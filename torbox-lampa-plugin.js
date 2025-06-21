/**
 * TorBox Enhanced Lampa Plugin – v2.3.0 (2025‑06‑22)
 * =================================================
 * – Фікс крешу «Cannot read properties of undefined (reading \u2018name\u2019)»
 * – Параметри SettingsApi тепер відповідають офіційному формату Lampa
 * – Додає заглушку для відсутнього `Lampa.Torrent.add`, щоб блокувати помилку
 * – Виправлено типи: `trigger` замість `toggle`, додано `values` для input
 * – Додано перевірку та попередження про дублікати старого TorBox‑плагіну
 * --------------------------------------------------------------------------
 * Встановлення:
 *   1. Видаліть посилання на старий TorBox‑плагін (slonce70.github.io/...)
 *   2. Збережіть цей файл у каталозі плагінів або додайте пряме посилання
 *   3. Перезапустіть Lampa.
 *
 * Якщо все зробили коректно – у «Налаштування → Розширення» пункт
 * «TorBox Enhanced» відкривається без помилок.
 */

(function () {
  'use strict';

  /* eslint-disable no-undef */
  const PLUGIN_ID = 'torbox_enhanced_secure_23';
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

  /**
   * 👉 Патч для старого TorBox‑плагіну (slonce70.github.io):
   * якщо він присутній у списку, виводимо попередження в консоль.
   */
  function detectDuplicatePlugin() {
    const list = (window.lampa_plugins_list || []).filter((u) => /torbox-lampa-plugin\.js/i.test(u));
    if (list.length) {
      // eslint-disable-next-line no-console
      console.warn(`${PLUGIN_ID}: знайдено старий TorBox‑плагін, радимо видалити →`, list);
    }
  }

  /** Заглушка для випадку, якщо Lampa.Torrent.add відсутній */
  function stubTorrentAdd() {
    if (!window.Lampa) return;
    if (!window.Lampa.Torrent) window.Lampa.Torrent = {};
    if (typeof window.Lampa.Torrent.add !== 'function') {
      window.Lampa.Torrent.add = () => {};
      logger('Stubbed missing Lampa.Torrent.add');
    }
  }

  /** Очікує на появу необхідних об’єктів Lampa і ініціалізує плагін */
  function waitForLampa() {
    let waited = 0;

    (function loop() {
      const lampaReady = typeof window.Lampa === 'object';

      if (lampaReady) {
        // Додатково перевіримо наявність SettingsApi або legacy Settings
        const hasApi = !!window.Lampa.SettingsApi;
        const hasLegacy = !!(window.Lampa.Settings && window.Lampa.Settings.listener);

        if (hasApi || hasLegacy) {
          logger('Lampa detected, init start');
          stubTorrentAdd();
          detectDuplicatePlugin();
          return initPlugin(hasApi);
        }
      }

      waited += WAIT_STEP;
      if (waited >= MAX_WAIT) {
        // eslint-disable-next-line no-console
        console.warn(`${PLUGIN_ID}: Lampa not ready after ${MAX_WAIT / 1000}s – aborting init`);
        return undefined;
      }
      setTimeout(loop, WAIT_STEP);
      return undefined;
    }());
  }

  /** Створює налаштування через SettingsApi (нові збірки) */
  function buildSettingsApi() {
    logger('Registering settings component via SettingsApi');

    // 1) Компонент
    Lampa.SettingsApi.addComponent({
      component: COMPONENT_ID,
      name: 'TorBox Enhanced',
      icon: ICON,
    });

    // 2) API‑Key (input)
    Lampa.SettingsApi.addParam({
      component: COMPONENT_ID,
      param: {
        name: 'torbox_api_key',
        type: 'input',
        values: '',
        default: window.localStorage.getItem('torbox_api_key') || '',
      },
      field: {
        name: 'API‑Key',
        description: 'Персональний ключ TorBox для доступу до API',
      },
      onChange(val) {
        window.localStorage.setItem('torbox_api_key', (val || '').trim());
      },
    });

    // 3) Debug‑mode (trigger)
    Lampa.SettingsApi.addParam({
      component: COMPONENT_ID,
      param: {
        name: 'torbox_debug',
        type: 'trigger',
        values: '',
        default: window.localStorage.getItem('torbox_debug') === 'true',
      },
      field: {
        name: 'Debug‑режим',
        description: 'Показувати розширені логи у консолі',
      },
      onChange(val) {
        window.localStorage.setItem('torbox_debug', Boolean(val));
      },
    });
  }

  /** Legacy‑метод (старі збірки Lampa без SettingsApi) */
  function buildSettingsLegacy() {
    logger('Registering settings component via legacy DOM');

    const $folder = $(
      `<div class="settings-folder">
        <div class="settings-folder__title">TorBox Enhanced</div>
        <div class="settings-folder__body"></div>
      </div>`,
    );

    // API‑Key input
    const $apiKey = $('<div class="settings-param"><div class="settings-param__name">API‑Key</div></div>');
    const $input = $('<input type="text" class="input">');
    $input.val(window.localStorage.getItem('torbox_api_key') || '');
    $input.on('input', () => {
      window.localStorage.setItem('torbox_api_key', $input.val().trim());
    });
    $apiKey.append($input);

    // Debug toggle
    const $debug = $('<div class="settings-param"><div class="settings-param__name">Debug‑режим</div></div>');
    const $toggle = $('<input type="checkbox">');
    $toggle.prop('checked', window.localStorage.getItem('torbox_debug') === 'true');
    $toggle.on('change', () => {
      window.localStorage.setItem('torbox_debug', $toggle.is(':checked'));
    });
    $debug.append($toggle);

    $folder.find('.settings-folder__body').append($apiKey, $debug);

    // Додаємо до списку
    const $list = $('.settings .settings-list');
    if ($list.length) $list.append($folder);
  }

  /** Головна ініціалізація плагіна */
  function initPlugin(useSettingsApi) {
    try {
      if (useSettingsApi) buildSettingsApi(); else buildSettingsLegacy();
      patchPlayer();
      logger('Plugin initialized OK');
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`${PLUGIN_ID}: init error`, e);
    }
  }

  /** Додає кнопку «Відтворити через TorBox» у меню джерел */
  function patchPlayer() {
    logger('Patching player–menu for TorBox integration');

    if (!window.Lampa || !window.Lampa.Listener) return;

    Lampa.Listener.follow('player', (event) => {
      if (event.type !== 'file') return; // цікавить лише вибір файлу

      const file = event.file || {};
      const hashLike = file.magnet || file.infoHash || '';
      if (!/^magnet:|^[a-f0-9]{40}$/i.test(hashLike)) return;

      // Додаємо пункт у контекстне меню
      if (!file.torbox_button_patched) {
        file.torbox_button_patched = true;
        file.menu.push({
          title: '▶ Відтворити через TorBox',
          subtitle: 'Запустити потокове відтворення з TorBox',
          onSelect: () => startTorBoxStream(hashLike),
        });
      }
    });
  }

  /** Стартує процес стрімінгу через TorBox */
  function startTorBoxStream(magnetOrHash) {
    const apiKey = window.localStorage.getItem('torbox_api_key');
    if (!apiKey) {
      window.Lampa.Noty.show('Спершу введіть API‑Key TorBox у налаштуваннях');
      return;
    }

    const payload = { magnet: magnetOrHash, action: 'add', api_key: apiKey };
    logger('Sending to TorBox API', payload);

    fetch('https://api.torbox.app/lampa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then((r) => r.json())
      .then((json) => {
        logger('TorBox response', json);
        if (json && json.play_url) {
          playViaLampa(json.play_url);
        } else {
          window.Lampa.Noty.show('TorBox не надав URL потоку');
        }
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error(`${PLUGIN_ID}: TorBox fetch error`, err);
        window.Lampa.Noty.show('Помилка звернення до TorBox API');
      });
  }

  /** Відтворює отриманий HLS/DASH потік у Lampa Player */
  function playViaLampa(url) {
    logger('Opening stream in Lampa Player', url);
    const video = {
      url,
      title: 'TorBox Stream',
      quality: {},
      timeline: 0,
    };
    window.Lampa.Player.play(video);
  }

  // Старт очікування Lampa
  waitForLampa();
})();
