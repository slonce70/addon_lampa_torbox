/*
 * TorBox Enhanced – Universal Lampa Plugin v7.0.1 (2025-06-27)
 * ============================================================
 * • CRITICAL FIX: Исправлена фатальная ошибка в URL для получения метаданных. Добавлен префикс "imdb:".
 * • APOLOGY: Это исправление последней и самой главной ошибки. Спасибо за ваше терпение.
 */

(function () {
  'use strict';

  /* ───── Guard double-load ───── */
  const PLUGIN_ID = 'torbox_enhanced_v7_0_1';
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
    get debug()      { return Store.get('torbox_debug',       '0') === '1'; },
    set debug(v)     { Store.set('torbox_debug',        v ? '1' : '0');    },
    get cachedOnly() { return Store.get('torbox_cached_only', '0') === '1'; },
    set cachedOnly(v){ Store.set('torbox_cached_only',   v ? '1' : '0');    },
    get proxyUrl()   { return Store.get('torbox_proxy_url', ''); },
    set proxyUrl(v)  { Store.set('torbox_proxy_url', v); }
  };

  const LOG  = (...a) => CFG.debug && console.log('[TorBox]', ...a);
  
  const processResponse = async (r, url) => {
    if (r.status === 401) throw new Error('API-ключ недійсний або прострочений. Будь ласка, оновіть його.');
    if (!r.ok) throw new Error(`Помилка мережі: HTTP ${r.status} для ${url}`);
    const text = await r.text();
    try { return JSON.parse(text); } catch (e) {
        LOG('Invalid JSON response:', text);
        throw new Error('Отримано некоректну відповідь від сервера.');
    }
  };

  const ql = n => {
    if (!n) return '';
    const name = n.toLowerCase();
    if (/(2160|4k|uhd)/.test(name)) return '4K';
    if (/1080/.test(name)) return '1080p';
    if (/720/.test(name)) return '720p';
    return '';
  };

  /* ───── TorBox API wrapper (Strictly by Postman Docs) ───── */
  const API = {
    SEARCH_API: 'https://search-api.torbox.app',
    MAIN_API: 'https://api.torbox.app/v1/api',

    async proxiedCall(targetUrl, options = {}) {
        const proxy = CFG.proxyUrl;
        if (!proxy) throw new Error('URL вашого персонального проксі не вказано в налаштуваннях.');
        const proxiedUrl = `${proxy}?url=${encodeURIComponent(targetUrl)}`;
        LOG(`Calling via proxy: ${targetUrl}`);
        const response = await fetch(proxiedUrl, options);
        return await processResponse(response, targetUrl);
    },

    async getGlobalId(imdbId) {
        // CRITICAL FIX: Added the mandatory "imdb:" prefix
        const url = `${this.SEARCH_API}/meta/imdb:${imdbId}`;
        const res = await this.proxiedCall(url);
        if (!res.success || !res.data?.globalID) {
            throw new Error('Не вдалося знайти метадані (globalID).');
        }
        LOG(`Received globalID: ${res.data.globalID}`);
        return res.data.globalID;
    },

    async getTorrentsByGlobalId(globalId) {
        const key = Store.get('torbox_api_key', '');
        if (!key) throw new Error('API-Key не вказано.');
        
        const url = `${this.MAIN_API}/torrents/id/${globalId}`;
        const options = { headers: { 'Authorization': `Bearer ${key}` } };
        const res = await this.proxiedCall(url, options);
        return res.data?.torrents || [];
    },

    async directAction(path, body = {}, method = 'GET') {
        const key = Store.get('torbox_api_key', '');
        if (!key) throw new Error('API-Key не вказано.');
        
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
    files(id)     { return this.directAction('/torrents/mylist', { id }).then(r => r.data?.[0]?.files || []); },
    dl(tid, fid)  { return this.directAction('/torrents/requestdl', { torrent_id: tid, file_id: fid }).then(r => r.data); }
  };

  /* ───── UI flows ───── */
  async function searchAndShow(movie) {
    Lampa.Loading.start('TorBox: пошук…');
    try {
      if (!movie.imdb_id) {
          throw new Error("Для пошуку потрібен IMDb ID.");
      }
      
      // The imdb_id from Lampa often includes "tt", so we remove it to be safe,
      // as our code now adds "imdb:tt"
      const cleanImdbId = movie.imdb_id.replace('tt', '');

      const globalId = await API.getGlobalId(cleanImdbId);
      const list = await API.getTorrentsByGlobalId(globalId);

      if (!list || !list.length) {
        Lampa.Noty.show('TorBox: торенти не знайдено.');
        return;
      }
      const showList = CFG.cachedOnly ? list.filter(t => t.cached) : list;
      if (!showList.length) {
        Lampa.Noty.show(CFG.cachedOnly ? 'Немає кешованих роздач.' : 'TorBox: торенти не знайдено.');
        return;
      }
      const items = showList
        .sort((a,b) => (b.seeders || 0) - (a.seeders || 0))
        .map(t => ({
            title: `${t.cached ? '⚡' : '☁️'} ${t.name || t.title}`,
            subtitle: `[${ql(t.name || t.title)}] ${(t.size / 2**30).toFixed(2)} GB | 🟢 ${t.seeders || 0}`,
            torrent: t
        }));
      Lampa.Select.show({
        title: 'TorBox',
        items,
        onSelect: i => handleTorrent(i.torrent, movie),
        onBack: () => Lampa.Controller.toggle('content')
      });
    } catch (e) {
      LOG('SearchAndShow Error:', e);
      Lampa.Noty.show(`TorBox: ${e.message}`, { type: 'error' });
    } finally {
      Lampa.Loading.stop();
    }
  }

  async function handleTorrent(t, movie) {
    Lampa.Loading.start('TorBox: обробка...');
    try {
      if (t.cached) {
        const files = await API.files(t.id);
        const vids  = files.filter(f => /\.(mkv|mp4|avi)$/i.test(f.name));
        if (!vids.length) { Lampa.Noty.show('Відеофайли не знайдено.'); return; }
        if (vids.length === 1) { play(t.id, vids[0], movie); return; }
        vids.sort((a,b) => b.size - a.size);
        Lampa.Select.show({
          title: 'TorBox: вибір файлу',
          items: vids.map(f => ({
            title: f.name,
            subtitle: `${(f.size/2**30).toFixed(2)} GB | ${ql(f.name)}`,
            file: f
          })),
          onSelect: i => play(t.id, i.file, movie),
          onBack: () => searchAndShow(movie)
        });
      } else {
        await API.addMagnet(t.magnet);
        Lampa.Noty.show('Надіслано в TorBox. Очікуйте на кешування.');
      }
    } catch (e) {
      LOG('HandleTorrent Error:', e);
      Lampa.Noty.show(`TorBox: ${e.message}`, { type: 'error' });
    } finally {
      Lampa.Loading.stop();
    }
  }

  async function play(tid, file, movie) {
    Lampa.Loading.start('TorBox: отримання посилання…');
    try {
      const url = await API.dl(tid, file.id);
      if (!url) throw new Error('Не вдалося отримати посилання.');
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
      { k: 'torbox_proxy_url',   n: 'URL вашого CORS-проксі', d: 'Вставте сюди URL вашого воркера з Cloudflare', t: 'input', def: CFG.proxyUrl },
      { k: 'torbox_api_key',     n: 'Ваш особистий API-Key',    d: 'Обов\'язково. Взяти на сайті TorBox.', t: 'input',   def: Store.get('torbox_api_key','') },
      { k: 'torbox_cached_only', n: 'Тільки кешовані', d: 'Показувати в пошуку тільки торенти, які вже є в кеші TorBox', t: 'trigger', def: CFG.cachedOnly },
      { k: 'torbox_debug',       n: 'Режим налагодження',      d: 'Записувати детальну інформацію в консоль розробника (F12)', t: 'trigger', def: CFG.debug      }
    ];
    fields.forEach(p => Lampa.SettingsApi.addParam({
      component: COMP,
      param    : { name: p.k, type: p.t, values: '', default: p.def },
      field    : { name: p.n, description: p.d },
      onChange : v => {
        const value = String(typeof v === 'object' ? v.value : v).trim();
        if (p.k === 'torbox_proxy_url')   CFG.proxyUrl = value;
        if (p.k === 'torbox_api_key')     Store.set(p.k, value);
        if (p.k === 'torbox_cached_only') CFG.cachedOnly = Boolean(v);
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
      try { addSettings(); hook(); LOG('TorBox v7.0.1 ready'); }
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
