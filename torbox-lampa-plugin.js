/* TorBox Enhanced – Universal Lampa Plugin v35.3.1 (UI/UX Stability Fix) */
(function() {
    'use strict';

    // ═══════════════════════ CONFIGURATION ═══════════════════════
    const Config = {
        DEF: {
            proxyUrl: 'https://cors-anywhere.herokuapp.com/',
            apiKey: 'f8b6c8b5c8e4f8b6c8b5c8e4f8b6c8b5c8e4f8b6'
        },
        get: k => Lampa.Storage.get(k, Config.DEF[k.replace('torbox_', '')])
    };

    const CFG = {
        get proxyUrl() { return Config.get('torbox_proxy_url') || Config.DEF.proxyUrl; },
        set proxyUrl(value) { Lampa.Storage.set('torbox_proxy_url', value); },
        get apiKey() { return Config.get('torbox_api_key') || Config.DEF.apiKey; },
        set apiKey(value) { Lampa.Storage.set('torbox_api_key', value); },
        get debug() { return Config.get('torbox_debug') || false; },
        set debug(value) { Lampa.Storage.set('torbox_debug', value); }
    };

    const Store = {
        get: (k, d) => Lampa.Storage.get(k, d),
        set: (k, v) => Lampa.Storage.set(k, v)
    };

    const ICON = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 7v10c0 5.55 3.84 9.739 9 11 5.16-1.261 9-5.45 9-11V7l-10-5z"/></svg>';

    // ═══════════════════════ UTILITIES ═══════════════════════
    const Utils = {
        log: (...args) => CFG.debug && console.log('[TorBox]', ...args),
        error: (...args) => console.error('[TorBox]', ...args),
        
        formatSize: bytes => {
            if (!bytes || bytes === 0) return 'N/A';
            const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
            const i = Math.floor(Math.log(bytes) / Math.log(1024));
            return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
        },
        
        formatSeeds: seeds => seeds ? `${seeds} сидов` : 'N/A',
        
        extractQuality: title => {
            const match = title.match(/(\d{3,4}p|4K|8K|HD|FHD|UHD)/i);
            return match ? match[0].toUpperCase() : 'SD';
        },
        
        extractYear: title => {
            const match = title.match(/\b(19|20)\d{2}\b/);
            return match ? match[0] : null;
        },
        
        safeRequest: (url, options = {}) => {
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Request timeout'));
                }, options.timeout || 15000);
                
                fetch(url, {
                    method: options.method || 'GET',
                    headers: options.headers || {},
                    signal: options.signal
                })
                .then(response => {
                    clearTimeout(timeout);
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    return response.json();
                })
                .then(resolve)
                .catch(reject);
            });
        }
    };

    // ═══════════════════════ API MODULE ═══════════════════════
    const API = {
        search: async (query, signal) => {
            const url = `${CFG.proxyUrl}https://torrentapi.org/pubapi_v2.php?mode=search&search_string=${encodeURIComponent(query)}&ranked=0&category=movies;tv&format=json_extended&app_id=torbox_lampa&token=${CFG.apiKey}`;
            
            try {
                const data = await Utils.safeRequest(url, { signal, timeout: 10000 });
                
                if (data.error_code === 20) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    return API.search(query, signal);
                }
                
                return data.torrent_results || [];
            } catch (error) {
                Utils.error('API search failed:', error);
                throw error;
            }
        }
    };

    // ═══════════════════════ MAIN COMPONENT ═══════════════════════
    function TorBoxComponent(object) {
        // Переменные состояния
        var network = new Lampa.Reguest();
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var files = new Lampa.Explorer(object);
        var filter = new Lampa.Filter(object);
        var abort = new AbortController();
        
        // Состояние компонента
        var initialized = false;
        var last = false;
        var state = {
            torrents: [],
            filters: { quality: 'all', type: 'all', seeds: 'all' },
            sort: 'seeds',
            last_hash: null
        };
        
        // Таймеры и интервалы
        var search_timer;
        var focus_timer;
        
        const defaultFilters = JSON.parse(JSON.stringify(state.filters));
        
        // ═══════════════════════ PRIVATE METHODS ═══════════════════════
        
        /**
         * Безопасный поиск торрентов
         */
        const search = async (force = false) => {
            if (!force && state.torrents.length) return;
            
            try {
                this.loading(true);
                
                const query = object.movie.title || object.movie.name || '';
                if (!query.trim()) {
                    this.empty('Не указано название для поиска');
                    return;
                }
                
                Utils.log('Searching for:', query);
                
                const results = await API.search(query, abort.signal);
                
                if (abort.signal.aborted) return;
                
                state.torrents = results.map((item, index) => ({
                    ...item,
                    hash: Lampa.Utils.hash(item.download + index),
                    quality: Utils.extractQuality(item.title),
                    year: Utils.extractYear(item.title)
                }));
                
                Utils.log('Found torrents:', state.torrents.length);
                
                this.build();
                
            } catch (error) {
                if (error.name === 'AbortError') return;
                Utils.error('Search failed:', error);
                this.empty('Ошибка поиска: ' + error.message);
            } finally {
                this.loading(false);
            }
        };
        
        /**
         * Применение фильтров и сортировки
         */
        const applyFiltersSort = (torrents) => {
            let filtered = [...torrents];
            
            // Фильтрация
            if (state.filters.quality !== 'all') {
                filtered = filtered.filter(t => t.quality === state.filters.quality);
            }
            if (state.filters.type !== 'all') {
                const isSerial = state.filters.type === 'serial';
                filtered = filtered.filter(t => {
                    const hasSeasonEpisode = /s\d+e\d+|season|episode/i.test(t.title);
                    return isSerial ? hasSeasonEpisode : !hasSeasonEpisode;
                });
            }
            if (state.filters.seeds !== 'all') {
                const minSeeds = parseInt(state.filters.seeds);
                filtered = filtered.filter(t => (t.seeders || 0) >= minSeeds);
            }
            
            // Сортировка
            filtered.sort((a, b) => {
                switch (state.sort) {
                    case 'seeds': return (b.seeders || 0) - (a.seeders || 0);
                    case 'size': return (b.size || 0) - (a.size || 0);
                    case 'date': return new Date(b.pubdate || 0) - new Date(a.pubdate || 0);
                    default: return 0;
                }
            });
            
            return filtered;
        };
        
        /**
         * Построение фильтров
         */
        const buildFilter = () => {
            const qualities = [...new Set(state.torrents.map(t => t.quality))].sort();
            const maxSeeds = Math.max(...state.torrents.map(t => t.seeders || 0));
            
            const filterItems = {
                quality: ['all', ...qualities],
                type: ['all', 'movie', 'serial'],
                seeds: ['all', '1', '5', '10', '50']
            };
            
            const sortItems = [
                { title: 'По сидам', key: 'seeds' },
                { title: 'По размеру', key: 'size' },
                { title: 'По дате', key: 'date' }
            ];
            
            // Настройка фильтров
            const filterSelect = [];
            
            filterSelect.push({ title: 'Сбросить', reset: true });
            filterSelect.push({ title: 'Обновить', refresh: true });
            
            Object.keys(filterItems).forEach(key => {
                const items = filterItems[key].map(value => ({
                    title: value === 'all' ? 'Все' : value,
                    value: value,
                    selected: state.filters[key] === value
                }));
                
                filterSelect.push({
                    title: key === 'quality' ? 'Качество' : key === 'type' ? 'Тип' : 'Сиды',
                    subtitle: state.filters[key] === 'all' ? 'Все' : state.filters[key],
                    items: items,
                    stype: key
                });
            });
            
            filter.set('filter', filterSelect);
            filter.set('sort', sortItems.map(item => ({
                ...item,
                selected: state.sort === item.key
            })));
        };
        
        // ═══════════════════════ PUBLIC METHODS ═══════════════════════
        
        /**
         * Показать пустой результат
         */
        this.empty = function(message = 'Торренты не найдены') {
            scroll.clear();
            const html = Lampa.Template.get('torbox_empty', { message });
            scroll.append(html);
            this.loading(false);
        };
        
        /**
         * Очистка списка
         */
        this.reset = function() {
            last = false;
            clearTimeout(search_timer);
            clearTimeout(focus_timer);
            abort.abort();
            abort = new AbortController();
            scroll.clear();
            scroll.reset();
        };
        
        /**
         * Построение списка торрентов
         */
        this.build = function() {
            if (!state.torrents.length) {
                this.empty();
                return;
            }
            
            const filtered = applyFiltersSort(state.torrents);
            
            if (!filtered.length) {
                this.empty('Нет торрентов, соответствующих фильтрам');
                return;
            }
            
            buildFilter();
            this.draw(filtered);
        };
        
        /**
         * Отрисовка списка торрентов
         */
        this.draw = function(torrents) {
            scroll.clear();
            
            torrents.forEach(torrent => {
                const info = [
                    Utils.formatSize(torrent.size),
                    Utils.formatSeeds(torrent.seeders),
                    torrent.category || 'Unknown'
                ].filter(Boolean).join(' • ');
                
                const meta = [
                    torrent.quality,
                    torrent.year,
                    new Date(torrent.pubdate).toLocaleDateString()
                ].filter(Boolean).join(' • ');
                
                const item_data = {
                    hash: torrent.hash,
                    title: torrent.title,
                    info_formated: info,
                    meta_formated: meta,
                    magnet: torrent.download,
                    icon: ICON,
                    tech_bar_html: ''
                };
                
                const item = Lampa.Template.get('torbox_item', item_data);
                
                // Обработчик клика
                item.on('hover:enter', () => {
                    state.last_hash = torrent.hash;
                    
                    const stream_url = torrent.download;
                    if (!stream_url) {
                        Lampa.Noty.show('Ссылка на торрент недоступна');
                        return;
                    }
                    
                    const playlist = [{
                        title: torrent.title,
                        url: stream_url,
                        timeline: Lampa.Timeline.details(object.movie),
                        subtitles: [],
                        callback: () => {
                            Utils.log('Playback started for:', torrent.title);
                        }
                    }];
                    
                    Lampa.Player.play(playlist);
                    Lampa.Player.playlist(playlist);
                });
                
                // Контекстное меню
                item.on('hover:long', () => {
                    Lampa.Select.show({
                        title: 'Действия',
                        items: [{ title: 'Копировать magnet-ссылку', magnet: true }],
                        onSelect: (a) => {
                            if (a.magnet) {
                                Lampa.Utils.copyTextToClipboard(torrent.download, 
                                    () => Lampa.Noty.show('Magnet-ссылка скопирована'),
                                    () => Lampa.Noty.show('Ошибка копирования')
                                );
                            }
                            Lampa.Controller.toggle('content');
                        },
                        onBack: () => Lampa.Controller.toggle('content')
                    });
                });
                
                scroll.append(item);
            });
            
            // Восстановление фокуса
            focus_timer = setTimeout(() => {
                let focus_element = false;
                if (state.last_hash) {
                    focus_element = scroll.render().find(`[data-hash="${state.last_hash}"]`)[0];
                }
                if (!focus_element) {
                    focus_element = scroll.render().find('.selector').first()[0];
                }
                if (focus_element) {
                    last = focus_element;
                    Lampa.Controller.collectionFocus(last, scroll.render());
                }
            }, 100);
        };
        
        /**
         * Инициализация компонента
         */
        this.initialize = function() {
            Utils.log('Initializing TorBox component');
            
            // Настройка фильтров
            filter.onSelect = (type, a, b) => {
                Lampa.Select.close();
                
                if (type === 'sort') {
                    state.sort = a.key;
                    Store.set('torbox_sort_method', a.key);
                } else if (type === 'filter') {
                    if (a.refresh) {
                        this.reset();
                        search(true);
                        return;
                    }
                    if (a.reset) {
                        state.filters = JSON.parse(JSON.stringify(defaultFilters));
                    } else if (a.stype) {
                        state.filters[a.stype] = b.value;
                    }
                    Store.set('torbox_filters_v2', JSON.stringify(state.filters));
                }
                
                state.last_hash = null;
                this.build();
                
                // Безопасное переключение контроллера
                setTimeout(() => {
                    if (Lampa.Activity.active().activity === this.activity) {
                        Lampa.Controller.toggle('content');
                    }
                }, 50);
            };
            
            filter.onBack = () => {
                if (Lampa.Activity.active().activity === this.activity) {
                    Lampa.Controller.toggle('content');
                }
            };
            
            if (filter.addButtonBack) filter.addButtonBack();
            
            // Загрузка сохраненных настроек
            const savedFilters = Store.get('torbox_filters_v2', null);
            if (savedFilters && typeof savedFilters === 'string') {
                try {
                    const parsed = JSON.parse(savedFilters);
                    if (parsed && typeof parsed === 'object') {
                        state.filters = { ...defaultFilters, ...parsed };
                    }
                } catch (e) {
                    Utils.error('Failed to parse saved filters:', e);
                    // Очищаем некорректные данные
                    Store.set('torbox_filters_v2', null);
                }
            } else if (savedFilters && typeof savedFilters === 'object') {
                // Если данные уже объект, используем их напрямую
                state.filters = { ...defaultFilters, ...savedFilters };
            }
            
            state.sort = Store.get('torbox_sort_method', 'seeds');
            
            this.empty('Загрузка...');
            
            // Запуск поиска с задержкой
            search_timer = setTimeout(() => search(), 300);
        };
        
        /**
         * Запуск компонента
         */
        this.start = function() {
            Utils.log('Starting TorBox component');
            
            // Инициализация только один раз
            if (!initialized) {
                this.initialize();
                initialized = true;
            }
            
            // Настройка фона
            if (object.movie) {
                Lampa.Background.immediately(Lampa.Utils.cardImgBackgroundBlur(object.movie));
            }
            
            // Настройка контроллера с улучшенной обработкой ошибок
            Lampa.Controller.add('content', {
                toggle: () => {
                    try {
                        Lampa.Controller.collectionSet(filter.render(), scroll.render());
                        Lampa.Controller.collectionFocus(last || false, scroll.render());
                    } catch (e) {
                        Utils.error('Controller toggle error:', e);
                    }
                },
                gone: () => {
                    clearTimeout(search_timer);
                    clearTimeout(focus_timer);
                },
                up: () => {
                    if (Lampa.Controller.enabled().name === 'content') {
                        const focused = Lampa.Controller.focused();
                        if (focused && focused.prev().length) {
                            Lampa.Controller.move('up');
                        } else {
                            Lampa.Controller.toggle('head');
                        }
                    }
                },
                down: () => {
                    if (Lampa.Controller.enabled().name === 'content') {
                        Lampa.Controller.move('down');
                    }
                },
                left: () => {
                    if (Lampa.Controller.enabled().name === 'content') {
                        const focused = Lampa.Controller.focused();
                        if (focused && focused.prev().length) {
                            Lampa.Controller.move('left');
                        } else {
                            Lampa.Controller.toggle('menu');
                        }
                    }
                },
                right: () => {
                    if (Lampa.Controller.enabled().name === 'content') {
                        const focused = Lampa.Controller.focused();
                        if (focused && focused.next().length) {
                            Lampa.Controller.move('right');
                        } else {
                            filter.show(Lampa.Lang.translate('title_filter'), 'filter');
                        }
                    }
                },
                back: this.back.bind(this)
            });
            
            Lampa.Controller.toggle('content');
        };
        
        /**
         * Обработка кнопки "Назад"
         */
        this.back = function() {
            // Проверяем открытые модальные окна
            if ($('body').find('.select').length) {
                Lampa.Select.close();
                return;
            }
            
            if ($('body').find('.filter').length) {
                Lampa.Filter.hide();
                setTimeout(() => {
                    if (Lampa.Activity.active().activity === this.activity) {
                        Lampa.Controller.toggle('content');
                    }
                }, 50);
                return;
            }
            
            // Отмена запросов и возврат
            abort.abort();
            Lampa.Activity.backward();
        };
        
        /**
         * Пауза компонента
         */
        this.pause = function() {
            clearTimeout(search_timer);
            clearTimeout(focus_timer);
        };
        
        /**
         * Остановка компонента
         */
        this.stop = function() {
            clearTimeout(search_timer);
            clearTimeout(focus_timer);
            abort.abort();
        };
        
        /**
         * Уничтожение компонента
         */
        this.destroy = function() {
            Utils.log('Destroying TorBox component');
            
            clearTimeout(search_timer);
            clearTimeout(focus_timer);
            abort.abort();
            
            if (network) network.clear();
            if (files) files.destroy();
            if (scroll) scroll.destroy();
            if (filter) filter.destroy();
            
            state = null;
            last = false;
            initialized = false;
        };
        
        /**
         * Создание компонента (требуется для Lampa Activity)
         */
        this.create = function() {
            Utils.log('Creating TorBox component');
            return this.render();
        };
        
        /**
         * Получение рендера
         */
        this.render = function() {
            return files.render();
        };
        
        /**
         * Управление загрузкой
         */
        this.loading = function(status) {
            try {
                const currentActivity = Lampa.Activity.active();
                if (status) {
                    if (currentActivity && currentActivity.loader) {
                        currentActivity.loader(true);
                    }
                } else {
                    if (currentActivity && currentActivity.loader) {
                        currentActivity.loader(false);
                    }
                    if (currentActivity && currentActivity.toggle) {
                        currentActivity.toggle();
                    }
                }
            } catch (e) {
                Utils.error('Loading method error:', e);
            }
        };
    }

    // ═══════════════════════ PLUGIN INTEGRATION ═══════════════════════
    const Plugin = (() => {
        
        /**
         * Добавление шаблонов
         */
        function addTemplates() {
            Lampa.Template.add('torbox_item', '<div class="torbox-item selector" data-hash="{hash}"><div class="torbox-item__title">{icon} {title}</div><div class="torbox-item__main-info">{info_formated}</div><div class="torbox-item__meta">{meta_formated}</div>{tech_bar_html}</div>');
            Lampa.Template.add('torbox_empty', '<div class="empty"><div class="empty__text">{message}</div></div>');
        }
        
        /**
         * Добавление настроек
         */
        const addSettings = () => {
            if (!Lampa.SettingsApi) return;
            
            Lampa.SettingsApi.addComponent({ 
                component: 'torbox_enh', 
                name: 'TorBox Enhanced', 
                icon: ICON 
            });
            
            const params = [
                { k: 'torbox_proxy_url', n: 'URL CORS-прокси', d: `Default: ${Config.DEF.proxyUrl}`, t: 'input', v: CFG.proxyUrl },
                { k: 'torbox_api_key', n: 'API-Key', d: 'Если есть собственный ключ', t: 'input', v: CFG.apiKey },
                { k: 'torbox_debug', n: 'Debug-режим', d: 'Выводить лог в консоль', t: 'trigger', v: CFG.debug }
            ];
            
            params.forEach(p => {
                Lampa.SettingsApi.addParam({
                    component: 'torbox_enh',
                    param: { name: p.k, type: p.t, values: '', default: p.v },
                    field: { name: p.n, description: p.d },
                    onChange: v => {
                        const val = typeof v === 'object' ? v.value : v;
                        if (p.k === 'torbox_proxy_url') CFG.proxyUrl = String(val).trim();
                        if (p.k === 'torbox_api_key') CFG.apiKey = String(val).trim();
                        if (p.k === 'torbox_debug') CFG.debug = Boolean(val);
                    },
                    onRender: f => { 
                        if (p.k === 'torbox_api_key') f.find('input').attr('type', 'password'); 
                    }
                });
            });
        };
        
        /**
         * Инициализация кнопки
         */
        const boot = () => {
            Lampa.Listener.follow('full', e => {
                if (e.type !== 'complite' || !e.data.movie) return;
                
                const root = e.object.activity.render();
                if (!root?.length || root.find('.view--torbox').length) return;
                
                const btn = $(`<div class="full-start__button selector view--torbox" data-subtitle="TorBox Enhanced">${ICON}<span>TorBox</span></div>`);
                
                btn.on('hover:enter', () => {
                    addTemplates();
                    
                    Lampa.Activity.push({
                        component: 'torbox_component',
                        title: 'TorBox - ' + (e.data.movie.title || e.data.movie.name),
                        movie: e.data.movie
                    });
                });
                
                const torrentBtn = root.find('.view--torrent');
                if (torrentBtn.length) {
                    torrentBtn.after(btn);
                } else {
                    root.find('.full-start__play').after(btn);
                }
            });
        };
        
        /**
         * Инициализация плагина
         */
        const init = () => {
            Utils.log('Initializing TorBox Enhanced Plugin v35.3.0');
            
            // Добавление стилей
            const css = document.createElement('style');
            css.id = 'torbox-enhanced-styles';
            css.textContent = `
                .torbox-item {
                    padding: 1em 1.2em;
                    margin: 0 0 1em 0;
                    border-radius: .8em;
                    background: var(--color-background-light);
                    cursor: pointer;
                    transition: all .3s ease;
                    border: 2px solid transparent;
                    overflow: hidden;
                }
                .torbox-item:last-child { margin-bottom: 0; }
                .torbox-item:hover, .torbox-item.focus {
                    background: var(--color-primary);
                    color: var(--color-background);
                    transform: scale(1.01);
                    border-color: rgba(255, 255, 255, .3);
                    box-shadow: 0 4px 20px rgba(0, 0, 0, .2);
                }
                .torbox-item__title {
                    font-size: 1.1em;
                    font-weight: 600;
                    margin-bottom: .5em;
                    display: flex;
                    align-items: center;
                    gap: .5em;
                }
                .torbox-item__main-info {
                    font-size: .9em;
                    opacity: .8;
                    margin-bottom: .3em;
                }
                .torbox-item__meta {
                    font-size: .8em;
                    opacity: .6;
                }
                .empty {
                    text-align: center;
                    padding: 2em;
                }
                .empty__text {
                    font-size: 1.2em;
                    opacity: .7;
                }
            `;
            
            if (!document.getElementById('torbox-enhanced-styles')) {
                document.head.appendChild(css);
            }
            
            // Регистрация компонента
            Lampa.Component.add('torbox_component', TorBoxComponent);
            
            // Инициализация модулей
            addSettings();
            boot();
            
            Utils.log('TorBox Enhanced Plugin ready!');
        };
        
        return { init };
    })();

    // ═══════════════════════ PLUGIN STARTUP ═══════════════════════
    
    /**
     * Ожидание загрузки Lampa
     */
    function waitForLampa() {
        if (window.Lampa && window.Lampa.Activity) {
            Plugin.init();
        } else {
            setTimeout(waitForLampa, 100);
        }
    }
    
    // Запуск плагина
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', waitForLampa);
    } else {
        waitForLampa();
    }
    
})();
