/*
 * TorBox Enhanced – Universal Lampa Plugin v10.0.7
 * ============================================================
 * • ИСПРАВЛЕНО: Устранена основная причина ошибки "Торрент не найден", улучшена обработка ответов API.
 * • ИСПРАВЛЕНО: Устранена ошибка 405 Method Not Allowed при запросе ссылки на скачивание.
 * • ОПТИМИЗАЦИЯ: Для уже кешированных торрентов пропускается отслеживание статуса и сразу открывается выбор файлов.
 * • НОВОЕ: Полная интеграция с TorBox!
 * • НОВОЕ: Информативное модальное окно со статусом загрузки.
 */

(function () {
  'use strict';

  /* ───── Guard double-load ───── */
  const PLUGIN_ID = 'torbox_enhanced_v10_0_7';
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
    get debug()      { return Store.get('torbox_debug', '0') === '1'; },
    set debug(v)     { Store.set('torbox_debug', v ? '1' : '0');    },
    get proxyUrl()   { return Store.get('torbox_proxy_url') || DEFAULTS.proxyUrl; },
    set proxyUrl(v)  { Store.set('torbox_proxy_url', v); },
    get apiKey()     { return Store.get('torbox_api_key') || DEFAULTS.apiKey; },
    set apiKey(v)    { Store.set('torbox_api_key', v); }
  };

  const LOG  = (...a) => CFG.debug && console.log('[TorBox]', ...a);

  const processResponse = async (r, url) => {
    const responseText = await r.text();
    if (r.status === 401) throw new Error(`Ошибка авторизации (401). Проверьте ваш API-ключ.`);
    if (responseText.includes("NO_AUTH")) throw new Error('Ошибка авторизации (NO_AUTH). Проверьте API-ключ и тарифный план.');
    if (!r.ok) throw new Error(`Ошибка сети: HTTP ${r.status}`);
    
    try {
        const json = JSON.parse(responseText);
        if (json.success === false && json.detail) {
            if (typeof json.detail === 'string') throw new Error(json.detail);
            if (Array.isArray(json.detail) && json.detail[0]?.msg) throw new Error(json.detail[0].msg);
        }
        if (json.success === false) throw new Error(json.message || 'API вернул ошибку.');
        return json;
    } catch (e) {
        LOG('Invalid JSON or API error:', responseText, e);
        throw new Error(e.message || 'Получен некорректный ответ от сервера.');
    }
  };

  const formatBytes = (bytes, speed = false) => {
    if (!bytes) return speed ? '0 KB/s' : '0 B';
    const k = 1024;
    const sizes = speed ? ['B/s', 'KB/s', 'MB/s', 'GB/s'] : ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };
  
  const formatTime = (seconds) => {
      if (isNaN(seconds) || seconds < 0) return 'н/д';
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = Math.floor(seconds % 60);
      return [h > 0 ? h : null, m, s].filter(v=>v!==null).map(v => v.toString().padStart(2, '0')).join(':');
  };

  const ql = (title) => {
    if (!title) return 'SD';
    if (title.match(/2160p|4K|UHD/i)) return '4K';
    if (title.match(/1080p|FHD/i)) return 'FHD';
    if (title.match(/720p|HD/i)) return 'HD';
    return 'SD';
  };

  if (!$('#torbox-component-styles').length) {
    $('head').append(`<style id="torbox-component-styles">.torbox-item{padding:1.2em;margin:.5em 0;border-radius:.8em;background:var(--color-background-light);cursor:pointer;transition:all .3s ease;border:2px solid transparent}.torbox-item:hover,.torbox-item.focus{background:var(--color-primary);color:var(--color-background);transform:translateX(.8em);border-color:rgba(255,255,255,.3);box-shadow:0 4px 20px rgba(0,0,0,.2)}.torbox-item__title{font-weight:600;margin-bottom:.5em;font-size:1.1em;line-height:1.3}.torbox-item__subtitle{font-size:.95em;opacity:.8;line-height:1.4}.torrent-list{padding:1em}.torbox-status{padding:1em 2em; text-align:center;}.torbox-status__title{font-size:1.4em; margin-bottom:1em;}.torbox-status__info{font-size: 1.1em; margin-bottom: 0.5em;}.torbox-status__progress-bar{height:10px; background:rgba(255,255,255,0.2); border-radius:5px; overflow:hidden; margin:1em 0;}.torbox-status__progress-bar>div{height:100%; width:0; background:var(--color-primary); transition: width 0.3s;}</style>`);
  }

  /* ───── TorBox API wrapper ───── */
  const API = {
    SEARCH_API: 'https://search-api.torbox.app',
    MAIN_API: 'https://api.torbox.app/v1/api',

    async proxiedCall(targetUrl, options = {}) {
        const proxy = CFG.proxyUrl;
        const proxiedUrl = `${proxy}?url=${encodeURIComponent(targetUrl)}`;
        LOG('Calling via proxy:', proxiedUrl, 'Target:', targetUrl);
        return await fetch(proxiedUrl, options).then(r => processResponse(r, targetUrl));
    },

    search(imdbId) {
        const key = CFG.apiKey;
        let formattedImdbId = imdbId;
        if (!/^tt\d+$/.test(imdbId)) {
            if (/^\d+$/.test(imdbId)) formattedImdbId = `tt${imdbId}`;
            else throw new Error(`Неверный формат IMDb ID: ${imdbId}`);
        }
        const url = `${this.SEARCH_API}/torrents/imdb:${formattedImdbId}?check_cache=true&check_owned=false&search_user_engines=false`;
        return this.proxiedCall(url, { headers: { 'Authorization': `Bearer ${key}` } })
            .then(res => res.data?.torrents || []);
    },

    directAction(path, body = {}, method = 'GET') {
        const key = CFG.apiKey;
        let url = `${this.MAIN_API}${path}`;
        const options = {
            method,
            headers: { 'Authorization': `Bearer ${key}`, 'Accept': 'application/json' }
        };
        if (method !== 'GET') {
            options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
            options.body = new URLSearchParams(body).toString();
        } else if (Object.keys(body).length) {
            url += '?' + new URLSearchParams(body).toString();
        }
        return this.proxiedCall(url, options);
    },

    addMagnet(magnet) { 
        return this.directAction('/torrents/createtorrent', { magnet, no_seed: true }, 'POST'); 
    },
    myList(torrentId) {
        return this.directAction('/torrents/mylist', { id: torrentId }).then(r => {
            // FIX: Normalize API response. API can return a single object or an array.
            // We always return an array to keep the logic consistent.
            if (r.data && !Array.isArray(r.data)) {
                return [r.data];
            }
            return r.data; // It's already an array or null
        });
    },
    requestDl(torrentId, fid) { 
        return this.directAction('/torrents/requestdl', { torrent_id: torrentId, file_id: fid }, 'GET'); 
    }
  };

  /* ───── TorBox Component ───── */
  function TorBoxComponent(object) {
    var network = new Lampa.Reguest();
    var scroll = new Lampa.Scroll({ mask: true, over: true });
    var files = new Lampa.Explorer(object);
    var filter = new Lampa.Filter(object);
    var last;
    var initialized = false;
    var all_torrents = [];
    var current_sort = Store.get('torbox_sort_method', 'seeders');
    var current_filters = JSON.parse(Store.get('torbox_filters', '{"quality":"all","tracker":"all"}'));

    var sort_types = [
        { key: 'seeders', title: 'По сидам (убыв.)', field: 'last_known_seeders', reverse: true },
        { key: 'size_desc', title: 'По размеру (убыв.)', field: 'size', reverse: true },
        { key: 'size_asc', title: 'По размеру (возр.)', field: 'size', reverse: false },
        { key: 'age', title: 'По дате добавления', field: 'age', reverse: false },
    ];


    this.movie = object.movie;

    this.start = function () {
        if (Lampa.Activity.active().activity !== this.activity) return;
        Lampa.Controller.add('content', {
            toggle: function () {
                Lampa.Controller.collectionSet(scroll.render(), files.render());
                Lampa.Controller.collectionFocus(last || false, scroll.render());
            },
            up: ()=>{Navigator.move('up')},
            down: ()=>{Navigator.move('down')},
            left: ()=>{Lampa.Controller.toggle('menu');},
            right: ()=>{
                if(Navigator.canmove('right')) Navigator.move('right');
                else Lampa.Controller.toggle('head');
            },
            back: this.back.bind(this)
        });
        Lampa.Controller.toggle('content');
    };

    this.create = function() {
        this.initialize();
        return this.render();
    };
    
    this.initialize = function() {
        if (initialized) return;
        this.initializeFilterHandlers(); 
        filter.onBack = () => { this.start(); }; 
        if (filter.addButtonBack) filter.addButtonBack();
        scroll.body().addClass('torrent-list');
        files.appendFiles(scroll.render());
        files.appendHead(filter.render());
        scroll.minus(files.render().find('.explorer__files-head'));
        this.loadAndDisplayTorrents();
        initialized = true;
    };
    
    this.initializeFilterHandlers = function() {
        var _this = this;
        filter.onSelect = function (type, a, b) {
            Lampa.Select.close();
            if (type === 'sort') {
                current_sort = a.key;
                Store.set('torbox_sort_method', current_sort);
            }
            if (type === 'filter') {
                if(a.reset){ current_filters = { quality: 'all', tracker: 'all' }; } 
                else { current_filters[a.stype] = b.value; }
                Store.set('torbox_filters', JSON.stringify(current_filters));
            }
            _this.display();
        };
    };

    this.updateFilterUI = function() {
        var sort_items = sort_types.map(item => ({...item, selected: item.key === current_sort}));
        filter.set('sort', sort_items);
        filter.render().find('.filter--sort span').text('Сортировка');
        filter.chosen('sort', [ (sort_types.find(s => s.key === current_sort) || {title:''}).title ]);
        const qualities = ['all', ...new Set(all_torrents.map(t => ql(t.raw_title)))];
        const trackers = ['all', ...new Set(all_torrents.map(t => t.tracker).filter(Boolean))];
        const quality_items = qualities.map(q => ({ title: q === 'all' ? 'Все' : q, value: q, selected: current_filters.quality === q }));
        const tracker_items = trackers.map(t => ({ title: t === 'all' ? 'Все' : t, value: t, selected: current_filters.tracker === t }));
        var filter_items = [{title:'Сбросить',reset:true},{title:'Качество',subtitle:current_filters.quality==='all'?'Все':current_filters.quality,items:quality_items,stype:'quality'},{title:'Трекер',subtitle:current_filters.tracker==='all'?'Все':current_filters.tracker,items:tracker_items,stype:'tracker'}];
        filter.set('filter', filter_items);
        filter.render().find('.filter--filter span').text('Фильтр');
        const filter_titles = [];
        if(current_filters.quality !== 'all') filter_titles.push(`Качество: ${current_filters.quality}`);
        if(current_filters.tracker !== 'all') filter_titles.push(`Трекер: ${current_filters.tracker}`);
        filter.chosen('filter', filter_titles);
    };

    this.applyFiltersAndSort = function() {
        let filtered = all_torrents.slice();
        if (current_filters.quality !== 'all') filtered = filtered.filter(t => ql(t.raw_title) === current_filters.quality);
        if (current_filters.tracker !== 'all') filtered = filtered.filter(t => t.tracker === current_filters.tracker);
        var sort_method = sort_types.find(s => s.key === current_sort);
        if (sort_method) {
            const parseAge=(a)=>{if(!a)return Infinity;let b=parseInt(a)||0;return a.includes("s")?b:a.includes("m")?60*b:a.includes("h")?3600*b:a.includes("d")?86400*b:a.includes("w")?604800*b:a.includes("y")?31536e3*b:Infinity};
            filtered.sort((a, b) => { let c,d;c="age"===sort_method.field?parseAge(a.age):a[sort_method.field]||0,d="age"===sort_method.field?parseAge(b.age):b[sort_method.field]||0;return c<d?-1:c>d?1:0});
            if (sort_method.reverse) filtered.reverse();
        }
        return filtered;
    };

    this.loadAndDisplayTorrents = async function() {
        this.loading(true);
        try {
            if (!this.movie?.imdb_id) throw new Error('IMDb ID не найден');
            all_torrents = await API.search(this.movie.imdb_id);
            this.display();
        } catch (error) {
            this.empty(error.message || 'Произошла ошибка');
            Lampa.Noty.show(`Ошибка: ${error.message}`, { type: 'error' });
        } finally {
            this.loading(false);
        }
    };

    this.display = function() {
        this.updateFilterUI();
        this.draw(this.applyFiltersAndSort());
    };

    this.draw = function(torrents_list) {
      scroll.clear();
      if (!torrents_list?.length) return this.empty('Ничего не найдено по заданным фильтрам');
      torrents_list.forEach(t => {
          const item = $(`<div class="torbox-item selector"><div class="torbox-item__title">${t.cached?'⚡':'☁️'} ${t.raw_title||t.title}</div><div class="torbox-item__subtitle">[${ql(t.raw_title||t.title)}] ${formatBytes(t.size)} | 🟢 <span style="color:var(--color-good);">${t.last_known_seeders||0}</span> / 🔴 <span style="color:var(--color-bad);">${t.last_known_peers||0}</span><br><span style="opacity:0.7;">Трекер: ${t.tracker||'н/д'} | Добавлено: ${t.age||'н/д'}</span></div></div>`);
          item.on('hover:focus', () => { last = item[0]; scroll.update(item, true); });
          item.on('hover:enter', () => handleTorrent(t, this.movie));
          scroll.append(item);
      });
      this.start();
    };

    this.empty = function(msg) { scroll.clear(); scroll.append($(`<div class="empty"><div class="empty__text">${msg||'Торренты не найдены'}</div></div>`)); this.start(); };
    this.loading = function(status) { if(status){scroll.clear();scroll.append($('<div class="broadcast__loading"><div></div><div></div><div></div></div>'))}else{scroll.render().find('.broadcast__loading').remove()}};
    this.render = function() { return files.render(); };
    this.back = function() { Lampa.Activity.backward(); };
    this.pause = this.stop = this.destroy = function() { network.clear(); files.destroy(); scroll.destroy(); };
  }
  
  /* ───── NEW: Full torrent handling logic ───── */
  
  let trackerInterval;

  function showStatusModal(title) {
      Lampa.Modal.open({
          title: 'TorBox',
          html: $(`<div class="torbox-status"><div class="torbox-status__title">${title}</div><div class="torbox-status__info" data-name="status">Ожидание...</div><div class="torbox-status__info" data-name="progress-text"></div><div class="torbox-status__progress-bar"><div style="width: 0%;"></div></div><div class="torbox-status__info" data-name="speed"></div><div class="torbox-status__info" data-name="eta"></div></div>`),
          size: 'medium',
          onBack: () => {
              clearInterval(trackerInterval);
              Lampa.Modal.close();
          }
      });
  }
  
  function updateStatusModal(data) {
      const modalBody = $('.modal__content .torbox-status');
      if (!modalBody.length) return;
      
      modalBody.find('[data-name="status"]').text(data.status || '...');
      modalBody.find('[data-name="progress-text"]').text(data.progressText || '');
      modalBody.find('.torbox-status__progress-bar > div').css('width', data.progress + '%' || '0%');
      modalBody.find('[data-name="speed"]').text(data.speed || '');
      modalBody.find('[data-name="eta"]').text(data.eta || '');
  }
  
  async function trackTorrentStatus(torrentId, movie) {
      showStatusModal('Отслеживание статуса...');
      
      trackerInterval = setInterval(async () => {
          try {
              const torrentDataArray = await API.myList(torrentId);
              if (!torrentDataArray?.[0]) {
                  throw new Error('Торрент не найден в вашем аккаунте.');
              }
              
              const torrent = torrentDataArray[0];

              const statusMap = {
                  'queued': 'В очереди',
                  'downloading': 'Загрузка',
                  'completed': 'Завершен',
                  'stalled': 'Остановлен',
                  'error': 'Ошибка'
              };
              
              let statusText = statusMap[torrent.status] || torrent.status;

              updateStatusModal({
                  status: statusText,
                  progress: torrent.progress,
                  progressText: `${torrent.progress}% из ${formatBytes(torrent.size)}`,
                  speed: `Скорость: ${formatBytes(torrent.down_speed, true)}`,
                  eta: `Осталось: ${formatTime(torrent.eta)}`
              });

              if (torrent.status === 'completed' || torrent.download_finished) {
                  clearInterval(trackerInterval);
                  Lampa.Modal.close();
                  await showFileSelection(torrent, movie);
              }
          } catch (error) {
              clearInterval(trackerInterval);
              Lampa.Noty.show(`Ошибка отслеживания: ${error.message}`, {type: 'error'});
              Lampa.Modal.close();
          }
      }, 5000); // Poll every 5 seconds
  }
  
  async function showFileSelection(torrentData, movie) {
      const files = torrentData.files.filter(f => /\.(mkv|mp4|avi|rar)$/i.test(f.name));
      if (!files.length) return Lampa.Noty.show('Видеофайлы не найдены в раздаче.');
      
      if (files.length === 1) return play(torrentData.id, files[0], movie);
      
      files.sort((a,b) => b.size - a.size);
      const fileItems = files.map(f => ({ title: f.name, subtitle: formatBytes(f.size), file: f }));

      Lampa.Select.show({
          title: 'TorBox - Выбор файла',
          items: fileItems,
          onSelect: item => play(torrentData.id, item.file, movie),
          onBack: () => { Lampa.Activity.backward(); }
      });
  }

  async function handleTorrent(torrent, movie) {
    showStatusModal('Добавление в TorBox...');
    try {
        const result = await API.addMagnet(torrent.magnet);
        const torrentInfo = result.data;
        const torrentIdForTracking = torrentInfo.torrent_id || torrentInfo.id;
        
        if (!torrentIdForTracking) throw new Error('Не удалось получить ID торрента из ответа API.');

        // OPTIMIZATION: Immediately check if the torrent is already downloaded
        const initialStatus = await API.myList(torrentIdForTracking);
        const initialTorrent = initialStatus?.[0];

        if (initialTorrent && (initialTorrent.status === 'completed' || initialTorrent.download_finished)) {
            updateStatusModal({status: 'Завершен'});
            await new Promise(resolve => setTimeout(resolve, 300)); // Short delay for user to see 'Completed'
            Lampa.Modal.close();
            await showFileSelection(initialTorrent, movie);
        } else {
            // If not completed, start tracking
            await trackTorrentStatus(torrentIdForTracking, movie);
        }

    } catch (e) {
      LOG('HandleTorrent Error:', e);
      Lampa.Modal.close();
      Lampa.Noty.show(`TorBox: ${e.message}`, { type: 'error' });
    }
  }

  async function play(torrentId, file, movie) {
    showStatusModal('Получение ссылки на файл...');
    try {
      const dlLink = await API.requestDl(torrentId, file.id);
      if (!dlLink?.url) throw new Error('Не удалось получить ссылку на скачивание.');
      Lampa.Modal.close();
      Lampa.Player.play({ url: dlLink.url, title: file.name || movie.title, poster: movie.img });
      Lampa.Player.callback(Lampa.Activity.backward);
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
    if (window.Lampa && Lampa.Activity && Lampa.Component) {
      try {
        Lampa.Component.add('torbox_component', TorBoxComponent);
        addSettings();
        boot();
        LOG('TorBox v10.0.6 ready');
      }
      catch (e) { console.error('[TorBox] Boot Error:', e); }
    } else {
      if ((waited += 500) >= 60000) return console.warn('[TorBox] Lampa not found, plugin disabled.');
      setTimeout(bootLoop, 500);
    }
  })();

})();
" was selected from immersive artifact "torbox_plugin.js (с полной интеграцией
