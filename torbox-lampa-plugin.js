/*
 * TorBox Enhanced – Universal Lampa Plugin v24.1.0 (Definitive Fix)
 * =================================================================================
 * • АРХИТЕКТУРА ИСПРАВЛЕНА: Жизненный цикл компонента реорганизован для
 * устранения конфликтов с Lampa. Активация навигации происходит до
 * асинхронной загрузки данных, что решает проблему с "зависанием".
 * • ЯВНОЕ ОБНОВЛЕНИЕ КОНТРОЛЛЕРА: После отрисовки данных вызывается
 * Lampa.Controller.collectionSet(), что корректно обновляет карту навигации.
 * • ОТКАЗОУСТОЙЧИВОСТЬ: Добавлен AbortController для отмены сетевых
 * запросов при выходе из компонента, что повышает стабильность.
 */

(function () {
  'use strict';

  /* ───── Guard double-load ───── */
  const PLUGIN_ID = 'torbox_enhanced_v24_1_0_definitive_fix';
  if (window[PLUGIN_ID]) return;
  window[PLUGIN_ID] = true;

  /* ───── Globals & Constants ───── */
  const ICON = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 7L12 2L21 7V17L12 22L3 17V7Z" stroke="currentColor" stroke-width="2"/><path d="M12 22V12" stroke="currentColor" stroke-width="2"/><path d="M21 7L12 12L3 7" stroke="currentColor" stroke-width="2"/></svg>`;

  const PUBLIC_PARSERS = [
      { name: 'Viewbox', url: 'jacred.viewbox.dev', key: 'viewbox' },
      { name: 'Jacred',  url: 'jacred.xyz',          key: '' }
  ];

  /* ───── Helpers ───── */
  const Store = {
    get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, String(v)); } catch {} }
  };

  const Cache = {
      store: {},
      get: function(key) {
          const entry = this.store[key];
          if (!entry) return null;
          const FIVE_MINUTES = 5 * 60 * 1000;
          if (Date.now() - entry.timestamp > FIVE_MINUTES) {
              delete this.store[key];
              LOG(`Локальный кэш для ключа '${key}' устарел и был удален.`);
              return null;
          }
          LOG(`Cache HIT для ключа: ${key}`);
          return entry.data;
      },
      set: function(key, data) {
          LOG(`Cache SET для ключа: ${key}`);
          this.store[key] = { timestamp: Date.now(), data: data };
      }
  };

  const DEFAULTS = {
    proxyUrl: 'https://proxy.cub.watch/',
    apiKey: ''
  };

  const CFG = {
    get debug()     { return Store.get('torbox_debug', '0') === '1'; },
    set debug(v)    { Store.set('torbox_debug', v ? '1' : '0');      },
    get proxyUrl()  { return Store.get('torbox_proxy_url') || DEFAULTS.proxyUrl; },
    set proxyUrl(v) { Store.set('torbox_proxy_url', v); },
    get apiKey()    { return Store.get('torbox_api_key') || DEFAULTS.apiKey; },
    set apiKey(v)   { Store.set('torbox_api_key', v); }
  };

  const LOG  = (...a) => CFG.debug && console.log('[TorBox]', ...a);

  const escapeHtml = (text) => {
      if (typeof text !== 'string') return '';
      const div = document.createElement('div');
      div.innerText = text;
      return div.innerHTML;
  };

  const ErrorHandler = {
      show: (type, error) => {
          let message = 'Произошла неизвестная ошибка';
          const err_message = error.message || 'Детали отсутствуют';
          if (error.name === 'AbortError') {
             LOG('Request aborted by user.');
             return;
          }
          switch (type) {
              case 'network': message = `Сетевая ошибка: ${err_message}`; break;
              case 'api': message = `Ошибка API: ${err_message}`; break;
              case 'auth': message = `Ошибка авторизации: ${err_message}`; break;
              case 'validation': message = `Ошибка проверки данных: ${err_message}`; break;
              default: message = err_message;
          }
          Lampa.Noty.show(message, { type: 'error' });
          LOG(`Error handled (${type}):`, error);
      }
  };
  
  // ... (Other helpers like formatBytes, formatTime etc. remain the same)
    const formatBytes = (bytes, speed = false) => {
        const B = Number(bytes);
        if (isNaN(B) || B === 0) return speed ? '0 KB/s' : '0 B';
        const k = 1024;
        const sizes = speed ? ['B/s', 'KB/s', 'MB/s', 'GB/s'] : ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(B) / Math.log(k));
        return parseFloat((B / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };
    const formatTime = (seconds) => {
        try {
            const numSeconds = parseInt(seconds, 10);
            if (isNaN(numSeconds) || numSeconds < 0) return 'н/д';
            if (numSeconds === Infinity || numSeconds > 86400 * 30) return '∞';
            const h = Math.floor(numSeconds / 3600);
            const m = Math.floor((numSeconds % 3600) / 60);
            const s = Math.floor(numSeconds % 60);
            return [h > 0 ? h + 'ч' : null, m > 0 ? m + 'м' : null, s + 'с'].filter(Boolean).join(' ');
        } catch (e) {
            LOG('Error formatting time:', e);
            return 'н/д';
        }
    };
    const formatAge = (isoDate) => {
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
          LOG('Error formatting age:', e);
          return 'н/д';
      }
    };
    const ql = (title) => {
        if (!title) return 'SD';
        if (title.match(/2160p|4K|UHD/i)) return '4K';
        if (title.match(/1080p|FHD/i)) return 'FHD';
        if (title.match(/720p|HD/i)) return 'HD';
        return 'SD';
    };

    // ... (Styles remain the same)
    if (!$('#torbox-component-styles').length) {
        $('head').append(`<style id="torbox-component-styles">.torbox-item{padding:1.2em;margin:.5em 0;border-radius:.8em;background:var(--color-background-light);cursor:pointer;transition:all .3s ease;border:2px solid transparent}.torbox-item:hover,.torbox-item.focus{background:var(--color-primary);color:var(--color-background);transform:translateX(.8em);border-color:rgba(255,255,255,.3);box-shadow:0 4px 20px rgba(0,0,0,.2)}.torbox-item__title{font-weight:600;margin-bottom:.5em;font-size:1.1em;line-height:1.3}.torbox-item__subtitle{font-size:.95em;opacity:.8;line-height:1.4}.torrent-list{padding:1em}.torbox-status{padding:1.5em 2em;text-align:center;min-height:200px;}.torbox-status__title{font-size:1.4em;margin-bottom:1em;font-weight:600;}.torbox-status__info{font-size:1.1em;margin-bottom:.8em;color:var(--color-text);}.torbox-status__progress-container{margin:1.5em 0;background:rgba(255,255,255,.1);border-radius:8px;overflow:hidden;height:12px;position:relative;}.torbox-status__progress-bar{height:100%;width:0%;background:linear-gradient(90deg,var(--color-primary),var(--color-primary-light,#4CAF50));transition:width .5s ease-out;border-radius:8px;position:relative;}.torbox-status__progress-bar::after{content:'';position:absolute;top:0;left:0;right:0;bottom:0;background:linear-gradient(45deg,transparent 30%,rgba(255,255,255,.2) 50%,transparent 70%);animation:shimmer 2s infinite}@keyframes shimmer{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}.modal .torbox-status__progress-container{background:rgba(255,255,255,.2)!important;}.modal .torbox-status__progress-bar{background:linear-gradient(90deg,#4CAF50,#66BB6A)!important;}</style>`);
    }

    function processResponse(responseText, status) {
        if (status === 401) throw { type: 'auth', message: `Ошибка авторизации (401). Проверьте API-ключ.` };
        if (status >= 500) throw { type: 'network', message: `Внутренняя ошибка сервера (${status}).` };
        if (status >= 400) throw { type: 'network', message: `Ошибка клиента (${status}). Неверный запрос.` };
        if (status < 200 || status >= 300) throw { type: 'network', message: `Неизвестная сетевая ошибка: HTTP ${status}` };
        if (!responseText || (typeof responseText === 'string' && responseText.trim() === '')) {
            throw { type: 'api', message: `Получен пустой ответ от сервера (HTTP ${status}).` };
        }
        try {
            const json = JSON.parse(responseText);
            if (typeof json === 'object' && !Array.isArray(json) && json.success === false) {
                const errorMsg = json.detail || json.message || 'API вернуло ошибку без деталей.';
                throw { type: 'api', message: errorMsg };
            }
            return json;
        } catch (e) {
            LOG('Invalid JSON or API error:', responseText, e);
            if (e.type) throw e;
            throw { type: 'api', message: 'Получен некорректный ответ от сервера.' };
        }
    }


  const API = {
    SEARCH_API: 'https://search-api.torbox.app',
    MAIN_API: 'https://api.torbox.app/v1/api',
    // **ИЗМЕНЕНИЕ**: Добавлен AbortSignal для всех запросов
    request: async function(url, options = {}, signal) {
        if (!CFG.proxyUrl) {
            throw { type: 'validation', message: "URL прокси-сервера не указан в настройках."};
        }
        const proxyUrl = `${CFG.proxyUrl}?url=${encodeURIComponent(url)}`;
        LOG('Calling via universal proxy. Target:', url);
        options.headers = options.headers || {};
        if (options.is_torbox_api) {
            options.headers['X-Api-Key'] = CFG.apiKey;
        } else {
            delete options.headers['X-Api-Key'];
        }
        try {
            // **ИЗМЕНЕНИЕ**: Пробрасываем signal в fetch
            const response = await fetch(proxyUrl, { ...options, signal });
            const responseText = await response.text();
            return processResponse(responseText, response.status);
        } catch (err) {
            if (err.type || err.name === 'AbortError') throw err;
            throw { type: 'network', message: `Ошибка при обращении к прокси: ${err.message}` };
        }
    },
    // **ИЗМЕНЕНИЕ**: Все методы API теперь принимают signal
    searchPublicTrackers: async function(movie, signal) {
        let lastError = null;
        for (const parser of PUBLIC_PARSERS) {
            try {
                // ... (params logic is the same)
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
                const result = await this.request(url, { method: 'GET', is_torbox_api: false }, signal);
                if (result && Array.isArray(result.Results)) {
                    LOG(`Success from ${parser.name}. Found ${result.Results.length} torrents.`);
                    return result.Results;
                }
            } catch (error) {
                if (error.name === 'AbortError') throw error;
                LOG(`Parser ${parser.name} failed:`, error.message);
                lastError = error;
            }
        }
        throw lastError || { type: 'api', message: 'Все публичные парсеры недоступны.' };
    },
    checkCached: async function(hashes, signal) {
        if (!Array.isArray(hashes) || hashes.length === 0) return {};
        const chunkSize = 100;
        let allCachedData = {};
        for (let i = 0; i < hashes.length; i += chunkSize) {
            const chunk = hashes.slice(i, i + chunkSize);
            const params = new URLSearchParams();
            chunk.forEach(hash => params.append('hash', hash));
            params.append('format', 'object');
            params.append('list_files', 'false');
            const url = `${this.MAIN_API}/torrents/checkcached?${params.toString()}`;
            try {
                const json = await this.request(url, { method: 'GET', is_torbox_api: true }, signal);
                if (json?.success && typeof json.data === 'object' && json.data !== null) {
                    Object.assign(allCachedData, json.data);
                }
            } catch (error) {
                if (error.name === 'AbortError') throw error;
                LOG(`Chunk failed on cache check:`, error.message);
            }
        }
        return allCachedData;
    },
    // ... (other API methods like addMagnet, myList etc. also need the signal)
    addMagnet: async function(magnet, signal) {
        const url = `${this.MAIN_API}/torrents/createtorrent`;
        const formData = new FormData();
        formData.append('magnet', magnet);
        formData.append('seed', '3');
        const json = await this.request(url, { method: 'POST', body: formData, is_torbox_api: true }, signal);
        if (!json?.data || (!json.data.id && !json.data.torrent_id)) {
            throw { type: 'validation', message: 'API добавления торрента вернуло неверную структуру.' };
        }
        return json;
    },
    stopTorrent: async function(torrentId, signal) {
        const url = `${this.MAIN_API}/torrents/controltorrent`;
        const body = { torrent_id: torrentId, operation: 'pause' };
        return this.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), is_torbox_api: true }, signal);
    },
    myList: async function(torrentId, signal) {
        const url = `${this.MAIN_API}/torrents/mylist?${new URLSearchParams({id: torrentId, bypass_cache: true}).toString()}`;
        return await this.request(url, { method: 'GET', is_torbox_api: true }, signal);
    },
    requestDl: async function(torrentId, fid, signal) {
        const params = new URLSearchParams({ torrent_id: torrentId, file_id: fid, token: CFG.apiKey });
        const url = `${this.MAIN_API}/torrents/requestdl?${params.toString()}`;
        const json = await this.request(url, { method: 'GET', is_torbox_api: true }, signal);
        const finalUrl = json?.data || json?.url;
        if (!finalUrl || !finalUrl.startsWith('http')) throw { type: 'validation', message: 'API ссылки на файл вернуло неверную структуру.' };
        return json;
    }
  };

  /* ───── TorBox Component (v24.1 - Refactored) ───── */
  function TorBoxComponent(object) {
    this.activity = object.activity;
    this.movie = object.movie;
    this.state = {};
    // **ИЗМЕНЕНИЕ**: Добавлен AbortController
    this.abortController = new AbortController();

    const sort_types = [
        { key: 'seeders', title: 'По сидам (убыв.)', field: 'last_known_seeders', reverse: true },
        { key: 'size_desc', title: 'По размеру (убыв.)', field: 'size', reverse: true },
        { key: 'size_asc', title: 'По размеру (возр.)', field: 'size', reverse: false },
        { key: 'age', title: 'По дате добавления', field: 'publish_date', reverse: true },
    ];

    /**
     * create() - Синхронно создает "скелет" UI.
     * Никаких асинхронных операций.
     */
    this.create = function() {
        LOG("Component create()");
        this.activity.loader(true); // Показываем глобальный лоадер Lampa

        this.state = {
            scroll: new Lampa.Scroll({ mask: true, over: true }),
            files: new Lampa.Explorer(object),
            filter: new Lampa.Filter(object),
            last: null,
            all_torrents: [],
            sort: Store.get('torbox_sort_method', 'seeders'),
            filters: JSON.parse(Store.get('torbox_filters', '{"quality":"all","tracker":"all"}')),
        };

        this.state.scroll.body().addClass('torrent-list');
        this.state.files.appendFiles(this.state.scroll.render());
        this.state.files.appendHead(this.state.filter.render());
        
        // Показываем начальное сообщение о загрузке
        this.empty('Загрузка торрентов...');

        return this.render();
    };

    /**
     * start() - Регистрирует контроллер и запускает асинхронную загрузку.
     */
    this.start = function() {
        LOG("Component start()");

        // **ИЗМЕНЕНИЕ**: Контроллер активируется немедленно
        Lampa.Controller.add('content', {
            toggle: () => {
                // **ИЗМЕНЕНИЕ**: collectionSet вызывается здесь, чтобы Lampa знала о контейнере
                Lampa.Controller.collectionSet(this.state.scroll.render(), this.state.files.render());
                Lampa.Controller.collectionFocus(this.state.last || false, this.state.scroll.render());
            },
            up: () => Navigator.move('up'),
            down: () => Navigator.move('down'),
            left: () => Lampa.Controller.toggle('menu'),
            right: () => {
                if (Navigator.canmove('right')) Lampa.Controller.toggle('head');
                else this.state.filter.show(Lampa.Lang.translate('title_filter'), 'filter');
            },
            back: () => {
                if ($('body').find('.select').length) Lampa.Select.close();
                else if ($('body').find('.filter').length) { Lampa.Filter.hide(); Lampa.Controller.toggle('content'); }
                else Lampa.Activity.backward();
            }
        });

        // **ИЗМЕНЕНИЕ**: Немедленно переключаемся на наш контент
        Lampa.Controller.toggle('content');

        // Инициализируем фильтры и запускаем загрузку
        this.initializeFilterHandlers();
        this.loadAndDisplayTorrents(); // Асинхронный вызов "fire-and-forget"
    };
    
    this.pause = function() { LOG("Component pause()"); };
    this.stop = function() { LOG("Component stop()"); };

    this.destroy = function() {
        LOG("Component destroy()");
        // **ИЗМЕНЕНИЕ**: Прерываем все активные запросы
        this.abortController.abort();
        
        Lampa.Controller.add('content', null);
        $(document).off('.torbox');
        
        if (this.state.scroll) this.state.scroll.destroy();
        if (this.state.files) this.state.files.destroy();
        if (this.state.filter) this.state.filter.destroy();
        
        for (let key in this.state) { this.state[key] = null; }
    };

    // ... (initializeFilterHandlers, updateFilterUI, applyFiltersAndSort остаются без изменений)
    this.initializeFilterHandlers = function() {
        this.state.filter.onSelect = (type, a, b) => {
            Lampa.Select.close();
            if (type === 'sort') {
                this.state.sort = a.key;
                Store.set('torbox_sort_method', a.key);
                this.display();
            }
            if (type === 'filter') {
                if (a.refresh) {
                    const cacheKey = `torbox_hybrid_${this.movie.id || this.movie.imdb_id}`;
                    delete Cache.store[cacheKey];
                    this.loadAndDisplayTorrents(true); 
                } else if (a.reset) {
                    this.state.filters = { quality: 'all', tracker: 'all' };
                    Store.set('torbox_filters', JSON.stringify(this.state.filters));
                    this.display();
                } else if (a.stype) {
                    this.state.filters[a.stype] = b.value;
                    Store.set('torbox_filters', JSON.stringify(this.state.filters));
                    this.display();
                }
            }
            Lampa.Controller.toggle('content');
        };
    };
    this.updateFilterUI = function() {
        const { filter, sort, filters, all_torrents } = this.state;
        const sort_items = sort_types.map(item => ({ ...item, selected: item.key === sort }));
        filter.set('sort', sort_items);
        filter.render().find('.filter--sort span').text('Сортировка');
        filter.chosen('sort', [(sort_types.find(s => s.key === sort) || {title:''}).title]);

        if (!Array.isArray(all_torrents)) this.state.all_torrents = [];
        const qualities = ['all', ...new Set(all_torrents.map(t => ql(t.raw_title)))];
        const trackers = ['all', ...new Set(all_torrents.map(t => t.tracker).filter(Boolean))];
        const quality_items = qualities.map(q => ({ title: q === 'all' ? 'Все' : q, value: q, selected: filters.quality === q }));
        const tracker_items = trackers.map(t => ({ title: t === 'all' ? 'Все' : t, value: t, selected: filters.tracker === t }));

        const filter_items = [
            {title:'Качество', subtitle:filters.quality==='all'?'Все':filters.quality, items:quality_items, stype:'quality'},
            {title:'Трекер', subtitle:filters.tracker==='all'?'Все':filters.tracker, items:tracker_items, stype:'tracker'},
            {title:'Сбросить фильтры', reset: true},
            {title:'Обновить список (очистить кэш)', refresh: true}
        ];

        filter.set('filter', filter_items);
        filter.render().find('.filter--filter span').text('Фильтр');

        const filter_titles = [];
        if (filters.quality !== 'all') filter_titles.push(`Качество: ${filters.quality}`);
        if (filters.tracker !== 'all') filter_titles.push(`Трекер: ${filters.tracker}`);
        filter.chosen('filter', filter_titles);
    };
    this.applyFiltersAndSort = function() {
        const { all_torrents, filters, sort } = this.state;
        if (!Array.isArray(all_torrents)) return [];
        let filtered = all_torrents.slice();
        if (filters.quality !== 'all') filtered = filtered.filter(t => ql(t.raw_title) === filters.quality);
        if (filters.tracker !== 'all') filtered = filtered.filter(t => t.tracker === filters.tracker);
        const sort_method = sort_types.find(s => s.key === sort);
        if (sort_method) {
            filtered.sort((a, b) => {
                const field = sort_method.field;
                let valA = a[field] || 0;
                let valB = b[field] || 0;
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


    this.loadAndDisplayTorrents = async function(force_refresh = false) {
        this.activity.loader(true);
        // Не очищаем скролл здесь, чтобы не было "прыжка" UI
        
        const movie = this.movie;
        if (!movie || (!movie.title && !movie.imdb_id)) {
            this.empty('Название фильма или IMDb ID не найдены');
            return;
        }

        const cacheKey = `torbox_hybrid_${movie.id || movie.imdb_id}`;
        if (!force_refresh) {
            const cached = Cache.get(cacheKey);
            if (cached) {
                LOG('Using cached results for hybrid search');
                this.state.all_torrents = cached;
                this.display(); // Отображаем кэшированные данные
                return;
            }
        }
        
        try {
            this.empty('Получение списка с публичных парсеров...');
            const rawTorrents = await API.searchPublicTrackers(movie, this.abortController.signal);
            
            // ... (дальнейшая логика обработки остается такой же)
            if (!Array.isArray(rawTorrents) || rawTorrents.length === 0) {
                this.empty('Парсер не вернул результатов. Попробуйте прямой поиск.');
                return;
            }
            LOG(`Парсер вернул ${rawTorrents.length} торрентов. Обработка...`);
            const torrentsWithHashes = [];
            rawTorrents.forEach((raw) => {
                if (raw?.MagnetUri) {
                    const match = raw.MagnetUri.match(/urn:btih:([a-fA-F0-9]{40})/i);
                    if (match?.[1]) {
                        torrentsWithHashes.push({ raw: raw, hash: match[1] });
                    }
                }
            });

            const hashesForCheck = torrentsWithHashes.map(t => t.hash);
            if (hashesForCheck.length === 0) {
                this.empty('Не найдено ни одного валидного торрента для проверки.');
                return;
            }

            this.empty(`Проверка кэша для ${hashesForCheck.length} торрентов в TorBox...`);
            const cachedDataObject = await API.checkCached(hashesForCheck, this.abortController.signal);
            const cachedHashes = new Set(Object.keys(cachedDataObject).map(h => h.toLowerCase()));
            LOG(`Получен статус кэша. ${cachedHashes.size} торрентов закэшировано.`);
            
            this.state.all_torrents = torrentsWithHashes.map(({ raw, hash }) => ({
                raw_title: raw.Title, size: raw.Size, magnet: raw.MagnetUri, hash: hash,
                last_known_seeders: raw.Seeders, last_known_peers: raw.Peers || raw.Leechers,
                tracker: raw.Tracker, cached: cachedHashes.has(hash.toLowerCase()), publish_date: raw.PublishDate
            }));

            Cache.set(cacheKey, this.state.all_torrents);
            this.display();

        } catch (error) {
            LOG(`Parser flow failed: ${error.message}.`);
            ErrorHandler.show(error.type || 'unknown', error);
            this.empty(error.message || 'Ошибка при загрузке с парсеров');
        } finally {
            this.activity.loader(false);
        }
    };

    /**
     * display() - Фильтрует, сортирует и вызывает отрисовку
     */
    this.display = function() {
        this.updateFilterUI();
        this.draw(this.applyFiltersAndSort());
    };

    /**
     * draw() - Отрисовывает контент и, что КЛЮЧЕВОЕ, обновляет контроллер
     */
    this.draw = function(torrents_list) {
        this.state.last = null;
        this.state.scroll.clear();
        this.activity.loader(false); // Убеждаемся что лоадер скрыт
        
        if (!torrents_list?.length) {
            this.empty('Ничего не найдено по заданным фильтрам');
            return;
        }
        
        const lastPlayedKey = `torbox_last_torrent_hash_${this.movie.id}`;
        const lastTorrentHash = Store.get(lastPlayedKey, null);
        let firstItem = null;

        torrents_list.forEach((t, index) => {
            const title = escapeHtml(t.raw_title || t.name);
            const isLastPlayed = lastTorrentHash && t.hash && (t.hash.toLowerCase() === lastTorrentHash.toLowerCase());
            const playedIcon = isLastPlayed ? '🎬 ' : '';
            const cacheIcon = t.cached ? '⚡' : '☁️';
            const ageText = formatAge(t.publish_date);
            const item = $(`<div class="torbox-item selector"><div class="torbox-item__title">${cacheIcon} ${playedIcon}${title}</div><div class="torbox-item__subtitle">[${ql(t.raw_title)}] ${formatBytes(t.size)} | 🟢 <span style="color:var(--color-good);">${t.last_known_seeders||0}</span> / 🔴 <span style="color:var(--color-bad);">${t.last_known_peers||0}</span><br><span style="opacity:0.7;">Трекер: ${escapeHtml(t.tracker||'н/д')} | Добавлено: ${escapeHtml(ageText)}</span></div></div>`);
            
            item.on('hover:focus.torbox', () => { 
                this.state.last = item[0]; 
                this.state.scroll.update(item, true); 
            });
            // **ИЗМЕНЕНИЕ**: Передаем `this.abortController.signal` в обработчик
            item.on('hover:enter.torbox', () => handleTorrent(t, this.movie, this, this.abortController.signal));
            
            this.state.scroll.append(item);
            
            if (index === 0) {
                firstItem = item[0];
            }
        });
        
        if (!this.state.last && firstItem) {
            this.state.last = firstItem;
        }

        // **КРИТИЧЕСКИ ВАЖНОЕ ИЗМЕНЕНИЕ**
        // Явно сообщаем Lampa, что коллекция изменилась и ее нужно пересканировать для навигации
        Lampa.Controller.collectionSet(this.state.scroll.render());
        Lampa.Controller.collectionFocus(this.state.last, this.state.scroll.render());
    };

    this.empty = function(msg) {
        this.state.scroll.clear();
        this.state.scroll.append($(`<div class="empty"><div class="empty__text">${escapeHtml(msg||'Торренты не найдены')}</div></div>`));
        this.activity.loader(false);
        // Также обновляем контроллер, даже если пусто, чтобы он знал о новом состоянии
        Lampa.Controller.collectionSet(this.state.scroll.render());
    };

    this.render = function() { return this.state.files.render(); };
  }

  /* ... (Модальные окна, обработчики, настройки) ... */
  // **ИЗМЕНЕНИЕ**: handleTorrent и другие функции, вызывающие API, теперь принимают signal
  async function handleTorrent(torrent, movie, component, signal) {
    try {
        if (!torrent?.magnet) {
             throw {type: 'validation', message: 'Не найдена magnet-ссылка.'};
        }
        showStatusModal('Добавление торрента...');
        const result = await API.addMagnet(torrent.magnet, signal);
        const torrentInfo = result.data;
        const torrentId = torrentInfo.torrent_id || torrentInfo.id;
        if (!torrentId) throw {type: 'api', message: 'Не удалось получить ID торрента.'};

        const finalTorrentData = await trackTorrentStatus(torrentId, signal);
        Store.set(`torbox_last_torrent_hash_${movie.id}`, String(finalTorrentData.hash || torrent.hash));
        Lampa.Modal.close();
        showFileSelection(finalTorrentData, movie, component, signal);
    } catch (e) {
        if (e.type !== "user" && e.name !== "AbortError") ErrorHandler.show(e.type || 'unknown', e);
        Lampa.Modal.close();
    }
  }

  function trackTorrentStatus(torrentId, signal) {
      return new Promise((resolve, reject) => {
          let isTrackingActive = true; let pollTimeout;
          const onCancel = () => { if (isTrackingActive) { isTrackingActive = false; clearTimeout(pollTimeout); reject({type: 'user', message: 'Отменено пользователем'}); } };
          showStatusModal('Отслеживание статуса...', onCancel);
          
          if (signal) {
              signal.addEventListener('abort', () => {
                  isTrackingActive = false;
                  clearTimeout(pollTimeout);
                  reject(new DOMException('Aborted', 'AbortError'));
              });
          }

          const poll = async () => {
              if (!isTrackingActive) { clearTimeout(pollTimeout); return; }
              try {
                  const torrentResult = await API.myList(torrentId, signal);
                  // ... остальная логика poll без изменений
                  const torrentData = torrentResult?.data?.[0];
                  if (!isTrackingActive) return;
                  if (!torrentData) { isTrackingActive = false; return reject({type: 'api', message: "Торрент исчез из списка"}); }
                  const currentStatus = torrentData.download_state || torrentData.status;
                  const statusMap = {'queued':'В очереди','downloading':'Загрузка','uploading':'Раздача','completed':'Завершен','stalled':'Остановлен','error':'Ошибка','metadl':'Получение метаданных','paused':'На паузе','failed':'Ошибка загрузки','checking':'Проверка'};
                  const statusText = statusMap[currentStatus.toLowerCase().split(' ')[0]] || currentStatus;
                  let progressValue = parseFloat(torrentData.progress);
                  let progressPercent = isNaN(progressValue) ? 0 : (progressValue > 1 ? progressValue : progressValue * 100);
                  progressPercent = Math.max(0, Math.min(100, progressPercent));
                  const etaValue = parseInt(torrentData.eta, 10);
                  const sizeValue = parseInt(torrentData.size, 10);
                  let progressText = (currentStatus.toLowerCase().startsWith('checking') || isNaN(sizeValue) || sizeValue === 0) ? "Обработка торрента..." : `${progressPercent.toFixed(2)}% из ${formatBytes(sizeValue)}`;
                  updateStatusModal({ status: escapeHtml(statusText), progress: progressPercent, progressText: escapeHtml(progressText), speed: `Скорость: ${escapeHtml(formatBytes(torrentData.download_speed, true))}`, eta: `Осталось: ${escapeHtml(formatTime(etaValue))}`, peers: `Сиды: ${escapeHtml(String(torrentData.seeds || '0'))} / Пиры: ${escapeHtml(String(torrentData.peers || '0'))}` });
                  const isDownloadFinished = currentStatus === 'completed' || torrentData.download_finished || progressPercent >= 100;
                  const filesAreReady = torrentData.files && torrentData.files.length > 0;
                  if (isDownloadFinished && filesAreReady) {
                      isTrackingActive = false;
                      if (currentStatus.startsWith('uploading')) {
                          updateStatusModal({ status: 'Загрузка завершена. Остановка раздачи...', progress: 100, peers: `Сиды: ${escapeHtml(String(torrentData.seeds))} / Пиры: ${escapeHtml(String(torrentData.peers))}` });
                          await API.stopTorrent(torrentData.id, signal).catch(e => LOG('Не удалось остановить раздачу:', e.message));
                      }
                      resolve(torrentData);
                  } else {
                      if (isDownloadFinished && !filesAreReady) updateStatusModal({ status: 'Завершено, обработка файлов...', progress: 100 });
                      if (isTrackingActive) pollTimeout = setTimeout(poll, 5000);
                  }

              } catch (error) { isTrackingActive = false; reject(error); }
          };
          poll();
      });
  }

  function showFileSelection(torrentData, movie, component, signal) {
      if (!torrentData?.files?.length) throw {type: 'validation', message: 'Видеофайлы не найдены в торренте.'};
      const files = torrentData.files.filter(f => /\.(mkv|mp4|avi)$/i.test(f.name));
      if (!files.length) throw {type: 'validation', message: 'Воспроизводимые видеофайлы не найдены.'};
      if (files.length === 1) return play(torrentData.id, files[0], movie, component, signal);
      files.sort((a,b) => b.size - a.size);
      const lastPlayedFileId = Store.get(`torbox_last_played_${movie.imdb_id}`, null);
      const fileItems = files.map(f => {
          let title = escapeHtml(f.name);
          if (lastPlayedFileId && String(f.id) === String(lastPlayedFileId)) title = `▶️ ${title} (прошлый просмотр)`;
          return { title: title, subtitle: formatBytes(f.size), file: f };
      });
      Lampa.Select.show({ title: 'Выбор файла для воспроизведения', items: fileItems, onSelect: item => play(torrentData.id, item.file, movie, component, signal), onBack: () => component.start() });
  }

  async function play(torrentId, file, movie, component, signal) {
    showStatusModal('Получение ссылки на файл...');
    try {
      const dlResponse = await API.requestDl(torrentId, file.id, signal);
      const finalUrl = dlResponse?.data || dlResponse?.url;
      try { Store.set(`torbox_last_played_${movie.imdb_id}`, String(file.id)); } catch (e) { LOG('Не удалось сохранить последний просмотренный файл:', e); }
      const player_data = { url: finalUrl, title: file.name || movie.title, poster: movie.img };
      Lampa.Modal.close();
      Lampa.Player.play(player_data);
    } catch (e) {
      ErrorHandler.show(e.type || 'unknown', e);
      Lampa.Modal.close();
    }
  }
  // ... (Остальной код модальных окон без изменений)
    let modalCache = {};
    function showStatusModal(title, onBack) {
        if ($('.modal').length) Lampa.Modal.close();
        modalCache = {};
        const modalHtml = $(`<div class="torbox-status"><div class="torbox-status__title">${escapeHtml(title)}</div><div class="torbox-status__info" data-name="status">Ожидание...</div><div class="torbox-status__info" data-name="progress-text"></div><div class="torbox-status__progress-container"><div class="torbox-status__progress-bar" style="width: 0%;"></div></div><div class="torbox-status__info" data-name="speed"></div><div class="torbox-status__info" data-name="eta"></div><div class="torbox-status__info" data-name="peers"></div></div>`);
        Lampa.Modal.open({ title: 'TorBox', html: modalHtml, size: 'medium', onBack: onBack || (() => { Lampa.Modal.close(); modalCache = {}; }) });
    }
    function updateStatusModal(data) {
        if (!modalCache.body) modalCache.body = $('.modal__content .torbox-status');
        if (!modalCache.body.length) return;
        if (!modalCache.status) modalCache.status = modalCache.body.find('[data-name="status"]');
        if (!modalCache.progressText) modalCache.progressText = modalCache.body.find('[data-name="progress-text"]');
        if (!modalCache.speed) modalCache.speed = modalCache.body.find('[data-name="speed"]');
        if (!modalCache.eta) modalCache.eta = modalCache.body.find('[data-name="eta"]');
        if (!modalCache.peers) modalCache.peers = modalCache.body.find('[data-name="peers"]');
        if (!modalCache.progressBar) modalCache.progressBar = modalCache.body.find('.torbox-status__progress-bar');
        modalCache.status.text(data.status || '...');
        modalCache.progressText.text(data.progressText || '');
        modalCache.speed.text(data.speed || '');
        modalCache.eta.text(data.eta || '');
        modalCache.peers.text(data.peers || '');
        const progressPercent = Math.max(0, Math.min(100, data.progress || 0));
        if (modalCache.progressBar.length) modalCache.progressBar.css('width', progressPercent + '%');
    }
    
  /* ───── Settings & Boot ───── */
  function addSettings() {
    if (!Lampa.SettingsApi) return;
    Lampa.SettingsApi.addComponent({ component: 'torbox_enh', name: 'TorBox Enhanced', icon: ICON });
    const fields = [
        {k:'torbox_proxy_url', n:'URL вашего CORS-прокси', d:`По умолчанию: ${DEFAULTS.proxyUrl}`, t:'input', def:Store.get('torbox_proxy_url','')},
        {k:'torbox_api_key', n:'Ваш личный API-Key', d:'По умолчанию используется гостевой ключ', t:'input', def:Store.get('torbox_api_key','')},
        {k:'torbox_debug', n:'Режим отладки', d:'Записывать подробную информацию в консоль', t:'trigger', def:CFG.debug}
    ];
    fields.forEach(p => {
        Lampa.SettingsApi.addParam({
            component: 'torbox_enh',
            param: { name: p.k, type: p.t, values: '', default: p.def },
            field: { name: p.n, description: p.d },
            onChange: v => {
                const a = String(typeof v === 'object' ? v.value : v).trim();
                if (p.k === 'torbox_proxy_url') CFG.proxyUrl = a;
                if (p.k === 'torbox_api_key') CFG.apiKey = a;
                if (p.k === 'torbox_debug') CFG.debug = Boolean(v);
            }
        });
    });
  }

  function boot() {
    Lampa.Listener.follow('full', e => {
      if (e.type !== 'complite' || !e.data.movie) return;
      const root = e.object.activity.render();
      if (root.find('.view--torbox').length) return;
      const btn = $(`<div class="full-start__button selector view--torbox" data-subtitle="TorBox">${ICON}<span>TorBox</span></div>`);
      btn.on('hover:enter.torbox', () => {
          Lampa.Activity.push({ component: 'torbox_component', title: 'TorBox - ' + (e.data.movie.title || e.data.movie.name), movie: e.data.movie });
      });
      root.find('.view--torrent').after(btn);
    });
  }

  (function bootLoop () {
    if (window.Lampa && Lampa.Activity) {
      try {
        Lampa.Component.add('torbox_component', TorBoxComponent);
        addSettings();
        boot();
        LOG('TorBox v24.1.0 (Definitive Fix) ready');
      }
      catch (e) { console.error('[TorBox] Boot Error:', e); }
    } else {
        setTimeout(bootLoop, 300);
    }
  })();

})();
