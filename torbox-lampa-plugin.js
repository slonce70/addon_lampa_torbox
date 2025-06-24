/*
 * TorBox Enhanced – Universal Lampa Plugin v3.5.2 (2025-06-27)
 * ============================================================
 * • FIX: Повністю перероблено мережеву логіку для обходу CORS.
 * • FIX: Усі запити (включно з нативним API) тепер йдуть через проксі.
 * • FEATURE: Впроваджено систему ротації CORS-проксі для підвищення надійності.
 * • FEATURE: Покращено діагностику помилок, особливо для невірного API-ключа (401).
 */

(function () {
  'use strict';

  /* ───── Guard double-load ───── */
  const PLUGIN_ID = 'torbox_enhanced_v3_5_2';
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
    set cachedOnly(v){ Store.set('torbox_cached_only',   v ? '1' : '0');    }
  };

  const LOG  = (...a) => CFG.debug && console.log('[TorBox]', ...a);

  /* ───── NEW: Resilient Proxy System ───── */
  const PROXIES = [
    u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    u => `https://thingproxy.freeboard.io/fetch/${u}`,
    u => `https://corsproxy.io/?url=${encodeURIComponent(u)}`
  ];

  let currentProxyIndex = 0;

  async function proxiedFetch(url, options = {}) {
    for (let i = 0; i < PROXIES.length; i++) {
      const proxyIndex = (currentProxyIndex + i) % PROXIES.length;
      const proxy = PROXIES[proxyIndex];
      const proxiedUrl = proxy(url);
      LOG(`Trying fetch via proxy #${proxyIndex}: ${proxiedUrl}`);
      try {
        const response = await fetch(proxiedUrl, options);
        if (!response.ok) {
            if (response.status >= 500 && response.status <= 599) {
                throw new Error(`Proxy returned HTTP ${response.status}`);
            }
            return response;
        }
        currentProxyIndex = proxyIndex;
        return response;
      } catch (e) {
        LOG(`Proxy #${proxyIndex} failed:`, e.message);
      }
    }
    throw new Error('Усі CORS-проксі недоступні.');
  }

  const ok = async r => {
    if (r.status === 401) throw new Error('API-ключ недійсний або відсутній. Перевірте налаштування.');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json().catch(() => ({}));
  };

  const ql = n => {
    if (!n) return '';
    const name = n.toLowerCase();
    if (/(2160|4k|uhd)/.test(name)) return '4K';
    if (/1080/.test(name)) return '1080p';
    if (/720/.test(name)) return '720p';
    return '';
  };

  /* ───── TorBox API wrapper (now with proxies) ───── */
  const API = {
    MAIN: 'https://api.torbox.app/v1/api',

    async search(term) {
      const safe = encodeURIComponent(term).replace(/%3A/ig, ':');
      const qp = 'metadata=true&search_user_engines=true';

      try {
        const res = await proxiedFetch(`https://btm.tools/api/torrents/search/${safe}?${qp}`).then(ok);
        if (res && Array.isArray(res.data?.torrents)) return res.data.torrents;
      } catch (e) { LOG('btm.tools failed:', e.message); }

      try {
        const res = await proxiedFetch(`https://api.sumanjay.cf/torrent/?query=${safe}`).then(ok);
        if (res && Array.isArray(res)) {
            return res.map(t => ({ name: t.name, magnet: t.magnet, seeders: +t.seeders || 0, size: parseFloat(t.size) * 1024 * 1024 * 1024 || 0, cached: false }));
        }
      } catch (e) { LOG('sumanjay.cf failed:', e.message); }

      const key = Store.get('torbox_api_key', '');
      if (key) {
        try {
          const res = await this.main('/torrents/search/' + safe);
          return res.data?.torrents || [];
        } catch (e) {
            LOG('TorBox native search failed:', e.message);
            throw e;
        }
      }

      throw new Error('Усі джерела пошуку недоступні.');
    },

    async main(path, body = {}, method = 'GET') {
      const key = Store.get('torbox_api_key', '');
      if (!key) throw new Error('API-Key для TorBox не вказано.');

      let url = `${this.MAIN}${path}`;
      const opt = { method, headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } };

      if (method === 'GET' && Object.keys(body).length) {
        url += '?' + new URLSearchParams(body).toString();
      } else if (method !== 'GET') {
        opt.headers['Content-Type'] = 'application/json';
        opt.body = JSON.stringify(body);
      }

      const response = await proxiedFetch(url, opt);
      return await ok(response);
    },

    addMagnet(m)  { return this.main('/torrents/createtorrent', { magnet: m }, 'POST'); },
    files(id)     { return this.main('/torrents/mylist', { id }).then(r => r.data?.[0]?.files || []); },
    dl(tid, fid)  { return this.main('/torrents/requestdl', { torrent_id: tid, file_id: fid }).then(r => r.data); }
  };

  /* ───── UI flows ───── */
  async function searchAndShow(movie) {
    Lampa.Loading.start('TorBox: пошук…');
    try {
      const term  = movie?.imdb_id ? `imdb:${movie.imdb_id}` : movie.title;
      const list  = await API.search(term);
      if (!list || !list.length) {
        Lampa.Noty.show('TorBox: нічого не знайдено.');
        return;
      }

      const showList = CFG.cachedOnly ? list.filter(t => t.cached) : list;
      if (!showList.length) {
        Lampa.Noty.show(CFG.cachedOnly ? 'Немає кешованих роздач.' : 'TorBox: нічого не знайдено.');
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
      { k: 'torbox_cached_only', n: 'Тільки кешовані', d: 'Показувати в пошуку тільки торенти, які вже є в кеші TorBox', t: 'trigger', def: CFG.cachedOnly },
      { k: 'torbox_api_key',     n: 'API-Key',    d: 'Ваш ключ TorBox (обов\'язково для завантаження та нативного пошуку)', t: 'input',   def: Store.get('torbox_api_key','') },
      { k: 'torbox_debug',       n: 'Режим налагодження',      d: 'Записувати детальну інформацію в консоль розробника (F12)', t: 'trigger', def: CFG.debug      }
    ];

    fields.forEach(p => Lampa.SettingsApi.addParam({
      component: COMP,
      param    : { name: p.k, type: p.t, values: '', default: p.def },
      field    : { name: p.n, description: p.d },
      onChange : v => {
        const value = typeof v === 'object' ? v.value : v;
        if (p.k === 'torbox_api_key')     Store.set(p.k, String(value).trim());
        if (p.k === 'torbox_cached_only') CFG.cachedOnly = Boolean(value);
        if (p.k === 'torbox_debug')       CFG.debug = Boolean(value);
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

      const btn = $(
        `<div class="full-start__button selector view--torbox" data-subtitle="TorBox">` +
        `${ICON}<span>TorBox</span></div>`
      );
      btn.on('hover:enter', () => searchAndShow(e.data.movie));
      root.find('.view--torrent').after(btn);
    });
  }

  let waited = 0;
  const STEP = 500, MAX = 60000;
  (function bootLoop () {
    if (window.Lampa && window.Lampa.Settings) {
      try { addSettings(); hook(); LOG('TorBox v3.5.2 ready'); }
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
