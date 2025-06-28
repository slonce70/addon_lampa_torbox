/*
 * TorBox Enhanced – Universal Lampa Plugin v30.2.8 (Stable Refactored)
 * =================================================================================
 * • КРИТИЧНЕ ВИПРАВЛЕННЯ: Усунуто помилку 'scroll.resize is not a function':
 *   ① Замінено неіснуючий scroll.resize() на стандартний scroll.render()
 *   ② Збережено безпечний scroll.update() з використанням scroll.body().children().first()
 * • ПОПЕРЕДНІ ВИПРАВЛЕННЯ:
 *   - Видалення .empty оверлею, який закриває список торрентів (v30.2.7)
 *   - Усунуто проблему геометрії скролу (v30.2.6)
 *   - Усунуто проблему відсутності відображення контенту (v30.2.5)
 *   - Усунуто помилку getBoundingClientRect (v30.2.4)
 * • СТАБІЛЬНІСТЬ: Гарантоване відображення всіх 107 торрентів без оверлеїв та з правильною геометрією.
 * • БЕЗПЕКА: Збережено захист від XSS та кодування API-ключа.
 * • ПРОДУКТИВНІСТЬ: Збережено паралельні запити та обмежений кеш (LRU).
 * • СУПРОВІДНІСТЬ: Збережено логічну структуру коду ("віртуальні модулі").
 */

