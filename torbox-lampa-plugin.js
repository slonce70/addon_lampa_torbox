/*
 * TorBox Enhanced – Universal Lampa Plugin v9.2.1 (2025-06-26)
 * ============================================================
 * • ВИПРАВЛЕННЯ: Усунуто синтаксичну помилку 'missing ) after argument list' при завантаженні плагіна.
 * • НОВИЙ ІНТЕРФЕЙС: Список торрентів тепер відображається в окремому повноцінному вікні (Activity).
 * • ИСПРАВЛЕННЫЙ ПОИСК: Запросы теперь идут на правильный URL 'search-api.torbox.app/torrents/imdb:...'.
 * • ОБНОВЛЕННАЯ ЛОГИКА: Код адаптирован для обработки новой структуры ответа от API.
 */

(function () {
  'use strict';

  /* ───── Guard double-load ───── */
  const PLUGIN_ID = 'torbox_enhanced_v9_2_1'; // Версія оновлена
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

  /* ───── TorBox API wrapper (Corrected Logic) ───── */
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

  /* НОВИЙ КОМПОНЕНТ: Створює окреме вікно для списку торрентів */
  function TorBoxResultsComponent(torrents, movie) {
    const component = new Lampa.Component.create({
        name: 'torbox_results_component',
        template: `<div class="lampa-list"></div>`,
        
        onSelect: (item) => {
            handleTorrent(item.torrent, movie);
        },
        onBack: () => {
            Lampa.Activity.backward();
        }
    });

    const scroll = new Lampa.Scroll({
        horizontal: false,
        onWheel: Lampa.Controller.enabled().wheel
    });

    const items = torrents
        .sort((a, b) => (b.last_known_seeders || 0) - (a.last_known_seeders || 0))
        .map(t => ({
            title: `${t.cached ? '⚡' : '☁️'} ${t.raw_title || t.title}`,
            subtitle: `[${ql(t.raw_title || t.title)}] ${(t.size / 2**30).toFixed(2)} GB | 🟢 ${t.last_known_seeders || 0}`,
            torrent: t
        }));

    component.build = function() {
        items.forEach(itemData => {
            const card = Lampa.Template.get('list_item', {});
            card.find('.list-item__title').text(itemData.title);
            card.find('.list-item__subtitle').text(itemData.subtitle);
            card.data('torrent', itemData.torrent);
            card.on('hover:enter', () => {
                this.onSelect(itemData);
            });
            scroll.append(card);
            this.render().find('.lampa-list').append(scroll.render());
        });
    };
    
    component.start = function() {
        Lampa.Controller.add('content', {
            toggle: () => {
                Lampa.Controller.collectionSet(this.render());
                Lampa.Controller.collectionFocus(false, this.render());
            },
            update: () => {},
            left: () => Lampa.Controller.toggle('menu'),
            right: () => Lampa.Controller.toggle('right'),
            up: () => scroll.move('up'),
            down: () => scroll.move('down'),
            back: this.onBack
        });
        Lampa.Controller.toggle('content');
    };

    component.destroy = function() {
        scroll.destroy();
        this.render().remove();
    };
    
    return component;
  }

  /* НОВИЙ МЕТОД: Запускає Activity з нашим компонентом */
  function showResultsInNewWindow(list, movie) {
      const resultsComponent = TorBoxResultsComponent(list, movie);
      resultsComponent.build();

      Lampa.Activity.push({
          title: 'TorBox',
          component: resultsComponent,
          activity: resultsComponent,
          right: Lampa.Template.get('empty'),
          left: Lampa.Template.get('empty')
      });
  }

  /* ЗМІНЕНО: searchAndShow тепер запускає нове вікно, а не Lampa.Select */
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
      
      showResultsInNewWindow(list, movie);

    } catch (e) {
      LOG('SearchAndShow Error:', e);
      Lampa.Noty.show(`TorBox: ${e.message}`, { type: 'error' });
    } finally {
      Lampa.Loading.stop();
    }
  }

  /* Ця функція залишається без змін, але тепер викликається з нового компонента */
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
          // /* ВИПРАВЛЕНО */ Додано 'async' перед функцією-стрілкою
          onBack: async () => showResultsInNewWindow(await API.search(movie.imdb_id), movie)
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

  /* Ця функція залишається без змін */
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
      try { addSettings(); hook(); LOG('TorBox v9.2.1 ready'); } // Версія оновлена
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
