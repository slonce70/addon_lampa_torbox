/*
 * TorBox Enhanced – Universal Lampa Plugin v9.8.1
 * ============================================================
 * • ИСПРАВЛЕНО: Меню фильтра теперь корректно отображает выбранные параметры.
 * • НОВОЕ: Добавлены фильтры по качеству и трекеру.
 * • ИСПРАВЛЕНО: Восстановлена кнопка "Фильтр" и улучшена навигация.
 * • ИСПРАВЛЕНО: Закрытие окна сортировки/фильтра больше не возвращает на предыдущий экран.
 * • НОВОЕ: Добавлена сортировка по сидам, размеру и дате.
 * • НОВОЕ: Отображение пиров, трекера и даты добавления торрента.
 * • УЛУЧШЕННЫЙ UI: Вся информация сгруппирована для лучшей читаемости.
 * • СТАБИЛЬНОСТЬ: Улучшена обработка ошибок и навигация.
 */

(function () {
  'use strict';

  /* ───── Guard double-load ───── */
  const PLUGIN_ID = 'torbox_enhanced_v9_8_1'; // Increased version to prevent conflicts
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

  const CFG = {
    get debug()      { return Store.get('torbox_debug', '0') === '1'; },
    set debug(v)     { Store.set('torbox_debug', v ? '1' : '0');    },
    get proxyUrl()   { return Store.get('torbox_proxy_url', ''); },
    set proxyUrl(v)  { Store.set('torbox_proxy_url', v); }
  };

  const LOG  = (...a) => CFG.debug && console.log('[TorBox]', ...a);

  const processResponse = async (r, url) => {
    const responseText = await r.text();
    if (r.status === 401) throw new Error(`Ошибка авторизации (401) для ${url}. Проверьте ваш API-ключ.`);

    if (responseText.includes("NO_AUTH")) {
        throw new Error('Ошибка авторизации (NO_AUTH). Проверьте API-ключ и ваш тарифный план TorBox.');
    }

    if (!r.ok) throw new Error(`Ошибка сети: HTTP ${r.status} для ${url}`);

    try {
        const json = JSON.parse(responseText);
        if (json.success === false) {
            throw new Error(json.message || 'API вернул ошибку.');
        }
        return json;
    } catch (e) {
        LOG('Invalid JSON or API error:', responseText, e);
        throw new Error(e.message || 'Получен некорректный ответ от сервера.');
    }
  };

  const formatBytes = (bytes) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const ql = (title) => {
    if (!title) return 'SD';
    if (title.match(/2160p|4K|UHD/i)) return '4K';
    if (title.match(/1080p|FHD/i)) return 'FHD';
    if (title.match(/720p|HD/i)) return 'HD';
    return 'SD';
  };

  // Добавляем стили для TorBox компонента
  if (!$('#torbox-component-styles').length) {
    $('head').append(`
      <style id="torbox-component-styles">
        .torbox-item {
          padding: 1.2em;
          margin: 0.5em 0;
          border-radius: 0.8em;
          background: var(--color-background-light);
          cursor: pointer;
          transition: all 0.3s ease;
          border: 2px solid transparent;
        }
        .torbox-item:hover,
        .torbox-item.focus {
          background: var(--color-primary);
          color: var(--color-background);
          transform: translateX(0.8em);
          border-color: rgba(255, 255, 255, 0.3);
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
        }
        .torbox-item__title {
          font-weight: 600;
          margin-bottom: 0.5em;
          font-size: 1.1em;
          line-height: 1.3;
        }
        .torbox-item__subtitle {
          font-size: 0.95em;
          opacity: 0.8;
          line-height: 1.4;
        }
        .torrent-list {
          padding: 1em;
        }
      </style>
    `);
  }

  /* ───── TorBox API wrapper ───── */
  const API = {
    SEARCH_API: 'https://search-api.torbox.app',
    MAIN_API: 'https://api.torbox.app/v1/api',

    async proxiedCall(targetUrl, options = {}) {
        const proxy = CFG.proxyUrl;
        if (!proxy) throw new Error('URL вашего персонального прокси не указано в настройках.');
        const proxiedUrl = `${proxy}?url=${encodeURIComponent(targetUrl)}`;
        LOG('Calling via proxy:', proxiedUrl);
        LOG('Target URL:', targetUrl);
        LOG('Options:', JSON.stringify(options, null, 2));

        const response = await fetch(proxiedUrl, options);
        LOG('Response status:', response.status, response.statusText);
        return await processResponse(response, targetUrl);
    },

    async search(imdbId) {
        const key = Store.get('torbox_api_key', '');
        if (!key) throw new Error('API-Key не указан.');

        let formattedImdbId = imdbId;
        if (!/^tt\d+$/.test(imdbId)) {
            if (/^\d+$/.test(imdbId)) {
                formattedImdbId = `tt${imdbId}`;
            } else {
                throw new Error(`Неверный формат IMDb ID: ${imdbId}`);
            }
        }

        const url = `${this.SEARCH_API}/torrents/imdb:${formattedImdbId}?check_cache=true&check_owned=false&search_user_engines=false`;
        LOG('Search URL:', url);

        const options = { headers: { 'Authorization': `Bearer ${key}` } };
        const res = await this.proxiedCall(url, options);

        return res.data?.torrents || [];
    },

    async directAction(path, body = {}, method = 'GET') {
        const key = Store.get('torbox_api_key', '');
        if (!key) throw new Error('API-Key не указан.');

        let url = `${this.MAIN_API}${path}`;
        const options = {
            method,
            headers: { 'Authorization': `Bearer ${key}`, 'Accept': 'application/json' }
        };
        if (method !== 'GET') {
            options.headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(body);
        } else if (Object.keys(body).length) {
            url += '?' + new URLSearchParams(body).toString();
        }
        return await this.proxiedCall(url, options);
    },

    addMagnet(m)  { return this.directAction('/torrents/createtorrent', { magnet: m }, 'POST'); },
    files(hash)   { return this.directAction('/torrents/mylist', { id: hash }).then(r => r.data?.[0]?.files || []); },
    dl(thash, fid){ return this.directAction('/torrents/requestdl', { torrent_id: thash, file_id: fid }).then(r => r.data); }
  };

  /* ───── TorBox Component (Lampa Architecture) ───── */
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
                if(a.reset){
                    current_filters = { quality: 'all', tracker: 'all' };
                } else {
                    current_filters[a.stype] = b.value;
                }
                Store.set('torbox_filters', JSON.stringify(current_filters));
            }
            _this.display();
        };
    };

    this.updateFilterUI = function() {
        // Build Sort
        var sort_items = sort_types.map(function(item) {
            item.selected = item.key === current_sort;
            return item;
        });
        filter.set('sort', sort_items);
        filter.render().find('.filter--sort span').text('Сортировка');
        filter.chosen('sort', [ (sort_types.find(s => s.key === current_sort) || {title:''}).title ]);

        // Build Filter
        const qualities = ['all', ...new Set(all_torrents.map(t => ql(t.raw_title)))];
        const trackers = ['all', ...new Set(all_torrents.map(t => t.tracker).filter(Boolean))];

        const quality_items = qualities.map(q => ({ title: q === 'all' ? 'Все' : q, value: q, selected: current_filters.quality === q }));
        const tracker_items = trackers.map(t => ({ title: t === 'all' ? 'Все' : t, value: t, selected: current_filters.tracker === t }));
        
        var filter_items = [
            {
                title: 'Сбросить',
                reset: true
            },
            {
                title: 'Качество',
                subtitle: current_filters.quality === 'all' ? 'Все' : current_filters.quality,
                items: quality_items,
                stype: 'quality'
            },
            {
                title: 'Трекер',
                subtitle: current_filters.tracker === 'all' ? 'Все' : current_filters.tracker,
                items: tracker_items,
                stype: 'tracker'
            }
        ];
        
        filter.set('filter', filter_items);
        filter.render().find('.filter--filter span').text('Фильтр');
        
        const filter_titles = [];
        if(current_filters.quality !== 'all') filter_titles.push(`Качество: ${current_filters.quality}`);
        if(current_filters.tracker !== 'all') filter_titles.push(`Трекер: ${current_filters.tracker}`);
        filter.chosen('filter', filter_titles);
    };

    this.applyFiltersAndSort = function() {
        let filtered = all_torrents.slice();

        // Apply filters
        if (current_filters.quality !== 'all') {
            filtered = filtered.filter(t => ql(t.raw_title) === current_filters.quality);
        }
        if (current_filters.tracker !== 'all') {
            filtered = filtered.filter(t => t.tracker === current_filters.tracker);
        }

        // Apply sort
        var sort_method = sort_types.find(s => s.key === current_sort);
        if (sort_method) {
            const parseAge = (ageStr) => {
                if (!ageStr) return Infinity;
                const value = parseInt(ageStr) || 0;
                if (ageStr.includes('s')) return value;
                if (ageStr.includes('m')) return value * 60;
                if (ageStr.includes('h')) return value * 3600;
                if (ageStr.includes('d')) return value * 86400;
                if (ageStr.includes('w')) return value * 604800;
                if (ageStr.includes('y')) return value * 31536000;
                return Infinity;
            };

            filtered.sort((a, b) => {
                let valA, valB;
                if (sort_method.field === 'age') {
                    valA = parseAge(a.age);
                    valB = parseAge(b.age);
                } else {
                    valA = a[sort_method.field] || 0;
                    valB = b[sort_method.field] || 0;
                }
                if (valA < valB) return -1;
                if (valA > valB) return 1;
                return 0;
            });

            if (sort_method.reverse) {
                filtered.reverse();
            }
        }
        return filtered;
    };

    this.loadAndDisplayTorrents = async function() {
        this.loading(true);
        try {
            if (!this.movie || !this.movie.imdb_id) {
                throw new Error('IMDb ID не найден');
            }
            LOG('Searching torrents for:', this.movie.title, 'IMDb ID:', this.movie.imdb_id);
            all_torrents = await API.search(this.movie.imdb_id);
            LOG('Found torrents:', all_torrents.length);
            
            this.display();

        } catch (error) {
            LOG('Load/Display Error:', error);
            this.empty(error.message || 'Произошла ошибка');
            Lampa.Noty.show(`Ошибка: ${error.message}`, { type: 'error' });
        } finally {
            this.loading(false);
        }
    };

    this.display = function() {
        this.updateFilterUI();
        const torrents_to_display = this.applyFiltersAndSort();
        this.draw(torrents_to_display, { onEnter: (item) => this.select(item) });
    };

    this.draw = function(torrents_list, params) {
      LOG('Drawing torrents:', torrents_list.length);
      scroll.clear();

      if (!torrents_list || torrents_list.length === 0) {
          return this.empty('Ничего не найдено по заданным фильтрам');
      }

      torrents_list.forEach((torrent) => {
          const item = $('<div class="torbox-item selector"></div>');
          const title = `${torrent.cached ? '⚡' : '☁️'} ${torrent.raw_title || torrent.title}`;
          
          const peers = `<span style="color:var(--color-bad);">${torrent.last_known_peers || 0}</span>`;
          const seeders = `<span style="color:var(--color-good);">${torrent.last_known_seeders || 0}</span>`;

          const line1 = `[${ql(torrent.raw_title || torrent.title)}] ${formatBytes(torrent.size)} | 🟢 ${seeders} / 🔴 ${peers}`;
          const line2 = `<span style="opacity:0.7;">Трекер: ${torrent.tracker || 'н/д'} | Добавлено: ${torrent.age || 'н/д'}</span>`;

          item.html(
            `<div class="torbox-item__title">${title}</div><div class="torbox-item__subtitle">${line1}<br>${line2}</div>`
          );

          item.data('torrent', torrent);
          item.on('hover:focus', function() {
              last = item[0];
              scroll.update(item, true);
          }).on('hover:enter', function() {
              if (params.onEnter) params.onEnter(torrent, item);
          });
          scroll.append(item);
      });
      
      this.start();
    };

    this.select = function(torrent) {
        handleTorrent(torrent, this.movie);
    };

    this.empty = function(message) {
      scroll.clear();
      const text = message || 'Торренты не найдены';
      const empty = $(`<div class="empty"><div class="empty__text">${text}</div></div>`);
      scroll.append(empty);
      this.start();
    };

    this.loading = function(status) {
        if (status) {
            scroll.clear();
            const loading = $('<div class="broadcast__loading"><div></div><div></div><div></div></div>');
            scroll.append(loading);
        } else {
            scroll.render().find('.broadcast__loading').remove();
        }
    };

    this.render = function() { return files.render(); };
    this.back = function() { Lampa.Activity.backward(); };
    this.pause = function() {};
    this.stop = function() {};
    this.destroy = function() {
        network.clear();
        files.destroy();
        scroll.destroy();
    };
  }

  /* ───── UI flows (Updated) ───── */
  async function handleTorrent(t, movie) {
    Lampa.Loading.start('TorBox: обработка...');
    try {
      if (t.cached) {
        const files = await API.files(t.hash);
        const vids  = files.filter(f => /\.(mkv|mp4|avi)$/i.test(f.name));

        if (!vids.length) { Lampa.Noty.show('Видеофайлы не найдены.'); return; }
        if (vids.length === 1) { play(t.hash, vids[0], movie); return; }

        vids.sort((a,b) => b.size - a.size);
        const fileItems = vids.map(f => ({
          title: f.name,
          subtitle: `${formatBytes(f.size)} | ${ql(f.name)}`,
          file: f
        }));

        Lampa.Select.show({
          title: 'TorBox - Выбор файла',
          items: fileItems,
          onSelect: function(item) {
            play(t.hash, item.file, movie);
          },
          onBack: function() {
            Lampa.Activity.backward();
          }
        });
      } else {
        await API.addMagnet(t.magnet);
        Lampa.Noty.show('Отправлено в TorBox. Ожидайте кеширования.');
      }
    } catch (e) {
      LOG('HandleTorrent Error:', e);
      Lampa.Noty.show(`TorBox: ${e.message}`, { type: 'error' });
    } finally {
      Lampa.Loading.stop();
    }
  }

  async function play(torrentHash, file, movie) {
    Lampa.Loading.start('TorBox: получение ссылки…');
    try {
      const url = await API.dl(torrentHash, file.id);
      if (!url) throw new Error('Не удалось получить ссылку.');
      Lampa.Player.play({ url, title: file.name || movie.title, poster: movie.img });
      Lampa.Player.callback(Lampa.Activity.backward);
    } catch (e) {
      LOG('Play Error:', e);
      Lampa.Noty.show(`TorBox: ${e.message}`, { type: 'error' });
    } finally {
      Lampa.Loading.stop();
    }
  }

  /* ───── Settings ───── */
  const COMP = 'torbox_enh';
  function addSettings() {
    if (!Lampa.SettingsApi) return;
    Lampa.SettingsApi.addComponent({ component: COMP, name: 'TorBox Enhanced', icon: ICON });

    const fields = [
      { k: 'torbox_proxy_url',   n: 'URL вашего CORS-прокси', d: 'Вставьте сюда URL вашего воркера с Cloudflare', t: 'input', def: CFG.proxyUrl },
      { k: 'torbox_api_key',     n: 'Ваш личный API-Key',    d: 'Обязательно. Взять на сайте TorBox.', t: 'input',   def: Store.get('torbox_api_key','') },
      { k: 'torbox_debug',       n: 'Режим отладки',      d: 'Записывать подробную информацию в консоль разработчика (F12)', t: 'trigger', def: CFG.debug      }
    ];
    fields.forEach(p => Lampa.SettingsApi.addParam({
      component: COMP,
      param    : { name: p.k, type: p.t, values: '', default: p.def },
      field    : { name: p.n, description: p.d },
      onChange : v => {
        const value = String(typeof v === 'object' ? v.value : v).trim();
        if (p.k === 'torbox_proxy_url')   CFG.proxyUrl = value;
        if (p.k === 'torbox_api_key')     Store.set(p.k, value);
        if (p.k === 'torbox_debug')       CFG.debug = Boolean(v);
        if (Lampa.Settings) Lampa.Settings.update();
      }
    }));
  }

  /* ───── hook & boot ───── */
  function hook() {
    Lampa.Listener.follow('full', e => {
      if (e.type !== 'complite' || !e.data.movie) return;
      const root = e.object.activity.render();
      if (root.find('.view--torbox').length) return;
      const btn = $(`<div class="full-start__button selector view--torbox" data-subtitle="TorBox">${ICON}<span>TorBox</span></div>`);
      btn.on('hover:enter', () => {
          Lampa.Activity.push({
              component: 'torbox_component',
              title: 'TorBox - ' + e.data.movie.title,
              movie: e.data.movie
          });
      });
      root.find('.view--torrent').after(btn);
    });
  }

  let waited = 0;
  const STEP = 500, MAX = 60000;
  (function bootLoop () {
    if (window.Lampa && window.Lampa.Settings && window.Lampa.Modal) {
      try {
        Lampa.Component.add('torbox_component', TorBoxComponent);
        addSettings();
        hook();
        LOG('TorBox v9.8.1 ready');
      }
      catch (e) { console.error('[TorBox] Boot Error:', e); }
      return;
    }
    if ((waited += STEP) >= MAX) {
      console.warn('[TorBox] Lampa not found, plugin disabled.');
      return;
    }
    setTimeout(bootLoop, STEP);
  })();

})();
