/*
 * TorBox Enhanced – Universal Lampa Plugin v9.8.1 (2025-06-25)
 * ============================================================
 * • ИСПРАВЛЕНО ОТОБРАЖЕНИЕ: Теперь используется Lampa.Modal для полноценного модального окна
 * • УЛУЧШЕННЫЙ UI: Добавлены иконки, лучшее форматирование и отображение
 * • СТАБИЛЬНОСТЬ: Улучшена обработка ошибок и навигация
 */

(function () {
  'use strict';

  /* ───── Guard double-load ───── */
  const PLUGIN_ID = 'torbox_enhanced_v9_1_1';
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
          line-height: 1.3;
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
        
        // Проверяем формат IMDb ID и добавляем 'tt' префикс если его нет
        let formattedImdbId = imdbId;
        if (!/^tt\d+$/.test(imdbId)) {
            // Если ID содержит только цифры, добавляем префикс 'tt'
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
    var scroll = new Lampa.Scroll({
      mask: true,
      over: true
    });
    var files = new Lampa.Explorer(object);
    var filter = new Lampa.Filter(object);
    var last;
    var items = [];
    var initialized = false;

    // Сохраняем переданные данные
    this.movie = object.movie;
    this.torrents = object.torrents;

    this.initialize = function() {
      var _this = this;
      
      // Настройка фильтра
      filter.onBack = function() {
        _this.back();
      };
      
      if (filter.addButtonBack) filter.addButtonBack();
      
      // Создаем основную структуру
      scroll.body().addClass('torrent-list');
      files.appendFiles(scroll.render());
      files.appendHead(filter.render());
      scroll.minus(files.render().find('.explorer__files-head'));
      
      Lampa.Controller.enable('content');
      initialized = true;
    };

    this.display = function(torrents) {
      var _this = this;
      items = torrents;
      
      if (!torrents || torrents.length === 0) {
        this.empty();
        return;
      }
      
      this.draw(torrents, {
        onEnter: function(item, html) {
          _this.select(item);
        },
        onBack: function() {
          _this.back();
        }
      });
      
      Lampa.Controller.enable('content');
    };

    this.draw = function(torrents, params) {
      var _this = this;
      
      LOG('Drawing torrents:', torrents.length);
      scroll.clear();
      
      if (!torrents || torrents.length === 0) {
        this.empty();
        return;
      }

      torrents.forEach(function(torrent, index) {
        LOG('Processing torrent', index + 1, ':', torrent.title || torrent.raw_title);
        var item = $('<div class="torbox-item selector"></div>');
        
        var title = `${torrent.cached ? '⚡' : '☁️'} ${torrent.raw_title || torrent.title}`;
        var subtitle = `[${ql(torrent.raw_title || torrent.title)}] ${(torrent.size / 2**30).toFixed(2)} GB | 🟢 ${torrent.last_known_seeders || 0}`;
        
        item.html(`
          <div class="torbox-item__title">${title}</div>
          <div class="torbox-item__subtitle">${subtitle}</div>
        `);
        
        item.data('torrent', torrent);
        
        item.on('hover:focus', function() {
          last = item[0];
          scroll.update(item, true);
        }).on('hover:enter', function() {
          if (params.onEnter) params.onEnter(torrent, item);
        });
        
        scroll.append(item);
        LOG('Added item to scroll, total items:', scroll.render().find('.torbox-item').length);
      });
      
      LOG('Finished drawing, enabling controller');
      Lampa.Controller.enable('content');
    };

    this.select = function(torrent) {
      handleTorrent(torrent, this.movie);
    };

    this.empty = function() {
      scroll.clear();
      var empty = $('<div class="empty"><div class="empty__text">Торренты не найдены</div></div>');
      scroll.append(empty);
      Lampa.Controller.enable('content');
    };

    this.loading = function(status) {
      if (status) {
        scroll.clear();
        var loading = $('<div class="broadcast__loading"><div></div><div></div><div></div></div>');
        scroll.append(loading);
        Lampa.Controller.enable('content');
      }
    };

    this.create = function() {
      return this.render();
    };

    this.render = function() {
      return files.render();
    };

    this.back = function() {
      Lampa.Activity.backward();
    };

    this.pause = function() {};
    this.stop = function() {};
    
    this.destroy = function() {
      network.clear();
      files.destroy();
      scroll.destroy();
    };
  }



  /* ───── UI flows (Updated) ───── */
  async function searchAndShow(movie) {
    try {
      const component = new TorBoxComponent({ movie, torrents: [] });
      component.initialize();
      
      Lampa.Activity.push({
        url: '',
        title: 'TorBox - ' + movie.title,
        component: component,
        page: 1
      });
      
      // Показываем загрузку
      component.loading(true);
      
      if (!movie.imdb_id) {
        component.empty();
        component.loading(false);
        Lampa.Noty.show('IMDb ID не найден для фильма: ' + movie.title);
        return;
      }
      
      LOG('Searching torrents for:', movie.title, 'IMDb ID:', movie.imdb_id);
      const torrents = await API.search(movie.imdb_id);
      LOG('Found torrents:', torrents.length);
      if (torrents.length > 0) {
        LOG('First torrent sample:', JSON.stringify(torrents[0], null, 2));
      }
      
      if (!torrents || torrents.length === 0) {
        component.empty();
        component.loading(false);
        Lampa.Noty.show('Торренты не найдены для: ' + movie.title);
        return;
      }
      
      // Отображаем результаты
      component.display(torrents);
      component.loading(false);
    } catch (error) {
      LOG('Search error:', error);
      component.loading(false);
      Lampa.Noty.show('Ошибка поиска торрентов: ' + error.message);
    }
  }

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
          subtitle: `${(f.size/2**30).toFixed(2)} GB | ${ql(f.name)}`,
          file: f
        }));
        
        // Создаем простой выбор файлов через Lampa.Select
        Lampa.Select.show({
          title: 'TorBox - Выбор файла',
          items: fileItems,
          onSelect: function(item) {
            play(t.hash, item.file, movie);
          },
          onBack: function() {
            searchAndShow(movie);
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
      btn.on('hover:enter', () => searchAndShow(e.data.movie));
      root.find('.view--torrent').after(btn);
    });
  }

  let waited = 0;
  const STEP = 500, MAX = 60000;
  (function bootLoop () {
    if (window.Lampa && window.Lampa.Settings && window.Lampa.Modal) {
      try { addSettings(); hook(); LOG('TorBox v9.6.2 ready'); }
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
