/**
 * TorBox <-> Lampa Integration Plugin
 * Version: 36.0.0 (Ultimate Failsafe Method)
 * Author: Gemini AI & Your Name
 *
 * CHANGE LOG v36.0.0:
 * - CRITICAL FIX: After analyzing the final 'TypeError', it's clear the issue lies deep within the Lampa component lifecycle in this specific user environment. All previous methods failed.
 * - This version reverts to the most basic, failsafe, and direct DOM manipulation method possible. It completely avoids Lampa.SettingsApi, Lampa.Settings.listener, and component registration.
 * - It now waits for the app to be ready and directly appends a fully-interactive HTML block into the settings page using jQuery, mirroring the most reliable pattern from the user's initial working scripts.
 * - This should definitively resolve the conflict with the Lampa core.
 * - ADDED: The "Redirect TorrServer" feature from the reference script has been re-integrated.
 */
(function () {
    'use strict';

    const PLUGIN_ID = 'torbox_ultimate_failsafe_v36';
    if (window[PLUGIN_ID]) {
        return;
    }
    window[PLUGIN_ID] = true;

    // --- Утилиты ---

    function logger(...args) {
        if (storage('torbox_debug') === 'true') {
            console.log(`[TorBox Failsafe]`, ...args);
        }
    }

    function storage(key, value) {
        try {
            if (typeof value === 'undefined') {
                return window.localStorage.getItem(key);
            }
            window.localStorage.setItem(key, String(value));
            return value;
        } catch (e) {
            console.error("[TorBox] LocalStorage Error:", e);
            return typeof value === 'undefined' ? null : value;
        }
    }
    
    // --- API Wrapper ---
    const TorBoxAPI = {
        API_BASE: 'https://api.torbox.app/v1/api',
        
        _call_check: async function(apiKey, endpoint, params = {}, method = 'GET', base = this.API_BASE) {
            if (!apiKey) {
                return Promise.reject(new Error('API ключ TorBox не установлен'));
            }
            let url = `${base}${endpoint}`;
            const options = { method, headers: { 'Authorization': `Bearer ${apiKey}` } };
            if (method === 'GET' && Object.keys(params).length) {
                url += '?' + new URLSearchParams(params).toString();
            } else if (method === 'POST') {
                options.headers['Content-Type'] = 'application/json';
                options.body = JSON.stringify(params);
            }
            const response = await fetch(url, options);
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || data.message || `HTTP ${response.status}`);
            }
            return data;
        },
        
        addMagnet: (magnet) => TorBoxAPI._call_check(storage('torbox_api_key'), '/torrents/createtorrent', { magnet }, 'POST'),
        getDirectLink: (magnet) => TorBoxAPI._call_check(storage('torbox_api_key'), '/torrents/getdirectdl', { magnet }, 'POST')
    };
    
    // --- Core Logic ---

    function startTorBoxStream(hash) {
        const apiKey = storage('torbox_api_key');
        if (!apiKey) {
            return Lampa.Noty.show('Спершу введіть API‑Key TorBox у налаштуваннях');
        }

        const magnet = hash.startsWith('magnet:') ? hash : `magnet:?xt=urn:btih:${hash}`;
        
        Lampa.Loading.start('Отправка в TorBox...');
        logger('Отправка magnet в TorBox:', magnet);

        TorBoxAPI.getDirectLink(magnet).then(result => {
            if (result && result.data) {
                logger('Прямая ссылка получена:', result.data);
                Lampa.Player.play({
                    url: result.data,
                    title: `TorBox Stream`
                });
                Lampa.Player.callback(Lampa.Activity.backward);
            } else {
                return TorBoxAPI.addMagnet(magnet).then(() => {
                    Lampa.Noty.show('Торрент добавлен в TorBox. Запустите его из списка на сайте.', { type: 'info' });
                });
            }
        }).catch(err => {
            logger('Ошибка API TorBox:', err);
            Lampa.Noty.show(err.message || 'Ошибка API TorBox', { type: 'error' });
        }).finally(() => {
            Lampa.Loading.stop();
        });
    }

    function interceptTorrServer() {
        if (!window.Lampa || !window.Lampa.Torrent) {
             logger("Lampa.Torrent не найден, перехват невозможен.");
             return;
        }

        const originalOpen = window.Lampa.Torrent.open;

        window.Lampa.Torrent.open = function patchedOpen(object) {
            const isRedirectEnabled = storage('torbox_redirect') === 'true';
            const hash = (typeof object === 'string' ? object : (object?.magnet || object?.hash || object?.url || ''));
            const isMagnet = /^magnet:|^[a-f0-9]{40}$/i.test(hash);

            if (isRedirectEnabled && isMagnet) {
                logger('Перехват TorrServer -> TorBox:', hash);
                startTorBoxStream(hash);
                return;
            }
            
            if (typeof originalOpen === 'function') {
                return originalOpen.apply(this, arguments);
            }
        };

        Lampa.Listener.follow('torrent', (e) => {
            if (e.type !== 'open') return;
            const file = e.object || {};
            const hash = file.magnet || file.hash || '';
            if (!/^magnet:|^[a-f0-9]{40}$/i.test(hash)) return;
            if (!file.menu) file.menu = [];
            if (file.menu.find((i) => i?.torbox)) return;
            file.menu.push({
                torbox: true,
                title: '▶ TorBox',
                onSelect: () => startTorBoxStream(hash),
            });
        });
    }

    // --- Самый надежный метод создания настроек ---
    function buildAndInjectSettings() {
        // Проверяем, не создан ли уже наш блок
        if ($('.settings-folder[data-torbox-plugin]').length > 0) {
            logger("Блок настроек TorBox уже существует.");
            return;
        }

        // Создаем контейнер-папку
        const folder = $(
            `<div class="settings-folder" data-torbox-plugin="true">
                <div class="settings-folder__title">TorBox</div>
                <div class="settings-folder__body"></div>
            </div>`
        );
        const body = folder.find('.settings-folder__body');

        // Элементы настроек
        const items = [
            { label: 'API Ключ', key: 'torbox_api_key', type: 'input' },
            { label: 'Перехватывать TorrServer', key: 'torbox_redirect', type: 'trigger' },
            { label: 'Debug-режим', key: 'torbox_debug', type: 'trigger' },
        ];

        items.forEach((p) => {
            const row = $(`<div class="settings-param selector">
                <div class="settings-param__name">${p.label}</div>
                <div class="settings-param__value"></div>
            </div>`);
            
            if (p.type === 'input') {
                row.find('.settings-param__value').text(storage(p.key) || 'Не указан');
                row.on('hover:enter', () => {
                    Lampa.Input.edit({ title: p.label, value: storage(p.key) || '', free: true }, (val) => {
                        storage(p.key, val.trim());
                        row.find('.settings-param__value').text(val.trim() || 'Не указан');
                        Lampa.Controller.toggle('settings');
                    });
                });
            } else if (p.type === 'trigger') {
                const updateVisual = () => row.find('.settings-param__value').text(storage(p.key) === 'true' ? 'Вкл' : 'Выкл');
                updateVisual();
                row.on('hover:enter', () => {
                    storage(p.key, !(storage(p.key) === 'true'));
                    updateVisual();
                });
            }
            body.append(row);
        });

        // Вставляем наш блок настроек в список
        $('.settings-content > .settings-list').append(folder);
        // Принудительно обновляем навигацию Lampa
        if(Lampa.Settings.main) Lampa.Settings.main().update();
    }


    // --- Инициализатор плагина ---
    function initPlugin() {
        logger('Запуск initPlugin');
        
        // Встраиваем настройки
        buildAndInjectSettings();
        
        // Включаем перехватчик TorrServer
        interceptTorrServer();
        
        logger('Плагин TorBox v36.0.0 полностью инициализирован.');
    }

    // Ждем, пока Lampa будет готова
    (function waitForLampa() {
        let waited = 0;
        const loop = setInterval(() => {
            // Ждем, пока Lampa и jQuery будут точно доступны
            if (window.Lampa && window.jQuery) {
                clearInterval(loop);
                logger('Lampa и jQuery готовы, запускаем плагин.');
                initPlugin();
            } else {
                waited += 200;
                if (waited >= 15000) {
                    clearInterval(loop);
                    console.error("[TorBox Failsafe] Lampa не загрузилась вовремя.");
                }
            }
        }, 200);
    })();

})();
