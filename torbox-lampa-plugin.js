/*
 * TorBox Enhanced – Universal Lampa Plugin v9.1.3 (2025-06-25)
 * ============================================================
 * • ИСПРАВЛЕНО ОТОБРАЖЕНИЕ: Теперь используется Lampa.Activity для полноэкранного окна
 * • ПОЛНОЭКРАННЫЙ ИНТЕРФЕЙС: Окно занимает весь экран как стандартные разделы Lampa
 * • СТАБИЛЬНОСТЬ: Улучшена обработка ошибок и навигация
 */

(function () {
  'use strict';

  /* ───── Guard double-load ───── */
  const PLUGIN_ID = 'torbox_enhanced_v9_1_2';
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

  const ql = n => {
    if (!n) return '';
    const name = n.toLowerCase();
    if (/(2160|4k|uhd)/.test(name)) return '4K';
    if (/1080/.test(name)) return '1080p';
    if (/720/.test(name)) return '720p';
    return 'SD';
  };

  /* ───── TorBox API wrapper ───── */
  const API = {
    SEARCH_API: 'https://search-api.torbox.app',
    MAIN_API: 'https://api.torbox.app/v1/api',

    async proxiedCall(targetUrl, options = {}) {
        const proxy = CFG.proxyUrl;
        if (!proxy) throw new Error('URL вашего персонального прокси не указано в настройках.');
        const proxiedUrl = `${proxy}?url=${encodeURIComponent(targetUrl)}`;
        LOG(`Calling via proxy: ${targetUrl}`);
        const response = await fetch(proxiedUrl, options);
        return await processResponse(response, targetUrl);
    },

    async search(imdbId) {
        const key = Store.get('torbox_api_key', '');
        if (!key) throw new Error('API-Key не указан.');
        
        const url = `${this.SEARCH_API}/torrents/imdb:${imdbId}?check_cache=true&check_owned=false&search_user_engines=true`;
        
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

  /* ───── Full Screen Activity Creation ───── */
  class TorBoxActivity {
    constructor() {
      this.active = false;
      this.currentItems = [];
      this.currentIndex = 0;
      this.onSelectCallback = null;
      this.onBackCallback = null;
    }

    create(title, items, onSelect, onBack) {
      this.currentItems = items;
      this.onSelectCallback = onSelect;
      this.onBackCallback = onBack;
      this.currentIndex = 0;

      // Создание полноэкранного HTML
      const html = $(`
        <div class="torbox-activity">
          <div class="torbox-activity__head">
            <div class="torbox-activity__title">
              <div class="torbox-activity__icon">${ICON}</div>
              <div class="torbox-activity__name">${title}</div>
            </div>
            <div class="torbox-activity__controls">
              <div class="torbox-activity__control">
                <div class="torbox-activity__control-name">Escape</div>
                <div class="torbox-activity__control-descr">Назад</div>
              </div>
              <div class="torbox-activity__control">
                <div class="torbox-activity__control-name">Enter</div>
                <div class="torbox-activity__control-descr">Выбрать</div>
              </div>
            </div>
          </div>
          <div class="torbox-activity__body">
            <div class="torbox-activity__scroll">
              <div class="torbox-activity__list">
                ${items.map((item, index) => `
                  <div class="torbox-activity__item selector" data-index="${index}">
                    <div class="torbox-activity__item-inner">
                      <div class="torbox-activity__item-title">${item.title}</div>
                      <div class="torbox-activity__item-subtitle">${item.subtitle}</div>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
        </div>
      `);

      // Добавляем стили если их нет
      if (!$('#torbox-activity-styles').length) {
        $('head').append(`
          <style id="torbox-activity-styles">
            .torbox-activity {
              position: fixed;
              top: 0;
              left: 0;
              width: 100%;
              height: 100%;
              background: var(--color-background);
              z-index: 1000;
              display: flex;
              flex-direction: column;
            }
            .torbox-activity__head {
              display: flex;
              justify-content: space-between;
              align-items: center;
              padding: 1.5em;
              border-bottom: 1px solid var(--color-border);
              background: var(--color-background-light);
            }
            .torbox-activity__title {
              display: flex;
              align-items: center;
              gap: 1em;
            }
            .torbox-activity__icon svg {
              width: 2em;
              height: 2em;
              color: var(--color-primary);
            }
            .torbox-activity__name {
              font-size: 1.8em;
              font-weight: 600;
              color: var(--color-text);
            }
            .torbox-activity__controls {
              display: flex;
              gap: 2em;
            }
            .torbox-activity__control {
              text-align: center;
            }
            .torbox-activity__control-name {
              font-weight: 600;
              color: var(--color-primary);
              margin-bottom: 0.3em;
            }
            .torbox-activity__control-descr {
              font-size: 0.9em;
              opacity: 0.7;
            }
            .torbox-activity__body {
              flex: 1;
              overflow: hidden;
              padding: 1.5em;
            }
            .torbox-activity__scroll {
              height: 100%;
              overflow-y: auto;
            }
            .torbox-activity__list {
              display: flex;
              flex-direction: column;
              gap: 1em;
            }
            .torbox-activity__item {
              padding: 1.5em;
              border-radius: 0.8em;
              background: var(--color-background-light);
              border: 2px solid transparent;
              cursor: pointer;
              transition: all 0.3s ease;
            }
            .torbox-activity__item:hover,
            .torbox-activity__item.focus {
              background: var(--color-primary);
              color: var(--color-background);
              border-color: var(--color-primary);
              transform: scale(1.02);
            }
            .torbox-activity__item-inner {
              display: flex;
              flex-direction: column;
              gap: 0.5em;
            }
            .torbox-activity__item-title {
              font-size: 1.2em;
              font-weight: 600;
              line-height: 1.3;
            }
            .torbox-activity__item-subtitle {
              font-size: 1em;
              opacity: 0.8;
              line-height: 1.4;
            }
          </style>
        `);
      }

      // Создаем Activity
      const activity = {
        html: html,
        active: true,
        activity: this,
        onKeyDown: (e) => this.keyDown(e),
        onDestroy: () => this.destroy(),
        render: () => html
      };

      // Показываем через Activity
      Lampa.Activity.push(activity);
      this.active = true;
      this.bindEvents();
      this.setFocus(0);

      return activity;
    }

    keyDown(e) {
      if (!this.active) return;
      
      switch (e.code || e.keyCode) {
        case 'ArrowUp':
        case 38:
          e.preventDefault();
          this.moveFocus(-1);
          break;
        case 'ArrowDown':
        case 40:
          e.preventDefault();
          this.moveFocus(1);
          break;
        case 'Enter':
        case 13:
          e.preventDefault();
          this.select();
          break;
        case 'Escape':
        case 27:
          e.preventDefault();
          this.back();
          break;
      }
    }

    bindEvents() {
      const items = $('.torbox-activity__item');
      items.on('click', (e) => {
        const index = parseInt($(e.currentTarget).data('index'));
        this.currentIndex = index;
        this.select();
      });
      
      items.on('hover', (e) => {
        const index = parseInt($(e.currentTarget).data('index'));
        this.setFocus(index);
      });
    }

    setFocus(index) {
      if (index < 0 || index >= this.currentItems.length) return;
      
      this.currentIndex = index;
      $('.torbox-activity__item').removeClass('focus');
      const currentItem = $(`.torbox-activity__item[data-index="${index}"]`);
      currentItem.addClass('focus');
      
      // Прокрутка к элементу
      const container = $('.torbox-activity__scroll');
      if (container.length && currentItem.length) {
        const scrollTop = container.scrollTop();
        const itemTop = currentItem.position().top;
        const containerHeight = container.height();
        const itemHeight = currentItem.outerHeight();
        
        if (itemTop < 0) {
          container.scrollTop(scrollTop + itemTop - 50);
        } else if (itemTop + itemHeight > containerHeight) {
          container.scrollTop(scrollTop + itemTop - containerHeight + itemHeight + 50);
        }
      }
    }

    moveFocus(direction) {
      let newIndex = this.currentIndex + direction;
      if (newIndex < 0) newIndex = this.currentItems.length - 1;
      if (newIndex >= this.currentItems.length) newIndex = 0;
      this.setFocus(newIndex);
    }

    select() {
      if (this.onSelectCallback && this.currentItems[this.currentIndex]) {
        this.onSelectCallback(this.currentItems[this.currentIndex]);
      }
    }

    back() {
      Lampa.Activity.backward();
      if (this.onBackCallback) {
        this.onBackCallback();
      }
    }

    destroy() {
      this.active = false;
      this.currentItems = [];
      this.onSelectCallback = null;
      this.onBackCallback = null;
    }
  }

  /* ───── UI flows (Updated) ───── */
  async function searchAndShow(movie) {
    Lampa.Loading.start('TorBox: поиск…');
    try {
      if (!movie.imdb_id) {
          throw new Error("Для поиска нужен IMDb ID.");
      }
      
      const list = await API.search(movie.imdb_id);

      if (!list || !list.length) {
        Lampa.Noty.show('TorBox: торренты не найдены.');
        return;
      }
      
      const items = list
        .sort((a,b) => (b.last_known_seeders || 0) - (a.last_known_seeders || 0))
        .map(t => ({
            title: `${t.cached ? '⚡' : '☁️'} ${t.raw_title || t.title}`,
            subtitle: `[${ql(t.raw_title || t.title)}] ${(t.size / 2**30).toFixed(2)} GB | 🟢 ${t.last_known_seeders || 0}`,
            torrent: t
        }));

      const activity = new TorBoxActivity();
      activity.create(
        `TorBox - ${movie.title}`,
        items,
        (item) => handleTorrent(item.torrent, movie),
        () => Lampa.Controller.toggle('content')
      );
    } catch (e) {
      LOG('SearchAndShow Error:', e);
      Lampa.Noty.show(`TorBox: ${e.message}`, { type: 'error' });
    } finally {
      Lampa.Loading.stop();
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
        
        const activity = new TorBoxActivity();
        activity.create(
          'TorBox - Выбор файла',
          fileItems,
          (item) => play(t.hash, item.file, movie),
          () => searchAndShow(movie)
        );
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
    if (window.Lampa && window.Lampa.Settings && window.Lampa.Activity) {
      try { addSettings(); hook(); LOG('TorBox v9.1.2 ready'); }
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
