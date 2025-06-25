/*
 * TorBox Enhanced – Universal Lampa Plugin v9.1.0 (2025-06-25)
 * ============================================================
 * • ИСПРАВЛЕННЫЙ ПОИСК: Запросы теперь идут на правильный URL 'search-api.torbox.app/torrents/imdb:...' согласно вашим указаниям.
 * • ОБНОВЛЕННАЯ ЛОГИКА: Код адаптирован для обработки новой структуры ответа от API (используются 'hash', 'raw_title', 'last_known_seeders').
 * • УДАЛЕНА НАСТРОЙКА "Только кешированные": По вашему желанию, эта опция убрана. Теперь в списке отображаются все найденные торренты.
 * • СТАБИЛЬНОСТЬ: Внесены исправления для более надежной работы с API и обработки данных.
 */

(function () {
  'use strict';

  /* ───── Guard double-load ───── */
  const PLUGIN_ID = 'torbox_enhanced_v9_1_0';
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

  // Конфигурация: настройка 'cachedOnly' была удалена.
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
        // Проверка на 'success: false' в ответе API
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
        
        // ИСПРАВЛЕНО: Правильный URL для поиска согласно вашим требованиям.
        const url = `${this.SEARCH_API}/torrents/imdb:${imdbId}?check_cache=true&check_owned=false&search_user_engines=false`;
        
        const options = { headers: { 'Authorization': `Bearer ${key}` } };
        const res = await this.proxiedCall(url, options);
        
        // ИСПРАВЛЕНО: Путь к торрентам в новой структуре ответа.
        return res.data?.torrents || [];
    },

    // Action calls use the MAIN_API
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

    // ИСПРАВЛЕНО: API может требовать 'hash' вместо 'id'. Будем использовать 'hash'.
    addMagnet(m)  { return this.directAction('/torrents/createtorrent', { magnet: m }, 'POST'); },
    files(hash)   { return this.directAction('/torrents/mylist', { id: hash }).then(r => r.data?.[0]?.files || []); },
    dl(thash, fid){ return this.directAction('/torrents/requestdl', { torrent_id: thash, file_id: fid }).then(r => r.data); }
  };

  /* ───── UI flows ───── */
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
      
      // ИЗМЕНЕНО: Фильтр 'cachedOnly' убран. Отображаются все результаты.
      // ИЗМЕНЕНО: Сортировка по 'last_known_seeders'
      const items = list
        .sort((a,b) => (b.last_known_seeders || 0) - (a.last_known_seeders || 0))
        .map(t => ({
            // ИЗМЕНЕНО: Используем 'raw_title' для полного названия и 'last_known_seeders' для сидов.
            title: `${t.cached ? '⚡' : '☁️'} ${t.raw_title || t.title}`,
            subtitle: `[${ql(t.raw_title || t.title)}] ${(t.size / 2**30).toFixed(2)} GB | 🟢 ${t.last_known_seeders || 0}`,
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
    Lampa.Loading.start('TorBox: обработка...');
    try {
      if (t.cached) {
        // ИСПРАВЛЕНО: Передаем 't.hash' вместо 't.id'
        const files = await API.files(t.hash);
        const vids  = files.filter(f => /\.(mkv|mp4|avi)$/i.test(f.name));
        
        if (!vids.length) { Lampa.Noty.show('Видеофайлы не найдены.'); return; }
        
        // ИСПРАВЛЕНО: Передаем 't.hash' в функцию play
        if (vids.length === 1) { play(t.hash, vids[0], movie); return; }
        
        vids.sort((a,b) => b.size - a.size);
        Lampa.Select.show({
          title: 'TorBox: выбор файла',
          items: vids.map(f => ({
            title: f.name,
            subtitle: `${(f.size/2**30).toFixed(2)} GB | ${ql(f.name)}`,
            file: f
          })),
          onSelect: i => play(t.hash, i.file, movie), // ИСПРАВЛЕНО: Передаем 't.hash'
          onBack: () => searchAndShow(movie)
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
      // ИСПРАВЛЕНО: 'torrentHash' используется как torrent_id
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
    
    // ИЗМЕНЕНО: Настройка 'torbox_cached_only' удалена.
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
        // Логика обновлена, т.к. одна из настроек убрана
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
      try { addSettings(); hook(); LOG('TorBox v9.1.0 ready'); }
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
