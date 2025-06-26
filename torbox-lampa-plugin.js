/*
 * TorBox Enhanced – Universal Lampa Plugin v11.0.46 (Refactored & Stabilized)
 * ===========================================================================
 * • ИСПРАВЛЕНИЕ СОВМЕСТИМОСТИ API: Добавлен обязательный метод stop() и заменен устаревший вызов Lampa.Select.visible() на актуальный Lampa.Utils.isSelectVisible(), что устраняет критические ошибки навигации.
 * • УСТРАНЕНИЕ УТЕЧКИ ПАМЯТИ: Контроллер теперь корректно выгружается из памяти при уничтожении компонента (destroy), предотвращая утечки.
 * • УСТРАНЕНИЕ ГОНКИ УСЛОВИЙ: Улучшена логика отслеживания торрента для предотвращения фоновых запросов после отмены операции пользователем.
 * • ПОВЫШЕНИЕ ПРОИЗВОДИТЕЛЬНОСТИ: Добавлено кэширование для функции сортировки по дате, что ускоряет отрисовку списка при большом количестве торрентов.
 * • УЛУЧШЕНИЕ БЕЗОПАСНОСТИ: Добавлена базовая валидация данных и экранирование HTML для предотвращения возможных проблем с отображением.
 */

(function () {
  'use strict';

  /* ───── Guard double-load ───── */
  const PLUGIN_ID = 'torbox_enhanced_v11_0_46_stabilized';
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

  const formatBytes = (bytes, speed = false) => {
    const B = Number(bytes); // Более производительно
    if (isNaN(B) || B === 0) return speed ? '0 KB/s' : '0 B';
    const k = 1024;
    const sizes = speed ? ['B/s', 'KB/s', 'MB/s', 'GB/s'] : ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(B) / Math.log(k));
    return parseFloat((B / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };
  
  const formatTime = (seconds) => {
      try {
        if (isNaN(seconds) || seconds < 0) return 'н/д';
        if (seconds === Infinity || seconds > 86400 * 30) return '∞';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
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
        throw new Error(`Ошибка авторизации (${status}). Проверьте ваш API-ключ.`);
    }
    if (typeof responseText === 'string' && responseText.toUpperCase().includes("NO_AUTH")) {
        throw new Error('Ошибка авторизации (NO_AUTH). Проверьте API-ключ и права доступа.');
    }
    if (status < 200 || status >= 300) {
        throw new Error(`Ошибка сети: HTTP ${status}`);
    }
    // Проверка на пустой ответ от прокси
    if (!responseText || (typeof responseText === 'string' && responseText.trim() === '')) {
        throw new Error('Получен пустой ответ от сервера/прокси.');
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
            throw new Error(errorMsg);
        }
        return json;
    } catch (e) {
        LOG('Invalid JSON or API error:', responseText, e);
        throw new Error(e.message || 'Получен некорректный ответ от сервера.');
    }
  }


  const API = {
    SEARCH_API: 'https://search-api.torbox.app',
    MAIN_API: 'https://api.torbox.app/v1/api',
    
    request: function(url, options = {}) {
        if (!CFG.proxyUrl) {
            return Promise.reject(new Error("URL прокси-сервера не указан в настройках."));
        }
        const proxyUrl = `${CFG.proxyUrl}?url=${encodeURIComponent(url)}`;
        LOG('Calling via universal proxy (fetch) for ALL platforms. Target:', url);

        options.headers = options.headers || {};
        options.headers['X-Api-Key'] = CFG.apiKey;
        delete options.headers['Authorization'];

        return fetch(proxyUrl, options)
            .then(async (r) => {
                if (!r.ok) {
                    const errorText = await r.text();
                    LOG(`Proxy error: Status ${r.status}`, errorText);
                    throw new Error(`Ошибка прокси-сервера: ${r.status} ${r.statusText}`);
                }
                const responseText = await r.text();
                return processResponse(responseText, r.status);
            })
            .catch(err => {
                LOG('Fetch error:', err.message);
                throw new Error(`Сетевая ошибка при обращении к прокси: ${err.message}`);
            });
    },

    async search(imdbId) {
        let formattedImdbId = imdbId;
        if (!imdbId) throw new Error('IMDb ID не передан в функцию поиска');
        if (!/^tt\d+$/.test(imdbId)) {
            if (/^\d+$/.test(imdbId)) formattedImdbId = `tt${imdbId}`;
            else throw new Error(`Неверный формат IMDb ID: ${imdbId}`);
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
    let scroll = new Lampa.Scroll({ mask: true, over: true });
    let files = new Lampa.Explorer(object);
    let filter = new Lampa.Filter(object);
    let last;
    let initialized = false;
    let all_torrents = [];
    let current_sort = Store.get('torbox_sort_method', 'seeders');
    let current_filters = JSON.parse(Store.get('torbox_filters', '{"quality":"all","tracker":"all"}'));
    this.activity = object.activity;
    this.movie = object.movie;
    let controller_registered = false;
    const ageCache = new Map();

    const sort_types = [
        { key: 'seeders', title: 'По сидам (убыв.)', field: 'last_known_seeders', reverse: true },
        { key: 'size_desc', title: 'По размеру (убыв.)', field: 'size', reverse: true },
        { key: 'size_asc', title: 'По размеру (возр.)', field: 'size', reverse: false },
        { key: 'age', title: 'По дате добавления', field: 'age', reverse: false },
    ];
    
    // ### FIXED ###
    // Полный набор методов жизненного цикла для совместимости с Lampa
    this.create = function() {
        this.initialize();
        return this.render();
    };

    this.start = function () {
        this.activity.loader(false);
        if (!controller_registered) {
            Lampa.Controller.add('content', {
                toggle: () => { 
                    Lampa.Controller.collectionSet(scroll.render(), files.render());
                    Lampa.Controller.collectionFocus(last || false, scroll.render()); 
                },
                up: () => { Navigator.move('up'); },
                down: () => { Navigator.move('down'); },
                left: () => { Lampa.Controller.toggle('menu'); },
                right: () => { 
                    if(Navigator.canmove('right')) Lampa.Controller.toggle('head'); 
                    else filter.show(Lampa.Lang.translate('title_filter'), 'filter'); 
                },
                back: () => {
                    // ### FIXED ###: Заменено на актуальный API-вызов Lampa для проверки видимости
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
            controller_registered = true;
        }
        Lampa.Controller.toggle('content');
    };

    this.pause = function () {
        LOG('TorBox component paused');
    };

    this.resume = function () {
        LOG('TorBox component resumed');
    };
    
    // ### FIXED ###: Добавлен недостающий метод, вызывающий ошибку при закрытии
    this.stop = function () {
        LOG('TorBox component stopped');
    };

    this.destroy = function() {
        LOG('Destroying TorBox component');
        // ### FIXED ###: Устранение утечки памяти. Удаляем контроллер.
        if (controller_registered) {
            Lampa.Controller.remove('content');
            controller_registered = false;
        }
        ageCache.clear();
        scroll.destroy();
        files.destroy();
        filter.destroy();
        // Обнуляем ссылки для сборщика мусора
        scroll = null;
        files = null;
        filter = null;
        all_torrents = [];
    };

    this.initialize = function() {
        if (initialized) return;
        this.initializeFilterHandlers(); 
        filter.onBack = () => {
            Lampa.Controller.toggle('content');
        };
        if (filter.addButtonBack) filter.addButtonBack();
        scroll.body().addClass('torrent-list');
        files.appendFiles(scroll.render());
        files.appendHead(filter.render());
        scroll.minus(files.render().find('.explorer__files-head'));
        this.loadAndDisplayTorrents();
        initialized = true;
    };
    
    this.initializeFilterHandlers = function() {
        filter.onSelect = (type, a, b) => {
            if (type === 'sort') Store.set('torbox_sort_method', a.key);
            if (type === 'filter') {
                let new_filters = JSON.parse(Store.get('torbox_filters', '{"quality":"all","tracker":"all"}'));
                if (a.reset) new_filters = { quality: 'all', tracker: 'all' };
                else new_filters[a.stype] = b.value; 
                Store.set('torbox_filters', JSON.stringify(new_filters));
            }
            Lampa.Select.close();
            Lampa.Activity.replace(object);
        };
    };

    this.updateFilterUI = function() {
        const sort_items = sort_types.map(item => ({...item, selected: item.key === current_sort}));
        filter.set('sort', sort_items);
        filter.render().find('.filter--sort span').text('Сортировка');
        filter.chosen('sort', [ (sort_types.find(s => s.key === current_sort) || {title:''}).title ]);
        
        if (!Array.isArray(all_torrents)) all_torrents = [];

        const qualities = ['all', ...new Set(all_torrents.map(t => ql(t.raw_title)))];
        const trackers = ['all', ...new Set(all_torrents.map(t => t.tracker).filter(Boolean))];
        const quality_items = qualities.map(q => ({ title: q === 'all' ? 'Все' : q, value: q, selected: current_filters.quality === q }));
        const tracker_items = trackers.map(t => ({ title: t === 'all' ? 'Все' : t, value: t, selected: current_filters.tracker === t }));
        const filter_items = [{title:'Сбросить',reset:true},{title:'Качество',subtitle:current_filters.quality==='all'?'Все':current_filters.quality,items:quality_items,stype:'quality'},{title:'Трекер',subtitle:current_filters.tracker==='all'?'Все':current_filters.tracker,items:tracker_items,stype:'tracker'}];
        filter.set('filter', filter_items);
        filter.render().find('.filter--filter span').text('Фильтр');
        const filter_titles = [];
        if(current_filters.quality !== 'all') filter_titles.push(`Качество: ${current_filters.quality}`);
        if(current_filters.tracker !== 'all') filter_titles.push(`Трекер: ${current_filters.tracker}`);
        filter.chosen('filter', filter_titles);
    };

    this.applyFiltersAndSort = function() {
        if (!Array.isArray(all_torrents)) return [];
        let filtered = all_torrents.slice();
        if (current_filters.quality !== 'all') filtered = filtered.filter(t => ql(t.raw_title) === current_filters.quality);
        if (current_filters.tracker !== 'all') filtered = filtered.filter(t => t.tracker === current_filters.tracker);
        const sort_method = sort_types.find(s => s.key === current_sort);
        if (sort_method) {
            // ### FIXED ###: Кэширование для ускорения парсинга
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

    this.loadAndDisplayTorrents = async function() {
        this.activity.loader(true);
        scroll.clear();
        try {
            if (!this.movie?.imdb_id) throw new Error('IMDb ID не найден');
            const torrents = await API.search(this.movie.imdb_id);
            
            all_torrents = Array.isArray(torrents) ? torrents : [];
            this.display();
        } catch (error) {
            this.empty(error.message || 'Произошла ошибка');
            Lampa.Noty.show(`Ошибка: ${error.message}`, { type: 'error' });
        } finally {
            this.activity.loader(false);
        }
    };

    this.display = function() {
        this.updateFilterUI();
        this.draw(this.applyFiltersAndSort());
    };

    this.draw = function(torrents_list) {
        scroll.clear();
        if (!torrents_list?.length) {
            this.empty('Ничего не найдено по заданным фильтрам');
            return;
        }
        torrents_list.forEach(t => {
            const isSeasonPack = /(S\d{1,2}E\d{1,2}|S\d{1,2}|Сезон \d+|Серии \d+-\d+)/i.test(t.raw_title || t.title);
            const sizeString = isSeasonPack ? `~ ${formatBytes(t.size)} / серия` : formatBytes(t.size);
            const title = escapeHtml(t.raw_title || t.title);

            const item = $(`<div class="torbox-item selector"><div class="torbox-item__title">${t.cached?'⚡':'☁️'} ${title}</div><div class="torbox-item__subtitle">[${ql(t.raw_title||t.title)}] ${sizeString} | 🟢 <span style="color:var(--color-good);">${t.last_known_seeders||0}</span> / 🔴 <span style="color:var(--color-bad);">${t.last_known_peers||0}</span><br><span style="opacity:0.7;">Трекер: ${t.tracker||'н/д'} | Добавлено: ${t.age||'н/д'}</span></div></div>`);
            item.on('hover:focus', () => { last = item[0]; scroll.update(item, true); });
            item.on('hover:enter', () => handleTorrent(t, this.movie, this));
            scroll.append(item);
        });
    };

    this.empty = function(msg) { 
        scroll.clear(); 
        scroll.append($(`<div class="empty"><div class="empty__text">${msg||'Торренты не найдены'}</div></div>`)); 
        this.activity.loader(false);
    };
    
    this.render = function() {
        return files.render();
    };
  }
  
  function showStatusModal(title, onBack) {
      if ($('.modal').length) Lampa.Modal.close();
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
          onBack: onBack || (() => { Lampa.Modal.close(); })
      });
      LOG('Modal created');
  }
  
  function updateStatusModal(data) {
      const modalBody = $('.modal__content .torbox-status');
      if (!modalBody.length) return;
      
      modalBody.find('[data-name="status"]').text(data.status || '...');
      modalBody.find('[data-name="progress-text"]').text(data.progressText || '');
      modalBody.find('[data-name="speed"]').text(data.speed || '');
      modalBody.find('[data-name="eta"]').text(data.eta || '');
      modalBody.find('[data-name="peers"]').text(data.peers || '');
      
      const progressBar = modalBody.find('.torbox-status__progress-bar');
      const progressPercent = Math.max(0, Math.min(100, data.progress || 0));
      
      if (progressBar.length) {
          progressBar.css('width', progressPercent + '%');
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
                  reject(new Error("Отменено пользователем"));
              }
          };
          
          showStatusModal('Отслеживание статуса...', onCancel);

          const poll = async () => {
              // ### FIXED ###: Устранение гонки условий
              if (!isTrackingActive) {
                  clearTimeout(pollTimeout);
                  return;
              }

              try {
                  const torrentResult = await API.myList(torrentId);
                  const torrentData = torrentResult?.data?.[0];

                  if (!isTrackingActive) return; // Еще одна проверка после асинхронного вызова

                  if (!torrentData) {
                      isTrackingActive = false;
                      return reject(new Error("Торрент исчез из списка"));
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
          return Lampa.Noty.show('Видеофайлы не найдены в торренте.', {type: 'error'});
      }
      const files = torrentData.files.filter(f => /\.(mkv|mp4|avi)$/i.test(f.name)); // rar убран, т.к. его нельзя воспроизвести
      if (!files.length) return Lampa.Noty.show('Воспроизводимые видеофайлы не найдены.');

      if (files.length === 1) return play(torrentData.id, files[0], movie, component);
      
      files.sort((a,b) => b.size - a.size);
      const fileItems = files.map(f => ({ title: f.name, subtitle: formatBytes(f.size), file: f }));
      Lampa.Select.show({ title: 'Выбор файла для воспроизведения', items: fileItems, onSelect: item => play(torrentData.id, item.file, movie, component), onBack: () => component.start() });
  }

  async function handleTorrent(torrent, movie, component) {
    // ### FIXED ###: Валидация входных данных
    if (!torrent?.magnet || typeof torrent.magnet !== 'string' || !torrent.magnet.startsWith('magnet:?')) {
        Lampa.Noty.show('Некорректная magnet-ссылка', {type: 'error'});
        return;
    }
    showStatusModal('Добавление в TorBox...');
    try {
        const result = await API.addMagnet(torrent.magnet);
        const torrentInfo = result.data;
        const torrentIdForTracking = torrentInfo.torrent_id || torrentInfo.id;
        if (!torrentIdForTracking) throw new Error('Не удалось получить ID торрента после добавления.');
        
        const finalTorrentData = await trackTorrentStatus(torrentIdForTracking);
        Lampa.Modal.close();
        showFileSelection(finalTorrentData, movie, component);
    } catch (e) {
        LOG('HandleTorrent Error:', e);
        if (e.message !== "Отменено пользователем") Lampa.Noty.show(`TorBox: ${e.message}`, { type: 'error' });
        Lampa.Modal.close();
    }
  }

  async function play(torrentId, file, movie, component) {
    showStatusModal('Получение ссылки на файл...');
    try {
      const dlResponse = await API.requestDl(torrentId, file.id);
      const finalUrl = dlResponse?.data || dlResponse?.url;
      if (!finalUrl || typeof finalUrl !== 'string') throw new Error('Не удалось получить ссылку для воспроизведения.');
      Lampa.Modal.close();
      Lampa.Player.play({ url: finalUrl, title: file.name || movie.title, poster: movie.img });
      Lampa.Player.callback(component.start.bind(component));
    } catch (e) {
      LOG('Play Error:', e);
      Lampa.Modal.close();
      Lampa.Noty.show(`TorBox Play: ${e.message}`, { type: 'error' });
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
      btn.on('hover:enter', () => {
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
        LOG('TorBox v11.0.46 (Refactored & Stabilized) ready');
      }
      catch (e) { console.error('[TorBox] Boot Error:', e); }
    } else {
      if ((waited += 500) >= 60000) return console.warn('[TorBox] Lampa not found, plugin disabled.');
      setTimeout(bootLoop, 500);
    }
  })();

})();
