/*
 * TorBox Enhanced – Universal Lampa Plugin v3.5.0 (2025-06-26)
 * ============================================================
 * • Пошук: btm.tools (cors → thingproxy) → api.sumanjay.cf → TorBox native.
 * • Флаги «Тільки кеш» / Debug зберігаються як "1" / "0".
 * • Стабільний fallback — помилки 530 / 525 більше не ламають плагін.
 */

(function () {
  'use strict';

  /* ───── Guard double-load ───── */
  const PLUGIN_ID = 'torbox_enhanced_v3_5_0';
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
  const CORS =  u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`;
  const CORS2 = u => `https://allorigins.hexlet.app/raw?url=${encodeURIComponent(u)}`;
  const ok   = async r => { if (!r.ok) throw new Error(r.status); return r.json(); };
  const ql   = n => {
    n = n.toLowerCase();
    if (/(2160|4k)/.test(n)) return '4K';
    if (/1080/.test(n))      return '1080p';
    if (/720/.test(n))       return '720p';
    return '';
  };

  /* ───── TorBox API wrapper ───── */
  const API = {
    MAIN: 'https://api.torbox.app/v1/api',

    async search(term) {
      const safe = encodeURIComponent(term).replace(/%3A/ig, ':');
      const qp   = 'metadata=true&search_user_engines=true';
      const timeout = 10000; // 10 секунд timeout

      const fetchWithTimeout = async (url, options = {}) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        try {
          const response = await fetch(url, { 
            ...options, 
            signal: controller.signal 
          });
          clearTimeout(timeoutId);
          return response;
        } catch (error) {
          clearTimeout(timeoutId);
          if (error.name === 'AbortError') {
            throw new Error('Запит перевищив час очікування');
          }
          throw error;
        }
      };

      /* 1️⃣ Вбудований пошук TorBox (найкращий варіант) */
      const key = Store.get('torbox_api_key', '');
      if (key) {
        try {
          const r = await fetchWithTimeout(`${this.MAIN}/torrents/search/${safe}`, {
             headers: { 
               'Authorization': `Bearer ${key}`, 
               'Accept': 'application/json',
               'User-Agent': 'Lampa/TorBox-Plugin'
             }
           });
          const result = await ok(r);
          if (result.data && result.data.length > 0) {
            return {
              torrents: result.data.map(t => ({
                ...t,
                cached: t.cached || false,
                torbox_id: t.id // Зберігаємо TorBox ID
              }))
            };
          }
        } catch (e) { LOG('TorBox native', e); }
      }

      /* 2️⃣ btm.tools → allorigins */
      try { 
        const result = await ok(await fetchWithTimeout(CORS(`https://btm.tools/api/torrents/search/${safe}?${qp}`))); 
        if (result.torrents && result.torrents.length > 0) return result;
      }
      catch (e) { LOG('btm allorigins', e); }

      /* 3️⃣ btm.tools → hexlet */
      try { 
        const result = await ok(await fetchWithTimeout(CORS2(`https://btm.tools/api/torrents/search/${safe}?${qp}`))); 
        if (result.torrents && result.torrents.length > 0) return result;
      }
      catch (e) { LOG('btm hexlet', e); }

      /* 4️⃣ api.sumanjay.cf (публічний) */
      try {
        const res = await ok(await fetchWithTimeout(CORS(`https://api.sumanjay.cf/torrent/?query=${safe}`)));
        if (res && res.length > 0) {
          return {
            torrents: res.map(t => ({
              name   : t.name,
              magnet : t.magnet,
              seeders: +t.seeders || 0,
              size   : parseFloat(t.size) * 1024 * 1024 * 1024 || 0,
              cached : false
            }))
          };
        }
      } catch (e) { LOG('sumanjay', e); }

      throw new Error('TorBox: усі джерела пошуку недоступні');
    },

    async main(path, body = {}, method = 'GET') {
      const key = Store.get('torbox_api_key', '');
      if (!key) throw new Error('TorBox: API-Key не вказано');

      let url = `${this.MAIN}${path}`;
      const opt = { 
        method, 
        headers: { 
          'Authorization': `Bearer ${key}`, 
          'Accept': 'application/json',
          'User-Agent': 'Lampa/TorBox-Plugin'
        },
        timeout: 15000
      };

      if (method === 'GET' && Object.keys(body).length)
        url += '?' + new URLSearchParams(body).toString();
      else if (method !== 'GET') {
        opt.headers['Content-Type'] = 'application/json';
        opt.body = JSON.stringify(body);
      }

      try {
        const r = await fetch(url, opt);
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          const errorMsg = j.error || j.message || j.detail || `HTTP ${r.status}`;
          LOG(`API Error ${r.status}:`, errorMsg);
          throw new Error(errorMsg);
        }
        return j;
      } catch (error) {
        if (error.name === 'AbortError') {
          throw new Error('Запит перевищив час очікування');
        }
        throw error;
      }
    },

    addMagnet(m)  { return this.main('/torrents/createtorrent', { magnet: m }, 'POST'); },
    files(id)     { 
      return this.main('/torrents/mylist', { id }).then(r => {
        const torrent = r.data?.[0];
        if (!torrent) throw new Error('Торрент не знайдено');
        if (!torrent.files || !Array.isArray(torrent.files)) {
          throw new Error('Файли торрента недоступні');
        }
        return torrent.files;
      }); 
    },
    dl(tid, fid)  { return this.main('/torrents/requestdl', { torrent_id: tid, file_id: fid }).then(r => r.data); }
  };

  /* ───── UI flows ───── */
  async function searchAndShow(movie) {
    Lampa.Loading.start('TorBox: пошук…');
    try {
      // Формуємо пошуковий запит
      let term = movie?.title || '';
      if (movie?.imdb_id) {
        term = `imdb:${movie.imdb_id}`;
      } else if (movie?.original_title && movie.original_title !== movie.title) {
        term = movie.original_title;
      }
      
      if (!term.trim()) {
        Lampa.Noty.show('Не вдалося визначити назву для пошуку', { type: 'error' });
        return;
      }

      LOG('Searching for:', term);
      const res = await API.search(term);
      const list = res.data?.torrents || res.torrents || res || [];
      
      if (!Array.isArray(list) || !list.length) { 
        Lampa.Noty.show('TorBox: нічого не знайдено'); 
        return; 
      }

      LOG(`Found ${list.length} torrents`);
      
      // Фільтруємо за налаштуваннями
      const show = CFG.cachedOnly ? list.filter(t => t.cached) : list;
      if (!show.length) { 
        const msg = CFG.cachedOnly ? 'Немає кешованих торрентів' : 'Немає доступних торрентів';
        Lampa.Noty.show(msg); 
        return; 
      }

      // Сортуємо та форматуємо
      const items = show
        .sort((a,b) => (b.seeders||0) - (a.seeders||0))
        .slice(0, 50) // Обмежуємо кількість результатів
        .map(t => {
          const size = t.size ? (t.size / (1024**3)).toFixed(2) : '?';
          const quality = ql(t.name || t.title || '');
          const qualityStr = quality ? ` [${quality}]` : '';
          
          return {
            title: `${t.cached ? '⚡' : '☁️'} ${(t.name || t.title || 'Невідомо').substring(0, 80)}${qualityStr}`,
            subtitle: `${size} GB | 🟢${t.seeders||0} | 🔴${t.leechers||0}`,
            torrent: t
          };
        });

      Lampa.Select.show({
        title: `TorBox (${items.length})`,
        items,
        onSelect: i => handleTorrent(i.torrent, movie),
        onBack: () => Lampa.Controller.toggle('content')
      });
    } catch (e) {
      LOG('Search error:', e);
      let errorMsg = e.message;
      if (e.message.includes('недоступні')) {
        errorMsg = 'Всі джерела пошуку недоступні. Перевірте інтернет-з\'єднання.';
      }
      Lampa.Noty.show(errorMsg, { type: 'error' });
    } finally {
      Lampa.Loading.stop();
    }
  }

  async function handleTorrent(t, movie) {
    Lampa.Loading.start('TorBox…');
    try {
      // Перевіряємо наявність API ключа
      const key = Store.get('torbox_api_key', '');
      if (!key) {
        Lampa.Noty.show('Потрібен API ключ TorBox в налаштуваннях', { type: 'error' });
        return;
      }

      if (t.cached && (t.torbox_id || t.id)) {
        // Для кешованих торрентів з TorBox ID
        const torrentId = t.torbox_id || t.id;
        const files = await API.files(torrentId);
        const vids  = files.filter(f => f.name && /\.(mkv|mp4|avi|mov|wmv|flv|webm|m4v|ts|m2ts)$/i.test(f.name) && f.size > 50 * 1024 * 1024); // Мінімум 50MB
        if (!vids.length) { Lampa.Noty.show('Відео файли не знайдено'); return; }

        if (vids.length === 1) { 
          await play(torrentId, vids[0], movie); 
          return; 
        }

        vids.sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
        Lampa.Select.show({
          title   : 'TorBox: файли',
          items   : vids.map(f => ({
            title   : f.name,
            subtitle: `${(f.size/2**30).toFixed(2)} GB ${ql(f.name)}`,
            file    : f
          })),
          onSelect: i => play(torrentId, i.file, movie),
          onBack  : () => searchAndShow(movie)
        });
      } else if (t.magnet) {
        // Для некешованих торрентів - додаємо в TorBox
        const result = await API.addMagnet(t.magnet);
        if (result && result.data && result.data.torrent_id) {
          Lampa.Noty.show(`Торрент додано в TorBox (ID: ${result.data.torrent_id}). Очікуйте завершення завантаження.`);
        } else {
          Lampa.Noty.show('Торрент відправлено в TorBox, очікуйте кеш');
        }
      } else {
        Lampa.Noty.show('Неможливо обробити торрент: відсутня magnet-посилання', { type: 'error' });
      }
    } catch (e) {
      LOG('handleTorrent error:', e);
      let errorMsg = e.message;
      if (e.message.includes('401')) {
        errorMsg = 'Невірний API ключ TorBox';
      } else if (e.message.includes('403')) {
        errorMsg = 'Доступ заборонено. Перевірте API ключ';
      } else if (e.message.includes('429')) {
        errorMsg = 'Забагато запитів. Спробуйте пізніше';
      }
      Lampa.Noty.show(errorMsg, { type: 'error' });
    } finally {
      Lampa.Loading.stop();
    }
  }

  async function play(tid, file, movie) {
    Lampa.Loading.start('TorBox: отримання посилання…');
    try {
      const result = await API.dl(tid, file.id);
      const url = result?.data || result;
      
      if (!url || typeof url !== 'string') {
        throw new Error('Не вдалося отримати посилання для відтворення');
      }

      LOG('Playing:', { url, title: file.name, size: file.size });
      
      const playerOptions = {
        url,
        title: file.name || movie.title || 'TorBox Video',
        poster: movie.img || movie.poster,
        subtitles: [],
        callback: () => {
          Lampa.Activity.backward();
        }
      };

      Lampa.Player.play(playerOptions);
    } catch (e) {
      LOG('Play error:', e);
      let errorMsg = e.message;
      if (e.message.includes('404')) {
        errorMsg = 'Файл не знайдено на сервері TorBox';
      } else if (e.message.includes('403')) {
        errorMsg = 'Доступ до файлу заборонено';
      } else if (e.message.includes('500')) {
        errorMsg = 'Помилка сервера TorBox';
      }
      Lampa.Noty.show(errorMsg, { type: 'error' });
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
      { k: 'torbox_cached_only', n: 'Только кеш', d: 'Скрывать не кеш',            t: 'trigger', def: CFG.cachedOnly },
      { k: 'torbox_debug',       n: 'Debug',      d: 'Лог',                        t: 'trigger', def: CFG.debug      },
      { k: 'torbox_api_key',     n: 'API-Key',    d: 'Ключ TorBox (для загрузок)', t: 'input',   def: Store.get('torbox_api_key','') }
    ];

    fields.forEach(p => Lampa.SettingsApi.addParam({
      component: COMP,
      param    : { name: p.k, type: p.t, values: '', default: p.def },
      field    : { name: p.n, description: p.d },
      onChange : v => {
        if (p.t === 'input')                     Store.set('torbox_api_key', v.trim());
        else if (p.k === 'torbox_cached_only')   CFG.cachedOnly = v;
        else                                     CFG.debug      = v;
      }
    }));
  }

  /* ───── hook & boot ───── */
  function hook() {
    Lampa.Listener.follow('full', e => {
      if (e.type !== 'complite') return;
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
      try { addSettings(); hook(); LOG('TorBox v3.5.0 ready'); }
      catch (e) { console.error('[TorBox]', e); }
      return;
    }
    if ((waited += STEP) >= MAX) {
      console.warn('[TorBox] Lampa не знайдено');
      return;
    }
    setTimeout(bootLoop, STEP);
  })();
})();