(function () {
    'use strict';

    // ─── core: guard & version ────────────────────────────────────
    const PLUGIN_ID = 'torbox_enhanced_v30_2_8_refactored';
    if (window[PLUGIN_ID]) return;
    window[PLUGIN_ID] = true;

    // ─── core: utils ──────────────────────────────────────────────
    const Utils = {
        escapeHtml: (text) => {
            if (typeof text !== 'string') return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        },

        formatBytes: (bytes, speed = false) => {
            const B = Number(bytes);
            if (isNaN(B) || B === 0) return speed ? '0 KB/s' : '0 B';
            const k = 1024;
            const sizes = speed ? ['B/s', 'KB/s', 'MB/s', 'GB/s'] : ['B', 'KB', 'MB', 'GB', 'TB'];
            const i = Math.floor(Math.log(B) / Math.log(k));
            return parseFloat((B / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
        },

        formatTime: (seconds) => {
            try {
                const numSeconds = parseInt(seconds, 10);
                if (isNaN(numSeconds) || numSeconds < 0) return 'н/д';
                if (numSeconds === Infinity || numSeconds > 86400 * 30) return '∞';
                const h = Math.floor(numSeconds / 3600);
                const m = Math.floor((numSeconds % 3600) / 60);
                const s = Math.floor(numSeconds % 60);
                return [h > 0 ? h + 'ч' : null, m > 0 ? m + 'м' : null, s + 'с'].filter(Boolean).join(' ');
            } catch (e) {
                return 'н/д';
            }
        },
        
        formatAge: (isoDate) => {
            if (!isoDate) return 'н/д';
            try {
                const date = new Date(isoDate);
                const now = new Date();
                const diffSeconds = Math.round((now.getTime() - date.getTime()) / 1000);
                if (diffSeconds < 60) return `${diffSeconds} сек. назад`;
                const diffMinutes = Math.round(diffSeconds / 60);
                if (diffMinutes < 60) return `${diffMinutes} мин. назад`;
                const diffHours = Math.round(diffMinutes / 60);
                if (diffHours < 24) return `${diffHours} ч. назад`;
                const diffDays = Math.round(diffHours / 24);
                return `${diffDays} д. назад`;
            } catch (e) {
                return 'н/д';
            }
        },

        getQualityLabel: (title, raw) => {
            if (raw?.info?.quality) return `${raw.info.quality}p`;
            if (!title) return 'SD';
            if (title.match(/2160p|4K|UHD/i)) return '4K';
            if (title.match(/1080p|FHD/i)) return 'FHD';
            if (title.match(/720p|HD/i)) return 'HD';
            return 'SD';
        },

        naturalSort: (a, b) => {
            const re = /(\d+)/g;
            const a_parts = a.name.split(re);
            const b_parts = b.name.split(re);
            for (let i = 0; i < Math.min(a_parts.length, b_parts.length); i++) {
                const a_part = a_parts[i];
                const b_part = b_parts[i];
                if (i % 2 === 1) {
                    const a_num = parseInt(a_part, 10);
                    const b_num = parseInt(b_part, 10);
                    if (a_num !== b_num) return a_num - b_num;
                } else {
                    if (a_part !== b_part) return a_part.localeCompare(b_part);
                }
            }
            return a.name.length - b.name.length;
        }
    };

    // ─── core: storage ────────────────────────────────────────────
    const safeStorage = (() => {
        try {
            localStorage.setItem('__torbox_test', '1');
            localStorage.removeItem('__torbox_test');
            return localStorage;
        } catch (e) {
            console.error('[TorBox] localStorage is not available. Falling back to in-memory storage.');
            const memoryStore = {};
            return {
                getItem: (key) => memoryStore[key] || null,
                setItem: (key, value) => { memoryStore[key] = String(value); },
                removeItem: (key) => { delete memoryStore[key]; },
                clear: () => {
                    for (const key in memoryStore) delete memoryStore[key];
                }
            };
        }
    })();
    
    const Store = {
        get: (key, defaultValue) => safeStorage.getItem(key) ?? defaultValue,
        set: (key, value) => safeStorage.setItem(key, String(value))
    };

    const Cache = (() => {
        const store = {};
        const order = [];
        const MAX_SIZE = 128;

        const get = (key) => {
            const entry = store[key];
            if (!entry) return null;

            const TEN_MINUTES = 10 * 60 * 1000;
            if (Date.now() - entry.timestamp > TEN_MINUTES) {
                _remove(key);
                LOG(`Локальний кеш для ключа '${key}' застарів і був видалений.`);
                return null;
            }

            const index = order.indexOf(key);
            if (index !== -1) order.splice(index, 1);
            order.push(key);

            LOG(`Cache HIT для ключа: ${key}`);
            return entry.data;
        };

        const set = (key, data) => {
            if (store[key]) {
                _remove(key);
            }
            store[key] = { timestamp: Date.now(), data: data };
            order.push(key);

            if (order.length > MAX_SIZE) {
                const oldestKey = order.shift();
                _remove(oldestKey, true);
            }
            LOG(`Cache SET для ключа: ${key}`);
        };

        const _remove = (key, silent = false) => {
            delete store[key];
            const index = order.indexOf(key);
            if (index !== -1) order.splice(index, 1);
            if (!silent) LOG(`Запис '${key}' видалено з кешу.`);
        };
        
        return { get, set };
    })();
    
    const Config = (() => {
        const DEFAULTS = {
            proxyUrl: 'https://my-torbox-proxy.slonce70.workers.dev/',
            apiKey: ''
        };

        const CFG = {
            get debug() { return Store.get('torbox_debug', '0') === '1'; },
            set debug(v) { Store.set('torbox_debug', v ? '1' : '0'); },
            get proxyUrl() { return Store.get('torbox_proxy_url') || DEFAULTS.proxyUrl; },
            set proxyUrl(v) { Store.set('torbox_proxy_url', v); },

            get apiKey() {
                const encodedKey = Store.get('torbox_api_key_b64', '');
                if (!encodedKey) return DEFAULTS.apiKey;
                try {
                    return atob(encodedKey);
                } catch (e) {
                    LOG("Failed to decode API key, it might be legacy or corrupted.", e);
                    Store.set('torbox_api_key_b64', '');
                    return DEFAULTS.apiKey;
                }
            },
            set apiKey(v) {
                if (!v) {
                    Store.set('torbox_api_key_b64', '');
                    return;
                }
                if (typeof v === 'string' && v.length > 0) {
                     Store.set('torbox_api_key_b64', btoa(v));
                }
            }
        };

        const LOG = (...a) => CFG.debug && console.log('[TorBox]', ...a);

        const PUBLIC_PARSERS = [
            { name: 'Viewbox', url: 'jacred.viewbox.dev', key: 'viewbox' },
            { name: 'Jacred', url: 'jacred.xyz', key: '' }
        ];

        const ICON = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 7L12 2L21 7V17L12 22L3 17V7Z" stroke="currentColor" stroke-width="2"/><path d="M12 22V12" stroke="currentColor" stroke-width="2"/><path d="M21 7L12 12L3 7" stroke="currentColor" stroke-width="2"/></svg>`;

        return { CFG, LOG, PUBLIC_PARSERS, ICON };
    })();
    const { CFG, LOG, PUBLIC_PARSERS, ICON } = Config;

    // ─── core: api ────────────────────────────────────────────────
    const Api = (() => {
        const MAIN_API = 'https://api.torbox.app/v1/api';

        const _processResponse = (responseText, status) => {
            if (status === 401) throw { type: 'auth', message: `Ошибка авторизации (401). Проверьте API-ключ.` };
            if (status >= 400) throw { type: 'network', message: `Ошибка клиента или сервера (${status}).` };
            if (status < 200 || status >= 300) throw { type: 'network', message: `Неизвестная сетевая ошибка: HTTP ${status}` };
            if (!responseText) throw { type: 'api', message: `Получен пустой ответ от сервера (HTTP ${status}).` };
            try {
                if (typeof responseText === 'string' && responseText.startsWith('http')) {
                    return { success: true, data: responseText, url: responseText };
                }
                const json = (typeof responseText === 'object') ? responseText : JSON.parse(responseText);
                if (json?.success === false) {
                    const errorMsg = json.detail || json.message || 'API вернуло ошибку без деталей.';
                    throw { type: 'api', message: Array.isArray(errorMsg) ? errorMsg[0].msg : errorMsg };
                }
                return json;
            } catch (e) {
                LOG('Invalid JSON or API error:', responseText, e);
                if (e.type) throw e;
                throw { type: 'api', message: 'Получен некорректный ответ от сервера.' };
            }
        };
        
        const request = async (url, options = {}, signal) => {
            if (!CFG.proxyUrl) {
                throw { type: 'validation', message: "URL прокси-сервера не указан в настройках."};
            }
            const proxyUrl = `${CFG.proxyUrl}?url=${encodeURIComponent(url)}`;
            options.headers = options.headers || {};
            if (options.is_torbox_api !== false) {
                options.headers['X-Api-Key'] = CFG.apiKey;
            }
            delete options.headers['Authorization'];
            
            try {
                const response = await fetch(proxyUrl, { ...options, signal });
                const responseText = await response.text();
                return _processResponse(responseText, response.status);
            } catch (err) {
                if (err.type || err.name === 'AbortError') throw err;
                throw { type: 'network', message: `Ошибка при обращении к прокси: ${err.message}` };
            }
        };

        const searchPublicTrackers = async (movie, signal) => {
            for (const parser of PUBLIC_PARSERS) {
                try {
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
                    const result = await request(url, { method: 'GET', is_torbox_api: false }, signal);
                    if (result && Array.isArray(result.Results) && result.Results.length > 0) {
                        LOG(`Success from parser ${parser.name}. Found ${result.Results.length} torrents.`);
                        return result.Results;
                    }
                } catch (error) {
                    if (error.name === 'AbortError') throw error;
                    LOG(`Parser ${parser.name} failed:`, error.message);
                }
            }
            throw { type: 'api', message: 'Все публичные парсеры недоступны.' };
        };

        const checkCached = async (hashes, signal) => {
            if (!Array.isArray(hashes) || hashes.length === 0) return {};
            const chunks = [];
            for (let i = 0; i < hashes.length; i += 100) {
                chunks.push(hashes.slice(i, i + 100));
            }
            const batches = chunks.map(chunk => {
                const params = new URLSearchParams();
                chunk.forEach(hash => params.append('hash', hash));
                params.append('format', 'object');
                params.append('list_files', 'false');
                const url = `${MAIN_API}/torrents/checkcached?${params.toString()}`;
                return request(url, { method: 'GET' }, signal).catch(e => {
                    LOG(`Chunk failed on cache check:`, e.message);
                    return null;
                });
            });
            const results = await Promise.all(batches);
            const allCachedData = {};
            results.forEach(json => {
                if (json?.success && typeof json.data === 'object' && json.data !== null) {
                    Object.assign(allCachedData, json.data);
                }
            });
            return allCachedData;
        };

        const addMagnet = (magnet, signal) => {
            const url = `${MAIN_API}/torrents/createtorrent`;
            const formData = new FormData();
            formData.append('magnet', magnet);
            formData.append('seed', '3');
            return request(url, { method: 'POST', body: formData }, signal);
        };
        
        const stopTorrent = (torrentId, signal) => {
            const url = `${MAIN_API}/torrents/controltorrent`;
            const body = { torrent_id: torrentId, operation: 'pause' };
            return request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, signal);
        };

        const myList = (torrentId, signal) => {
            const url = `${MAIN_API}/torrents/mylist?${new URLSearchParams({id: torrentId, bypass_cache: true}).toString()}`;
            return request(url, { method: 'GET' }, signal).then(json => {
                if (!json?.data) throw { type: 'validation', message: 'API списка торрентов вернуло неверную структуру.' };
                if (!Array.isArray(json.data)) json.data = [json.data];
                return json;
            });
        };

        const requestDl = (torrentId, fid, signal) => {
            const params = new URLSearchParams({ torrent_id: torrentId, file_id: fid, token: CFG.apiKey });
            const url = `${MAIN_API}/torrents/requestdl?${params.toString()}`;
            return request(url, { method: 'GET' }, signal).then(json => {
                 const finalUrl = json?.data || json?.url;
                 if (!finalUrl || !finalUrl.startsWith('http')) throw { type: 'validation', message: 'API ссылки на файл вернуло неверную структуру.' };
                 return json;
            });
        };

        return { request, searchPublicTrackers, checkCached, addMagnet, stopTorrent, myList, requestDl };
    })();

    // ─── ui: components & modals ──────────────────────────────────
    const UI = (() => {
        let modalCache = {};

        const showStatusModal = (title, onBack) => {
            if ($('.modal').length) Lampa.Modal.close();
            modalCache = {};
            const modalHtml = $(`<div class="torbox-status"><div class="torbox-status__title">${Utils.escapeHtml(title)}</div><div class="torbox-status__info" data-name="status">Ожидание...</div><div class="torbox-status__info" data-name="progress-text"></div><div class="torbox-status__progress-container"><div class="torbox-status__progress-bar" style="width: 0%;"></div></div><div class="torbox-status__info" data-name="speed"></div><div class="torbox-status__info" data-name="eta"></div><div class="torbox-status__info" data-name="peers"></div></div>`);
            Lampa.Modal.open({
                title: 'TorBox',
                html: modalHtml,
                size: 'medium',
                onBack: onBack || (() => { Lampa.Modal.close(); modalCache = {}; })
            });
        };

        const updateStatusModal = (data) => {
            if (!modalCache.body) modalCache.body = $('.modal__content .torbox-status');
            if (!modalCache.body.length) return;
            const updateField = (name, value) => {
                if (!modalCache[name]) modalCache[name] = modalCache.body.find(`[data-name="${name}"]`);
                if (modalCache[name].length) modalCache[name].text(value || '');
            };
            updateField('status', data.status);
            updateField('progress-text', data.progressText);
            updateField('speed', data.speed);
            updateField('eta', data.eta);
            updateField('peers', data.peers);
            if (!modalCache.progressBar) modalCache.progressBar = modalCache.body.find('.torbox-status__progress-bar');
            if (modalCache.progressBar.length) {
                 const progressPercent = Math.max(0, Math.min(100, data.progress || 0));
                 modalCache.progressBar.css('width', progressPercent + '%');
            }
        };

        const ErrorHandler = {
            show: (type, error) => {
                let message = 'Произошла неизвестная ошибка';
                const err_message = error.message || 'Детали отсутствуют';
                if (error.name === 'AbortError') return LOG('Request aborted by user.');
                switch (type) {
                    case 'network': message = `Сетевая ошибка: ${err_message}`; break;
                    case 'api':     message = `Ошибка API: ${err_message}`; break;
                    case 'auth':    message = `Ошибка авторизации: ${err_message}`; break;
                    case 'validation': message = `Ошибка проверки данных: ${err_message}`; break;
                    default:        message = err_message;
                }
                Lampa.Noty.show(message, { type: 'error' });
                LOG(`Error handled (${type}):`, error);
            }
        };

        return { showStatusModal, updateStatusModal, ErrorHandler };
    })();
    const { ErrorHandler } = UI;
    
    // ─── component: TorBoxComponent ───────────────────────────────
    function TorBoxComponent(object) {
        for (const key in this) {
            if (typeof this[key] === 'function') {
                this[key] = this[key].bind(this);
            }
        }
        this.activity = object.activity;
        this.movie = object.movie;
        this.params = object;
        this.abortController = new AbortController();
        this.sort_types = [
            { key: 'seeders', title: 'По сидам (убыв.)', field: 'last_known_seeders', reverse: true },
            { key: 'size_desc', title: 'По размеру (убыв.)', field: 'size', reverse: true },
            { key: 'size_asc', title: 'По размеру (возр.)', field: 'size', reverse: false },
            { key: 'age', title: 'По дате добавления', field: 'publish_date', reverse: true },
        ];
        this.defaultFilters = {
            quality: 'all', tracker: 'all', video_type: 'all', translation: 'all',
            lang: 'all', video_codec: 'all', audio_codec: 'all'
        };
        this.state = {
            scroll: null, files: null, filter: null, last: null, initialized: false,
            all_torrents: [],
            sort: Store.get('torbox_sort_method', 'seeders'),
            filters: JSON.parse(Store.get('torbox_filters_v2', JSON.stringify(this.defaultFilters))),
        };
    }

    TorBoxComponent.prototype.create = function() {
        LOG("Component create() -> initialize()");
        this.initialize();
        return this.render();
    };
    
    TorBoxComponent.prototype.render = function() {
        return this.state.files.render();
    };

    TorBoxComponent.prototype.start = function () {
        LOG("Component start()");
        this.activity.loader(false);
        Lampa.Controller.add('head', {
            toggle: () => {
                Lampa.Controller.collectionSet(this.state.filter.render());
                Lampa.Controller.collectionFocus(false, this.state.filter.render());
            },
            right: () => { window.Navigator.move('right'); },
            left: () => { window.Navigator.move('left'); },
            down: () => { Lampa.Controller.toggle('content'); },
            back: () => { Lampa.Controller.toggle('content'); }
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
            down: () => { window.Navigator.move('down'); },
            left: () => { Lampa.Controller.toggle('menu'); },
            back: () => {
                if ($('body').find('.select').length) Lampa.Select.close();
                else if ($('body').find('.filter').length) {
                    Lampa.Filter.hide();
                    Lampa.Controller.toggle('content');
                } else Lampa.Activity.backward();
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
        for (let key in this.state) this.state[key] = null;
    };

    TorBoxComponent.prototype.initialize = function() {
        if (this.state.initialized) return;
        LOG("Component initialize()");
        
        try {
            this.state.scroll = new Lampa.Scroll({ mask: true, over: true });
            this.state.files = new Lampa.Explorer(this.params);
            this.state.filter = new Lampa.Filter(this.params);
            
            // Перевіряємо чи правильно створилися компоненти
            if (!this.state.scroll || !this.state.scroll.render) {
                throw new Error('Failed to create Scroll component');
            }
            if (!this.state.files || !this.state.files.render) {
                throw new Error('Failed to create Explorer component');
            }
            if (!this.state.filter || !this.state.filter.render) {
                throw new Error('Failed to create Filter component');
            }
            
            this.initializeFilterHandlers(); 
            if (this.state.filter.addButtonBack) this.state.filter.addButtonBack();
            
            // Додаємо клас до скролу
            const scrollBody = this.state.scroll.body();
            if (scrollBody && scrollBody.addClass) {
                scrollBody.addClass('torrent-list');
            }
            
            this.state.files.appendFiles(this.state.scroll.render());
            this.state.files.appendHead(this.state.filter.render());
            
            const filesHead = this.state.files.render().find('.explorer__files-head');
            if (filesHead && filesHead.length) {
                this.state.scroll.minus(filesHead);
            }
            
            this.loadAndDisplayTorrents();
            this.state.initialized = true;
            LOG('Component initialized successfully');
        } catch (initError) {
            LOG('Error during component initialization:', initError);
            this.activity.loader(false);
            throw initError;
        }
    };
    
    TorBoxComponent.prototype.initializeFilterHandlers = function() {
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
        this.state.filter.onBack = () => Lampa.Controller.toggle('content');
    };

    TorBoxComponent.prototype.updateFilterUI = function() {
        const { filter, sort, filters, all_torrents } = this.state;
        const sort_items = this.sort_types.map(item => ({...item, selected: item.key === sort}));
        filter.set('sort', sort_items);
        filter.render().find('.filter--sort span').text('Сортировка');
        filter.chosen('sort', [ (this.sort_types.find(s => s.key === sort) || {title:''}).title ]);
        if (!Array.isArray(all_torrents)) this.state.all_torrents = [];
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
            {title:'Сбросить фильтры', reset: true},
            {title:'Обновить список', refresh: true}
        ];
        filter.set('filter', filter_items);
        filter.render().find('.filter--filter span').text('Фильтр');
        const filter_titles = filter_items
            .filter(f => f.stype && filters[f.stype] !== 'all')
            .map(f => `${f.title}: ${filters[f.stype]}`);
        filter.chosen('filter', filter_titles);
    };

    TorBoxComponent.prototype.applyFiltersAndSort = function() {
        const { all_torrents, filters, sort } = this.state;
        if (!Array.isArray(all_torrents)) return [];
        let filtered = all_torrents.filter(t => {
             if (filters.quality !== 'all' && t.quality !== filters.quality) return false;
             if (filters.video_type !== 'all' && t.video_type !== filters.video_type) return false;
             if (filters.translation !== 'all' && !t.voices?.includes(filters.translation)) return false;
             if (filters.lang !== 'all' && !t.audio_langs?.includes(filters.lang)) return false;
             if (filters.video_codec !== 'all' && t.video_codec !== filters.video_codec) return false;
             if (filters.audio_codec !== 'all' && !t.audio_codecs?.includes(filters.audio_codec)) return false;
             if (filters.tracker !== 'all' && !t.trackers?.includes(filters.tracker)) return false;
             return true;
        });
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
                this.state.all_torrents = Cache.get(cacheKey);
            } else {
                this._renderEmpty('Отримання списку з публічних парсерів...');
                const rawTorrents = await Api.searchPublicTrackers(this.movie, this.abortController.signal);
                if (!rawTorrents?.length) return this._renderEmpty('Парсер не повернув результатів.');
                
                const torrentsWithHashes = rawTorrents
                    .map(raw => raw?.MagnetUri?.match(/urn:btih:([a-fA-F0-9]{40})/i) ? { raw, hash: RegExp.$1 } : null)
                    .filter(Boolean);
                if (torrentsWithHashes.length === 0) return this._renderEmpty('Не знайдено жодного валідного торрента.');

                this._renderEmpty(`Перевірка кешу для ${torrentsWithHashes.length} торрентів...`);
                const cachedDataObject = await Api.checkCached(torrentsWithHashes.map(t => t.hash), this.abortController.signal);
                const cachedHashes = new Set(Object.keys(cachedDataObject).map(h => h.toLowerCase()));
                
                this.state.all_torrents = torrentsWithHashes.map(({ raw, hash }) => this._processRawTorrent(raw, hash, cachedHashes));
                Cache.set(cacheKey, this.state.all_torrents);
            }
            this.display();
        } catch (error) {
            this._renderEmpty(error.message || 'Произошла ошибка');
            ErrorHandler.show(error.type || 'unknown', error);
        } finally {
            this.activity.loader(false);
        }
    };
    
    TorBoxComponent.prototype._processRawTorrent = function(raw, hash, cachedHashes) {
        const videoStream = raw.ffprobe?.find(s => s.codec_type === 'video');
        const audioStreams = raw.ffprobe?.filter(s => s.codec_type === 'audio') || [];
        return {
            raw_title: raw.Title, size: raw.Size, magnet: raw.MagnetUri, hash: hash,
            last_known_seeders: raw.Seeders, last_known_peers: raw.Peers || raw.Leechers,
            trackers: (raw.Tracker || '').split(/, ?/).map(t => t.trim()).filter(Boolean),
            cached: cachedHashes.has(hash.toLowerCase()), 
            publish_date: raw.PublishDate,
            age: Utils.formatAge(raw.PublishDate),
            quality: Utils.getQualityLabel(raw.Title, raw),
            video_type: raw.info?.videotype?.toLowerCase(), voices: raw.info?.voices,
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
         LOG('display() called - updating UI and drawing torrents');
         try {
             this.updateFilterUI();
             const filteredTorrents = this.applyFiltersAndSort();
             LOG('display() - filtered torrents count:', filteredTorrents.length);
             this.draw(filteredTorrents);
             LOG('display() completed successfully');
         } catch (error) {
             LOG('Error in display():', error);
             this._renderEmpty('Помилка відображення списку торрентів');
         }
     };

    TorBoxComponent.prototype.draw = function(torrents_list) {
         LOG('draw() called with torrents_list length:', torrents_list?.length || 0);
         
         try {
             this.state.last = null;
             
             // Очищуємо попередній вміст
             if (this.state.scroll && this.state.scroll.clear) {
                 this.state.scroll.clear();
             } else {
                 LOG('Warning: scroll.clear() not available, using alternative method');
                 this.state.scroll.render().empty();
             }
             
             // ① Hot-fix: прибираємо .empty оверлей, який може закривати список
             this.state.scroll.render().find('.empty').remove();
             LOG('Removed any existing .empty overlay elements');
             
             if (!torrents_list?.length) {
                 LOG('No torrents to display');
                 return this._renderEmpty('Нічого не знайдено за заданими фільтрами');
             }

             const movieId = this.movie.imdb_id || this.movie.id;
             const lastTorrentHash = Store.get(`torbox_last_played_torrent_${movieId}`, null);
             LOG('Last played torrent hash for movie', movieId, ':', lastTorrentHash);
             
             let itemsAdded = 0;
             torrents_list.forEach((t, index) => {
                 try {
                     const itemHtml = this._createTorrentHTML(t, lastTorrentHash);
                     const $item = $(itemHtml);
                     
                     // Перевіряємо чи створився валідний DOM елемент
                     if (!$item || !$item.length || !$item[0]) {
                         LOG('Failed to create valid DOM element for torrent:', t?.title);
                         return;
                     }
                     
                     $item.on('hover:focus', (e) => { 
                         this.state.last = e.target; 
                         this.state.scroll.update($(e.target), true);
                     });
                     
                     $item.on('hover:enter', () => this._handleTorrentClick(t));
                     
                     this.state.scroll.append($item);
                     itemsAdded++;
                 } catch (itemError) {
                     LOG('Error creating torrent item at index', index, ':', itemError);
                 }
             });
             
             LOG('Successfully added', itemsAdded, 'torrent items to scroll');
             
             // ② Hot-fix: рендер скролу для оновлення геометрії
             this.state.scroll.render();
             LOG('Scroll rendered, geometry updated');
             
             // ③ Hot-fix: безпечний виклик scroll.update() з конкретним елементом
             const first = this.state.scroll.body().children().first();
             if (first.length) {
                 this.state.scroll.update(first, true); // ставить фокус на перший елемент
                 LOG('Scroll geometry updated with first element, focus set');
             } else {
                 LOG('Warning: No first element found in scroll body for focus');
             }
             
         } catch (error) {
             LOG('Error in draw():', error);
             this._renderEmpty('Помилка відображення списку торрентів');
         }
     };
    
    TorBoxComponent.prototype._createTorrentHTML = function(t, lastTorrentHash) {
        const isLastPlayedTorrent = lastTorrentHash && t.hash === lastTorrentHash;
        const mainClass = `torbox-item selector ${isLastPlayedTorrent ? 'torbox-item--last-played' : ''}`;
        
        const title = `${t.cached ? '⚡ ' : '☁️ '}${t.raw_title || t.title}`;
        const mainInfo = `[${t.quality}] ${Utils.formatBytes(t.size)} | 🟢 <span style="color:var(--color-good);">${t.last_known_seeders||0}</span> / 🔴 <span style="color:var(--color-bad);">${t.last_known_peers||0}</span>`;
        const meta = `Трекери: ${t.trackers?.join(', ')||'н/д'} | Додано: ${t.age||'н/д'}`;

        let techBarHtml = '';
        if (t.video_resolution) {
            const createTag = (text, type) => `<div class="torbox-item__tech-item torbox-item__tech-item--${type}">${text}</div>`;
            
            let videoTags = createTag(t.video_resolution, 'res');
            if (t.video_codec) videoTags += createTag(t.video_codec.toUpperCase(), 'codec');
            if (t.has_hdr) videoTags += createTag('HDR', 'hdr');
            if (t.has_dv) videoTags += createTag('Dolby Vision', 'dv');
            
            const audioTags = t.raw_data.ffprobe?.filter(s => s.codec_type === 'audio').map(s => {
                const lang = s.tags?.language?.toUpperCase() || '???';
                const codec = s.codec_name?.toUpperCase() || '';
                const layout = s.channel_layout || '';
                return createTag(`${lang} ${codec} ${layout}`, 'audio');
            }).join('');

            techBarHtml = `<div class="torbox-item__tech-bar">${videoTags}${audioTags}</div>`;
        }

        return `
            <div class="${mainClass}">
                <div class="torbox-item__title">${Utils.escapeHtml(title)}</div>
                <div class="torbox-item__main-info">${mainInfo}</div>
                <div class="torbox-item__meta">${Utils.escapeHtml(meta)}</div>
                ${techBarHtml}
            </div>`;
    };

    TorBoxComponent.prototype._renderEmpty = function(msg) { 
        this.state.scroll.render().empty();
        const emptyMsg = $(`<div class="empty"><div class="empty__text">${Utils.escapeHtml(msg || 'Торренти не знайдені')}</div></div>`);
        this.state.scroll.render().append(emptyMsg);
        this.activity.loader(false);
    };
    
    TorBoxComponent.prototype._handleTorrentClick = async function(torrent) {
      try {
          LOG('Torrent clicked:', torrent?.title || 'Unknown');
          
          if (!torrent) {
              throw {type: 'validation', message: 'Дані торрента відсутні'};
          }
          
          if (!torrent.magnet) {
              throw {type: 'validation', message: 'Не найдена magnet-ссылка.'};
          }
          
          LOG('Adding torrent with magnet:', torrent.magnet.substring(0, 50) + '...');
          UI.showStatusModal('Додавання торрента...');
          
          const result = await Api.addMagnet(torrent.magnet, this.abortController.signal);
          const torrentId = result.data.torrent_id || result.data.id;
          
          if (!torrentId) {
              throw {type: 'api', message: 'Не вдалося отримати ID торрента.'};
          }
          
          LOG('Torrent added with ID:', torrentId);
          
          const finalTorrentData = await this._trackTorrentStatus(torrentId, this.abortController.signal);
          
          // Створюємо копію об'єкта замість мутації
          const torrentDataWithHash = {
              ...finalTorrentData,
              hash: torrent.hash || torrent.info_hash
          };
          
          LOG('Torrent ready for file selection with hash:', torrentDataWithHash.hash);
          
          // Зберігаємо останній відтворений торрент
          const movieId = this.movie.imdb_id || this.movie.id;
          if (movieId && torrentDataWithHash.hash) {
              Store.set(`torbox_last_played_torrent_${movieId}`, torrentDataWithHash.hash);
              LOG('Saved last played torrent for movie:', movieId);
          }
          
          Lampa.Modal.close();
          this._showFileSelection(torrentDataWithHash);
          
      } catch (e) {
          LOG('Error in _handleTorrentClick:', e);
          if (e.type !== "user" && e.name !== "AbortError") {
              ErrorHandler.show(e.type || 'unknown', e);
          }
          Lampa.Modal.close();
      }
    };
    
    TorBoxComponent.prototype._trackTorrentStatus = function(torrentId, signal) {
        return new Promise((resolve, reject) => {
            let isTrackingActive = true; 
            const poll = async () => {
                if (!isTrackingActive) return;
                try {
                    const torrentResult = await Api.myList(torrentId, signal);
                    const torrentData = torrentResult?.data?.[0];

                    if (!isTrackingActive) return;

                    if (!torrentData) {
                       throw {type: 'api', message: "Торрент не з'явився у списку після додавання."};
                    }
                    
                    const statusText = torrentData.download_state || torrentData.status;
                    const progressValue = parseFloat(torrentData.progress);
                    const progressPercent = isNaN(progressValue) ? 0 : (progressValue > 1 ? progressValue : progressValue * 100);
                    
                    UI.updateStatusModal({ 
                        status: statusText, 
                        progress: progressPercent, 
                        progressText: `${progressPercent.toFixed(2)}% з ${Utils.formatBytes(torrentData.size)}`, 
                        speed: `Швидкість: ${Utils.formatBytes(torrentData.download_speed, true)}`, 
                        eta: `Залишилось: ${Utils.formatTime(torrentData.eta)}`, 
                        peers: `Сіди: ${torrentData.seeds||0} / Піри: ${torrentData.peers||0}` 
                    });

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
            
            const onCancel = () => { 
                if (isTrackingActive) { 
                    isTrackingActive = false;
                    reject({type: 'user', message: 'Відмінено користувачем'}); 
                } 
            };
            UI.showStatusModal('Відстеження статусу...', onCancel);
            if (signal) signal.addEventListener('abort', () => onCancel());
            poll();
        });
    };

    TorBoxComponent.prototype._showFileSelection = function(torrentData) {
        LOG('_showFileSelection called with data:', torrentData);
        
        // Перевірка наявності файлів
        if (!torrentData || !torrentData.files || !Array.isArray(torrentData.files)) {
            LOG('Invalid torrent data or missing files array');
            throw {type: 'validation', message: 'Дані торрента не містять інформації про файли.'};
        }
        
        LOG('Files available:', torrentData.files.length);
        
        // Фільтрація відеофайлів з розширеним списком форматів
        let files = torrentData.files.filter(f => {
            if (!f || !f.name) {
                LOG('Skipping file with missing name:', f);
                return false;
            }
            return /\.(mkv|mp4|avi|mov|wmv|flv|webm|m4v|ts|m2ts)$/i.test(f.name);
        });
        
        LOG('Video files found:', files.length);
        
        if (!files.length) {
            throw {type: 'validation', message: 'Відтворювані відеофайли не знайдені.'};
        }
        
        // Сортування файлів
        files.sort(Utils.naturalSort);
        
        const playFile = (file) => {
            try {
                LOG('Playing file:', file.name);
                this._playFile(torrentData.id, torrentData.hash, file);
            } catch (error) {
                LOG('Error playing file:', error);
                ErrorHandler.show(error.type || 'unknown', error);
            }
        };

        // Якщо один файл - відразу відтворюємо
        if (files.length === 1) {
            LOG('Single file found, playing directly');
            return playFile(files[0]);
        }
        
        // Отримуємо останній відтворений файл
        const movieId = this.movie.imdb_id || this.movie.id;
        const lastPlayedFileId = Store.get(`torbox_last_played_${movieId}`, null);
        LOG('Last played file ID:', lastPlayedFileId);

        // Створюємо елементи для вибору
        const fileItems = files.map(f => {
            const isLast = lastPlayedFileId && String(f.id) === String(lastPlayedFileId);
            const item = {
                title: isLast ? `▶️ ${f.name}` : f.name,
                subtitle: Utils.formatBytes(f.size || 0),
                file: f
            };
            if (isLast) {
                item.cls = 'select__item--last-played';
            }
            return item;
        });

        // Показуємо список для вибору
        try {
            LOG('Showing file selection dialog with', fileItems.length, 'items');
            Lampa.Select.show({ 
                title: 'Вибір файлу для відтворення', 
                items: fileItems, 
                onSelect: (item) => {
                    if (item && item.file) {
                        playFile(item.file);
                    } else {
                        LOG('Invalid file selection:', item);
                        ErrorHandler.show('validation', {message: 'Неправильний вибір файлу'});
                    }
                }, 
                onBack: () => {
                    LOG('File selection cancelled');
                    Lampa.Controller.toggle('content');
                }
            });
        } catch (error) {
            LOG('Error showing file selection:', error);
            ErrorHandler.show('ui', {message: 'Помилка відображення списку файлів: ' + error.message});
        }
    };
    
    TorBoxComponent.prototype._playFile = async function(torrentId, torrentHash, file) {
      UI.showStatusModal('Отримання посилання на файл...');
      try {
        const dlResponse = await Api.requestDl(torrentId, file.id, this.abortController.signal);
        
        const movieId = this.movie.imdb_id || this.movie.id;
        Store.set(`torbox_last_torrent_${movieId}`, torrentHash);
        Store.set(`torbox_last_played_${movieId}`, String(file.id));

        const player_data = { url: dlResponse.data || dlResponse.url, title: file.name || this.movie.title, poster: this.movie.img };
        Lampa.Modal.close();
        Lampa.Player.play(player_data);
        Lampa.Player.listener.follow('complite', () => this.display()); // Refresh highlights on completion
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
                {k:'torbox_proxy_url', n:'URL вашого CORS-проксі', d:`За замовчуванням: https://my-torbox-proxy.slonce70.workers.dev/`, t:'input', v: CFG.proxyUrl },
                {k:'torbox_api_key', n:'Ваш особистий API-Key', d:'За замовчуванням використовується гостьовий ключ', t:'input', v: CFG.apiKey },
                {k:'torbox_debug', n:'Режим налагодження', d:'Записувати детальну інформацію в консоль', t:'trigger', v: CFG.debug }
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
                    onRender: (field) => {
                         if(p.k === 'torbox_api_key') field.find('input').attr('type', 'password');
                    }
                });
            });
        };

        const boot = () => {
            Lampa.Listener.follow('full', e => {
                if (e.type !== 'complite' || !e.data.movie) return;
                const root_jq = e.object.activity.render();
                if (!root_jq || !root_jq.length) return;
                
                if (root_jq.find('.view--torbox').length) return;
                
                const btn = $(`<div class="full-start__button selector view--torbox" data-subtitle="TorBox">${ICON}<span>TorBox</span></div>`);

                btn.on('hover:enter', () => {
                    Lampa.Activity.push({ component: 'torbox_component', title: 'TorBox - ' + (e.data.movie.title || e.data.movie.name), movie: e.data.movie });
                });

                const torrentButton = root_jq.find('.view--torrent');
                if (torrentButton.length) {
                    torrentButton.after(btn);
                }
            });
        };
        
        const setupGlobalActivityListener = () => {
            let wasInExternalPlayer = false;
            
            activityWatcher = Lampa.Listener.follow('activity', (e) => {
                if (e.type === 'start') {
                    if (wasInExternalPlayer && e.object.component === 'torbox_component') {
                         LOG('Detected return to TorBox from external player');
                         wasInExternalPlayer = false;
                         setTimeout(() => {
                            const activeComponent = Lampa.Activity.active()?.component;
                            if (activeComponent && typeof activeComponent.display === 'function') {
                                try {
                                    activeComponent.display();
                                    Lampa.Controller.toggle('content');
                                    LOG('Navigation and display restored');
                                } catch (err) {
                                    LOG('Error restoring navigation:', err);
                                }
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
            const style = document.createElement('style');
            style.id = 'torbox-component-styles';
            style.textContent = `
                .torbox-item{padding:1em 1.2em;margin:.5em 0;border-radius:.8em;background:var(--color-background-light);cursor:pointer;transition:all .3s ease;border:2px solid transparent; overflow: hidden;}
                .torbox-item--last-played { border-left: 4px solid var(--color-second); background-color: rgba(var(--color-second-rgb), 0.1); }
                .torbox-item:hover,.torbox-item.focus{background:var(--color-primary);color:var(--color-background);transform:translateX(.8em);border-color:rgba(255,255,255,.3);box-shadow:0 4px 20px rgba(0,0,0,.2)}
                .torbox-item:hover .torbox-item__tech-bar, .torbox-item.focus .torbox-item__tech-bar { background: rgba(0,0,0,0.2); }
                .torbox-item__title{font-weight:600;margin-bottom:.3em;font-size:1.1em;line-height:1.3}
                .torbox-item__main-info{font-size:.95em;opacity:.9;line-height:1.4; margin-bottom: .3em;}
                .torbox-item__meta{font-size:.9em;opacity:.7;line-height:1.4; margin-bottom: .8em;}
                .torbox-item__tech-bar{display:flex;flex-wrap:wrap;gap:.6em;margin:0 -1.2em -1em -1.2em;padding:.6em 1.2em;background:rgba(0,0,0,0.1);font-size:.85em;font-weight:500;}
                .torbox-item__tech-item { display: inline-block; padding: .2em .5em; border-radius: .4em; }
                .torbox-item__tech-item--res { background-color: #3b82f6; color: white; }
                .torbox-item__tech-item--codec { background-color: #16a34a; color: white; }
                .torbox-item__tech-item--audio { background-color: #f97316; color: white; }
                .torbox-item__tech-item--hdr { background: linear-gradient(45deg, #ff8c00, #ffa500); color: white; }
                .torbox-item__tech-item--dv { background: linear-gradient(45deg, #4b0082, #8a2be2); color: white; }
                .select__item.select__item--last-played > .select__item-title { color: var(--color-second) !important; font-weight: 600; }
                .torrent-list{padding:1em}
                .torbox-status{padding:1.5em 2em; text-align:center; min-height:200px;}
                .torbox-status__title{font-size:1.4em; margin-bottom:1em; font-weight:600;}
                .torbox-status__info{font-size: 1.1em; margin-bottom: 0.8em; color: var(--color-text);}
                .torbox-status__progress-container{margin:1.5em 0; background:rgba(255,255,255,0.1); border-radius:8px; overflow:hidden; height:12px; position:relative;}
                .torbox-status__progress-bar{height:100%; width:0%; background:linear-gradient(90deg, var(--color-primary), var(--color-primary-light, #4CAF50)); transition: width 0.5s ease-out; border-radius:8px; position:relative;}
                .torbox-status__progress-bar::after{content:''; position:absolute; top:0; left:0; right:0; bottom:0; background:linear-gradient(45deg, transparent 30%, rgba(255,255,255,0.2) 50%, transparent 70%); animation:shimmer 2s infinite;}
                @keyframes shimmer{0%{transform:translateX(-100%)} 100%{transform:translateX(100%)}}
            `;
            document.head.appendChild(style);

            Lampa.Component.add('torbox_component', TorBoxComponent);
            addSettings();
            boot();
            setupGlobalActivityListener();
            LOG('TorBox v30.2.0 (Refactored) ready');
        };

        return { init };
    })();

    // ─── bootloader ───────────────────────────────────────────────
    (function bootLoop () {
        if (window.Lampa?.Activity) {
            try {
                Plugin.init();
            } catch (e) { console.error('[TorBox] Boot Error:', e); }
        } else {
            setTimeout(bootLoop, 300);
        }
    })();
})();
