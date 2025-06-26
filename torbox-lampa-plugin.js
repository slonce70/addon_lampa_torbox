/*
 * TorBox Enhanced – Universal Lampa Plugin v21.0.0 (Navigation & Lifecycle Fix)
 * =================================================================================
 * • ИСПРАВЛЕНА НАВИГАЦИЯ: Полностью переписана логика жизненного цикла компонента по примеру предоставленного вами скрипта. Устранена проблема с потерей фокуса и невозможностью навигации после загрузки списка.
 * • СТАБИЛЬНОСТЬ КОНТРОЛЛЕРА: Контроллер навигации теперь инициализируется корректно при каждом запуске/возобновлении активности, что обеспечивает надежную работу.
 * • ОПТИМИЗАЦИЯ КОДА: Улучшена общая структура компонента, инициализация и уничтожение теперь соответствуют лучшим практикам для плагинов Lampa.
 */

(function () {
  'use strict';

  /* ───── Guard double-load ───── */
  const PLUGIN_ID = 'torbox_enhanced_v21_0_0_nav_fix';
  if (window[PLUGIN_ID]) return;
  window[PLUGIN_ID] = true;

  /* ───── Globals & Constants ───── */
  const ICON =
    `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 7L12 2L21 7V17L12 22L3 17V7Z" stroke="currentColor" stroke-width="2"/><path d="M12 22V12" stroke="currentColor" stroke-width="2"/><path d="M21 7L12 12L3 7" stroke="currentColor" stroke-width="2"/></svg>`;

  const PUBLIC_PARSERS = [
      {
          name: 'Viewbox',
          url: 'jacred.viewbox.dev',
          key: 'viewbox',
      },
      {
          name: 'Jacred',
          url: 'jacred.xyz',
          key: '', // jacred.xyz often doesn't require a key
      }
  ];

  /* ───── Helpers ───── */
  const Store = {
    get: (k, d) => {
      try { return localStorage.getItem(k) ?? d; } catch { return d; }
    },
    set: (k, v) => {
      try { localStorage.setItem(k, String(v)); } catch {}
    }
  };

  const Cache = {
      store: {},
      get: function(key) {
          const entry = this.store[key];
          if (!entry) return null;

          const FIVE_MINUTES = 5 * 60 * 1000;
          if (Date.now() - entry.timestamp > FIVE_MINUTES) {
              delete this.store[key]; // Expired
              LOG(`Локальный кэш для ключа '${key}' устарел и был удален.`);
              return null;
          }
          LOG(`Cache HIT для ключа: ${key}`);
          return entry.data;
      },
      set: function(key, data) {
          LOG(`Cache SET для ключа: ${key}`);
          this.store[key] = {
              timestamp: Date.now(),
              data: data
          };
      }
  };

  const DEFAULTS = {
    proxyUrl: 'https://my-torbox-proxy.slonce70.workers.dev/',
    apiKey: '4b7b263b-b5a8-483f-a9a5-53b4127c4bb2'
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

  const ql = (title) => {
    if (!title) return 'SD';
    if (title.match(/2160p|4K|UHD/i)) return '4K';
    if (title.match(/1080p|FHD/i)) return 'FHD';
    if (title.match(/720p|HD/i)) return 'HD';
    return 'SD';
  };

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
    SEARCH_API: 'https://search-api.torbox.app', // Fallback API
    MAIN_API: 'https://api.torbox.app/v1/api',
   
    request: async function(url, options = {}) {
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
            const response = await fetch(proxyUrl, options);
            const responseText = await response.text();
            return processResponse(responseText, response.status);
        } catch (err) {
            if (err.type) throw err;
            throw { type: 'network', message: `Ошибка при обращении к прокси: ${err.message}` };
        }
    },

    searchPublicTrackers: async function(movie) {
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

                if (movie.year) {
                    params.append('year', movie.year);
                }
               
                const url = `https://${parser.url}/api/v2.0/indexers/all/results?${params.toString()}`;
                LOG(`Trying parser: ${parser.name} with URL: ${url}`);
                const result = await this.request(url, { method: 'GET', is_torbox_api: false });

                if (result && Array.isArray(result.Results)) {
                    LOG(`Success from ${parser.name}. Found ${result.Results.length} torrents.`);
                    return result.Results;
                }
            } catch (error) {
                LOG(`Parser ${parser.name} failed:`, error.message);
                lastError = error;
            }
        }
        throw lastError || { type: 'api', message: 'Все публичные парсеры недоступны.' };
    },

    searchTorBoxDirectly: async function(imdbId) {
        const searchParams = new URLSearchParams({ check_cache: 'true', check_owned: 'false' });
        const url = `${this.SEARCH_API}/torrents/imdb:${imdbId}?${searchParams.toString()}`;
        const json = await this.request(url, { method: 'GET', is_torbox_api: true });
        if (!json || !json.data || !Array.isArray(json.data.torrents)) {
             throw { type: 'validation', message: 'API поиска TorBox вернуло неверную структуру.' };
        }
        return json.data.torrents;
    },

    checkCached: async function(hashes) {
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
                const json = await this.request(url, { method: 'GET', is_torbox_api: true });
                if (json && json.success && typeof json.data === 'object' && json.data !== null) {
                    Object.assign(allCachedData, json.data);
                }
            } catch (error) {
                LOG(`Chunk failed on cache check:`, error.message);
            }
        }
        return allCachedData;
    },

    addMagnet: async function(magnet) {
        const url = `${this.MAIN_API}/torrents/createtorrent`;
        const formData = new FormData();
        formData.append('magnet', magnet);
        const json = await this.request(url, { method: 'POST', body: formData, is_torbox_api: true });
        if (!json || !json.data || (!json.data.id && !json.data.torrent_id)) {
            throw { type: 'validation', message: 'API добавления торрента вернуло неверную структуру.' };
        }
        return json;
    },

    stopTorrent: async function(torrentId) {
        const url = `${this.MAIN_API}/torrents/controltorrent`;
        const body = { torrent_id: torrentId, operation: 'pause' };
        return this.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), is_torbox_api: true });
    },
   
    myList: async function(torrentId) {
        const url = `${this.MAIN_API}/torrents/mylist?${new URLSearchParams({id: torrentId, bypass_cache: true}).toString()}`;
        const json = await this.request(url, { method: 'GET', is_torbox_api: true });
        if (!json || !json.data) throw { type: 'validation', message: 'API списка торрентов вернуло неверную структуру.' };
        if (json.data && !Array.isArray(json.data)) json.data = [json.data];
        return json;
    },

    requestDl: async function(torrentId, fid) {
        const key = CFG.apiKey;
        const params = new URLSearchParams({ torrent_id: torrentId, file_id: fid, token: key });
        const url = `${this.MAIN_API}/torrents/requestdl?${params.toString()}`;
        const json = await this.request(url, { method: 'GET', is_torbox_api: true });
        const finalUrl = json?.data || json?.url;
        if (!finalUrl || !finalUrl.startsWith('http')) throw { type: 'validation', message: 'API ссылки на файл вернуло неверную структуру.' };
        return json;
    }
  };

  /* ───── TorBox Component (Navigation & Lifecycle Rework) ───── */
  function TorBoxComponent(object) {
    let initialized = false;
    
    this.state = {
        scroll: null, files: null, filter: null, last: null,
        all_torrents: [],
        sort: Store.get('torbox_sort_method', 'seeders'),
        filters: JSON.parse(Store.get('torbox_filters', '{"quality":"all","tracker":"all"}')),
    };
   
    this.activity = object.activity;
    this.movie = object.movie;
   
    const sort_types = [
        { key: 'seeders', title: 'По сидам (убыв.)', field: 'last_known_seeders', reverse: true },
        { key: 'size_desc', title: 'По размеру (убыв.)', field: 'size', reverse: true },
        { key: 'size_asc', title: 'По размеру (возр.)', field: 'size', reverse: false },
        { key: 'age', title: 'По дате добавления', field: 'publish_date', reverse: true },
    ];
   
    this.create = function() {
        this.activity.loader(true);
        this.state.files = new Lampa.Explorer(object);
        this.state.scroll = new Lampa.Scroll({ mask: true, over: true });
        this.state.filter = new Lampa.Filter(object);

        this.state.scroll.body().addClass('torrent-list');
        this.state.files.appendFiles(this.state.scroll.render());
        this.state.files.appendHead(this.state.filter.render());
        
        return this.state.files.render();
    };

    this.start = function () {
        if (Lampa.Activity.active().activity !== this.activity) return;

        Lampa.Background.immediately(Lampa.Utils.cardImgBackgroundBlur(this.movie));
        
        if (!initialized) {
            initialized = true;
            this.initializeFilterHandlers();
            this.loadAndDisplayTorrents();
        }

        Lampa.Controller.add('content', {
            toggle: () => {
                Lampa.Controller.collectionSet(this.state.scroll.render(), this.state.files.render());
                Lampa.Controller.collectionFocus(this.state.last || false, this.state.scroll.render());
            },
            up: () => {
                if (Navigator.canmove('up')) Navigator.move('up');
                else Lampa.Controller.toggle('head');
            },
            down: () => {
                Navigator.move('down');
            },
            right: () => {
                if (Navigator.canmove('right')) Navigator.move('right');
                else this.state.filter.show(Lampa.Lang.translate('title_filter'), 'filter');
            },
            left: () => {
                if (Navigator.canmove('left')) Navigator.move('left');
                else Lampa.Controller.toggle('menu');
            },
            back: () => {
                if ($('body').find('.select').length) Lampa.Select.close();
                else if ($('body').find('.filter').length) { 
                    Lampa.Filter.hide();
                    Lampa.Controller.toggle('content'); 
                } 
                else Lampa.Activity.backward();
            }
        });
        
        Lampa.Controller.toggle('content');
    };

    this.destroy = function() {
        LOG('Destroying TorBox component');
        $(document).off('.torbox');
        if (this.state.scroll) this.state.scroll.destroy();
        if (this.state.files) this.state.files.destroy();
        if (this.state.filter) this.state.filter.destroy();
        for (let key in this.state) { this.state[key] = null; }
    };
   
    this.initializeFilterHandlers = function() {
        this.state.filter.onSelect = (type, a, b) => {
            Lampa.Select.close();
            if (type === 'sort') { this.state.sort = a.key; Store.set('torbox_sort_method', a.key); this.display(); }
            if (type === 'filter') {
                if (a.refresh) {
                    const cacheKey = `torbox_cached_hashes_${this.movie.id || this.movie.imdb_id}`;
                    delete Cache.store[cacheKey];
                    LOG(`Локальный кэш для '${this.movie.title}' очищен вручную.`);
                    this.loadAndDisplayTorrents(true);
                }
                else if (a.reset) {
                    this.state.filters = { quality: 'all', tracker: 'all' };
                    Store.set('torbox_filters', JSON.stringify(this.state.filters)); this.display();
                } else if (a.stype) {
                    this.state.filters[a.stype] = b.value; 
                    Store.set('torbox_filters', JSON.stringify(this.state.filters)); this.display();
                }
            }
            Lampa.Controller.toggle('content');
        };
    };

    this.updateFilterUI = function() {
        const { filter, sort, filters, all_torrents } = this.state;
        const sort_items = sort_types.map(item => ({...item, selected: item.key === sort}));
        filter.set('sort', sort_items);
        filter.render().find('.filter--sort span').text('Сортировка');
        filter.chosen('sort', [ (sort_types.find(s => s.key === sort) || {title:''}).title ]);
       
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

    this.loadAndDisplayTorrents = async function() {
        this.activity.loader(true);
        this.state.scroll.clear();
       
        const movie = this.movie;
        if (!movie || (!movie.title && !movie.imdb_id)) {
            this.empty('Название фильма или IMDb ID не найдены');
            return;
        }

        try {
            this.empty('Получение списка с публичных парсеров...');
            const rawTorrents = await API.searchPublicTrackers(movie);
           
            if (!Array.isArray(rawTorrents) || rawTorrents.length === 0) {
                this.empty('Парсер не вернул результатов.');
                return;
            }

            LOG(`Парсер вернул ${rawTorrents.length} торрентов. Обработка и извлечение хешей...`);
            
            const torrentsWithHashes = [];
            rawTorrents.forEach((raw, index) => {
                if (!raw || typeof raw !== 'object') {
                    LOG(`Торрент #${index + 1} отфильтрован (не является объектом).`);
                    return;
                }
                const magnet = raw.MagnetUri;
                let hash = null;
                
                if (magnet && typeof magnet === 'string') {
                    const match = magnet.match(/urn:btih:([a-fA-F0-9]{40})/i);
                    if (match && match[1]) {
                        hash = match[1];
                    }
                }

                if (!hash) {
                    LOG(`Торрент #${index + 1} отфильтрован (не удалось извлечь InfoHash из MagnetUri):`, raw.Title);
                    return;
                }
                torrentsWithHashes.push({ raw: raw, hash: hash });
            });
            
            const hashesForCheck = torrentsWithHashes.map(t => t.hash);
            LOG(`Найдено ${hashesForCheck.length} валидных торрентов для проверки кэша.`);
            
            if (hashesForCheck.length === 0) {
                this.empty('Не найдено ни одного валидного торрента для проверки.');
                return;
            }
            
            const cacheKey = `torbox_cached_hashes_${movie.id || movie.imdb_id}`;
            let cachedHashes = Cache.get(cacheKey);

            if (cachedHashes) {
                LOG('Используются данные о кэше из локального кэша плагина.');
            } else {
                this.empty(`Проверка кэша для ${hashesForCheck.length} торрентов в TorBox...`);
                const cachedDataObject = await API.checkCached(hashesForCheck);
                const cachedHashesSet = new Set(Object.keys(cachedDataObject).map(hash => hash.toLowerCase()));
                LOG(`Получен статус кэша. ${cachedHashesSet.size} торрентов закэшировано.`);
                Cache.set(cacheKey, cachedHashesSet);
                cachedHashes = cachedHashesSet;
            }

            const finalTorrents = torrentsWithHashes.map(({ raw, hash }) => {
                const isCached = cachedHashes.has(hash.toLowerCase());
               
                return {
                    raw_title: raw.Title,
                    size: raw.Size,
                    magnet: raw.MagnetUri,
                    hash: hash,
                    last_known_seeders: raw.Seeders,
                    last_known_peers: raw.Peers || raw.Leechers,
                    tracker: raw.Tracker,
                    cached: isCached,
                    publish_date: raw.PublishDate
                };
            });

            this.state.all_torrents = finalTorrents;
            this.display();

        } catch (error) {
            LOG(`Parser flow failed: ${error.message}. Switching to fallback.`);
            this.empty('Публичные парсеры недоступны. Используется прямой поиск TorBox...');
            if (!movie.imdb_id) {
                this.empty('Для прямого поиска нужен IMDb ID, который не найден.');
                return;
            }
            try {
                const torrents = await API.searchTorBoxDirectly(movie.imdb_id);
                if (!torrents.length) {
                    this.empty('В TorBox ничего не найдено по этому фильму.');
                    return;
                }
                this.state.all_torrents = torrents.map(t => ({...t, raw_title: t.name, last_known_seeders: t.seeders, last_known_peers: t.leechers, publish_date: t.created_at, magnet: t.magnet, cached: t.cached }));
                this.display();
            } catch (fallbackError) {
                this.empty(fallbackError.message || 'Ошибка при прямом поиске в TorBox.');
                ErrorHandler.show(fallbackError.type || 'unknown', fallbackError);
            }
        }
    };

    this.display = function() {
        this.updateFilterUI();
        this.draw(this.applyFiltersAndSort());
        this.activity.loader(false);
        Lampa.Controller.toggle('content');
    };

    this.draw = function(torrents_list) {
        this.state.last = null;
        this.state.scroll.clear();
        if (!torrents_list?.length) {
            this.empty('Ничего не найдено по заданным фильтрам');
            return;
        }
        const lastPlayedKey = `torbox_last_torrent_hash_${this.movie.id}`;
        const lastTorrentHash = Store.get(lastPlayedKey, null);

        torrents_list.forEach(t => {
            const title = escapeHtml(t.raw_title || t.name);
            const isLastPlayed = lastTorrentHash && t.hash && (t.hash.toLowerCase() === lastTorrentHash.toLowerCase());
            const playedIcon = isLastPlayed ? '🎬 ' : '';
            const cacheIcon = t.cached ? '⚡' : '☁️';
            const ageText = formatAge(t.publish_date);
           
            const item = $(`<div class="torbox-item selector"><div class="torbox-item__title">${cacheIcon} ${playedIcon}${title}</div><div class="torbox-item__subtitle">[${ql(t.raw_title)}] ${formatBytes(t.size)} | 🟢 <span style="color:var(--color-good);">${t.last_known_seeders||0}</span> / 🔴 <span style="color:var(--color-bad);">${t.last_known_peers||0}</span><br><span style="opacity:0.7;">Трекер: ${escapeHtml(t.tracker||'н/д')} | Добавлено: ${escapeHtml(ageText)}</span></div></div>`);
            item.on('hover:focus.torbox', () => { this.state.last = item[0]; this.state.scroll.update(item, true); });
            item.on('hover:enter.torbox', () => handleTorrent(t, this.movie, this));
            this.state.scroll.append(item);
        });
    };
   
    this.empty = function(msg) { 
        this.state.scroll.clear(); 
        this.state.scroll.append($(`<div class="empty"><div class="empty__text">${escapeHtml(msg||'Торренты не найдены')}</div></div>`)); 
        this.activity.loader(false);
    };

    this.render = function() { return this.state.files.render(); };
  }
 
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

  function trackTorrentStatus(torrentId) {
      return new Promise((resolve, reject) => {
          let isTrackingActive = true; let pollTimeout;
          const onCancel = () => { if (isTrackingActive) { isTrackingActive = false; clearTimeout(pollTimeout); reject({type: 'user', message: 'Отменено пользователем'}); } };
          showStatusModal('Отслеживание статуса...', onCancel);
          const poll = async () => {
              if (!isTrackingActive) { clearTimeout(pollTimeout); return; }
              try {
                  const torrentResult = await API.myList(torrentId);
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
                          await API.stopTorrent(torrentData.id).catch(e => LOG('Не удалось остановить раздачу:', e.message));
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
 
  function showFileSelection(torrentData, movie, component) {
      if (!torrentData?.files?.length) {
          throw {type: 'validation', message: 'Видеофайлы не найдены в торренте.'};
      }
      const files = torrentData.files.filter(f => /\.(mkv|mp4|avi)$/i.test(f.name));
      if (!files.length) throw {type: 'validation', message: 'Воспроизводимые видеофайлы не найдены.'};

      if (files.length === 1) return play(torrentData.id, files[0], movie, component);
     
      files.sort((a,b) => b.size - a.size);
      const lastPlayedFileId = Store.get(`torbox_last_played_${movie.imdb_id}`, null);
      const fileItems = files.map(f => {
        let title = escapeHtml(f.name);
        if (lastPlayedFileId && String(f.id) === String(lastPlayedFileId)) {
            title = `▶️ ${title} (прошлый просмотр)`;
        }
        return { title: title, subtitle: formatBytes(f.size), file: f };
      });
      Lampa.Select.show({ title: 'Выбор файла для воспроизведения', items: fileItems, onSelect: item => play(torrentData.id, item.file, movie, component), onBack: () => component.start() });
  }

  async function handleTorrent(torrent, movie, component) {
    try {
        if (!torrent?.magnet) {
             throw {type: 'validation', message: 'Не найдена magnet-ссылка.'};
        }
        showStatusModal('Добавление торрента...');
        const result = await API.addMagnet(torrent.magnet);
        const torrentInfo = result.data;
        const torrentId = torrentInfo.torrent_id || torrentInfo.id;
        if (!torrentId) throw {type: 'api', message: 'Не удалось получить ID торрента.'};
       
        const finalTorrentData = await trackTorrentStatus(torrentId);
        Store.set(`torbox_last_torrent_hash_${movie.id}`, String(finalTorrentData.hash || torrent.hash));
        Lampa.Modal.close();
        showFileSelection(finalTorrentData, movie, component);
    } catch (e) {
        if (e.type !== "user") ErrorHandler.show(e.type || 'unknown', e);
        Lampa.Modal.close();
    }
  }

  async function play(torrentId, file, movie, component) {
    showStatusModal('Получение ссылки на файл...');
    try {
      const dlResponse = await API.requestDl(torrentId, file.id);
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
        LOG('TorBox v21.0.0 (Navigation & Lifecycle Fix) ready');
      }
      catch (e) { console.error('[TorBox] Boot Error:', e); }
    } else {
        setTimeout(bootLoop, 300);
    }
  })();

})();
