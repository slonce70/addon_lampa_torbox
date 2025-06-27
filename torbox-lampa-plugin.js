/*
 * TorBox Enhanced – Universal Lampa Plugin v25.2.4 (Stable Architecture)
 * =================================================================================
 * • ИСПРАВЛЕНИЕ ЗАПУСКА: Полностью устранена ошибка "TypeError: Class extends value is not a constructor".
 * Компонент переписан с использованием стабильного синтаксиса функций-конструкторов,
 * совместимого с Lampa, вместо ES6-классов.
 * • НАДЕЖНАЯ АРХИТЕКТУРА: Сохранена вся исправленная логика жизненного цикла
 * (синхронный create, асинхронный start) и явное управление навигацией
 * через Lampa.Controller.collectionSet(), что обеспечивает стабильную работу.
 */

(function () {
  'use strict';

  /* ───── Guard double-load ───── */
  const PLUGIN_ID = 'torbox_enhanced_v25_2_0_stable';
  if (window[PLUGIN_ID]) return;
  window[PLUGIN_ID] = true;

  /* ───── Globals & Constants (Lampa-independent) ───── */
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

  if (!$('#torbox-component-styles').length) {
      $('head').append(`<style id="torbox-component-styles">
        .torbox-main {
          height: 100%;
          display: flex;
          flex-direction: column;
          background: transparent;
        }
        .torbox-head {
          display: flex;
          padding: 0 1em;
          margin-bottom: .5em;
          flex-shrink: 0;
          height: 60px;
          box-sizing: border-box;
        }
        .card-content__results {
          flex: 1;
          overflow: hidden;
          position: relative;
          height: calc(100% - 80px);
          background: transparent;
        }
        .torbox-list-container {
          height: 100%;
          overflow-y: auto;
          padding: 1em;
          background: transparent !important;
        }
        .scroll {
          height: 100% !important;
          overflow-y: auto !important;
          background: transparent !important;
        }
        .scroll .scroll__body {
           background: transparent !important;
         }
         .empty {
           background: transparent !important;
           color: rgba(255,255,255,0.7) !important;
         }
         .activity {
           background: transparent !important;
         }
         .activity__body {
           background: transparent !important;
         }
        .torbox-filter-btn {
          margin-right: 1em;
          padding: .5em 1em;
          background: var(--color-background-light);
          border-radius: .5em;
          cursor: pointer;
        }
        .torbox-filter-btn.focus,
        .torbox-filter-btn:hover {
          background: var(--color-primary);
          color: var(--color-background);
        }
        .torbox-item {
          padding: 1.2em;
          margin: .5em 0;
          border-radius: .8em;
          background: var(--color-background-light);
          cursor: pointer;
          transition: all .3s ease;
          border: 2px solid transparent;
        }
        .torbox-item:hover,
        .torbox-item.focus {
          background: var(--color-primary);
          color: var(--color-background);
          transform: translateX(.8em);
          border-color: rgba(255,255,255,.3);
          box-shadow: 0 4px 20px rgba(0,0,0,.2);
        }
        .torbox-item__title {
          font-weight: 600;
          margin-bottom: .5em;
          font-size: 1.1em;
          line-height: 1.3;
        }
        .torbox-item__subtitle {
          font-size: .95em;
          opacity: .8;
          line-height: 1.4;
        }
        .torbox-status {
          padding: 1.5em 2em;
          text-align: center;
          min-height: 200px;
          background: transparent;
        }
        .torbox-status__title {
          font-size: 1.4em;
          margin-bottom: 1em;
          font-weight: 600;
        }
        .torbox-status__info {
          font-size: 1.1em;
          margin-bottom: .8em;
          color: var(--color-text);
        }
        .torbox-status__progress-container {
          margin: 1.5em 0;
          background: rgba(255,255,255,.1);
          border-radius: 8px;
          overflow: hidden;
          height: 12px;
          position: relative;
        }
        .torbox-status__progress-bar {
          height: 100%;
          width: 0%;
          background: linear-gradient(90deg,var(--color-primary),var(--color-primary-light,#4CAF50));
          transition: width .5s ease-out;
          border-radius: 8px;
          position: relative;
        }
        .torbox-status__progress-bar::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(45deg,transparent 30%,rgba(255,255,255,.2) 50%,transparent 70%);
          animation: shimmer 2s infinite;
        }
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        .modal .torbox-status__progress-container {
          background: rgba(255,255,255,.2) !important;
        }
        .modal .torbox-status__progress-bar {
          background: linear-gradient(90deg,#4CAF50,#66BB6A) !important;
        }
        .empty.selector {
          background: transparent !important;
          color: var(--color-text) !important;
          padding: 2em;
          text-align: center;
          font-size: 1.1em;
        }
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
          if (options.is_torbox_api) {
              options.headers['X-Api-Key'] = CFG.apiKey;
          } else {
              delete options.headers['X-Api-Key'];
          }
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
    
    /**
     * Компонент, определенный через функцию-конструктор, 
     * чтобы обеспечить максимальную совместимость с Lampa.
     */
    function TorBoxComponent(object) {
        // Привязываем контекст this ко всем методам
        for (const key in this) {
            if (typeof this[key] === 'function') {
                this[key] = this[key].bind(this);
            }
        }
        
        this.movie = object.movie;
        this.activity = object.activity;
        this.abortController = new AbortController();
    }

    TorBoxComponent.prototype.create = function() {
        LOG("Component create()");
        this.state = {
            all_torrents: [],
            sort: Store.get('torbox_sort_method', 'seeders'),
            filters: JSON.parse(Store.get('torbox_filters', '{"quality":"all","tracker":"all"}')),
            last_focused: null,
        };
        
        // Створюємо scroll з правильними параметрами
        this.scroll = new Lampa.Scroll({ 
            mask: true, 
            over: true,
            step: 250
        });
        
        // Додаємо CSS класи для правильного відображення
        this.scroll.body().addClass('torbox-list-container');
        this.scroll.render().css({
            'height': '100%',
            'overflow-y': 'auto'
        });
        
        const mainHtml = $(`
            <div class="torbox-main">
                <div class="torbox-head"></div>
                <div class="card-content__results"></div>
            </div>
        `);
        
        // Додаємо scroll до контейнера результатів
        const resultsContainer = mainHtml.find('.card-content__results');
        resultsContainer.append(this.scroll.render());
        
        // Очищуємо та додаємо до activity
        this.activity.render().empty().append(mainHtml);
        
        // Забезпечуємо правильну висоту для scroll
        setTimeout(() => {
            this.scroll.render().css('height', '100%');
        }, 100);
    };
      
    TorBoxComponent.prototype.start = function() {
        LOG("Component start()");
        Lampa.Controller.add('content', {
            toggle: () => {
                Lampa.Controller.collectionSet(this.activity.render());
                Lampa.Controller.collectionFocus(this.state.last_focused, this.activity.render());
            },
            back: () => {
                if ($('body').find('.select').length) Lampa.Select.close();
                else Lampa.Activity.backward();
            }
        });
        Lampa.Controller.toggle('content');
        this.renderHead();
        this.loadData();
    };
      
    TorBoxComponent.prototype.loadData = async function(force_refresh = false) {
        this.activity.loader(true);
        this.renderStatus('Загрузка торрентов...');
        const cacheKey = `torbox_hybrid_${this.movie.id || this.movie.imdb_id}`;
        if (!force_refresh) {
            const cached = Cache.get(cacheKey);
            if (cached) {
                LOG('Using cached results for hybrid search');
                this.state.all_torrents = cached;
                this.renderContent();
                this.activity.loader(false);
                return;
            }
        }
        try {
            this.renderStatus('Получение списка с публичных парсеров...');
            const rawTorrents = await API.searchPublicTrackers(this.movie, this.abortController.signal);
            if (!Array.isArray(rawTorrents) || rawTorrents.length === 0) {
                this.renderStatus('Парсер не вернул результатов.');
                return;
            }
            const torrentsWithHashes = rawTorrents
                .map(raw => {
                    const match = raw?.MagnetUri?.match(/urn:btih:([a-fA-F0-9]{40})/i);
                    return match?.[1] ? { raw, hash: match[1] } : null;
                })
                .filter(Boolean);
            if (torrentsWithHashes.length === 0) {
                this.renderStatus('Не найдено ни одного валидного торрента для проверки.');
                return;
            }
            this.renderStatus(`Проверка кэша для ${torrentsWithHashes.length} торрентов...`);
            const cachedDataObject = await API.checkCached(torrentsWithHashes.map(t => t.hash), this.abortController.signal);
            const cachedHashes = new Set(Object.keys(cachedDataObject).map(h => h.toLowerCase()));
            this.state.all_torrents = torrentsWithHashes.map(({ raw, hash }) => ({
                raw_title: raw.Title, size: raw.Size, magnet: raw.MagnetUri, hash: hash,
                last_known_seeders: raw.Seeders, last_known_peers: raw.Peers || raw.Leechers,
                tracker: raw.Tracker, cached: cachedHashes.has(hash.toLowerCase()), publish_date: raw.PublishDate
            }));
            Cache.set(cacheKey, this.state.all_torrents);
            this.renderContent();
        } catch (error) {
            LOG(`Data loading failed:`, error);
            ErrorHandler.show(error.type || 'unknown', error);
            this.renderStatus(error.message || 'Ошибка при загрузке данных');
        } finally {
            this.activity.loader(false);
        }
    };

    TorBoxComponent.prototype.renderContent = function() {
        const { all_torrents, filters, sort } = this.state;
        this.scroll.clear();
        let filtered = all_torrents.slice();
        if (filters.quality !== 'all') filtered = filtered.filter(t => ql(t.raw_title) === filters.quality);
        if (filters.tracker !== 'all') filtered = filtered.filter(t => t.tracker === filters.tracker);
        const sort_types = {
            'seeders': { field: 'last_known_seeders', reverse: true },
            'size_desc': { field: 'size', reverse: true },
            'size_asc': { field: 'size', reverse: false },
            'age': { field: 'publish_date', reverse: true },
        };
        const sort_method = sort_types[sort];
        if (sort_method) {
            filtered.sort((a, b) => {
                const field = sort_method.field;
                let valA = a[field] || 0;
                let valB = b[field] || 0;
                if (field === 'publish_date') {
                    valA = valA ? new Date(valA).getTime() : 0;
                    valB = valB ? new Date(valB).getTime() : 0;
                }
                const result = valA < valB ? -1 : (valA > valB ? 1 : 0);
                return sort_method.reverse ? -result : result;
            });
        }
        if (filtered.length === 0) {
            this.renderStatus('Ничего не найдено по заданным фильтрам');
            return;
        }
        filtered.forEach(torrent => {
            this.renderItem(torrent);
        });
        // Обновляем навігацію після рендерингу всіх елементів
        setTimeout(() => {
            this.updateNavController();
        }, 100);
    };

    TorBoxComponent.prototype.renderItem = function(t) {
        const lastPlayedKey = `torbox_last_torrent_hash_${this.movie.id}`;
        const lastTorrentHash = Store.get(lastPlayedKey, null);
        const isLastPlayed = lastTorrentHash && t.hash && (t.hash.toLowerCase() === lastTorrentHash.toLowerCase());
        const playedIcon = isLastPlayed ? '🎬 ' : '';
        const cacheIcon = t.cached ? '⚡' : '☁️';
        const ageText = formatAge(t.publish_date);
        const itemHtml = $(`
            <div class="torbox-item selector">
                <div class="torbox-item__title">${cacheIcon} ${playedIcon}${escapeHtml(t.raw_title)}</div>
                <div class="torbox-item__subtitle">
                    [${ql(t.raw_title)}] ${formatBytes(t.size)} | 🟢<span style="color:var(--color-good);">${t.last_known_seeders||0}</span> / 🔴<span style="color:var(--color-bad);">${t.last_known_peers||0}</span>
                    <br><span style="opacity:0.7;">Трекер: ${escapeHtml(t.tracker||'н/д')} | Добавлено: ${escapeHtml(ageText)}</span>
                </div>
            </div>`);
        itemHtml.on('hover:focus', () => {
            this.state.last_focused = itemHtml[0];
            this.scroll.update(itemHtml, true);
        });
        itemHtml.on('hover:enter', () => {
            handleTorrent(t, this.movie, this, this.abortController.signal);
        });
        this.scroll.append(itemHtml);
    };
    
    TorBoxComponent.prototype.renderHead = function() {
        const head = this.activity.render().find('.torbox-head').empty();
        const sortBtn = $(`<div class="torbox-filter-btn selector"><span>Сортировка</span></div>`);
        
        sortBtn.on('hover:focus', () => {
            this.state.last_focused = sortBtn[0];
        });
        
        sortBtn.on('hover:enter', () => {
             Lampa.Select.show({
                title: 'Сортировка',
                items: [
                    { title: 'По сидам (убыв.)', value: 'seeders' },
                    { title: 'По размеру (убыв.)', value: 'size_desc' },
                    { title: 'По размеру (возр.)', value: 'size_asc' },
                    { title: 'По дате', value: 'age' }
                ],
                onSelect: (selected) => {
                    this.state.sort = selected.value;
                    Store.set('torbox_sort_method', this.state.sort);
                    this.renderContent();
                    Lampa.Controller.toggle('content');
                },
                onBack: () => Lampa.Controller.toggle('content')
            });
        });
        const filterBtn = $(`<div class="torbox-filter-btn selector"><span>Фильтр</span></div>`);
        
        filterBtn.on('hover:focus', () => {
            this.state.last_focused = filterBtn[0];
        });
        
        filterBtn.on('hover:enter', () => {
            const qualities = ['all', ...new Set(this.state.all_torrents.map(t => ql(t.raw_title)))];
            const trackers = ['all', ...new Set(this.state.all_torrents.map(t => t.tracker).filter(Boolean))];
            Lampa.Select.show({
                title: 'Фильтр',
                items: [
                    { title: `Качество: ${this.state.filters.quality}`, type: 'quality' },
                    { title: `Трекер: ${this.state.filters.tracker}`, type: 'tracker' },
                    { title: 'Сбросить фильтры', type: 'reset' },
                    { title: 'Обновить (очистить кэш)', type: 'refresh' }
                ],
                onSelect: (item) => {
                    if (item.type === 'quality') {
                        Lampa.Select.show({ title: 'Качество', items: qualities.map(q => ({title: q, value: q})), onSelect: (q) => { this.state.filters.quality = q.value; this.renderContent(); Lampa.Controller.toggle('content'); }, onBack: () => Lampa.Controller.toggle('content') });
                    }
                    if (item.type === 'tracker') {
                         Lampa.Select.show({ title: 'Трекер', items: trackers.map(t => ({title: t, value: t})), onSelect: (t) => { this.state.filters.tracker = t.value; this.renderContent(); Lampa.Controller.toggle('content'); }, onBack: () => Lampa.Controller.toggle('content') });
                    }
                    if (item.type === 'reset') {
                        this.state.filters = { quality: 'all', tracker: 'all' };
                        this.renderContent();
                        Lampa.Controller.toggle('content');
                    }
                    if (item.type === 'refresh') {
                        const cacheKey = `torbox_hybrid_${this.movie.id || this.movie.imdb_id}`;
                        delete Cache.store[cacheKey];
                        this.loadData(true);
                        Lampa.Controller.toggle('content');
                    }
                },
                onBack: () => Lampa.Controller.toggle('content')
            });
        });
        head.append(sortBtn).append(filterBtn);
        this.updateNavController();
    };
    
    TorBoxComponent.prototype.renderStatus = function(message) {
        this.scroll.clear();
        const statusElement = $(`<div class="torbox-status selector">${escapeHtml(message)}</div>`);
        this.scroll.append(statusElement);
        this.updateNavController();
    };
    
    TorBoxComponent.prototype.updateNavController = function() {
        Lampa.Controller.collectionSet(this.activity.render());
        Lampa.Controller.collectionFocus(this.state.last_focused, this.activity.render());
    };

    TorBoxComponent.prototype.destroy = function() {
        LOG("Component destroy()");
        if (this.abortController) {
            this.abortController.abort();
        }
        
        this.activity.loader(false);
        
        if (this.scroll) {
            this.scroll.destroy();
        }
        
        // Очищаємо контролер та видаляємо обробники подій
        Lampa.Controller.clear();
        this.activity.render().off();
        
        this.last = null;
        this.state = null;
        
        this.activity.render().empty();
        for (let key in this) {
            delete this[key];
        }
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
            let isTrackingActive = true; let pollTimeout;
            const onCancel = () => { if (isTrackingActive) { isTrackingActive = false; clearTimeout(pollTimeout); reject({type: 'user', message: 'Отменено пользователем'}); } };
            showStatusModal('Отслеживание статуса...', onCancel);
            if (signal) signal.addEventListener('abort', () => { isTrackingActive = false; clearTimeout(pollTimeout); reject(new DOMException('Aborted', 'AbortError')); });
            const poll = async () => {
                if (!isTrackingActive) { clearTimeout(pollTimeout); return; }
                try {
                    const torrentResult = await API.myList(torrentId, signal);
                    const torrentData = torrentResult?.data?.[0];
                    if (!isTrackingActive) return;
                    if (!torrentData) { isTrackingActive = false; return reject({type: 'api', message: "Торрент исчез из списка"}); }
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
                } catch (error) { isTrackingActive = false; reject(error); }
            };
            poll();
        });
    }

    function showFileSelection(torrentData, movie, component, signal) {
        if (!torrentData?.files?.length) throw {type: 'validation', message: 'Видеофайлы не найдены в торренте.'};
        const files = torrentData.files.filter(f => /\.(mkv|mp4|avi)$/i.test(f.name));
        if (!files.length) throw {type: 'validation', message: 'Воспроизводимые видеофайлы не найдены.'};
        files.sort((a,b) => b.size - a.size);
        if (files.length === 1) return play(torrentData.id, files[0], movie, signal);
        const lastPlayedFileId = Store.get(`torbox_last_played_${movie.imdb_id}`, null);
        const fileItems = files.map(f => {
            let title = escapeHtml(f.name);
            if (lastPlayedFileId && String(f.id) === String(lastPlayedFileId)) title = `▶️ ${title} (прошлый просмотр)`;
            return { title: title, subtitle: formatBytes(f.size), file: f, torrentId: torrentData.id };
        });
        Lampa.Select.show({ 
            title: 'Выбор файла для воспроизведения', 
            items: fileItems, 
            onSelect: item => play(item.torrentId, item.file, movie, signal), 
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

    async function handleTorrent(torrent, movie, component, signal) {
      try {
          if (!torrent?.magnet) throw {type: 'validation', message: 'Не найдена magnet-ссылка.'};
          showStatusModal('Добавление торрента...');
          const result = await API.addMagnet(torrent.magnet, signal);
          const torrentId = result.data.torrent_id || result.data.id;
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
    
    Lampa.Component.add('torbox_component', TorBoxComponent);
    addSettings();
    boot();
    LOG('TorBox v25.2.0 (Stable Architecture) ready');
  }

  (function bootLoop () {
    if (window.Lampa && 
        window.Lampa.Activity && 
        window.Lampa.Component && 
        window.Lampa.Controller && 
        window.Lampa.Scroll && 
        window.Lampa.Select && 
        window.Lampa.Modal && 
        window.Lampa.Player && 
        window.Lampa.Noty && 
        window.Lampa.Listener && 
        typeof window.Lampa.Activity === 'object') {
      try {
        initPlugin();
      }
      catch (e) { console.error('[TorBox] Boot Error:', e); }
    } else {
        setTimeout(bootLoop, 300);
    }
  })();

})();
