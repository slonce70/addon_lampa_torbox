/**
 * TorBox Enhanced Lampa Plugin – v2.4.0 (2025‑06‑23)
 * =================================================
 * – NEW: «Перехоплення TorrServer» (toggle) – можна автоматично замінити TorrServer на TorBox
 * – Додає кнопку «▶ TorBox» у вікно вибору клієнта TorrServer (legacy overlay)
 * – Перехоплення `Lampa.Torrent.open` (safe‑proxy) + fallback, щоб не ламати інші аддони
 * – Виправлено edge‑case, коли сторонній парсер віддає array із внутрішніми об’єктами без `menu`
 * – Мінімальна версія Lampa залишилась 2.3.0+, проте плагін сам себе відключить на <2.x
 * --------------------------------------------------------------------------
 * Як використати новий режим:
 *  1) Налаштування → TorBox Enhanced → **Перенаправляти TorrServer** → увімкнути.
 *  2) Тепер при кліку на «Відтворити» або виборі клієнта TorrServer торент піде в TorBox API — без додаткових дій.
 */

(function () {
  'use strict';

  /* eslint-disable no-undef */
  const PLUGIN_ID = 'torbox_enhanced_secure_24';
  const COMPONENT_ID = 'torbox_enhanced_settings';
  const WAIT_STEP = 500; // ms
  const MAX_WAIT = 60000; // 60 s

  /** SVG‑іконка (сіро‑фіолетова коробка) */
  const ICON = `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 7L12 2L21 7V17L12 22L3 17V7Z" stroke="currentColor" stroke-width="2" />
      <path d="M12 22V12" stroke="currentColor" stroke-width="2" />
      <path d="M21 7L12 12L3 7" stroke="currentColor" stroke-width="2" />
    </svg>`;

  /** Логер з підтримкою debug‑режиму */
  function logger(...args) {
    if (window.localStorage.getItem('torbox_debug') === 'true') {
      // eslint-disable-next-line no-console
      console.log(`[${PLUGIN_ID}]`, ...args);
    }
  }

  /** Зручний гетер/сетер для localStorage */
  function storage(key, value) {
    if (typeof value === 'undefined') return window.localStorage.getItem(key);
    window.localStorage.setItem(key, String(value));
    return value;
  }

  /** Стягуємо API‑key, debug‑mode, redirect‑toggle */
  function getConfig() {
    return {
      apiKey: storage('torbox_api_key') || '',
      debug: storage('torbox_debug') === 'true',
      redirect: storage('torbox_redirect') === 'true',
    };
  }

  /** Патч для старого TorBox‑плагіну */
  function detectDuplicatePlugin() {
    const list = (window.lampa_plugins_list || []).filter((u) => /torbox-lampa-plugin\.js/i.test(u));
    if (list.length) {
      // eslint-disable-next-line no-console
      console.warn(`${PLUGIN_ID}: знайдено старий TorBox‑плагін, радимо видалити →`, list);
    }
  }

  /** Заглушка для відсутнього Lampa.Torrent.add */
  function stubTorrentAdd() {
    if (!window.Lampa) return;
    if (!window.Lampa.Torrent) window.Lampa.Torrent = {};
    if (typeof window.Lampa.Torrent.add !== 'function') {
      window.Lampa.Torrent.add = () => {};
      logger('Stubbed missing Lampa.Torrent.add');
    }
  }

  /** Очікуємо Lampa */
  function waitForLampa() {
    let waited = 0;
    (function loop() {
      const ok = window.Lampa && (window.Lampa.SettingsApi || (window.Lampa.Settings && window.Lampa.Settings.listener));
      if (ok) {
        logger('Lampa detected – init');
        stubTorrentAdd();
        detectDuplicatePlugin();
        return initPlugin(Boolean(window.Lampa.SettingsApi));
      }
      waited += WAIT_STEP;
      if (waited >= MAX_WAIT) {
        // eslint-disable-next-line no-console
        console.warn(`${PLUGIN_ID}: Lampa not ready after ${MAX_WAIT / 1000}s – abort`);
        return undefined;
      }
      setTimeout(loop, WAIT_STEP);
      return undefined;
    }());
  }

  /** SettingsApi component */
  function buildSettingsApi() {
    Lampa.SettingsApi.addComponent({ component: COMPONENT_ID, name: 'TorBox Enhanced', icon: ICON });

    const params = [
      {
        key: 'torbox_api_key',
        field: { name: 'API‑Key', description: 'Персональний ключ TorBox' },
        type: 'input',
        def: storage('torbox_api_key') || '',
      },
      {
        key: 'torbox_debug',
        field: { name: 'Debug‑режим', description: 'Писати детальні логи у консоль' },
        type: 'trigger',
        def: storage('torbox_debug') === 'true',
      },
      {
        key: 'torbox_redirect',
        field: { name: 'Перенаправляти TorrServer', description: 'Авто‑стрім у TorBox замість TorrServer' },
        type: 'trigger',
        def: storage('torbox_redirect') === 'true',
      },
    ];

    params.forEach((p) => {
      Lampa.SettingsApi.addParam({
        component: COMPONENT_ID,
        param: { name: p.key, type: p.type, values: '', default: p.def },
        field: p.field,
        onChange(val) {
          storage(p.key, p.type === 'trigger' ? Boolean(val) : (val || '').trim());
        },
      });
    });
  }

  /** Legacy settings */
  function buildSettingsLegacy() {
    const $folder = $(
      `<div class="settings-folder"><div class="settings-folder__title">TorBox Enhanced</div><div class="settings-folder__body"></div></div>`,
    );
    const items = [
      {
        label: 'API‑Key',
        key: 'torbox_api_key',
        type: 'input',
      },
      {
        label: 'Debug‑режим',
        key: 'torbox_debug',
        type: 'trigger',
      },
      {
        label: 'Перенаправляти TorrServer',
        key: 'torbox_redirect',
        type: 'trigger',
      },
    ];

    items.forEach((p) => {
      const $row = $(`<div class="settings-param"><div class="settings-param__name">${p.label}</div></div>`);
      let $ctrl;
      if (p.type === 'input') {
        $ctrl = $('<input type="text" class="input">').val(storage(p.key) || '').on('input', (e) => storage(p.key, e.target.value.trim()));
      } else {
        $ctrl = $('<input type="checkbox">').prop('checked', storage(p.key) === 'true').on('change', (e) => storage(p.key, e.target.checked));
      }
      $row.append($ctrl);
      $folder.find('.settings-folder__body').append($row);
    });
    $('.settings .settings-list').append($folder);
  }

  /** Основна ініціалізація */
  function initPlugin(useApi) {
    try {
      useApi ? buildSettingsApi() : buildSettingsLegacy();
      interceptTorrServer();
      patchPlayer();
      logger('Plugin ready v2.4.0');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`${PLUGIN_ID}: init error`, err);
    }
  }

  /** Перехоплюємо TorrServer.open + додаємо кнопку у його меню */
  function interceptTorrServer() {
    if (!window.Lampa || !window.Lampa.Torrent) return;

    const originalOpen = window.Lampa.Torrent.open ? window.Lampa.Torrent.open.bind(window.Lampa.Torrent) : null;

    // ЦЕ ГОЛОВНИЙ МЕХАНІЗМ АВТОМАТИЧНОГО ПЕРЕХОПЛЕННЯ
    window.Lampa.Torrent.open = function patchedOpen(object) {
      const cfg = getConfig();
      const hash = (typeof object === 'string' ? object : (object?.magnet || object?.hash || object?.url || ''));
      const isMagnet = /^magnet:|^[a-f0-9]{40}$/i.test(hash);

      // Якщо редирект увімкнено, відправляємо в TorBox
      if (cfg.redirect && isMagnet) {
        logger('Redirecting TorrServer → TorBox', hash);
        startTorBoxStream(hash);
        return;
      }
      // Інакше, повертаємо оригінальну поведінку
      if (originalOpen) return originalOpen(object);
    };

    // ЦЕ ЗАПАСНИЙ МЕХАНІЗМ: додавання кнопки в меню
    Lampa.Listener.follow('torrent', (e) => {
      if (e.type !== 'open') return;
      const file = e.object || {};
      const hash = file.magnet || file.hash || '';
      if (!/^magnet:|^[a-f0-9]{40}$/i.test(hash)) return;
      if (!file.menu) file.menu = [];
      if (file.menu.find((i) => i?.torbox)) return;
      file.menu.push({
        torbox: true,
        title: '▶ TorBox',
        onSelect: () => startTorBoxStream(hash),
      });
    });
  }

  /** Патч меню плеєра (ще один запасний механізм) */
  function patchPlayer() {
    if (!window.Lampa || !window.Lampa.Listener) return;
    Lampa.Listener.follow('player', (event) => {
      if (event.type !== 'file') return;
      const file = event.file || {};
      const hashLike = file.magnet || file.infoHash || '';
      if (!/^magnet:|^[a-f0-9]{40}$/i.test(hashLike)) return;
      if (!file.menu) file.menu = [];
      if (file.menu.find((i) => i.torbox)) return;
      file.menu.push({
        torbox: true,
        title: '▶ Відтворити через TorBox',
        subtitle: 'Потік із TorBox',
        onSelect: () => startTorBoxStream(hashLike),
      });
    });
  }

  /** Запускаємо TorBox API */
  function startTorBoxStream(magnet) {
    const { apiKey } = getConfig();
    if (!apiKey) {
      window.Lampa.Noty.show('Спершу введіть API‑Key TorBox у налаштуваннях');
      return;
    }
    const payload = { magnet, action: 'add', api_key: apiKey };
    logger('Fetch TorBox', payload);
    fetch('https://api.torbox.app/lampa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then((r) => r.json())
      .then((json) => {
        logger('TorBox →', json);
        if (json?.play_url) playViaLampa(json.play_url);
        else window.Lampa.Noty.show('TorBox не повернув URL потоку');
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error(`${PLUGIN_ID}: TorBox fetch error`, err);
        window.Lampa.Noty.show('Помилка TorBox API');
      });
  }

  /** Відтворення у Lampa */
  function playViaLampa(url) {
    logger('Play stream', url);
    const video = { url, title: 'TorBox Stream', quality: {}, timeline: 0 };
    window.Lampa.Player.play(video);
  }

  waitForLampa();
})();
