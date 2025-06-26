/*
 * TorBox Enhanced – Universal Lampa Plugin v12.0.0 (Major Refactoring)
 * =================================================================================
 * • АРХИТЕКТУРНЫЙ РЕФАКТОРИНГ: Внедрено изолированное состояние компонента для предотвращения конфликтов. Глобальные переменные заменены на объект this.state.
 * • СТАБИЛИЗАЦИЯ НАВИГАЦИИ: Улучшена логика регистрации и очистки контроллера. Предотвращена повторная регистрация, что решает конфликты с основной навигацией Lampa.
 * • НАДЕЖНАЯ ОБРАБОТКА ОШИБОК: Добавлен централизованный обработчик ошибок (ErrorHandler), который разделяет ошибки по типам (сеть, API, авторизация) и выводит понятные уведомления.
 * • ОПТИМИЗАЦИЯ ПРОИЗВОДИТЕЛЬНОСТИ:
 * - Запросы к DOM в модальном окне статуса теперь кэшируются.
 * - Ограничен размер кэша для функции сортировки по дате (ageCache) для предотвращения утечек памяти.
 * • ОЧИСТКА РЕСУРСОВ: Внедрена очистка обработчиков событий jQuery через неймспейсы для предотвращения утечек памяти при уничтожении компонента.
 */

