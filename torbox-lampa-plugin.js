/* ... початок файлу ... */
(function () {
    'use strict';

    const PLUGIN_ID = 'torbox_enhanced_v30_0_6';
    if (window[PLUGIN_ID]) return;
    window[PLUGIN_ID] = true;

    // ─── core: utils ──────────────────────────────────────────────
    const Utils = { /* утиліти (escapeHtml, formatBytes, formatTime, formatAge, getQualityLabel, naturalSort) без змін */ };

    // ─── core: storage ────────────────────────────────────────────
    const safeStorage = (() => { /* реалізація safeStorage для localStorage або пам’яті */ })();
    const Store = { /* обгорнуті get/set для Storage */ };

    // ─── core: cache ────────────────────────────────────────────
    const Cache = (() => { /* LRU-кеш для обмеження пам’яті, без змін */ })();

    // ─── core: config ────────────────────────────────────────────
    const Config = (() => {
        const DEFAULTS = { proxyUrl: 'https://my-torbox-proxy.slonce70.workers.dev/', apiKey: '' };
        const CFG = { /* зберігання налаштувань (debug, proxyUrl, apiKey) */ };
        const LOG = (...a) => CFG.debug && console.log('[TorBox]', ...a);
        const PUBLIC_PARSERS = [
            { name: 'Viewbox', url: 'jacred.viewbox.dev', key: 'viewbox' },
            { name: 'Jacred', url: 'jacred.xyz', key: '' }
        ];
        const ICON = `<svg width="24" height="24" ...>...</svg>`;  // SVG-іконка TorBox
        return { CFG, LOG, PUBLIC_PARSERS, ICON };
    })();
    const { CFG, LOG, PUBLIC_PARSERS, ICON } = Config;

    // ─── core: api ────────────────────────────────────────────────
    const Api = (() => {
        const MAIN_API = 'https://api.torbox.app/v1/api';

        const _processResponse = (responseText, status) => { /* обробка відповіді fetch (без змін) */ };

        const request = async (url, options = {}, signal) => { /* HTTP-запит через CORS-проксі, з заголовком X-Api-Key, без змін */ };

        const searchPublicTrackers = async (movie, signal) => {
            // Послідовний обхід публічних парсерів (спершу Viewbox, потім Jacred тощо)
            for (const parser of PUBLIC_PARSERS) {
                // Формуємо URL для поточного парсера
                const params = new URLSearchParams({
                    apikey: parser.key,
                    Query: `${movie.title} ${movie.year || ''}`.trim(),
                    title: movie.title,
                    title_original: movie.original_title,
                    Category: '2000,5000'
                });
                if (movie.year) params.append('year', movie.year);
                const url = `https://${parser.url}/api/v2.0/indexers/all/results?${params.toString()}`;
                LOG(`Trying parser: ${parser.name} with URL: ${url}`);
                try {
                    const json = await request(url, { method: 'GET', is_torbox_api: false }, signal);
                    if (json && Array.isArray(json.Results) && json.Results.length) {
                        LOG(`Success from parser ${parser.name}. Found ${json.Results.length} torrents.`);
                        return json.Results;  // Повертаємо результати, якщо знайдено
                    } else {
                        LOG(`Parser ${parser.name} returned no results.`);
                    }
                } catch (error) {
                    LOG(`Parser ${parser.name} failed:`, error.message);
                    // Продовжуємо до наступного парсера, якщо виникла помилка або нема результату
                }
            }
            // Якщо жоден парсер не дав результатів – генеруємо помилку
            throw { type: 'api', message: 'Усі публічні парсери недоступні або не дали результатів.' };
        };

        const checkCached = async (hashes, signal) => { /* перевірка кешу на TorBox, без змін */ };
        const addMagnet = (magnet, signal) => { /* додавання magnet до TorBox, без змін */ };
        const stopTorrent = (torrentId, signal) => { /* зупинка (pause) торренту, без змін */ };
        const myList = (torrentId, signal) => { /* отримання списку торрентів користувача, без змін */ };
        const requestDl = (torrentId, fid, signal) => { /* отримання прямого URL для файлу торренту, без змін */ };

        return { request, searchPublicTrackers, checkCached, addMagnet, stopTorrent, myList, requestDl };
    })();

    // ─── ui: components & modals ──────────────────────────────────
    const UI = (() => {
        const showStatusModal = (title, onBack) => { /* показ модального вікна статусу (завантаження/прогрес), без змін */ };
        const updateStatusModal = (data) => { /* оновлення прогрес-бару і статистики в модальному вікні, без змін */ };
        const ErrorHandler = { show: (type, error) => { /* показ повідомлення про помилку через Lampa.Noty, без змін */ } };
        return { showStatusModal, updateStatusModal, ErrorHandler };
    })();
    const { ErrorHandler } = UI;

    // ─── component: TorBoxComponent ───────────────────────────────
    function TorBoxComponent(object) {
        // Прив’язуємо контекст до методів компоненту
        for (const key in this) { if (typeof this[key] === 'function') this[key] = this[key].bind(this); }
        // Зберігаємо посилання на поточну активність та дані фільму
        this.activity = object.activity;
        this.movie = object.movie;
        this.params = object;
        this.abortController = new AbortController();

        // Параметри сортування (ключ, назва, поле, напрямок)
        this.sort_types = [
            { key: 'seeders', title: 'По сидам (убыв.)', field: 'last_known_seeders', reverse: true },
            { key: 'size_desc', title: 'По размеру (убыв.)', field: 'size', reverse: true },
            { key: 'size_asc', title: 'По размеру (возр.)', field: 'size', reverse: false },
            { key: 'age', title: 'По дате добавления', field: 'publish_date', reverse: true }
        ];

        // Параметри фільтра (за замовчуванням — «all» для всіх значень)
        this.defaultFilters = { quality: 'all', tracker: 'all', video_type: 'all', translation: 'all', lang: 'all', video_codec: 'all', audio_codec: 'all' };

        // Стан компоненту
        this.state = {
            scroll: null, files: null, filter: null, last: null, initialized: false,
            all_torrents: [],
            sort: Store.get('torbox_sort_method', 'seeders'),
            filters: JSON.parse(Store.get('torbox_filters_v2', JSON.stringify(this.defaultFilters))),
            ageCache: new Map()
        };
    }

    // Життєвий цикл компоненту (create, render, start, pause, stop, destroy)
    TorBoxComponent.prototype.create = function() {
        LOG("Component create() -> initialize()");
        this.initialize();
        return this.render();
    };
    TorBoxComponent.prototype.render = function() { return this.state.files.render(); };
    TorBoxComponent.prototype.start = function () {
        LOG("Component start()");
        this.activity.loader(false);
        // Реєструємо контролери для фільтра (head) та списку (content)
        Lampa.Controller.add('head', {
            toggle: () => {
                Lampa.Controller.collectionSet(this.state.filter.render());
                Lampa.Controller.collectionFocus(false, this.state.filter.render());
            },
            right: () => window.Navigator.move('right'),
            left: () => window.Navigator.move('left'),
            down: () => Lampa.Controller.toggle('content'),
            back: () => Lampa.Controller.toggle('content')
        });
        Lampa.Controller.add('content', {
            toggle: () => {
                Lampa.Controller.collectionSet(this.state.scroll.render());
                Lampa.Controller.collectionFocus(this.state.last || false, this.state.scroll.render());
            },
            up: () => {
                if (this.state.scroll.is_first()) Lampa.Controller.toggle('head');
                else window.Navigator.move('up');
            },
            down: () => window.Navigator.move('down'),
            left: () => Lampa.Controller.toggle('menu'),
            back: () => {
                if ($('body').find('.select').length) Lampa.Select.close();
                else if ($('body').find('.filter').length) {
                    Lampa.Filter.hide();
                    Lampa.Controller.toggle('content');
                } else {
                    Lampa.Activity.backward();
                }
            }
        });
        Lampa.Controller.toggle('content');
    };
    TorBoxComponent.prototype.pause = function() { LOG('Component pause()'); Lampa.Controller.add('content', null); Lampa.Controller.add('head', null); };
    TorBoxComponent.prototype.stop = function() { LOG('Component stop()'); Lampa.Controller.add('content', null); Lampa.Controller.add('head', null); };
    TorBoxComponent.prototype.destroy = function() {
        LOG('Destroying TorBox component');
        this.abortController.abort();
        Lampa.Controller.add('content', null);
        Lampa.Controller.add('head', null);
        if (this.state.scroll) this.state.scroll.destroy();
        if (this.state.files) this.state.files.destroy();
        if (this.state.filter) this.state.filter.destroy();
        // Очищуємо усі поля стану
        for (let key in this.state) this.state[key] = null;
    };

    TorBoxComponent.prototype.initialize = function() {
        if (this.state.initialized) return;
        LOG("Component initialize()");
        // Створюємо компоненти скролу, списка файлів та фільтра
        this.state.scroll = new Lampa.Scroll({ mask: true, over: true });
        this.state.files = new Lampa.Explorer(this.params);
        this.state.filter = new Lampa.Filter(this.params);
        // Ініціалізуємо обробники подій фільтра
        this.initializeFilterHandlers();
        if (this.state.filter.addButtonBack) this.state.filter.addButtonBack();
        // Налаштовуємо верстку: додаємо клас контейнеру списку та вставляємо елементи
        this.state.scroll.body().addClass('torrent-list');
        this.state.files.appendFiles(this.state.scroll.render());
        this.state.files.appendHead(this.state.filter.render());
        // Скоригуємо висоту області прокрутки, віднявши висоту шапки-фільтра
        this.state.scroll.minus(this.state.files.render().find('.explorer__files-head'));
        // Завантажуємо торренти і відображаємо список
        this.loadAndDisplayTorrents();
        this.state.initialized = true;
    };

    TorBoxComponent.prototype.initializeFilterHandlers = function() {
        // Обробник вибору опцій у фільтрі та сортуванні
        this.state.filter.onSelect = (type, a, b) => {
            Lampa.Select.close();
            if (type === 'sort') {
                this.state.sort = a.key;
                Store.set('torbox_sort_method', a.key);
            } else if (type === 'filter') {
                if (a.refresh) return this.loadAndDisplayTorrents(true);
                if (a.reset) this.state.filters = JSON.parse(JSON.stringify(this.defaultFilters));
                else if (a.stype) this.state.filters[a.stype] = b.value;
                Store.set('torbox_filters_v2', JSON.stringify(this.state.filters));
            }
            this.display();
            Lampa.Controller.toggle('content');
        };
        // Повернення з меню фільтра
        this.state.filter.onBack = () => Lampa.Controller.toggle('content');
    };

    TorBoxComponent.prototype.updateFilterUI = function() {
        const { filter, sort, filters, all_torrents } = this.state;
        const sort_items = this.sort_types.map(item => ({ ...item, selected: item.key === sort }));
        filter.set('sort', sort_items);
        filter.render().find('.filter--sort span').text('Сортировка');
        filter.chosen('sort', [ (this.sort_types.find(s => s.key === sort) || { title: '' }).title ]);
        if (!Array.isArray(all_torrents)) this.state.all_torrents = [];
        // Будуємо списки унікальних значень для кожного фільтра
        const buildFilter = (key, title, allItems) => {
            const uniqueItems = [...new Set(allItems.flat().filter(Boolean))].sort();
            const items = ['all', ...uniqueItems].map(i => ({
                title: i === 'all' ? 'Все' : i.toUpperCase(),
                value: i,
                selected: filters[key] === i
            }));
            const sub = filters[key] === 'all' ? 'Все' : filters[key].toUpperCase();
            return { title, subtitle: sub, items, stype: key };
        };
        const filter_items = [
            buildFilter('quality', 'Качество', all_torrents.map(t => t.quality)),
            buildFilter('video_type', 'Тип видео', all_torrents.map(t => t.video_type)),
            buildFilter('translation', 'Перевод', all_torrents.map(t => t.voices)),
            buildFilter('lang', 'Язык аудио', all_torrents.map(t => t.audio_langs)),
            buildFilter('video_codec', 'Видео кодек', all_torrents.map(t => t.video_codec)),
            buildFilter('audio_codec', 'Аудио кодек', all_torrents.map(t => t.audio_codecs)),
            buildFilter('tracker', 'Трекер', all_torrents.map(t => t.trackers)),
            { title: 'Сбросить фильтры', reset: true },
            { title: 'Обновить список', refresh: true }
        ];
        filter.set('filter', filter_items);
        filter.render().find('.filter--filter span').text('Фильтр');
        // Показуємо вибрані значення (для subtitle кнопки фільтра)
        const filter_titles = filter_items
            .filter(f => f.stype && filters[f.stype] !== 'all')
            .map(f => `${f.title}: ${filters[f.stype]}`);
        filter.chosen('filter', filter_titles);
    };

    TorBoxComponent.prototype.applyFiltersAndSort = function() {
        const { all_torrents, filters, sort } = this.state;
        if (!Array.isArray(all_torrents)) return [];
        // Застосовуємо фільтри
        let filtered = all_torrents.filter(t => {
            if (filters.quality !== 'all' && t.quality !== filters.quality) return false;
            if (filters.video_type !== 'all' && t.video_type !== filters.video_type) return false;
            if (filters.translation !== 'all' && !(t.voices || []).includes(filters.translation)) return false;
            if (filters.lang !== 'all' && !(t.audio_langs || []).includes(filters.lang)) return false;
            if (filters.video_codec !== 'all' && t.video_codec !== filters.video_codec) return false;
            if (filters.audio_codec !== 'all' && !(t.audio_codecs || []).includes(filters.audio_codec)) return false;
            if (filters.tracker !== 'all' && !(t.trackers || []).includes(filters.tracker)) return false;
            return true;
        });
        // Застосовуємо сортування
        const sort_method = this.sort_types.find(s => s.key === sort);
        if (sort_method) {
            filtered.sort((a, b) => {
                const field = sort_method.field;
                let valA = a[field] || 0, valB = b[field] || 0;
                if (field === 'publish_date') {
                    valA = valA ? new Date(valA).getTime() : 0;
                    valB = valB ? new Date(valB).getTime() : 0;
                }
                if (valA < valB) return -1;
                if (valA > valB) return 1;
                return 0;
            });
            if (sort_method.reverse) filtered.reverse();
        }
        return filtered;
    };

    TorBoxComponent.prototype.loadAndDisplayTorrents = async function(force_update = false) {
        this.activity.loader(true);
        this._renderEmpty('Завантаження...');
        try {
            const cacheKey = `torbox_hybrid_${this.movie.id || this.movie.imdb_id}`;
            LOG(`Checking cache for key: ${cacheKey}. Force update: ${force_update}`);
            if (!force_update && Cache.get(cacheKey)) {
                // Якщо в кеші вже є результати – беремо їх (уникаємо зайвих запитів)
                this.state.all_torrents = Cache.get(cacheKey);
            } else {
                this._renderEmpty('Отримання списку з публічних парсерів...');
                const rawTorrents = await Api.searchPublicTrackers(this.movie, this.abortController.signal);
                if (!rawTorrents?.length) {
                    // Якщо жоден парсер нічого не повернув – виводимо повідомлення і припиняємо
                    return this._renderEmpty('Парсер не повернув результатів.');
                }
                // Виділяємо з Magnet-посилань хеші торрентів
                const torrentsWithHashes = rawTorrents.map(raw => {
                    return raw?.MagnetUri?.match(/urn:btih:([a-fA-F0-9]{40})/i) 
                        ? { raw, hash: RegExp.$1 } 
                        : null;
                }).filter(Boolean);
                if (torrentsWithHashes.length === 0) {
                    return this._renderEmpty('Не знайдено жодного валідного торрента.');
                }
                this._renderEmpty(`Перевірка кешу для ${torrentsWithHashes.length} торрентів...`);
                // Запитуємо у TorBox API, які з знайдених торрентів доступні у кеші (Cloud)
                const cachedDataObject = await Api.checkCached(torrentsWithHashes.map(t => t.hash), this.abortController.signal);
                const cachedHashes = new Set(Object.keys(cachedDataObject).map(h => h.toLowerCase()));
                // Формуємо остаточний список торрентів з усією необхідною інформацією
                this.state.all_torrents = torrentsWithHashes.map(({ raw, hash }) => this._processRawTorrent(raw, hash, cachedHashes));
                Cache.set(cacheKey, this.state.all_torrents);
            }
            // Відображаємо список торрентів після отримання та обробки
            this.display();
        } catch (error) {
            this._renderEmpty(error.message || 'Произошла ошибка');
            ErrorHandler.show(error.type || 'unknown', error);
        } finally {
            this.activity.loader(false);
        }
    };

    TorBoxComponent.prototype._processRawTorrent = function(raw, hash, cachedHashes) {
        // Збираємо потрібні поля з сирих даних парсерів та доповнюємо розрахованими
        const videoStream = raw.ffprobe?.find(s => s.codec_type === 'video');
        const audioStreams = raw.ffprobe?.filter(s => s.codec_type === 'audio') || [];
        return {
            raw_title: raw.Title,
            size: raw.Size,
            magnet: raw.MagnetUri,
            hash,
            last_known_seeders: raw.Seeders,
            last_known_peers: raw.Peers || raw.Leechers,
            trackers: (raw.Tracker || '').split(/, ?/).map(t => t.trim()).filter(Boolean),
            cached: cachedHashes.has(hash.toLowerCase()),
            publish_date: raw.PublishDate,
            age: Utils.formatAge(raw.PublishDate),
            quality: Utils.getQualityLabel(raw.Title, raw),
            video_type: raw.info?.videotype?.toLowerCase(),
            voices: raw.info?.voices,
            video_codec: videoStream?.codec_name,
            video_resolution: videoStream ? `${videoStream.width}x${videoStream.height}` : null,
            audio_langs: [...new Set(audioStreams.map(s => s.tags?.language).filter(Boolean))],
            audio_codecs: [...new Set(audioStreams.map(s => s.codec_name).filter(Boolean))],
            has_hdr: /hdr/i.test(raw.Title) || raw.info?.videotype?.toLowerCase() === 'hdr',
            has_dv: /dv|dolby vision/i.test(raw.Title) || raw.info?.videotype?.toLowerCase() === 'dovi',
            raw_data: raw
        };
    };

    TorBoxComponent.prototype.display = function() {
        // Оновлюємо інтерфейс фільтра (виділені опції) та будуємо відсортований/відфільтрований список
        this.updateFilterUI();
        this.draw(this.applyFiltersAndSort());
    };

    TorBoxComponent.prototype.draw = function(torrents_list) {
        this.state.last = null;
        $(this.state.scroll.render()).empty();
        if (!torrents_list?.length) {
            return this._renderEmpty('Нічого не знайдено за заданими фільтрами');
        }
        const lastPlayedTorrentKey = `torbox_last_torrent_${this.movie.imdb_id || this.movie.id}`;
        const lastTorrentHash = Store.get(lastPlayedTorrentKey, null);
        // Генеруємо DOM-фрагмент зі списком торрентів
        const fragment = document.createDocumentFragment();
        torrents_list.forEach(t => {
            const item = this._createTorrentDOMItem(t, lastTorrentHash);
            // Додаємо обробники для навігації: фокус та вибір елементу
            $(item).on('hover:focus', () => {
                this.state.last = item;
                this.state.scroll.update($(item), true);
            });
            $(item).on('hover:enter', () => this._handleTorrentClick(t));
            fragment.appendChild(item);
        });
        this.state.scroll.render().append(fragment);
    };

    TorBoxComponent.prototype._createTorrentDOMItem = function(t, lastTorrentHash) {
        // Створюємо основний контейнер елементу
        const item = document.createElement('div');
        item.className = 'torbox-item selector';
        if (lastTorrentHash && t.hash === lastTorrentHash) {
            item.classList.add('torbox-item--last-played');
        }
        // Назва торренту (із значком кешування)
        const title = document.createElement('div');
        title.className = 'torbox-item__title';
        title.textContent = `${t.cached ? '⚡ ' : '☁️ '}${t.raw_title || t.title}`;
        // Основна інформація: якість, розмір, сіди/піри
        const mainInfo = document.createElement('div');
        mainInfo.className = 'torbox-item__main-info';
        mainInfo.innerHTML = `[${t.quality}] ${Utils.formatBytes(t.size)} | 🟢 <span style="color:var(--color-good);">${t.last_known_seeders || 0}</span> / 🔴 <span style="color:var(--color-bad);">${t.last_known_peers || 0}</span>`;
        // Додаткова інформація: трекери та вік (час з моменту додавання)
        const meta = document.createElement('div');
        meta.className = 'torbox-item__meta';
        meta.textContent = `Трекери: ${t.trackers?.join(', ') || 'н/д'} | Додано: ${t.age || 'н/д'}`;
        // Додаємо складові до контейнера елементу
        item.append(title, mainInfo, meta);
        // Якщо є технічні дані про відео/аудіо – додаємо панель тегів
        if (t.video_resolution) {
            const techBar = this._createTechBar(t);
            item.appendChild(techBar);
        }
        return item;
    };

    TorBoxComponent.prototype._createTechBar = function(t) {
        // Створюємо панель технічних тегів (якість відео, кодеки, аудіодоріжки)
        const techBar = document.createElement('div');
        techBar.className = 'torbox-item__tech-bar';
        const createTag = (text, type) => {
            const tag = document.createElement('div');
            tag.className = `torbox-item__tech-item torbox-item__tech-item--${type}`;
            tag.textContent = text;
            return tag;
        };
        // Теги: роздільна здатність, відеокодек, HDR, Dolby Vision
        techBar.appendChild(createTag(t.video_resolution, 'res'));
        if (t.video_codec) techBar.appendChild(createTag(t.video_codec.toUpperCase(), 'codec'));
        if (t.has_hdr) techBar.appendChild(createTag('HDR', 'hdr'));
        if (t.has_dv) techBar.appendChild(createTag('Dolby Vision', 'dv'));
        // Теги аудіодоріжок: для кожної мовної доріжки – мова, кодек, канальність
        (t.raw_data.ffprobe || []).filter(s => s.codec_type === 'audio').forEach(s => {
            const lang = s.tags?.language?.toUpperCase() || '???';
            const codec = s.codec_name?.toUpperCase() || '';
            const layout = s.channel_layout || '';
            techBar.appendChild(createTag(`${lang} ${codec} ${layout}`, 'audio'));
        });
        return techBar;
    };

    TorBoxComponent.prototype._renderEmpty = function(msg) {
        // Очищуємо список та показуємо повідомлення (якщо список порожній або йде завантаження)
        const scrollRender = this.state.scroll.render();
        scrollRender.empty();
        const emptyMsg = document.createElement('div');
        emptyMsg.className = 'empty';
        const text = document.createElement('div');
        text.className = 'empty__text';
        text.textContent = msg || 'Торренти не знайдені';
        emptyMsg.appendChild(text);
        scrollRender.append(emptyMsg);
        this.activity.loader(false);
    };

    TorBoxComponent.prototype._handleTorrentClick = async function(torrent) {
        try {
            if (!torrent?.magnet) throw { type: 'validation', message: 'Не найдена magnet-ссылка.' };
            // Запускаємо додавання торренту до TorBox (хмарного TorrServe)
            UI.showStatusModal('Додавання торрента...');
            const result = await Api.addMagnet(torrent.magnet, this.abortController.signal);
            const torrentId = result.data.torrent_id || result.data.id;
            if (!torrentId) throw { type: 'api', message: 'Не вдалося отримати ID торрента.' };
            // Відстежуємо статус завантаження торренту та чекаємо завершення (або появи файлів)
            const finalTorrentData = await this._trackTorrentStatus(torrentId, this.abortController.signal);
            finalTorrentData.hash = torrent.hash;  // Передаємо оригінальний хеш для позначки
            Lampa.Modal.close();
            this._showFileSelection(finalTorrentData);
        } catch (e) {
            if (e.type !== 'user' && e.name !== 'AbortError') ErrorHandler.show(e.type || 'unknown', e);
            Lampa.Modal.close();
        }
    };

    TorBoxComponent.prototype._trackTorrentStatus = function(torrentId, signal) {
        // Опитуємо TorBox API для відстеження прогресу завантаження торренту
        return new Promise((resolve, reject) => {
            let isTrackingActive = true;
            const poll = async () => {
                if (!isTrackingActive) return;
                try {
                    const torrentResult = await Api.myList(torrentId, signal);
                    const torrentData = torrentResult?.data?.[0];
                    if (!isTrackingActive) return;
                    if (!torrentData) {
                        throw { type: 'api', message: "Торрент не з'явився у списку після додавання." };
                    }
                    // Оновлюємо інформацію в модальному вікні статусу
                    const statusText = torrentData.download_state || torrentData.status;
                    const progressValue = parseFloat(torrentData.progress);
                    const progressPercent = isNaN(progressValue) ? 0 : (progressValue > 1 ? progressValue : progressValue * 100);
                    UI.updateStatusModal({
                        status: statusText,
                        progress: progressPercent,
                        progressText: `${progressPercent.toFixed(2)}% з ${Utils.formatBytes(torrentData.size)}`,
                        speed: `Швидкість: ${Utils.formatBytes(torrentData.download_speed, true)}`,
                        eta: `Залишилось: ${Utils.formatTime(torrentData.eta)}`,
                        peers: `Сіди: ${torrentData.seeds || 0} / Піри: ${torrentData.peers || 0}`
                    });
                    // Перевіряємо, чи завершено завантаження
                    const isDownloadFinished = statusText === 'completed' || torrentData.download_finished || progressPercent >= 100;
                    if (isDownloadFinished && torrentData.files?.length > 0) {
                        isTrackingActive = false;
                        if (statusText.startsWith('uploading')) {
                            UI.updateStatusModal({ status: 'Завантаження завершено. Зупинка роздачі...', progress: 100 });
                            await Api.stopTorrent(torrentData.id, signal).catch(e => LOG('Не вдалося зупинити роздачу:', e.message));
                        }
                        resolve(torrentData);
                    } else if (isTrackingActive) {
                        setTimeout(poll, 5000);
                    }
                } catch (error) {
                    isTrackingActive = false;
                    reject(error);
                }
            };
            // Відображаємо модальне вікно статусу з можливістю скасування
            const onCancel = () => {
                if (isTrackingActive) {
                    isTrackingActive = false;
                    reject({ type: 'user', message: 'Відмінено користувачем' });
                }
            };
            UI.showStatusModal('Відстеження статусу...', onCancel);
            if (signal) signal.addEventListener('abort', onCancel);
            poll();
        });
    };

    TorBoxComponent.prototype._showFileSelection = function(torrentData) {
        // Формуємо список відеофайлів торренту для вибору користувачем
        let files = torrentData.files.filter(f => /\.(mkv|mp4|avi)$/i.test(f.name));
        if (!files.length) throw { type: 'validation', message: 'Відтворювані відеофайли не знайдені.' };
        files.sort(Utils.naturalSort);
        const playFile = (file) => this._playFile(torrentData.id, torrentData.hash, file);
        if (files.length === 1) {
            // Якщо файл лише один – запускаємо відтворення одразу
            return playFile(files[0]);
        }
        // Якщо файлів кілька – будуємо список для меню вибору
        const lastPlayedFileId = Store.get(`torbox_last_played_${this.movie.imdb_id || this.movie.id}`, null);
        const fileItems = files.map(f => {
            const isLast = lastPlayedFileId && String(f.id) === String(lastPlayedFileId);
            return {
                title: isLast ? `▶️ ${f.name}` : f.name,
                subtitle: Utils.formatBytes(f.size),
                file: f,
                cls: isLast ? 'select__item--last-played' : undefined
            };
        });
        Lampa.Select.show({
            title: 'Вибір файлу для відтворення',
            items: fileItems,
            onSelect: item => playFile(item.file),
            onBack: () => Lampa.Controller.toggle('content')
        });
    };

    TorBoxComponent.prototype._playFile = async function(torrentId, torrentHash, file) {
        // Отримуємо від TorBox прямий URL для вибраного файлу і запускаємо програвач Lampa
        UI.showStatusModal('Отримання посилання на файл...');
        try {
            const dlResponse = await Api.requestDl(torrentId, file.id, this.abortController.signal);
            const movieId = this.movie.imdb_id || this.movie.id;
            Store.set(`torbox_last_torrent_${movieId}`, torrentHash);
            Store.set(`torbox_last_played_${movieId}`, String(file.id));
            const player_data = { url: dlResponse.data || dlResponse.url, title: file.name || this.movie.title, poster: this.movie.img };
            Lampa.Modal.close();
            Lampa.Player.play(player_data);
            Lampa.Player.listener.follow('complite', () => this.display());  // Після завершення – оновлюємо виділення переглянутого
        } catch (e) {
            ErrorHandler.show(e.type || 'unknown', e);
            Lampa.Modal.close();
        }
    };

    // ─── plugin: main logic ───────────────────────────────────────
    const Plugin = (() => {
        let activityWatcher = null;
        const addSettings = () => {
            if (!Lampa.SettingsApi) return;
            Lampa.SettingsApi.addComponent({ component: 'torbox_enh', name: 'TorBox Enhanced', icon: ICON });
            const fields = [
                { k: 'torbox_proxy_url', n: 'URL вашого CORS-проксі', d: `За замовчуванням: ${CFG.proxyUrl}`, t: 'input', v: CFG.proxyUrl },
                { k: 'torbox_api_key', n: 'Ваш особистий API-Key', d: 'За замовчуванням використовується гостьовий ключ', t: 'input', v: CFG.apiKey },
                { k: 'torbox_debug', n: 'Режим налагодження', d: 'Записувати детальну інформацію в консоль', t: 'trigger', v: CFG.debug }
            ];
            fields.forEach(p => {
                Lampa.SettingsApi.addParam({
                    component: 'torbox_enh',
                    param: { name: p.k, type: p.t, values: '', default: p.v },
                    field: { name: p.n, description: p.d },
                    onChange: v => {
                        const val = (typeof v === 'object' ? v.value : v);
                        if (p.k === 'torbox_proxy_url') CFG.proxyUrl = String(val).trim();
                        if (p.k === 'torbox_api_key') CFG.apiKey = String(val).trim();
                        if (p.k === 'torbox_debug') CFG.debug = Boolean(val);
                    },
                    onRender: field => {
                        if (p.k === 'torbox_api_key') field.find('input').attr('type', 'password');
                    }
                });
            });
        };
        const boot = () => {
            // Додаємо кнопку TorBox на екран детальної інформації про фільм
            Lampa.Listener.follow('full', e => {
                if (e.type !== 'complite' || !e.data.movie) return;
                const root = e.object.activity.render();
                if (!root || !root.length) return;
                if (root.find('.view--torbox').length) return;  // Кнопка вже додана
                const btn = $(`<div class="full-start__button selector view--torbox" data-subtitle="TorBox">${ICON}<span>TorBox</span></div>`);
                btn.on('hover:enter', () => {
                    Lampa.Activity.push({
                        component: 'torbox_component',
                        title: 'TorBox - ' + (e.data.movie.title || e.data.movie.name),
                        movie: e.data.movie
                    });
                });
                const torrentButton = root.find('.view--torrent');
                if (torrentButton.length) {
                    torrentButton.after(btn);
                }
            });
        };
        const setupGlobalActivityListener = () => {
            let wasInExternalPlayer = false;
            // Відстежуємо глобальні події навігації Lampa, щоб коректно повертатися після зовнішнього плеєра
            activityWatcher = Lampa.Listener.follow('activity', e => {
                if (e.type === 'start') {
                    if (wasInExternalPlayer && e.object.component === 'torbox_component') {
                        LOG('Detected return to TorBox from external player');
                        wasInExternalPlayer = false;
                        setTimeout(() => {
                            try {
                                // Після повернення – оновлюємо відображення списку і фокус
                                e.object.activity.component.display();
                                Lampa.Controller.toggle('content');
                                LOG('Navigation and display restored');
                            } catch (error) {
                                LOG('Error restoring navigation:', error);
                            }
                        }, 250);
                    }
                } else if (e.type === 'destroy') {
                    if (e.object.component === 'torbox_component') {
                        wasInExternalPlayer = true;
                        LOG('Detected possible external player launch from TorBox');
                    }
                }
            });
        };
        const init = () => {
            // Додаємо стилі для елементів інтерфейсу плагіна
            const style = document.createElement('style');
            style.id = 'torbox-component-styles';
            style.textContent = `
                .torbox-item { padding: 1em 1.2em; margin: .5em 0; border-radius: .8em; background: var(--color-background-light); cursor: pointer; transition: all .3s ease; border: 2px solid transparent; overflow: hidden; }
                .torbox-item--last-played { border-left: 4px solid var(--color-second); background-color: rgba(var(--color-second-rgb), 0.1); }
                .torbox-item:hover, .torbox-item.focus { background: var(--color-primary); color: var(--color-background); transform: translateX(.8em); border-color: rgba(255,255,255,.3); box-shadow: 0 4px 20px rgba(0,0,0,.2); }
                .torbox-item:hover .torbox-item__tech-bar, .torbox-item.focus .torbox-item__tech-bar { background: rgba(0,0,0,0.2); }
                .torbox-item__title { font-weight: 600; margin-bottom: .3em; font-size: 1.1em; line-height: 1.3; }
                .torbox-item__main-info { font-size: .95em; opacity: .9; line-height: 1.4; margin-bottom: .3em; }
                .torbox-item__meta { font-size: .9em; opacity: .7; line-height: 1.4; margin-bottom: .8em; }
                .torbox-item__tech-bar { display: flex; flex-wrap: wrap; gap: .6em; margin: 0 -1.2em -1em -1.2em; padding: .6em 1.2em; background: rgba(0,0,0,0.1); font-size: .85em; font-weight: 500; }
                .torbox-item__tech-item { display: inline-block; padding: .2em .5em; border-radius: .4em; }
                .torbox-item__tech-item--res { background-color: #3b82f6; color: white; }
                .torbox-item__tech-item--codec { background-color: #16a34a; color: white; }
                .torbox-item__tech-item--audio { background-color: #f97316; color: white; }
                .torbox-item__tech-item--hdr { background: linear-gradient(45deg, #ff8c00, #ffa500); color: white; }
                .torbox-item__tech-item--dv { background: linear-gradient(45deg, #4b0082, #8a2be2); color: white; }
                .select__item.select__item--last-played > .select__item-title { color: var(--color-second) !important; font-weight: 600; }
                .torrent-list { padding: 1em; }
                .torbox-status { padding: 1.5em 2em; text-align: center; min-height: 200px; }
                .torbox-status__title { font-size: 1.4em; margin-bottom: 1em; font-weight: 600; }
                .torbox-status__info { font-size: 1.1em; margin-bottom: 0.8em; color: var(--color-text); }
                .torbox-status__progress-container { margin: 1.5em 0; background: rgba(255,255,255,0.1); border-radius: 8px; overflow: hidden; height: 12px; position: relative; }
                .torbox-status__progress-bar { height: 100%; width: 0%; background: linear-gradient(90deg, var(--color-primary), var(--color-primary-light, #4CAF50)); transition: width 0.5s ease-out; border-radius: 8px; position: relative; }
                .torbox-status__progress-bar::after { content: ''; position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: linear-gradient(45deg, transparent 30%, rgba(255,255,255,0.2) 50%, transparent 70%); animation: shimmer 2s infinite; }
                @keyframes shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
            `;
            document.head.appendChild(style);
            // Реєструємо компонент та налаштування плагіна в Lampa
            Lampa.Component.add('torbox_component', TorBoxComponent);
            addSettings();
            boot();
            setupGlobalActivityListener();
            LOG('TorBox v30.0.6 (Updated) ready');
        };
        return { init };
    })();

    // ─── bootloader: запускаємо ініціалізацію плагіна після завантаження Lampa ───
    (function bootLoop() {
        if (window.Lampa?.Activity) {
            try { Plugin.init(); }
            catch (e) { console.error('[TorBox] Boot Error:', e); }
        } else {
            setTimeout(bootLoop, 300);
        }
    })();
})();
/* ... кінець файлу ... */
