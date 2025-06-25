/*
 * TorBox Enhanced – Universal Lampa Plugin v9.4.0 (2025-06-26)
 * ============================================================
 * • ПОВНА ПЕРЕРОБКА АРХІТЕКТУРИ: Код переписано з нуля за зразком найкращих практик (bwa.js). Створено єдиний самодостатній компонент, що керує своїм життєвим циклом.
 * • ПРАВИЛЬНИЙ UX ЗАВАНТАЖЕННЯ: Інтерфейс реагує миттєво. Перехід на новий екран відбувається відразу, а завантаження та обробка помилок — вже всередині нього.
 * • ВИПРАВЛЕНО API-ЗАПИТ: Параметр 'search_user_engines' тепер завжди встановлено в 'false' згідно з вашими вимогами.
 * • СТАБІЛЬНІСТЬ ТА НАДІЙНІСТЬ: Нова структура усуває попередні помилки та робить плагін значно надійнішим.
 */

(function () {
  'use strict';

  /* ───── Guard double-load ───── */
  const PLUGIN_ID = 'torbox_enhanced_v9_4_0';
  if (window[PLUGIN_ID]) return;
  window[PLUGIN_ID] = true;

  /* ───── Templates ───── */
  function addTemplates() {
    const style = `
      <style>
        .torbox-component .empty {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          color: rgba(255,255,255,0.5);
          font-size: 1.3em;
        }
        .torbox-list .list-item {
          padding: 1em 1.5em;
        }
      </style>
    `;
    $('body').append(style);
  }


  /* ───── Helpers ───── */
  const ICON =
    `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 7L12 2L21 7V17L12 22L3 17V7Z" stroke="currentColor" stroke-width="2"/><path d="M12 22V12" stroke="currentColor" stroke-width="2"/><path d="M21 7L12 12L3 7" stroke="currentColor" stroke-width="2"/></svg>`;

  const Store = {
    get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, String(v)); } catch {} }
  };

  const CFG = {
    get debug()      { return Store.get('torbox_debug', '0') === '1'; },
    set debug(v)     { Store.set('torbox_debug', v ? '1' : '0');    },
    get proxyUrl()   { return Store.get('torbox_proxy_url', ''); },
    set proxyUrl(v)  { Store.set('torbox_proxy_url', v); }
  };

  const LOG  = (...a) => CFG.debug && console.log('[TorBox]', ...a);
  
  const processResponse = async (r) => {
    const responseText = await r.text();
    if (r.status === 401) throw new Error(`Ошибка авторизации (401). Проверьте ваш API-ключ.`);
    if (responseText.includes("NO_AUTH")) throw new Error('Ошибка авторизации (NO_AUTH). Проверьте API-ключ и ваш тарифный план TorBox.');
    if (!r.ok) throw new Error(`Ошибка сети: HTTP ${r.status}`);
    
    try { 
        const json = JSON.parse(responseText);
        if (json.success === false) throw new Error(json.message || 'API вернул ошибку.');
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
        return await processResponse(response);
    },

    async search(imdbId) {
        const key = Store.get('torbox_api_key', '');
        if (!key) throw new Error('API-Key не указан.');
        // ВИПРАВЛЕНО: search_user_engines=false
        const url = `${this.SEARCH_API}/torrents/imdb:${imdbId}?check_cache=true&check_owned=false&search_user_engines=false`;
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

  /* НОВА АРХІТЕКТУРА: Єдиний компонент, що керує всім */
  function TorBoxComponent(movie) {
    let network = new Lampa.Network();
    let scroll = new Lampa.Scroll({ horizontal: false });
    let last_focused;
    
    // Основний контейнер компонента
    let component = $(`<div class="torbox-component"></div>`);
    let list = $(`<div class="torbox-list"></div>`);
    scroll.render().addClass('lampa-list');
    list.append(scroll.render());
    component.append(list);

    // Метод для відображення помилки або порожнього результату
    this.showError = (message) => {
        scroll.clear();
        let empty = $(`<div class="empty">${message}</div>`);
        component.empty().append(empty);
        Lampa.Controller.enable('content');
    };

    // Метод для побудови списку з отриманих даних
    this.draw = (torrents) => {
        if (!torrents.length) {
            this.showError('TorBox: торренты не найдены.');
            return;
        }

        const items = torrents
            .sort((a, b) => (b.last_known_seeders || 0) - (a.last_known_seeders || 0))
            .map(t => ({
                title: `${t.cached ? '⚡' : '☁️'} ${t.raw_title || t.title}`,
                subtitle: `[${ql(t.raw_title || t.title)}] ${(t.size / 2**30).toFixed(2)} GB | 🟢 ${t.last_known_seeders || 0}`,
                torrent: t
            }));
        
        scroll.clear();

        items.forEach(itemData => {
            const card = Lampa.Template.get('list_item', {});
            card.find('.list-item__title').text(itemData.title);
            card.find('.list-item__subtitle').text(itemData.subtitle);
            card.on('hover:enter', () => handleTorrent(itemData.torrent, movie));
            card.on('hover:focus', (e) => {
                last_focused = e.target;
                scroll.update($(e.target), true);
            });
            scroll.append(card);
        });
        
        Lampa.Controller.enable('content');
    };
    
    // Метод, що викликається при запуску Activity
    this.start = () => {
        Lampa.Controller.add('content', {
            toggle: () => {
                Lampa.Controller.collectionSet(component);
                Lampa.Controller.collectionFocus(last_focused, component);
            },
            up: () => scroll.move('up'),
            down: () => scroll.move('down'),
            back: () => {
                network.clear();
                Lampa.Activity.backward();
            }
        });
        Lampa.Controller.toggle('content');
        this.load(); // Запускаємо завантаження
    };

    // Метод для завантаження даних
    this.load = async () => {
        Lampa.Loading.start();
        try {
            if (!movie.imdb_id) throw new Error("Для поиска нужен IMDb ID.");
            const list = await API.search(movie.imdb_id);
            this.draw(list);
        } catch (e) {
            LOG('TorBoxComponent Error:', e);
            this.showError(`TorBox: ${e.message}`);
        } finally {
            Lampa.Loading.stop();
        }
    };

    this.render = () => component;

    this.destroy = () => {
        network.clear();
        scroll.destroy();
        component.remove();
    };
  }

  /* Функція тепер просто створює і запускає Activity */
  function searchAndShow(movie) {
      const component = new TorBoxComponent(movie);

      Lampa.Activity.push({
          title: 'TorBox',
          component: 'torbox_activity', // Унікальне ім'я для компонента
          activity: component, // Передаємо наш об'єкт як контролер активності
      });
  }

  /* Ця функція залишається майже без змін */
  async function handleTorrent(t, movie) {
    Lampa.Loading.start('TorBox: обработка...');
    try {
      if (t.cached) {
        const files = await API.files(t.hash);
        const vids  = files.filter(f => /\.(mkv|mp4|avi)$/i.test(f.name));
        
        if (!vids.length) { Lampa.Noty.show('Видеофайлы не найдены.'); return; }
        
        if (vids.length === 1) { play(t.hash, vids[0], movie); return; }
        
        vids.sort((a,b) => b.size - a.size);
        Lampa.Select.show({
          title: 'TorBox: выбор файла',
          items: vids.map(f => ({
            title: f.name,
            subtitle: `${(f.size/2**30).toFixed(2)} GB | ${ql(f.name)}`,
            file: f
          })),
          onSelect: i => play(t.hash, i.file, movie),
          onBack: () => Lampa.Controller.toggle('content')
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
    if (window.Lampa && window.Lampa.Settings) {
      try { addTemplates(); addSettings(); hook(); LOG('TorBox v9.4.0 ready'); }
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