(function () {
  'use strict';

  /* ───── Guard double-load ───── */
  const PLUGIN_ID = 'torbox_enhanced_v12_0_0_refactored';
  if (window[PLUGIN_ID]) return;
  window[PLUGIN_ID] = true;

  /* ───── Helpers ───── */
  const ICON =
    `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 7L12 2L21 7V17L12 22L3 17V7Z" stroke="currentColor" stroke-width="2"/><path d="M12 22V12" stroke="currentColor" stroke-width="2"/><path d="M21 7L12 12L3 7" stroke="currentColor" stroke-width="2"/></svg>`;

  const Store = {
    get: (k, d) => {
      try { return localStorage.getItem(k) ?? d; } catch { return d; }
    },
    set: (k, v) => {
      try { localStorage.setItem(k, String(v)); } catch {}
    }
  };

  const DEFAULTS = {
    proxyUrl: 'https://my-torbox-proxy.slonce70.workers.dev/',
    apiKey: '4b7b263b-b5a8-483f-a9a5-53b4127c4bb2'
  };

  const CFG = {
    get debug()     { return Store.get('torbox_debug', '0') === '1'; },
    set debug(v)    { Store.set('torbox_debug', v ? '1' : '0');     },
    get proxyUrl()  { return Store.get('torbox_proxy_url') || DEFAULTS.proxyUrl; },
    set proxyUrl(v) { Store.set('torbox_proxy_url', v); },
    get apiKey()    { return Store.get('torbox_api_key') || DEFAULTS.apiKey; },
    set apiKey(v)   { Store.set('torbox_api_key', v); }
  };

  const LOG  = (...a) => CFG.debug && console.log('[TorBox]', ...a);
  
  const escapeHtml = (text) => {
      return text ? $('<div>').text(text).html() : '';
  };

  const ErrorHandler = {
      show: (type, error) => {
          let message = 'Произошла неизвестная ошибка';
          switch (type) {
              case 'network':
                  message = `Сетевая ошибка: ${error.message}`;
                  break;
              case 'api':
                  message = `Ошибка API TorBox: ${error.message}`;
                  break;
              case 'auth':
                  message = `Ошибка авторизации: ${error.message}. Проверьте API-ключ.`;
                  break;
              case 'validation':
                  message = `Ошибка данных: ${error.message}`;
                  break;
              default:
                  message = error.message;
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
    if (status === 401 || status === 403) {
        throw { type: 'auth', message: `Ошибка авторизации (${status}).` };
    }
    if (typeof responseText === 'string' && responseText.toUpperCase().includes("NO_AUTH")) {
        throw { type: 'auth', message: 'Проверьте API-ключ и права доступа.' };
    }
    if (status < 200 || status >= 300) {
        throw { type: 'network', message: `Ошибка сети: HTTP ${status}` };
    }
    if (!responseText || (typeof responseText === 'string' && responseText.trim() === '')) {
        throw { type: 'api', message: 'Получен пустой ответ от сервера/прокси.' };
    }
    
    try {
        if (typeof responseText === 'string' && responseText.startsWith('http')) {
            return { success: true, url: responseText };
        }
        const json = (typeof responseText === 'object') ? responseText : JSON.parse(responseText);
        if (json.success === false) {
            const errorMsg = (json.detail && typeof json.detail === 'string') 
                ? json.detail 
                : (Array.isArray(json.detail) && json.detail[0]?.msg) 
                ? json.detail[0].msg 
                : (json.message || 'API вернуло неизвестную ошибку.');
            throw { type: 'api', message: errorMsg };
        }
        return json;
    } catch (e) {
        LOG('Invalid JSON or API error:', responseText, e);
        // Если это уже наша кастомная ошибка, пробрасываем ее дальше
        if (e.type) throw e;
        // Иначе, это ошибка парсинга JSON
        throw { type: 'api', message: 'Получен некорректный ответ от сервера.' };
    }
  }


  const API = {
    SEARCH_API: 'https://search-api.torbox.app',
    MAIN_API: 'https://api.torbox.app/v1/api',
    
    request: function(url, options = {}) {
        if (!CFG.proxyUrl) {
            return Promise.reject({ type: 'validation', message: "URL прокси-сервера не указан в настройках."});
        }
        const proxyUrl = `${CFG.proxyUrl}?url=${encodeURIComponent(url)}`;
        LOG('Calling via universal proxy. Target:', url);

        options.headers = options.headers || {};
        options.headers['X-Api-Key'] = CFG.apiKey;
        delete options.headers['Authorization'];

        return fetch(proxyUrl, options)
            .then(async (r) => {
                const responseText = await r.text();
                return processResponse(responseText, r.status);
            })
            .catch(err => {
                // Пробрасываем типизированную ошибку
                if (err.type) throw err;
                throw { type: 'network', message: `Ошибка при обращении к прокси: ${err.message}` };
            });
    },

    async search(imdbId) {
        if (!imdbId) throw { type: 'validation', message: 'IMDb ID не передан в функцию поиска' };
        let formattedImdbId = imdbId;
        if (!/^tt\d+$/.test(imdbId)) {
            if (/^\d+$/.test(imdbId)) formattedImdbId = `tt${imdbId}`;
            else throw { type: 'validation', message: `Неверный формат IMDb ID: ${imdbId}` };
        }
        const url = `${this.SEARCH_API}/torrents/imdb:${formattedImdbId}?check_cache=true&check_owned=false&search_user_engines=false`;
        
        const json = await this.request(url, { method: 'GET' });
        return json?.data?.torrents || [];
    },

    async addMagnet(magnet) {
        const url = `${this.MAIN_API}/torrents/createtorrent`;
        const formData = new FormData();
        formData.append('magnet', magnet);
        formData.append('seed', '3');

        return this.request(url, { method: 'POST', body: formData });
    },

    async stopTorrent(torrentId) {
        const url = `${this.MAIN_API}/torrents/controltorrent`;
        const body = { torrent_id: torrentId, operation: 'pause' };
        
        return this.request(url, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body) 
        });
    },

    async myList(torrentId) {
        const url = `${this.MAIN_API}/torrents/mylist?${new URLSearchParams({id: torrentId, bypass_cache: true}).toString()}`;
        const json = await this.request(url, { method: 'GET' });

        if (json && json.data && !Array.isArray(json.data)) {
            json.data = [json.data];
        }
        return json;
    },

    async requestDl(torrentId, fid) {
        const key = CFG.apiKey;
        const body = { torrent_id: torrentId, file_id: fid, token: key }; 
        const params = new URLSearchParams(body);
        const url = `${this.MAIN_API}/torrents/requestdl?${params.toString()}`;
        
        return this.request(url, { method: 'GET' });
    }
  };

  /* ───── TorBox Component ───── */
  function TorBoxComponent(object) {
    // ### REFACTORED ###: Изолированное состояние компонента
    this.state = {
        scroll: null,
        files: null,
        filter: null,
        last: null,
        initialized: false,
        controller_registered: false,
        all_torrents: [],
        sort: Store.get('torbox_sort_method', 'seeders'),
        filters: JSON.parse(Store.get('torbox_filters', '{"quality":"all","tracker":"all"}')),
        ageCache: new Map()
    };
    
    this.activity = object.activity;
    this.movie = object.movie;
    
    const sort_types = [
        { key: 'seeders', title: 'По сидам (убыв.)', field: 'last_known_seeders', reverse: true },
        { key: 'size_desc', title: 'По размеру (убыв.)', field: 'size', reverse: true },
        { key: 'size_asc', title: 'По размеру (возр.)', field: 'size', reverse: false },
        { key: 'age', title: 'По дате добавления', field: 'age', reverse: false },
    ];
    
    this.create = function() {
        this.initialize();
        return this.render();
    };

    this.start = function () {
        this.activity.loader(false);
        // ### REFACTORED ###: Предотвращаем повторную регистрацию контроллера
        if (!this.state.controller_registered) {
            Lampa.Controller.add('content', {
                toggle: () => { 
                    Lampa.Controller.collectionSet(this.state.scroll.render(), this.state.files.render());
                    Lampa.Controller.collectionFocus(this.state.last || false, this.state.scroll.render()); 
                },
                up: () => { Navigator.move('up'); },
                down: () => { Navigator.move('down'); },
                left: () => { Lampa.Controller.toggle('menu'); },
                right: () => { 
                    if(Navigator.canmove('right')) Lampa.Controller.toggle('head'); 
                    else this.state.filter.show(Lampa.Lang.translate('title_filter'), 'filter'); 
                },
                back: () => {
                    if (Lampa.Utils.isSelectVisible()) {
                        Lampa.Select.close();
                    } else if (typeof Lampa.Filter !== 'undefined' && Lampa.Filter.visible) {
                        Lampa.Filter.hide();
                        Lampa.Controller.toggle('content');
                    } else {
                        Lampa.Activity.backward();
                    }
                }
            });
            this.state.controller_registered = true;
        }
        Lampa.Controller.toggle('content');
    };

    this.pause = function () { LOG('TorBox component paused'); };
    this.resume = function () { LOG('TorBox component resumed'); };
    this.stop = function () { LOG('TorBox component stopped'); };

    this.destroy = function() {
        LOG('Destroying TorBox component');
        if (this.state.controller_registered) {
            Lampa.Controller.add('content', null);
            this.state.controller_registered = false;
        }
        // ### REFACTORED ###: Очистка обработчиков событий jQuery
        $(document).off('.torbox');
        
        this.state.ageCache.clear();
        this.state.scroll.destroy();
        this.state.files.destroy();
        this.state.filter.destroy();
        
        // Обнуляем все состояние
        for (let key in this.state) {
            this.state[key] = null;
        }
    };

    this.initialize = function() {
        if (this.state.initialized) return;

        this.state.scroll = new Lampa.Scroll({ mask: true, over: true });
        this.state.files = new Lampa.Explorer(object);
        this.state.filter = new Lampa.Filter(object);

        this.initializeFilterHandlers(); 
        
        this.state.filter.onBack = () => {
            Lampa.Controller.toggle('content');
        };
        if (this.state.filter.addButtonBack) this.state.filter.addButtonBack();
        
        this.state.scroll.body().addClass('torrent-list');
        this.state.files.appendFiles(this.state.scroll.render());
        this.state.files.appendHead(this.state.filter.render());
        this.state.scroll.minus(this.state.files.render().find('.explorer__files-head'));
        
        this.loadAndDisplayTorrents();
        this.state.initialized = true;
    };
    
    this.initializeFilterHandlers = function() {
        this.state.filter.onSelect = (type, a, b) => {
            Lampa.Select.close();
            if (type === 'sort') {
                this.state.sort = a.key;
                Store.set('torbox_sort_method', a.key);
            }
            if (type === 'filter') {
                if (a.reset) {
                    this.state.filters = { quality: 'all', tracker: 'all' };
                } else {
                    this.state.filters[a.stype] = b.value; 
                }
                Store.set('torbox_filters', JSON.stringify(this.state.filters));
            }
            this.display();
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
        const filter_items = [{title:'Сбросить',reset:true},{title:'Качество',subtitle:filters.quality==='all'?'Все':filters.quality,items:quality_items,stype:'quality'},{title:'Трекер',subtitle:filters.tracker==='all'?'Все':filters.tracker,items:tracker_items,stype:'tracker'}];
        filter.set('filter', filter_items);
        filter.render().find('.filter--filter span').text('Фильтр');
        const filter_titles = [];
        if(filters.quality !== 'all') filter_titles.push(`Качество: ${filters.quality}`);
        if(filters.tracker !== 'all') filter_titles.push(`Трекер: ${filters.tracker}`);
        filter.chosen('filter', filter_titles);
    };

    this.applyFiltersAndSort = function() {
        const { all_torrents, filters, sort, ageCache } = this.state;
        if (!Array.isArray(all_torrents)) return [];
        
        let filtered = all_torrents.slice();
        if (filters.quality !== 'all') filtered = filtered.filter(t => ql(t.raw_title) === filters.quality);
        if (filters.tracker !== 'all') filtered = filtered.filter(t => t.tracker === filters.tracker);
        
        const sort_method = sort_types.find(s => s.key === sort);
        if (sort_method) {
            const parseAge = (ageString) => {
                if (!ageString) return Infinity;
                if (ageCache.has(ageString)) return ageCache.get(ageString);
                
                // ### REFACTORED ###: Ограничиваем размер кэша
                if (ageCache.size > 500) {
                    const firstKey = ageCache.keys().next().value;
                    ageCache.delete(firstKey);
                }

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

    this.loadAndDisplayTorrents = async function() {
        this.activity.loader(true);
        this.state.scroll.clear();
        try {
            if (!this.movie?.imdb_id) throw { type: 'validation', message: 'IMDb ID не найден' };
            const torrents = await API.search(this.movie.imdb_id);
            this.state.all_torrents = Array.isArray(torrents) ? torrents : [];
            this.display();
        } catch (error) {
            this.empty(error.message || 'Произошла ошибка');
            ErrorHandler.show(error.type, error);
        } finally {
            this.activity.loader(false);
        }
    };

    this.display = function() {
        this.updateFilterUI();
        this.draw(this.applyFiltersAndSort());
    };

    this.draw = function(torrents_list) {
        this.state.last = null;
        this.state.scroll.clear();
        if (!torrents_list?.length) {
            this.empty('Ничего не найдено по заданным фильтрам');
            return;
        }
        torrents_list.forEach(t => {
            const isSeasonPack = /(S\d{1,2}E\d{1,2}|S\d{1,2}|Сезон \d+|Серии \d+-\d+)/i.test(t.raw_title || t.title);
            const sizeString = isSeasonPack ? `~ ${formatBytes(t.size)} / серия` : formatBytes(t.size);
            const title = escapeHtml(t.raw_title || t.title);

            const item = $(`<div class="torbox-item selector"><div class="torbox-item__title">${t.cached?'⚡':'☁️'} ${title}</div><div class="torbox-item__subtitle">[${ql(t.raw_title||t.title)}] ${sizeString} | 🟢 <span style="color:var(--color-good);">${t.last_known_seeders||0}</span> / 🔴 <span style="color:var(--color-bad);">${t.last_known_peers||0}</span><br><span style="opacity:0.7;">Трекер: ${t.tracker||'н/д'} | Добавлено: ${t.age||'н/д'}</span></div></div>`);
            // ### REFACTORED ###: Используем неймспейс для событий
            item.on('hover:focus.torbox', () => { this.state.last = item[0]; this.state.scroll.update(item, true); });
            item.on('hover:enter.torbox', () => handleTorrent(t, this.movie, this));
            this.state.scroll.append(item);
        });
    };

    this.empty = function(msg) { 
        this.state.scroll.clear(); 
        this.state.scroll.append($(`<div class="empty"><div class="empty__text">${msg||'Торренты не найдены'}</div></div>`)); 
        this.activity.loader(false);
    };
    
    this.render = function() {
        return this.state.files.render();
    };
  }
  
  // ### REFACTORED ###: Кэшируем элементы модального окна для производительности
  let modalCache = {};
  function showStatusModal(title, onBack) {
      if ($('.modal').length) Lampa.Modal.close();
      modalCache = {}; // Очищаем кэш при открытии нового модала
      
      const modalHtml = $(`
        <div class="torbox-status">
          <div class="torbox-status__title">${title}</div>
          <div class="torbox-status__info" data-name="status">Ожидание...</div>
          <div class="torbox-status__info" data-name="progress-text"></div>
          <div class="torbox-status__progress-container">
            <div class="torbox-status__progress-bar" style="width: 0%;"></div>
          </div>
          <div class="torbox-status__info" data-name="speed"></div>
          <div class="torbox-status__info" data-name="eta"></div>
          <div class="torbox-status__info" data-name="peers"></div>
        </div>
      `);
      
      Lampa.Modal.open({
          title: 'TorBox',
          html: modalHtml,
          size: 'medium',
          onBack: onBack || (() => { Lampa.Modal.close(); modalCache = {}; })
      });
      LOG('Modal created');
  }
  
  function updateStatusModal(data) {
      if (!modalCache.body) modalCache.body = $('.modal__content .torbox-status');
      if (!modalCache.body.length) return;
      
      // Кэшируем элементы при первом доступе
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
      if (modalCache.progressBar.length) {
          modalCache.progressBar.css('width', progressPercent + '%');
      }
  }

  function trackTorrentStatus(torrentId) {
      return new Promise((resolve, reject) => {
          let isTrackingActive = true;
          let pollTimeout;
          
          const onCancel = () => {
              if (isTrackingActive) {
                  isTrackingActive = false;
                  clearTimeout(pollTimeout);
                  reject({type: 'user', message: 'Отменено пользователем'});
              }
          };
          
          showStatusModal('Отслеживание статуса...', onCancel);

          const poll = async () => {
              if (!isTrackingActive) {
                  clearTimeout(pollTimeout);
                  return;
              }

              try {
                  const torrentResult = await API.myList(torrentId);
                  const torrentData = torrentResult?.data?.[0];

                  if (!isTrackingActive) return;

                  if (!torrentData) {
                      isTrackingActive = false;
                      return reject({type: 'api', message: "Торрент исчез из списка"});
                  }

                  const currentStatus = torrentData.download_state || torrentData.status;
                  const statusMap = {'queued':'В очереди','downloading':'Загрузка','uploading':'Раздача','completed':'Завершен','stalled':'Остановлен','error':'Ошибка','metadl':'Получение метаданных','paused':'На паузе','failed':'Ошибка загрузки','checking':'Проверка'};
                  const statusText = statusMap[currentStatus.toLowerCase().split(' ')[0]] || currentStatus;
                  
                  let progressValue = parseFloat(torrentData.progress);
                  let progressPercent = isNaN(progressValue) ? 0 : (progressValue > 1 ? progressValue : progressValue * 100);
                  progressPercent = Math.max(0, Math.min(100, progressPercent));

                  const etaValue = parseInt(torrentData.eta, 10);
                  const sizeValue = parseInt(torrentData.size, 10);
                  let progressText = (currentStatus.toLowerCase().startsWith('checking') || isNaN(sizeValue) || sizeValue === 0) ? "Обработка торрента..." : `${progressPercent.toFixed(2)}% из ${formatBytes(sizeValue)}`;
                  
                  updateStatusModal({ 
                      status: statusText, 
                      progress: progressPercent, 
                      progressText: progressText, 
                      speed: `Скорость: ${formatBytes(torrentData.download_speed, true)}`, 
                      eta: `Осталось: ${formatTime(etaValue)}`, 
                      peers: `Сиды: ${torrentData.seeds} / Пиры: ${torrentData.peers}` 
                  });
                  
                  const isDownloadFinished = currentStatus === 'completed' || torrentData.download_finished || progressPercent >= 100;
                  const filesAreReady = torrentData.files && torrentData.files.length > 0;

                  if (isDownloadFinished && filesAreReady) {
                      isTrackingActive = false;
                      if (currentStatus.startsWith('uploading')) {
                          updateStatusModal({ status: 'Загрузка завершена. Остановка раздачи...', progress: 100, peers: `Сиды: ${torrentData.seeds} / Пиры: ${torrentData.peers}` });
                          await API.stopTorrent(torrentData.id).catch(e => LOG('Не удалось остановить раздачу:', e.message));
                      }
                      resolve(torrentData);
                  } else {
                      if (isDownloadFinished && !filesAreReady) updateStatusModal({ status: 'Завершено, обработка файлов...', progress: 100 });
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
      if (!torrentData?.files?.length) {
          throw {type: 'validation', message: 'Видеофайлы не найдены в торренте.'};
      }
      const files = torrentData.files.filter(f => /\.(mkv|mp4|avi)$/i.test(f.name));
      if (!files.length) throw {type: 'validation', message: 'Воспроизводимые видеофайлы не найдены.'};

      if (files.length === 1) return play(torrentData.id, files[0], movie, component);
      
      files.sort((a,b) => b.size - a.size);
      const fileItems = files.map(f => ({ title: f.name, subtitle: formatBytes(f.size), file: f }));
      Lampa.Select.show({ title: 'Выбор файла для воспроизведения', items: fileItems, onSelect: item => play(torrentData.id, item.file, movie, component), onBack: () => component.start() });
  }

  async function handleTorrent(torrent, movie, component) {
    try {
        if (!torrent?.magnet || typeof torrent.magnet !== 'string' || !torrent.magnet.startsWith('magnet:?')) {
            throw {type: 'validation', message: 'Некорректная magnet-ссылка'};
        }
        showStatusModal('Добавление в TorBox...');
        const result = await API.addMagnet(torrent.magnet);
        const torrentInfo = result.data;
        const torrentIdForTracking = torrentInfo.torrent_id || torrentInfo.id;
        if (!torrentIdForTracking) throw {type: 'api', message: 'Не удалось получить ID торрента после добавления.'};
        
        const finalTorrentData = await trackTorrentStatus(torrentIdForTracking);
        Lampa.Modal.close();
        modalCache = {};
        showFileSelection(finalTorrentData, movie, component);
    } catch (e) {
        if (e.type !== "user") { // Не показываем ошибку, если пользователь сам отменил
            ErrorHandler.show(e.type, e);
        }
        Lampa.Modal.close();
        modalCache = {};
    }
  }

  async function play(torrentId, file, movie, component) {
    showStatusModal('Получение ссылки на файл...');
    try {
      const dlResponse = await API.requestDl(torrentId, file.id);
      const finalUrl = dlResponse?.data || dlResponse?.url;
      if (!finalUrl || typeof finalUrl !== 'string') throw {type: 'api', message: 'Не удалось получить ссылку для воспроизведения.'};
      Lampa.Modal.close();
      modalCache = {};
      Lampa.Player.play({ url: finalUrl, title: file.name || movie.title, poster: movie.img });
      Lampa.Player.callback(component.start.bind(component));
    } catch (e) {
      ErrorHandler.show(e.type, e);
      Lampa.Modal.close();
      modalCache = {};
    }
  }

  /* ───── Settings & Boot ───── */
  const COMP = 'torbox_enh';
  function addSettings() {
    if (!Lampa.SettingsApi) return;
    Lampa.SettingsApi.addComponent({ component: COMP, name: 'TorBox Enhanced', icon: ICON });
    const fields = [{k:'torbox_proxy_url',n:'URL вашего CORS-прокси',d:`По умолчанию: ${DEFAULTS.proxyUrl}`,t:'input',def:Store.get('torbox_proxy_url','')},{k:'torbox_api_key',n:'Ваш личный API-Key',d:`По умолчанию используется гостевой ключ`,t:'input',def:Store.get('torbox_api_key','')},{k:'torbox_debug',n:'Режим отладки',d:'Записывать подробную информацию в консоль',t:'trigger',def:CFG.debug}];
    fields.forEach(p=>Lampa.SettingsApi.addParam({component:COMP,param:{name:p.k,type:p.t,values:'',default:p.def},field:{name:p.n,description:p.d},onChange:v=>{const a=String(typeof v==='object'?v.value:v).trim();if(p.k==='torbox_proxy_url')CFG.proxyUrl=a;if(p.k==='torbox_api_key')CFG.apiKey=a;if(p.k==='torbox_debug')CFG.debug=Boolean(v)}}));
  }

  function boot() {
    Lampa.Listener.follow('full', e => {
      if (e.type !== 'complite' || !e.data.movie) return;
      const root = e.object.activity.render();
      if (root.find('.view--torbox').length) return;
      const btn = $(`<div class="full-start__button selector view--torbox" data-subtitle="TorBox">${ICON}<span>TorBox</span></div>`);
      btn.on('hover:enter.torbox', () => {
          Lampa.Activity.push({ component: 'torbox_component', title: 'TorBox - ' + e.data.movie.title, movie: e.data.movie });
      });
      root.find('.view--torrent').after(btn);
    });
  }

  let waited = 0;
  (function bootLoop () {
    if (window.Lampa && Lampa.Activity && Lampa.Component && Lampa.Utils) {
      try {
        Lampa.Component.add('torbox_component', TorBoxComponent);
        addSettings();
        boot();
        LOG('TorBox v12.0.0 (Major Refactoring) ready');
      }
      catch (e) { console.error('[TorBox] Boot Error:', e); }
    } else {
      if ((waited += 500) >= 60000) return console.warn('[TorBox] Lampa not found, plugin disabled.');
      setTimeout(bootLoop, 500);
    }
  })();

})();
