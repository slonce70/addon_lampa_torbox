/*
 * TorBox Enhanced – Universal Lampa Plugin v29.0.0 (Rich UI Blocks & Bugfix)
 * =================================================================================
 * • НОВЫЙ БЛОЧНЫЙ ИНТЕРФЕЙС: Полностью переработан дизайн списка торрентов, 
 * чтобы соответствовать предоставленному примеру. Добавлена красочная нижняя 
 * панель с техническими данными (разрешение, кодеки, аудиодорожки).
 * • ИСПРАВЛЕНИЕ ОШИБКИ: Устранена критическая ошибка 'Uncaught SyntaxError: "undefined" is not valid JSON',
 * которая возникала при сбросе фильтров.
 * • ПРОДВИНУТЫЙ ФИЛЬТР И ЛОГИКА ТРЕКЕРОВ: Весь функционал из предыдущей версии сохранен.
 */

(function () {
  'use strict';

  /* ───── Guard double-load ───── */
  const PLUGIN_ID = 'torbox_enhanced_v29_0_0_rich_ui';
  if (window[PLUGIN_ID]) return;
  window[PLUGIN_ID] = true;

  /* ───── Globals & Constants ───── */
  const ICON = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 7L12 2L21 7V17L12 22L3 17V7Z" stroke="currentColor" stroke-width="2"/><path d="M12 22V12" stroke="currentColor" stroke-width="2"/><path d="M21 7L12 12L3 7" stroke="currentColor" stroke-width="2"/></svg>`;

  const PUBLIC_PARSERS = [
      { name: 'Viewbox', url: 'jacred.viewbox.dev', key: 'viewbox' },
      { name: 'Jacred',  url: 'jacred.xyz',          key: '' }
  ];

  const Store = {
    get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, String(v)); } catch {} }
  };
  
  const Cache = {
      store: {},
      get: function(key) {
          const entry = this.store[key];
          if (!entry) return null;
          const TEN_MINUTES = 10 * 60 * 1000;
          if (Date.now() - entry.timestamp > TEN_MINUTES) {
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
    proxyUrl: 'https://my-torbox-proxy.slonce70.workers.dev/',
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
        .torbox-item{padding:1em 1.2em;margin:.5em 0;border-radius:.8em;background:var(--color-background-light);cursor:pointer;transition:all .3s ease;border:2px solid transparent; overflow: hidden;}
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

    const ql = (title, raw) => {
        if (raw?.info?.quality) return `${raw.info.quality}p`;
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
      MAIN_API: 'https://api.torbox.app/v1/api',
      request: async function(url, options = {}, signal) {
          if (!CFG.proxyUrl) {
              throw { type: 'validation', message: "URL прокси-сервера не указан в настройках."};
          }
          const proxyUrl = `${CFG.proxyUrl}?url=${encodeURIComponent(url)}`;
          LOG('Calling via universal proxy. Target:', url);
          options.headers = options.headers || {};
          
          if (options.is_torbox_api !== false) {
              options.headers['X-Api-Key'] = CFG.apiKey;
          }
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
      searchPublicTrackers: async function(movie, signal) {
          let lastError = null;
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
                  const json = await this.request(url, { method: 'GET' }, signal);
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
        
        // BUGFIX: Moved defaultFilters to the instance scope
        this.defaultFilters = {
            quality: 'all',
            tracker: 'all',
            video_type: 'all', // sdr, hdr, dv
            translation: 'all',
            lang: 'all',
            video_codec: 'all',
            audio_codec: 'all'
        };

        this.state = {
            scroll: null,
            files: null,
            filter: null,
            last: null,
            initialized: false,
            all_torrents: [],
            sort: Store.get('torbox_sort_method', 'seeders'),
            // Use instance `defaultFilters` for initialization
            filters: JSON.parse(Store.get('torbox_filters_v2', JSON.stringify(this.defaultFilters))),
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

    TorBoxComponent.prototype.pause = function() {
        LOG('Component pause()');
        Lampa.Controller.add('content', null);
    };

    TorBoxComponent.prototype.stop = function() {
        LOG('Component stop()');
        Lampa.Controller.add('content', null);
    };

    TorBoxComponent.prototype.destroy = function() {
        LOG('Destroying TorBox component');
        this.abortController.abort();
        Lampa.Controller.add('content', null);
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
        
        this.state.files = new Lampa.Explorer(this.params);
        this.state.filter = new Lampa.Filter(this.params);

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
            const storeKey = 'torbox_filters_v2';
            if (type === 'sort') {
                this.state.sort = a.key;
                Store.set('torbox_sort_method', a.key);
            }
            if (type === 'filter') {
                if (a.refresh) {
                    this.loadAndDisplayTorrents(true);
                    return; 
                } else if (a.reset) {
                    // BUGFIX: Use the instance-scoped defaultFilters
                    this.state.filters = JSON.parse(JSON.stringify(this.defaultFilters)); 
                } else if (a.stype) {
                    this.state.filters[a.stype] = b.value; 
                }
                Store.set(storeKey, JSON.stringify(this.state.filters));
            }
            this.display();
            Lampa.Controller.toggle('content');
        };
        this.state.filter.onBack = () => Lampa.Controller.toggle('content');
    };

    TorBoxComponent.prototype.updateFilterUI = function() {
        const { filter, sort, filters, all_torrents } = this.state;
        
        // --- Sort ---
        const sort_items = this.sort_types.map(item => ({...item, selected: item.key === sort}));
        filter.set('sort', sort_items);
        filter.render().find('.filter--sort span').text('Сортировка');
        filter.chosen('sort', [ (this.sort_types.find(s => s.key === sort) || {title:''}).title ]);
        
        if (!Array.isArray(all_torrents)) this.state.all_torrents = [];

        // --- Filters ---
        const buildFilter = (key, title, allItems) => {
            const items = ['all', ...new Set(allItems.flat().filter(Boolean))].map(i => ({
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
        
        const filter_titles = [];
        Object.keys(filters).forEach(key => {
            if(filters[key] !== 'all') {
                const item = filter_items.find(f => f.stype === key);
                if (item) filter_titles.push(`${item.title}: ${filters[key]}`);
            }
        });
        filter.chosen('filter', filter_titles);
    };

    TorBoxComponent.prototype.applyFiltersAndSort = function() {
        const { all_torrents, filters, sort } = this.state;
        if (!Array.isArray(all_torrents)) return [];
        
        let filtered = all_torrents.slice().filter(t => {
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

    TorBoxComponent.prototype.loadAndDisplayTorrents = async function(force_update = false) {
        this.activity.loader(true);
        this.state.scroll.clear();
        try {
            const cacheKey = `torbox_hybrid_${this.movie.id || this.movie.imdb_id}`;
            LOG(`Checking cache for key: ${cacheKey}. Force update: ${force_update}`);

            if (!force_update && Cache.get(cacheKey)) {
                LOG(`Cache HIT for ${cacheKey}`);
                this.state.all_torrents = Cache.get(cacheKey);
                this.display();
                this.activity.loader(false);
                return;
            }

            LOG(`Cache MISS or REFRESH for ${cacheKey}. Fetching fresh results.`);
            
            this.empty('Получение списка с публичных парсеров...');
            const rawTorrents = await API.searchPublicTrackers(this.movie, this.abortController.signal);
            if (!Array.isArray(rawTorrents) || rawTorrents.length === 0) {
                this.empty('Парсер не вернул результатов.');
                return;
            }
            
            const torrentsWithHashes = rawTorrents
                .map(raw => {
                    const match = raw?.MagnetUri?.match(/urn:btih:([a-fA-F0-9]{40})/i);
                    return match?.[1] ? { raw, hash: match[1] } : null;
                })
                .filter(Boolean);
            if (torrentsWithHashes.length === 0) {
                this.empty('Не найдено ни одного валидного торрента для проверки.');
                return;
            }
            
            this.empty(`Проверка кэша для ${torrentsWithHashes.length} торрентов...`);
            const cachedDataObject = await API.checkCached(torrentsWithHashes.map(t => t.hash), this.abortController.signal);
            const cachedHashes = new Set(Object.keys(cachedDataObject).map(h => h.toLowerCase()));
            
            this.state.all_torrents = torrentsWithHashes.map(({ raw, hash }) => {
                const videoStream = raw.ffprobe?.find(s => s.codec_type === 'video');
                const audioStreams = raw.ffprobe?.filter(s => s.codec_type === 'audio') || [];

                return {
                    raw_title: raw.Title, 
                    size: raw.Size, 
                    magnet: raw.MagnetUri, 
                    hash: hash,
                    last_known_seeders: raw.Seeders, 
                    last_known_peers: raw.Peers || raw.Leechers,
                    trackers: (raw.Tracker || '').split(/, ?/).map(t => t.trim()).filter(Boolean),
                    cached: cachedHashes.has(hash.toLowerCase()), 
                    publish_date: raw.PublishDate,
                    age: formatAge(raw.PublishDate),
                    // -- Enriched data --
                    quality: ql(raw.Title, raw),
                    video_type: raw.info?.videotype?.toLowerCase(),
                    voices: raw.info?.voices,
                    video_codec: videoStream?.codec_name,
                    video_resolution: videoStream ? `${videoStream.width}x${videoStream.height}` : null,
                    audio_langs: [...new Set(audioStreams.map(s => s.tags?.language).filter(Boolean))],
                    audio_codecs: [...new Set(audioStreams.map(s => s.codec_name).filter(Boolean))],
                    has_hdr: /hdr/i.test(raw.Title) || raw.info?.videotype?.toLowerCase() === 'hdr',
                    has_dv: /dv|dolby vision/i.test(raw.Title) || raw.info?.videotype?.toLowerCase() === 'dovi',
                    raw_data: raw 
                }
            });
            
            Cache.set(cacheKey, this.state.all_torrents);
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
            
            let techBarHtml = '';
            // UI Redesign: Create a tech bar similar to the screenshot
            if (t.video_resolution) { 
                let techItems = [];
                techItems.push(`<div class="torbox-item__tech-item torbox-item__tech-item--res">${t.video_resolution}</div>`);
                if(t.video_codec) techItems.push(`<div class="torbox-item__tech-item torbox-item__tech-item--codec">${t.video_codec.toUpperCase()}</div>`);
                if(t.has_hdr) techItems.push(`<div class="torbox-item__tech-item torbox-item__tech-item--hdr">HDR</div>`);
                if(t.has_dv) techItems.push(`<div class="torbox-item__tech-item torbox-item__tech-item--dv">Dolby Vision</div>`);
                
                const audioItems = t.raw_data.ffprobe?.filter(s => s.codec_type === 'audio').map(s => {
                    const lang = s.tags?.language?.toUpperCase() || '???';
                    const codec = s.codec_name?.toUpperCase() || '';
                    const layout = s.channel_layout || '';
                    return `<div class="torbox-item__tech-item torbox-item__tech-item--audio">${lang} ${codec} ${layout}</div>`;
                }) || [];

                techItems = techItems.concat(audioItems);
                techBarHtml = `<div class="torbox-item__tech-bar">${techItems.join('')}</div>`;
            }

            const item = $(`<div class="torbox-item selector">
                <div class="torbox-item__title">${t.cached?'⚡':'☁️'} ${playedIcon}${title}</div>
                <div class="torbox-item__main-info">
                    [${t.quality}] ${formatBytes(t.size)} | 🟢 <span style="color:var(--color-good);">${t.last_known_seeders||0}</span> / 🔴 <span style="color:var(--color-bad);">${t.last_known_peers||0}</span>
                </div>
                <div class="torbox-item__meta">
                    Трекеры: ${escapeHtml(t.trackers?.join(', ')||'н/д')} | Добавлено: ${escapeHtml(t.age||'н/д')}
                </div>
                ${techBarHtml}
            </div>`);
            
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
        btn.on('hover:enter', () => {
            Lampa.Activity.push({ component: 'torbox_component', title: 'TorBox - ' + (e.data.movie.title || e.data.movie.name), movie: e.data.movie });
        });
        root.find('.view--torrent').after(btn);
      });
    }
    
    function setupGlobalActivityListener() {
      let lastActivity = null;
      let wasInExternalPlayer = false;
      
      const checkActivityChange = function() {
          const currentActivity = Lampa.Activity.active();
          if (!currentActivity) return;
          
          if (lastActivity && lastActivity.component === 'torbox_component' && 
              currentActivity.component !== 'torbox_component') {
              wasInExternalPlayer = true;
              LOG('Detected possible external player launch from TorBox');
          }
          
          if (wasInExternalPlayer && currentActivity.component === 'torbox_component') {
              LOG('Detected return to TorBox from external player');
              wasInExternalPlayer = false;
              
              setTimeout(() => {
                  try {
                      const torboxActivity = Lampa.Activity.active();
                      if (torboxActivity && torboxActivity.component === 'torbox_component') {
                          Lampa.Controller.toggle('content');
                          LOG('Navigation restored after external player');
                      }
                  } catch (error) {
                      LOG('Error restoring navigation:', error);
                  }
              }, 500);
          }
          
          lastActivity = currentActivity;
      };
      
      setInterval(checkActivityChange, 1000);
    }
    
    Lampa.Component.add('torbox_component', TorBoxComponent);
    addSettings();
    boot();
    setupGlobalActivityListener();
    LOG('TorBox v29.0.0 (Rich UI Blocks & Bugfix) ready');
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
