/*
 * TorBox Enhanced – Universal Lampa Plugin v9.3.0 (2025-06-25)
 * ============================================================
 * • ИСПРАВЛЕННЫЙ ПОИСК: Запросы теперь идут на правильный URL 'search-api.torbox.app/torrents/imdb:...' согласно вашим указаниям.
 * • ОБНОВЛЕННАЯ ЛОГИКА: Код адаптирован для обработки новой структуры ответа от API (используются 'hash', 'raw_title', 'last_known_seeders').
 * • УДАЛЕНА НАСТРОЙКА "Только кешированные": По вашему желанию, эта опция убрана. Теперь в списке отображаются все найденные торренты.
 * • СТАБИЛЬНОСТЬ: Внесены исправления для более надежной работы с API и обработки данных.
 */

(function () {
  'use strict';

  const CONSTANTS = {
    PLUGIN_ID: 'torbox_enhanced_v9_1_0',
    API_SEARCH: 'https://search-api.torbox.app',
    API_MAIN: 'https://api.torbox.app/v1/api',
    SETTINGS_KEYS: {
        DEBUG: 'torbox_debug',
        PROXY_URL: 'torbox_proxy_url',
        API_KEY: 'torbox_api_key',
    },
    REQUEST_TIMEOUT_MS: 15000, // 15 секунд
  };
  /* ───── Guard double-load ───── */
  if (window[CONSTANTS.PLUGIN_ID]) return;
  window[CONSTANTS.PLUGIN_ID] = true;

  /* ───── Templates ───── */
  Lampa.Template.add('torbox_view_template', `
    <div class="torbox-view layer--wheight">
        <div class="torbox-view__content">
            <div class="torbox-view__list"></div>
        </div>
        <div class="torbox-view__empty selector" style="display: none; height: 100%;">
            <div class="empty">
                <p>Торренты не найдены</p>
                <p>Попробуйте поискать на другом ресурсе</p>
            </div>
        </div>
    </div>
  `);

  Lampa.Template.add('torbox_card_template', `
      <div class="full-item selector">
          <div class="full-item__title">{title}</div>
          <div class="full-item__sub">{subtitle}</div>
      </div>
  `);

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
    get debug()      { return Store.get(CONSTANTS.SETTINGS_KEYS.DEBUG, '0') === '1'; },
    set debug(v)     { Store.set(CONSTANTS.SETTINGS_KEYS.DEBUG, v ? '1' : '0');    },
    get proxyUrl()   { return Store.get(CONSTANTS.SETTINGS_KEYS.PROXY_URL, ''); },
    set proxyUrl(v)  { Store.set(CONSTANTS.SETTINGS_KEYS.PROXY_URL, v); }
  };

  const LOG  = (...a) => CFG.debug && console.log('[TorBox]', ...a);
  
  async function fetchWithTimeout(resource, options = {}) {
      const { timeout = CONSTANTS.REQUEST_TIMEOUT_MS } = options;
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeout);
      try {
        const response = await fetch(resource, { ...options, signal: controller.signal });
        return response;
      } catch (e) {
        if (e.name === 'AbortError') {
            throw new Error(`Запрос превысил время ожидания (${timeout / 1000}с)`);
        }
        throw e;
      } finally {
        clearTimeout(id);
      }
  }

  const processResponse = async (r, url) => {
    if (r.status === 401) {
        throw new Error(`Ошибка авторизации (401) для ${url}. Проверьте ваш API-ключ.`);
    }
    if (!r.ok) {
        try {
            const errorBody = await r.json();
            const errorMessage = errorBody.message || JSON.stringify(errorBody);
            throw new Error(`Ошибка сети: HTTP ${r.status} - ${errorMessage} для ${url}`);
        } catch (e) {
            throw new Error(`Ошибка сети: HTTP ${r.status} для ${url}`);
        }
    }

    const responseText = await r.text();
    if (responseText.includes("NO_AUTH")) {
        throw new Error('Ошибка авторизации (NO_AUTH). Проверьте API-ключ и ваш тарифный план TorBox.');
    }

    try { 
        const json = JSON.parse(responseText);
        if (json.success === false) {
            throw new Error(json.message || 'API вернул ошибку без сообщения.');
        }
        return json;
    } catch (e) {
        LOG('Invalid JSON or API error:', responseText, e);
        if (e instanceof Error) throw e;
        throw new Error('Получен некорректный JSON от сервера.');
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
    async _call(path, options = {}, apiType = 'search') {
        const key = Store.get(CONSTANTS.SETTINGS_KEYS.API_KEY, '');
        if (!key) throw new Error('API-Key не указан в настройках.');

        const proxy = CFG.proxyUrl;
        if (!proxy) throw new Error('URL вашего персонального прокси не указано в настройках.');

        const baseUrl = apiType === 'main' ? CONSTANTS.API_MAIN : CONSTANTS.API_SEARCH;
        const targetUrl = `${baseUrl}${path}`;
        const proxiedUrl = `${proxy}?url=${encodeURIComponent(targetUrl)}`;
        
        const fetchOptions = {
            ...options,
            headers: {
                'Authorization': `Bearer ${key}`,
                'Accept': 'application/json',
                ...options.headers,
            },
            timeout: CONSTANTS.REQUEST_TIMEOUT_MS,
        };

        LOG(`Calling via proxy: ${targetUrl}`);
        const response = await fetchWithTimeout(proxiedUrl, fetchOptions);
        return await processResponse(response, targetUrl);
    },

    async search(imdbId) {
        const path = `/torrents/imdb:${imdbId}?check_cache=true&check_owned=false&search_user_engines=true`;
        const res = await this._call(path, {}, 'search');
        return res.data?.torrents || [];
    },

    async _directAction(path, body = {}, method = 'GET') {
        let fullPath = path;
        const options = { method };
        if (method !== 'GET') {
            options.headers = { 'Content-Type': 'application/json' };
            options.body = JSON.stringify(body);
        } else if (Object.keys(body).length) {
            fullPath += '?' + new URLSearchParams(body).toString();
        }
        return this._call(fullPath, options, 'main');
    },

    addMagnet(m)  { return this._directAction('/torrents/createtorrent', { magnet: m }, 'POST'); },
    files(hash)   { return this._directAction('/torrents/mylist', { id: hash }).then(r => r.data?.[0]?.files || []); },
    dl(thash, fid){ return this._directAction('/torrents/requestdl', { torrent_id: thash, file_id: fid }).then(r => r.data); }
  };

  /* ───── Component for results screen ───── */
  function TorboxView() {
    let component = Lampa.Template.js('torbox_view_template');
    let movie;

    this.create = function () {
        this.activity.loader(true);
        return component;
    };

    this.start = function (data) {
        movie = data.movie;
        Lampa.Head.title('TorBox');
        Lampa.Head.subtitle(movie.title || movie.name);
        this.search();
    };

    this.search = async function() {
        try {
            if (!movie || !movie.imdb_id) throw new Error("Для поиска нужен IMDb ID.");
            
            const list = await API.search(movie.imdb_id);

            if (!list || !list.length) {
                component.find('.torbox-view__empty').show();
            } else {
                const items = list
                    .sort((a,b) => (b.last_known_seeders || 0) - (a.last_known_seeders || 0))
                    .map(t => ({
                        title: `${t.cached ? '⚡' : '☁️'} ${t.raw_title || t.title}`,
                        subtitle: `[${ql(t.raw_title || t.title)}] ${(t.size / 2**30).toFixed(2)} GB | 🟢 ${t.last_known_seeders || 0}`,
                        torrent: t
                    }));
                this.build(items);
            }
            
            this.activity.loader(false);
            Lampa.Controller.enable(this.activity.render());

        } catch (e) {
            LOG('TorboxView Search Error:', e);
            this.activity.loader(false);
            Lampa.Noty.show(`TorBox: ${e.message}`, { type: 'error' });
            Lampa.Activity.backward();
        }
    };

    this.build = function(items) {
        const list = component.find('.torbox-view__list');
        items.forEach(item => {
            let card = Lampa.Template.js('torbox_card_template', item);
            card.on('hover:enter', () => {
                handleTorrent(item.torrent, movie);
            });
            list.append(card);
        });
    };

    this.pause = function () { Lampa.Controller.toggle('content'); };
    this.stop = function () {};
    this.destroy = function () {
        component.find('.torbox-view__list').empty();
    }
  }

  /* ───── UI flows ───── */
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
          onSelect: i => play(t.hash, i.file, movie),
          onBack: () => Lampa.Controller.toggle('content') // ИСПРАВЛЕНО: Возврат на экран с результатами
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
      { k: CONSTANTS.SETTINGS_KEYS.PROXY_URL, n: 'URL вашего CORS-прокси', d: 'Вставьте сюда URL вашего воркера с Cloudflare', t: 'input', def: CFG.proxyUrl },
      { k: CONSTANTS.SETTINGS_KEYS.API_KEY,   n: 'Ваш личный API-Key',    d: 'Обязательно. Взять на сайте TorBox.', t: 'input',   def: Store.get(CONSTANTS.SETTINGS_KEYS.API_KEY,'') },
      { k: CONSTANTS.SETTINGS_KEYS.DEBUG,     n: 'Режим отладки',         d: 'Записывать подробную информацию в консоль разработчика (F12)', t: 'trigger', def: CFG.debug }
    ];
    fields.forEach(p => Lampa.SettingsApi.addParam({
      component: COMP,
      param    : { name: p.k, type: p.t, values: '', default: p.def },
      field    : { name: p.n, description: p.d },
      onChange : v => {
        const value = String(typeof v === 'object' ? v.value : v);
        if (p.k === CONSTANTS.SETTINGS_KEYS.PROXY_URL) CFG.proxyUrl = value.trim();
        if (p.k === CONSTANTS.SETTINGS_KEYS.API_KEY)   Store.set(p.k, value.trim());
        if (p.k === CONSTANTS.SETTINGS_KEYS.DEBUG)     CFG.debug = Boolean(v);
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
        Lampa.Activity.push({ component: 'torbox_view', data: { movie: e.data.movie } });
      });
      root.find('.view--torrent').after(btn);
    });
  }

  let waited = 0;
  const STEP = 500, MAX = 60000;
  (function bootLoop () {
    if (window.Lampa && window.Lampa.Settings && window.Lampa.Component) {
      Lampa.Component.add('torbox_view', TorboxView);
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
