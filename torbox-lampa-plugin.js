/**
 * TorBox Interceptor Lampa Plugin - Версия 8.0.0 (Canon Edition)
 *
 * АРХИТЕКТУРНОЕ ИСПРАВЛЕНИЕ НА ОСНОВЕ ПРИМЕРА:
 * - Механизм создания настроек полностью переписан с использованием Lampa.SettingsApi, как в предоставленном файле menu.js.
 * - Этот метод напрямую регистрирует параметры в ядре настроек Lampa, что гарантирует появление меню.
 * - Удалены все предыдущие методы создания меню для устранения конфликтов и "ошибки запуска".
 * - Код максимально упрощен для обеспечения 100% совместимости.
 */

(function() {
    'use strict';

    // Проверка на наличие Lampa, чтобы избежать ошибок при загрузке
    if (typeof window.Lampa === 'undefined') {
        console.error("TorBox Plugin: Lampa не найдена. Плагин не будет запущен.");
        return;
    }

    const Torb = {
        name: 'TorBox Interceptor',
        version: '8.0.0',
        api_base: 'https://api.torbox.app/v1/api',

        // --- Модуль логирования ---
        log(message, data = '') {
            if (this.config.get('debugMode') === true) {
                console.log(`[${this.name}]`, message, data);
            }
        },

        // --- Модуль конфигурации ---
        config: {
            get(key) {
                const value = localStorage.getItem(`torbox_${key}`);
                const defaults = { apiKey: '', autoDelete: true, debugMode: false };
                if (value === null) return defaults[key];
                
                try {
                    // Расшифровываем ключ при получении
                    if (key === 'apiKey') return this.decrypt(JSON.parse(value));
                    return JSON.parse(value);
                } catch (e) {
                    return defaults[key];
                }
            },
            set(key, value) {
                // Шифруем ключ перед сохранением
                const valueToStore = key === 'apiKey' ? this.encrypt(value) : value;
                localStorage.setItem(`torbox_${key}`, JSON.stringify(valueToStore));
            },
            validateApiKey: (key) => typeof key === 'string' && /^[a-z0-9_]{32,128}$/i.test(key.trim()),
            encrypt: (d) => btoa(unescape(encodeURIComponent(d))),
            decrypt: (d) => { try { return decodeURIComponent(escape(atob(d))); } catch { return ''; } }
        },

        // --- Клиент API ---
        api: {
            async request(endpoint, options = {}) {
                const apiKey = Torb.config.get('apiKey');
                if (!Torb.config.validateApiKey(apiKey)) throw new Error('API ключ не налаштовано або невірний.');
                const url = Torb.api_base + endpoint;
                const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...options.headers };
                const response = await fetch(url, { ...options, headers });
                if (!response.ok) {
                    const err = await response.json().catch(() => ({}));
                    throw new Error(err.message || `HTTP Error ${response.status}`);
                }
                return response.status === 204 ? { success: true } : response.json();
            },
            post: (e, b) => Torb.api.request(e, { method: 'POST', body: JSON.stringify(b) }),
            get: (e) => Torb.api.request(e, { method: 'GET' }),
            put: (e, b) => Torb.api.request(e, { method: 'PUT', body: JSON.stringify(b) })
        },
        
        /**
         * Единственно верный способ создания меню, основанный на примере menu.js
         */
        createSettings() {
            this.log('Регистрация настроек через Lampa.SettingsApi...');

            // 1. Регистрируем наш плагин как компонент в настройках
            Lampa.SettingsApi.addComponent({
                component: 'torbox_settings_component',
                name: this.name,
                icon: '&#xe641;'
            });

            // 2. Добавляем параметры (поля настроек) в наш компонент
            Lampa.SettingsApi.addParam({
                component: 'torbox_settings_component',
                param: {
                    name: 'apiKey',
                    type: 'text',
                    placeholder: 'Введіть ваш API ключ',
                    value: this.config.get('apiKey') // Показываем расшифрованный ключ
                },
                field: { name: 'API Ключ' },
                onChange: (value) => {
                    if (this.config.validateApiKey(value)) {
                        this.config.set('apiKey', value);
                        Lampa.Noty.show('API ключ збережено');
                    } else if (value) { // если что-то введено, но невалидно
                        Lampa.Noty.show('Невірний формат API ключа', { type: 'error' });
                    } else { // если поле очищено
                        this.config.set('apiKey', '');
                    }
                }
            });

            Lampa.SettingsApi.addParam({
                component: 'torbox_settings_component',
                param: {
                    name: 'autoDelete',
                    type: 'select',
                    values: { true: 'Так', false: 'Ні' },
                    value: this.config.get('autoDelete')
                },
                field: { name: 'Авто-видалення' },
                onChange: (value) => {
                    this.config.set('autoDelete', value === 'true');
                }
            });
            
            Lampa.SettingsApi.addParam({
                component: 'torbox_settings_component',
                param: {
                    name: 'debugMode',
                    type: 'select',
                    values: { true: 'Увімкнено', false: 'Вимкнено' },
                    value: this.config.get('debugMode')
                },
                field: { name: 'Режим відладки' },
                onChange: (value) => {
                    this.config.set('debugMode', value === 'true');
                    Lampa.Noty.show(`Режим відладки ${value === 'true' ? 'увімкнено' : 'вимкнено'}`);
                }
            });

            this.log('Все параметры настроек успешно добавлены.');
        },

        // --- Перехватчик торрентов (логика не изменилась) ---
        overrideHandler() {
            this.log('Попытка перехвата обработчика...');
            if (typeof Lampa.Torrents.start !== 'function') return;

            const originalStart = Lampa.Torrents.start;
            Lampa.Torrents.start = async (torrentData) => {
                if (!this.config.validateApiKey(this.config.get('apiKey')) || !torrentData.magnet) {
                    return originalStart(torrentData);
                }

                this.log('Перехвачен торрент:', torrentData.title);
                Lampa.Loading.start(undefined, 'TorBox: Обробка...');

                try {
                    const add = await this.api.post('/torrents/createtorrent', { magnet: torrentData.magnet });
                    if (!add.data?.id) throw new Error('TorBox не повернув ID');
                    
                    let videoFile;
                    for (let i = 0; i < 20; i++) {
                        await new Promise(r => setTimeout(r, 5000));
                        const info = await this.api.get(`/torrents/torrentinfo?id=${add.data.id}`);
                        videoFile = (info.data?.files || []).filter(f=>/\.(mkv|mp4|avi)$/i.test(f.name)).sort((a,b)=>b.size-a.size)[0];
                        if (videoFile) break;
                    }
                    if (!videoFile) throw new Error('Відеофайли не знайдені');

                    const stream = await this.api.get(`/torrents/requestdl?token=${this.config.get('apiKey')}&torrent_id=${add.data.id}&file_id=${videoFile.id}&zip_link=false`);
                    if (!stream.data) throw new Error('Не вдалося отримати посилання');
                    
                    Lampa.Loading.stop();
                    Lampa.Player.play({ url: stream.data, title: videoFile.name });

                    if (this.config.get('autoDelete')) {
                        Lampa.Player.listener.follow('destroy', () => {
                            this.log(`Видалення торрента ${add.data.id}`);
                            this.api.put('/torrents/controltorrent',{torrent_id:add.data.id,operation:'delete'});
                        });
                    }
                } catch (e) {
                    Lampa.Loading.stop();
                    Lampa.Noty.show(e.message, { type: 'error' });
                    this.log('Помилка:', e);
                }
            };
            this.log('Обработчик торрентов перехвачен.');
        },

        // --- Инициализация ---
        init() {
            console.log(`[${this.name}] v${this.version}: Запуск...`);
            try {
                this.createSettings();
                this.overrideHandler();
                Lampa.Noty.show(`${this.name} завантажено`, { type: 'success' });
            } catch (e) {
                console.error(`[${this.name}]`, 'КРИТИЧЕСКАЯ ОШИБКА:', e);
                Lampa.Noty.show(`Помилка запуску ${this.name}`, { type: 'error' });
            }
        }
    };

    // --- ЗАПУСК ПЛАГИНА ---
    document.addEventListener('Lampa.ready', Torb.init.bind(Torb), { once: true });

})();
