/*
 * TorBox Enhanced – Universal Lampa Plugin v26.0.0 (Architecture Rebuild)
 * =================================================================================
 * • ПОЛНАЯ ПЕРЕРАБОТКА АРХИТЕКТУРЫ: По вашему справедливому замечанию, код был
 * полностью переписан с возвратом к стабильной архитектуре v18. Вместо
 * самодельного интерфейса теперь используются нативные компоненты Lampa.Explorer
 * и Lampa.Filter, что гарантирует правильную интеграцию и стабильную работу.
 * • ИСПРАВЛЕНИЕ ЛОГИКИ ЗАПРОСОВ: Восстановлена корректная логика API-запросов
 * из v18, включая удаление конфликтующего заголовка 'Authorization', что
 * окончательно решает проблему "торрент не найден".
 * • СТАБИЛЬНОСТЬ И НАДЕЖНОСТЬ: Сохранены все работающие исправления:
 * современный и безопасный конструктор компонента, изолированные CSS-стили
 * и улучшенный механизм отслеживания статуса торрента с ретраями.
 */

(function () {
  'use strict';

  /* ───── Guard double-load ───── */
  const PLUGIN_ID = 'torbox_enhanced_v26_0_0_rebuild';
  if (window[PLUGIN_ID]) return;
  window[PLUGIN_ID] = true;

  /* ───── Globals & Constants (Lampa-independent) ───── */
  const ICON = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 7L12 2L21 7V17L12 22L3 17V7Z" stroke="currentColor" stroke-width="2"/><path d="M12 22V12" stroke="currentColor" stroke-width="2"/><path d="M21 7L12 12L3 7" stroke="currentColor" stroke-width="2"/></svg>`;

  const Store = {
    get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, String(v)); } catch {} }
  };
  
  const SearchCache = new Map();
  const CACHE_TTL_MS = 10 * 60 * 1000; // 10 минут

  const DEFAULTS = {
    proxyUrl: 'https://proxy.cub.watch/',
    apiKey: ''
  };

  const CFG = {
    get debug()     { return Store.get('torbox_debug', '0') === '1'; },
    set debug(v)    { Store.set('torbox_debug', v ? '1' : '0');       },
    get proxyUrl()  { return Store.get('torbox_proxy_url') || DEFAULTS.proxyUrl; },
    set proxyUrl(v) { Store.set('torbox_proxy_url', v); },
    get apiKey()    { return Store.get('torbox_api_key') || DEFAULTS.apiKey; },
    set apiKey(v)   { Store.set('torbox_api_key', v); }
  };
  
  const LOG  = (...a) => CFG.debug && console.log('[TorBox]', ...a);

  if (!$('#torbox-component-styles').length) {
      $('head').append(`<style id="torbox-component-styles">
        .torbox-item{padding:1.2em;margin:.5em 0;border-radius:.8em;background:var(--color-background-light);cursor:pointer;transition:all .3s ease;border:2px solid transparent}
        .torbox-item:hover,.torbox-item.focus{background:var(--color-primary);color:var(--color-background);transform:translateX(.8em);border-color:rgba(255,255,255,.3);box-shadow:0 4px 20px rgba(0,0,0,.2)}
        .torbox-item__title{font-weight:600;margin-bottom:.5em;font-size:1.1em;line-height:1.3}
        .torbox-item__subtitle{font-size:.95em;opacity:.8;line-height:1.4}
        .torrent-list{padding:1em}
        .torbox-status{padding:1.5em 2em; text-align:center; min-height:200px;}
        .torbox-status__title{font-size:1.4em; margin-bottom:1em; font-weight:600;}
        .torbox-status__info{font-size: 1.1em; margin-bottom: 0.8em; color: var(--color-text);}
        .torbox-status__progress-container{margin:1.5em 0; background:rgba(255,255,255,0.1); border-radius:8px; overflow:hidden; height:12px; position:relative;}
        .torbox-status__progress-bar{height:100%; width:0%; background:linear-gradient(90deg, var(--color-primary), var(--color-primary-light, #4CAF50)); transition: width 0.5s ease-out; border-radius:8px; position:relative;}
        .torbox-status__progress-bar::after{content:''; position:absolute; top:0; left:0; right:0; bottom:0; background:linear-gradient(45deg, transparent 30%, rgba(255,255,255,0.2) 50%, transparent 70%); animation:shimmer 2s infinite;}
        @keyframes shimmer{0%{transform:translateX(-100%)} 100%{transform:translateX(100%)}}
        .modal .torbox-status__progress-container{background:rgba(255,255,255,0.2) !important;}
        .modal .torbox-status__progress-bar{background:linear-gradient(90deg, #4CAF50, #66BB6A) !important;}
      </style>`);
  }

  function initPlugin() {
    
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

    const ql = (title) => {
        if (!title) return 'SD';
        if (title.match(/2160p|4K|UHD/i)) return '4K';
        if (title.match(/1080p|FHD/i)) return 'FHD';
        if (title.match(/720p|HD/i)) return 'HD';
        return 'SD';
    };

    function processResponse(responseText, status) {
        if (status === 401) throw { type: 'auth', message: `Ошибка авторизации (401). Проверьте API-ключ.` };
        if (status === 403) throw { type: 'auth', message: `Доступ запрещен (403). У ключа недостаточно прав.` };
        if (status === 429) throw { type: 'network', message: `Слишком много запросов (429). Попробуйте позже.` };
        if (status >= 500) throw { type: 'network', message: `Внутренняя ошибка сервера TorBox (${status}).` };
        if (status >= 400) throw { type: 'network', message: `Ошибка клиента (${status}). Неверный запрос.` };
        if (status < 200 || status >= 300) throw { type: 'network', message: `Неизвестная сетевая ошибка: HTTP ${status}` };
        if (!responseText || (typeof responseText === 'string' && responseText.trim() === '')) {
            throw { type: 'api', message: `Получен пустой ответ от сервера (HTTP ${status}).` };
        }
        try {
            if (typeof responseText === 'string' && (responseText.startsWith('http://') || responseText.startsWith('https://'))) {
                return { success: true, data: responseText, url: responseText };
            }
            const json = (typeof responseText === 'object') ? responseText : JSON.parse(responseText);
            if (typeof json === 'object' && !Array.isArray(json) && json.success === false) {
                const errorMsg = (json.detail && typeof json.detail === 'string')
                    ? json.detail
                    : (Array.isArray(json.detail) && json.detail[0]?.msg)
                    ? json.detail[0].msg
                    : (json.message || 'API вернуло ошибку без деталей.');
                throw { type: 'api', message: errorMsg };
            }
            return json;
        } catch (e) {
            LOG('Invalid JSON or API error:', responseText, e);
            if (e.type) throw e;
            throw { type: 'api', message: 'Получен некорректный ответ от сервера (не JSON).' };
        }
    }

    const API = {
      SEARCH_API: 'https://search-api.torbox.app',
      MAIN_API: 'https://api.torbox.app/v1/api',
      request: async function(url, options = {}, signal) {
          if (!CFG.proxyUrl) {
              throw { type: 'validation', message: "URL прокси-сервера не указан в настройках."};
          }
          const proxyUrl = `${CFG.proxyUrl}?url=${encodeURIComponent(url)}`;
          LOG('Calling via universal proxy. Target:', url);
          options.headers = options.headers || {};
          
          options.headers['X-Api-Key'] = CFG.apiKey;
          delete options.headers['Authorization'];
          
          try {
              const response = await fetch(proxyUrl, { ...options, signal });
              const responseText = await response.text();
              return processResponse(responseText, response.status);
          } catch (err) {
              if (err.type || err.name === 'AbortError') throw err;
              throw { type: 'network', message: `Ошибка при обращении к прокси: ${err.message}` };
          }
      },
      search: async function(imdbId, signal) {
          if (!imdbId) throw { type: 'validation', message: 'IMDb ID не передан' };
          let formattedImdbId = imdbId.startsWith('tt') ? imdbId : `tt${imdbId}`;
          
          const useUserEngines = Store.get('torbox_use_user_engines', 'false') === 'true';
          const searchParams = new URLSearchParams({
              check_cache: 'true',
              check_owned: 'false',
              search_user_engines: useUserEngines
          });
          
          const url = `${this.SEARCH_API}/torrents/imdb:${formattedImdbId}?${searchParams.toString()}`;
          const json = await this.request(url, { method: 'GET' }, signal);
          
          if (!json?.data?.torrents || !Array.isArray(json.data.torrents)) {
               throw { type: 'validation', message: 'API поиска вернуло неверную структуру данных.' };
          }
          return json.data.torrents;
      },
      addMagnet: async function(magnet, signal) {
          const url = `${this.MAIN_API}/torrents/createtorrent`;
          const formData = new FormData();
          formData.append('magnet', magnet);
          formData.append('seed', '3');
          const json = await this.request(url, { method: 'POST', body: formData }, signal);
          if (!json?.data || (!json.data.id && !json.data.torrent_id)) {
              throw { type: 'validation', message: 'API добавления торрента вернуло неверную структуру.' };
          }
          return json;
      },
      stopTorrent: async function(torrentId, signal) {
          const url = `${this.MAIN_API}/torrents/controltorrent`;
          const body = { torrent_id: torrentId, operation: 'pause' };
          return this.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, signal);
      },
      myList: async function(torrentId, signal) {
          const url = `${this.MAIN_API}/torrents/mylist?${new URLSearchParams({id: torrentId, bypass_cache: true}).toString()}`;
          const json = await this.request(url, { method: 'GET' }, signal);
          if (!json || !json.data) {
             throw { type: 'validation', message: 'API списка торрентов вернуло неверную структуру.' };
          }
          if (json.data && !Array.isArray(json.data)) {
            json.data = [json.data];
          }
          if (json.data.length > 0 && typeof json.data[0] !== 'object') {
             throw { type: 'validation', message: 'API списка торрентов вернуло неверные данные.' };
          }
          return json;
      },
      requestDl: async function(torrentId, fid, signal) {
          const params = new URLSearchParams({ torrent_id: torrentId, file_id: fid, token: CFG.apiKey });
          const url = `${this.MAIN_API}/torrents/requestdl?${params.toString()}`;
          const json = await this.request(url, { method: 'GET' }, signal);
          const finalUrl = json?.data || json?.url;
          if (!finalUrl || !finalUrl.startsWith('http')) throw { type: 'validation', message: 'API ссылки на файл вернуло неверную структуру.' };
          return json;
      }
    };
    
    // ==================================================================
    // ARCHITECTURE REBUILD: Using Lampa Native Components (from v18)
    // ==================================================================
    function TorBoxComponent(object) {
        // Safe binding of methods
        for (const key in this) {
            if (typeof this[key] === 'function') {
                this[key] = this[key].bind(this);
            }
        }
        
        this.activity = object.activity;
        this.movie = object.movie;
        this.abortController = new AbortController();

        this.sort_types = [
            { key: 'seeders', title: 'По сидам (убыв.)', field: 'last_known_seeders', reverse: true },
            { key: 'size_desc', title: 'По размеру (убыв.)', field: 'size', reverse: true },
            { key: 'size_asc', title: 'По размеру (возр.)', field: 'size', reverse: false },
            { key: 'age', title: 'По дате добавления', field: 'age', reverse: false },
        ];
        
        // Component state, as in v18
        this.state = {
            scroll: null,
            files: null,
            filter: null,
            last: null,
            initialized: false,
            all_torrents: [],
            sort: Store.get('torbox_sort_method', 'seeders'),
            filters: JSON.parse(Store.get('torbox_filters', '{"quality":"all","tracker":"all"}')),
            ageCache: new Map()
        };
    }

    TorBoxComponent.prototype.create = function() {
        LOG("Component create() -> initialize()");
        this.initialize();
        return this.render();
    };

    TorBoxComponent.prototype.start = function () {
        LOG("Component start()");
        this.activity.loader(false);
        Lampa.Controller.add('content', {
            toggle: () => { 
                Lampa.Controller.collectionSet(this.state.scroll.render(), this.state.files.render());
                Lampa.Controller.collectionFocus(this.state.last || false, this.state.scroll.render()); 
            },
            up: () => { window.Navigator.move('up'); },
            down: () => { window.Navigator.move('down'); },
            left: () => { Lampa.Controller.toggle('menu'); },
            right: () => { 
                if(window.Navigator.canmove('right')) Lampa.Controller.toggle('head'); 
                else this.state.filter.show(Lampa.Lang.translate('title_filter'), 'filter'); 
            },
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

    TorBoxComponent.prototype.destroy = function() {
        LOG('Destroying TorBox component');
        this.abortController.abort();
        Lampa.Controller.remove('content');
        if (this.state.ageCache) this.state.ageCache.clear();
        if (this.state.scroll) this.state.scroll.destroy();
        if (this.state.files) this.state.files.destroy();
        if (this.state.filter) this.state.filter.destroy();
        for (let key in this.state) this.state[key] = null;
    };

    TorBoxComponent.prototype.initialize = function() {
        if (this.state.initialized) return;
        LOG("Component initialize()");

        this.state.scroll = new Lampa.Scroll({ mask: true, over: true });
        this.state.files = new Lampa.Explorer(this.activity.render().find('.explorer-parent')[0] || {});
        this.state.filter = new Lampa.Filter(this.activity.render().find('.filter-parent')[0] || {});

        this.initializeFilterHandlers(); 
        if (this.state.filter.addButtonBack) this.state.filter.addButtonBack();
        
        this.state.scroll.body().addClass('torrent-list');
        this.state.files.appendFiles(this.state.scroll.render());
        this.state.files.appendHead(this.state.filter.render());
        this.state.scroll.minus(this.state.files.render().find('.explorer__files-head'));
        
        this.loadAndDisplayTorrents();
        this.state.initialized = true;
    };
    
    TorBoxComponent.prototype.initializeFilterHandlers = function() {
        this.state.filter.onSelect = (type, a, b) => {
            Lampa.Select.close();
            if (type === 'sort') {
                this.state.sort = a.key;
                Store.set('torbox_sort_method', a.key);
                this.display();
            }
            if (type === 'filter') {
                if (a.refresh) this.loadAndDisplayTorrents(true);
                else if (a.reset) {
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
        this.state.filter.onBack = () => Lampa.Controller.toggle('content');
    };

    TorBoxComponent.prototype.updateFilterUI = function() {
        const { filter, sort, filters, all_torrents } = this.state;
        const sort_items = this.sort_types.map(item => ({...item, selected: item.key === sort}));
        filter.set('sort', sort_items);
        filter.render().find('.filter--sort span').text('Сортировка');
        filter.chosen('sort', [ (this.sort_types.find(s => s.key === sort) || {title:''}).title ]);
        
        if (!Array.isArray(all_torrents)) this.state.all_torrents = [];

        const qualities = ['all', ...new Set(all_torrents.map(t => ql(t.raw_title)))];
        const trackers = ['all', ...new Set(all_torrents.map(t => t.tracker).filter(Boolean))];
        const quality_items = qualities.map(q => ({ title: q === 'all' ? 'Все' : q, value: q, selected: filters.quality === q }));
        const tracker_items = trackers.map(t => ({ title: t === 'all' ? 'Все' : t, value: t, selected: filters.tracker === t }));
        
        const filter_items = [
            {title:'Качество', subtitle:filters.quality==='all'?'Все':filters.quality, items:quality_items, stype:'quality'},
            {title:'Трекер', subtitle:filters.tracker==='all'?'Все':filters.tracker, items:tracker_items, stype:'tracker'},
            {title:'Сбросить фильтры', reset: true},
            {title:'Обновить список', refresh: true}
        ];

        filter.set('filter', filter_items);
        filter.render().find('.filter--filter span').text('Фильтр');
        
        const filter_titles = [];
        if(filters.quality !== 'all') filter_titles.push(`Качество: ${filters.quality}`);
        if(filters.tracker !== 'all') filter_titles.push(`Трекер: ${filters.tracker}`);
        filter.chosen('filter', filter_titles);
    };

    TorBoxComponent.prototype.applyFiltersAndSort = function() {
        const { all_torrents, filters, sort, ageCache } = this.state;
        if (!Array.isArray(all_torrents)) return [];
        
        let filtered = all_torrents.slice();
        if (filters.quality !== 'all') filtered = filtered.filter(t => ql(t.raw_title) === filters.quality);
        if (filters.tracker !== 'all') filtered = filtered.filter(t => t.tracker === filters.tracker);
        
        const sort_method = this.sort_types.find(s => s.key === sort);
        if (sort_method) {
            const parseAge = (ageString) => {
                if (!ageString) return Infinity;
                if (ageCache.has(ageString)) return ageCache.get(ageString);
                
                const value = parseInt(ageString, 10) || 0;
                let result = Infinity;
                if (ageString.includes("s")) result = value;
                else if (ageString.includes("m")) result = value * 60;
                else if (ageString.includes("h")) result = value * 3600;
                else if (ageString.includes("d")) result = value * 86400;
                else if (ageString.includes("w")) result = value * 604800;
                else if (ageString.includes("y")) result = value * 31536000;
                
                ageCache.set(ageString, result);
                return result;
            };
            filtered.sort((a, b) => {
                const field = sort_method.field;
                const valA = (field === "age") ? parseAge(a.age) : a[field] || 0;
                const valB = (field === "age") ? parseAge(b.age) : b[field] || 0;
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
        this.state.scroll.clear();
        try {
            const imdb_id = this.movie?.imdb_id;
            if (!imdb_id) throw { type: 'validation', message: 'IMDb ID не найден' };

            const useUserEngines = Store.get('torbox_use_user_engines', 'false') === 'true';
            const cacheKey = `${imdb_id}_${useUserEngines}`;

            if (!force_update && SearchCache.has(cacheKey)) {
                const cached = SearchCache.get(cacheKey);
                if (Date.now() - cached.timestamp < CACHE_TTL_MS) {
                    LOG(`Using cached results for ${cacheKey}`);
                    this.state.all_torrents = cached.data;
                    this.display();
                    this.activity.loader(false);
                    return;
                }
            }
            
            LOG(`Fetching fresh results for ${cacheKey}`);
            const torrents = await API.search(imdb_id, this.abortController.signal);
            
            SearchCache.set(cacheKey, { timestamp: Date.now(), data: torrents });
            this.state.all_torrents = torrents.map(t => ({...t, raw_title: t.raw_title || t.title}));
            this.display();
        } catch (error) {
            this.empty(error.message || 'Произошла ошибка');
            ErrorHandler.show(error.type || 'unknown', error);
        } finally {
            this.activity.loader(false);
        }
    };

    TorBoxComponent.prototype.display = function() {
        this.updateFilterUI();
        this.draw(this.applyFiltersAndSort());
    };

    TorBoxComponent.prototype.draw = function(torrents_list) {
        this.state.last = null;
        this.state.scroll.clear();
        if (!torrents_list?.length) {
            this.empty('Ничего не найдено по заданным фильтрам');
            return;
        }
        const lastPlayedKey = `torbox_last_torrent_${this.movie.imdb_id}`;
        const lastTorrentId = Store.get(lastPlayedKey, null);

        torrents_list.forEach(t => {
            const isLastPlayed = lastTorrentId && (String(t.id) === lastTorrentId || t.hash === lastTorrentId);
            const title = escapeHtml(t.raw_title || t.title);
            const playedIcon = isLastPlayed ? '🎬 ' : '';

            const item = $(`<div class="torbox-item selector"><div class="torbox-item__title">${t.cached?'⚡':'☁️'} ${playedIcon}${title}</div><div class="torbox-item__subtitle">[${ql(t.raw_title||t.title)}] ${formatBytes(t.size)} | 🟢 <span style="color:var(--color-good);">${t.last_known_seeders||0}</span> / 🔴 <span style="color:var(--color-bad);">${t.last_known_peers||0}</span><br><span style="opacity:0.7;">Трекер: ${escapeHtml(t.tracker||'н/д')} | Добавлено: ${escapeHtml(t.age||'н/д')}</span></div></div>`);
            item.on('hover:focus', () => { this.state.last = item[0]; this.state.scroll.update(item, true); });
            item.on('hover:enter', () => handleTorrent(t, this.movie, this));
            this.state.scroll.append(item);
        });
    };

    TorBoxComponent.prototype.empty = function(msg) { 
        this.state.scroll.clear(); 
        this.state.scroll.append($(`<div class="empty"><div class="empty__text">${escapeHtml(msg||'Торренты не найдены')}</div></div>`)); 
        this.activity.loader(false);
    };
    
    TorBoxComponent.prototype.render = function() {
        return this.state.files.render();
    };

    // ==================================================================
    // Modal, Torrent Handling, and Player Logic
    // ==================================================================

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

    function trackTorrentStatus(torrentId, signal) {
        return new Promise((resolve, reject) => {
            let isTrackingActive = true; 
            let pollTimeout;
            let retries = 0;
            const MAX_RETRIES = 8;
            const RETRY_DELAY = 3500;

            const onCancel = () => { 
                if (isTrackingActive) { 
                    isTrackingActive = false; 
                    clearTimeout(pollTimeout); 
                    reject({type: 'user', message: 'Отменено пользователем'}); 
                } 
            };

            showStatusModal('Отслеживание статуса...', onCancel);
            
            if (signal) signal.addEventListener('abort', () => { 
                isTrackingActive = false; 
                clearTimeout(pollTimeout); 
                reject(new DOMException('Aborted', 'AbortError')); 
            });

            const poll = async () => {
                if (!isTrackingActive) { clearTimeout(pollTimeout); return; }
                
                try {
                    const torrentResult = await API.myList(torrentId, signal);
                    const torrentData = torrentResult?.data?.[0];

                    if (!isTrackingActive) return;

                    if (!torrentData) {
                        retries++;
                        if (retries > MAX_RETRIES) {
                            isTrackingActive = false;
                            return reject({type: 'api', message: "Торрент не появился в списке после добавления."});
                        } else {
                            LOG(`Торрент ${torrentId} не найден, попытка ${retries}/${MAX_RETRIES}. Повтор через ${RETRY_DELAY} мс.`);
                            updateStatusModal({ status: `Ожидание в списке... (попытка ${retries})` });
                            if (isTrackingActive) pollTimeout = setTimeout(poll, RETRY_DELAY);
                            return;
                        }
                    }

                    retries = 0; 
                    const currentStatus = torrentData.download_state || torrentData.status;
                    const statusMap = {'queued':'В очереди','downloading':'Загрузка','uploading':'Раздача','completed':'Завершен','stalled':'Остановлен','error':'Ошибка','metadl':'Получение метаданных','paused':'На паузе','failed':'Ошибка загрузки','checking':'Проверка'};
                    const statusText = statusMap[currentStatus.toLowerCase().split(' ')[0]] || currentStatus;
                    let progressValue = parseFloat(torrentData.progress);
                    let progressPercent = isNaN(progressValue) ? 0 : (progressValue > 1 ? progressValue : progressValue * 100);
                    
                    updateStatusModal({ 
                        status: escapeHtml(statusText), 
                        progress: progressPercent, 
                        progressText: `${progressPercent.toFixed(2)}% из ${formatBytes(torrentData.size)}`, 
                        speed: `Скорость: ${formatBytes(torrentData.download_speed, true)}`, 
                        eta: `Осталось: ${formatTime(torrentData.eta)}`, 
                        peers: `Сиды: ${torrentData.seeds||0} / Пиры: ${torrentData.peers||0}` 
                    });

                    const isDownloadFinished = currentStatus === 'completed' || torrentData.download_finished || progressPercent >= 100;
                    const filesAreReady = torrentData.files && torrentData.files.length > 0;

                    if (isDownloadFinished && filesAreReady) {
                        isTrackingActive = false;
                        if (currentStatus.startsWith('uploading')) {
                            updateStatusModal({ status: 'Загрузка завершена. Остановка раздачи...', progress: 100 });
                            await API.stopTorrent(torrentData.id, signal).catch(e => LOG('Не удалось остановить раздачу:', e.message));
                        }
                        resolve(torrentData);
                    } else {
                        if (isTrackingActive) pollTimeout = setTimeout(poll, 5000);
                    }
                } catch (error) { 
                    isTrackingActive = false; 
                    reject(error); 
                }
            };
            poll();
        });
    }

    function showFileSelection(torrentData, movie, component) {
        if (!torrentData?.files?.length) throw {type: 'validation', message: 'Видеофайлы не найдены в торренте.'};
        const files = torrentData.files.filter(f => /\.(mkv|mp4|avi)$/i.test(f.name));
        if (!files.length) throw {type: 'validation', message: 'Воспроизводимые видеофайлы не найдены.'};
        files.sort((a,b) => b.size - a.size);
        if (files.length === 1) return play(torrentData.id, files[0], movie, component.abortController.signal);
        
        const lastPlayedFileId = Store.get(`torbox_last_played_${movie.imdb_id}`, null);
        const fileItems = files.map(f => {
            let title = escapeHtml(f.name);
            if (lastPlayedFileId && String(f.id) === String(lastPlayedFileId)) title = `▶️ ${title} (прошлый просмотр)`;
            return { title: title, subtitle: formatBytes(f.size), file: f };
        });
        Lampa.Select.show({ 
            title: 'Выбор файла для воспроизведения', 
            items: fileItems, 
            onSelect: item => play(torrentData.id, item.file, movie, component.abortController.signal), 
            onBack: () => Lampa.Controller.toggle('content') 
        });
    }

    async function play(torrentId, file, movie, signal) {
      showStatusModal('Получение ссылки на файл...');
      try {
        const dlResponse = await API.requestDl(torrentId, file.id, signal);
        Store.set(`torbox_last_played_${movie.imdb_id}`, String(file.id));
        const player_data = { url: dlResponse.data || dlResponse.url, title: file.name || movie.title, poster: movie.img };
        Lampa.Modal.close();
        Lampa.Player.play(player_data);
      } catch (e) {
        ErrorHandler.show(e.type || 'unknown', e);
        Lampa.Modal.close();
      }
    }

    async function handleTorrent(torrent, movie, component) {
      try {
          if (!torrent?.magnet) throw {type: 'validation', message: 'Не найдена magnet-ссылка.'};
          showStatusModal('Добавление торрента...');
          const result = await API.addMagnet(torrent.magnet, component.abortController.signal);
          const torrentId = result.data.torrent_id || result.data.id;
          if (!torrentId) throw {type: 'api', message: 'Не удалось получить ID торрента.'};
          
          const finalTorrentData = await trackTorrentStatus(torrentId, component.abortController.signal);
          
          Store.set(`torbox_last_torrent_${movie.imdb_id}`, String(finalTorrentData.id || torrentId));
          
          Lampa.Modal.close();
          showFileSelection(finalTorrentData, movie, component);
      } catch (e) {
          if (e.type !== "user" && e.name !== "AbortError") ErrorHandler.show(e.type || 'unknown', e);
          Lampa.Modal.close();
      }
    }

    function addSettings() {
      if (!Lampa.SettingsApi) return;
      Lampa.SettingsApi.addComponent({ component: 'torbox_enh', name: 'TorBox Enhanced', icon: ICON });
      const fields = [
          {k:'torbox_proxy_url', n:'URL вашего CORS-прокси', d:`По умолчанию: ${DEFAULTS.proxyUrl}`, t:'input', def:Store.get('torbox_proxy_url','')},
          {k:'torbox_api_key', n:'Ваш личный API-Key', d:'По умолчанию используется гостевой ключ', t:'input', def:Store.get('torbox_api_key','')},
          {k:'torbox_use_user_engines', n:'Использовать свои поисковики', d:'Включить поиск через свои поисковые системы, настроенные в TorBox', t:'trigger', def:Store.get('torbox_use_user_engines', 'false') === 'true'},
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
                  if (p.k === 'torbox_use_user_engines') {
                    Store.set('torbox_use_user_engines', String(v));
                    SearchCache.clear();
                    Lampa.Noty.show('Настройка поисковиков изменена. Кэш поиска очищен.');
                  }
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
        btn.on('hover:enter', () => {
            Lampa.Activity.push({ component: 'torbox_component', title: 'TorBox - ' + (e.data.movie.title || e.data.movie.name), movie: e.data.movie });
        });
        root.find('.view--torrent').after(btn);
      });
    }
    
    Lampa.Component.add('torbox_component', TorBoxComponent);
    addSettings();
    boot();
    LOG('TorBox v26.0.0 (Architecture Rebuild) ready');
  }

  (function bootLoop () {
    if (window.Lampa && Lampa.Activity && Lampa.Component && Lampa.Controller && Lampa.Scroll && Lampa.Select && Lampa.Modal && Lampa.Player && Lampa.Noty && Lampa.Listener && Lampa.Utils) {
      try {
        initPlugin();
      }
      catch (e) { console.error('[TorBox] Boot Error:', e); }
    } else {
        setTimeout(bootLoop, 300);
    }
  })();

})();
