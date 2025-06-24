/**
 * TorBox <-> Lampa Integration Plugin
 * Version: 35.0.0 (Hybrid Adaptive Settings)
 * Author: Gemini AI & Your Name
 *
 * CHANGE LOG v35.0.0:
 * - CRITICAL FIX: Implemented the hybrid/adaptive settings method from the user-provided 'torbox_enhanced_secure_24' script.
 * - The plugin now checks for the presence of 'Lampa.SettingsApi'.
 * - If the API exists, it builds the settings using the modern component-based approach.
 * - If the API does not exist, it falls back to the robust legacy method of direct DOM injection.
 * - This resolves all previous 'Template not found' and compatibility issues.
 * - ADDED: The "Redirect TorrServer" feature from the reference script has been integrated.
 */
(function () {
    'use strict';

    const PLUGIN_ID = 'torbox_hybrid_v35';
    if (window[PLUGIN_ID]) {
        return;
    }
    window[PLUGIN_ID] = true;

    const COMPONENT_ID = 'torbox_enhanced_settings';
    const WAIT_STEP = 500; // ms
    const MAX_WAIT = 15000; // 15 s

    const ICON = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 7L12 2L21 7V17L12 22L3 17V7Z" stroke="currentColor" stroke-width="2" />
            <path d="M12 22V12" stroke="currentColor" stroke-width="2" />
            <path d="M21 7L12 12L3 7" stroke="currentColor" stroke-width="2" />
        </svg>`;

    function logger(...args) {
        if (storage('torbox_debug') === 'true') {
            console.log(`[TorBox Hybrid]`, ...args);
        }
    }

    function storage(key, value) {
        if (typeof value === 'undefined') return window.localStorage.getItem(key);
        window.localStorage.setItem(key, String(value));
        return value;
    }

    function getConfig() {
        return {
            apiKey: storage('torbox_api_key') || '',
            debug: storage('torbox_debug') === 'true',
            cachedOnly: storage('torbox_cached_only') === 'true',
            redirect: storage('torbox_redirect') === 'true',
        };
    }
    
    // --- API Wrapper ---
    const TorBoxAPI = {
        API_BASE: 'https://api.torbox.app/v1/api',
        API_SEARCH_BASE: 'https://search-api.torbox.app',
        
        _call: async function(endpoint, params = {}, method = 'GET', base = this.API_BASE) {
            const apiKey = storage('torbox_api_key');
            return this._call_check(apiKey, endpoint, params, method, base);
        },

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
        
        addMagnet: (magnet) => TorBoxAPI._call('/torrents/createtorrent', { magnet }, 'POST'),
        getDirectLink: (magnet) => TorBoxAPI._call('/torrents/getdirectdl', { magnet }, 'POST')
    };
    
    // --- Settings Builders ---

    /** Modern Settings via SettingsApi */
    function buildSettingsApi() {
        Lampa.SettingsApi.addComponent({ component: COMPONENT_ID, name: 'TorBox', icon: ICON });

        const params = [
            {
                key: 'torbox_api_key',
                field: { name: 'API-Key', description: 'Персональный ключ TorBox' },
                type: 'input',
                def: getConfig().apiKey,
            },
            {
                key: 'torbox_cached_only',
                field: { name: 'Только кэшированные', description: 'Показывать только раздачи, уже имеющиеся в кэше TorBox' },
                type: 'trigger',
                def: getConfig().cachedOnly,
            },
            {
                key: 'torbox_redirect',
                field: { name: 'Перехватывать TorrServer', description: 'Автоматически отправлять торренты в TorBox вместо TorrServer' },
                type: 'trigger',
                def: getConfig().redirect,
            },
            {
                key: 'torbox_debug',
                field: { name: 'Debug-режим', description: 'Выводить подробные логи в консоль разработчика' },
                type: 'trigger',
                def: getConfig().debug,
            }
        ];

        params.forEach((p) => {
            Lampa.SettingsApi.addParam({
                component: COMPONENT_ID,
                param: { name: p.key, type: p.type, default: p.def },
                field: p.field,
                onChange(value) {
                    storage(p.key, p.type === 'trigger' ? Boolean(value) : (value || '').trim());
                },
            });
        });
    }

    /** Legacy Settings via Direct Injection */
    function buildSettingsLegacy() {
        const folder = $(
            `<div class="settings-folder">
                <div class="settings-folder__title">TorBox</div>
                <div class="settings-folder__body"></div>
            </div>`
        );
        const body = folder.find('.settings-folder__body');

        const items = [
            { label: 'API Ключ', key: 'torbox_api_key', type: 'input' },
            { label: 'Только кэшированные', key: 'torbox_cached_only', type: 'trigger' },
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

        $('.settings-content .settings-list').append(folder);
    }
    
    // --- Core Logic ---

    function startTorBoxStream(hash) {
        const { apiKey } = getConfig();
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
                // Fallback на добавление, если прямая ссылка не пришла
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
        if (!window.Lampa || !window.Lampa.Torrent) return;

        const originalOpen = window.Lampa.Torrent.open ? window.Lampa.Torrent.open.bind(window.Lampa.Torrent) : null;

        // Главный механизм перехвата
        window.Lampa.Torrent.open = function patchedOpen(object) {
            const cfg = getConfig();
            const hash = (typeof object === 'string' ? object : (object?.magnet || object?.hash || object?.url || ''));
            const isMagnet = /^magnet:|^[a-f0-9]{40}$/i.test(hash);

            if (cfg.redirect && isMagnet) {
                logger('Перехват TorrServer -> TorBox:', hash);
                startTorBoxStream(hash);
                return;
            }
            if (originalOpen) return originalOpen(object);
        };

        // Запасной механизм: кнопка в меню
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

    function initPlugin(useApi) {
        try {
            logger(`Инициализация плагина. Использовать SettingsApi: ${useApi}`);
            useApi ? buildSettingsApi() : buildSettingsLegacy();
            interceptTorrServer();
            logger('Плагин готов');
        } catch (err) {
            console.error(`${PLUGIN_ID}: ошибка инициализации`, err);
        }
    }

    // Ожидание полной загрузки Lampa
    (function waitForLampa() {
        let waited = 0;
        const loop = setInterval(() => {
            const isReady = window.Lampa && (window.Lampa.SettingsApi || (window.Lampa.Settings && window.Lampa.Settings.listener));
            if (isReady) {
                clearInterval(loop);
                logger('Lampa готова, запускаем плагин.');
                initPlugin(Boolean(window.Lampa.SettingsApi));
            } else {
                waited += WAIT_STEP;
                if (waited >= MAX_WAIT) {
                    clearInterval(loop);
                    console.error(`${PLUGIN_ID}: Lampa не загрузилась за ${MAX_WAIT / 1000}с.`);
                }
            }
        }, WAIT_STEP);
    })();

})();
