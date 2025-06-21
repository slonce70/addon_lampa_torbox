/**
 * TorBox Interceptor Lampa Plugin - Версия 6.0.0 (Отказоустойчивая)
 *
 * ТОТАЛЬНАЯ ПЕРЕСБОРКА ДЛЯ СОВМЕСТИМОСТИ:
 * - Использован самый базовый и надежный метод регистрации настроек, который должен работать в ЛЮБОЙ версии Lampa.
 * - Удален сложный компонентный подход, вызывавший конфликт.
 * - Код предельно упрощен для устранения ошибок при запуске.
 * - Добавлено расширенное логирование для диагностики.
 */

(function() {
    'use strict';

    // Убедимся, что Lampa доступна, прежде чем что-либо делать
    if (typeof window.Lampa === 'undefined') {
        console.error("TorBox Plugin: Lampa не найдена. Плагин не будет запущен.");
        return;
    }

    // --- Глобальный объект плагина ---
    const Torb = {
        name: 'TorBox Interceptor',
        version: '6.0.0',
        api_base: 'https://api.torbox.app/v1/api',

        // --- Модуль логирования ---
        log(message, data = '') {
            // Режим отладки теперь включается/выключается прямо в localStorage для диагностики до загрузки плагина
            if (localStorage.getItem('torbox_debugMode') === 'true') {
                console.log(`[${this.name}]`, message, data);
            }
        },

        // --- Модуль конфигурации ---
        config: {
            // Получение настроек из localStorage
            get(key) {
                const value = localStorage.getItem(`torbox_${key}`);
                const defaults = { apiKey: '', autoDelete: true, debugMode: false };
                if (value === null) return defaults[key];
                
                try {
                    return JSON.parse(value);
                } catch (e) {
                    return defaults[key];
                }
            },
            // Сохранение настроек в localStorage
            set(key, value) {
                localStorage.setItem(`torbox_${key}`, JSON.stringify(value));
            },
            // Валидация и шифрование ключа
            validateApiKey: (key) => typeof key === 'string' && /^[a-zA-Z0-9_]{32,128}$/.test(key.trim()),
            encrypt: (data) => btoa(unescape(encodeURIComponent(data))),
            decrypt: (data) => { try { return decodeURIComponent(escape(atob(data))); } catch { return ''; } }
        },

        // --- Клиент API ---
        api: {
            async request(endpoint, options = {}) {
                const apiKey = Torb.config.decrypt(Torb.config.get('apiKey'));
                if (!Torb.config.validateApiKey(apiKey)) throw new Error('API ключ не налаштовано або невірний.');
                
                const url = Torb.api_base + endpoint;
                const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...options.headers };
                
                const response = await fetch(url, { ...options, headers });
                if (!response.ok) {
                    const errorBody = await response.json().catch(() => ({ message: `HTTP Помилка ${response.status}` }));
                    throw new Error(errorBody.message);
                }
                return response.status === 204 ? { success: true } : await response.json();
            },
            post: (endpoint, body) => Torb.api.request(endpoint, { method: 'POST', body: JSON.stringify(body) }),
            get: (endpoint) => Torb.api.request(endpoint, { method: 'GET' }),
            put: (endpoint, body) => Torb.api.request(endpoint, { method: 'PUT', body: JSON.stringify(body) })
        },

        /**
         * Самый надежный и простой способ создать меню настроек.
         */
        createSettings() {
            Torb.log('Запуск создания меню настроек...');

            // Этот объект — стандартный и самый совместимый способ добавления настроек
            const settings_object = {
                name: Torb.name,
                icon: '&#xe641;',
                items: [
                    {
                        name: 'API Ключ',
                        type: 'text',
                        field: 'apiKey_decrypted', // Используем временное поле для отображения
                        value: Torb.config.decrypt(Torb.config.get('apiKey')),
                        placeholder: 'Введіть ваш ключ'
                    },
                    {
                        name: 'Авто-видалення',
                        type: 'select',
                        field: 'autoDelete',
                        values: { "true": 'Так', "false": 'Ні' },
                        value: Torb.config.get('autoDelete')
                    },
                    {
                        name: 'Режим відладки',
                        type: 'select',
                        field: 'debugMode',
                        values: { "true": 'Увімкнено', "false": 'Вимкнено' },
                        value: Torb.config.get('debugMode')
                    }
                ]
            };

            // Слушаем событие сохранения настроек от Lampa
            Lampa.Listener.follow('settings-saved', (event) => {
                if (event.card_name === Torb.name) {
                    Torb.log('Сохранение настроек...', event.data);
                    event.data.forEach(item => {
                        if (item.field === 'apiKey_decrypted') {
                            if (Torb.config.validateApiKey(item.value)) {
                                Torb.config.set('apiKey', Torb.config.encrypt(item.value));
                                Lampa.Noty.show('API ключ збережено');
                            } else if(item.value) { // если ввели что-то, но невалидное
                                Lampa.Noty.show('Невірний формат API ключа', {type: 'error'});
                            } else { // если поле пустое
                                Torb.config.set('apiKey', '');
                            }
                        } else {
                            // Для select Lampa возвращает строку 'true'/'false'
                            const valueToSet = (item.value === 'true' || item.value === 'false') ? JSON.parse(item.value) : item.value;
                            Torb.config.set(item.field, valueToSet);
                        }
                    });
                    Lampa.Noty.show('Налаштування TorBox збережено', {type: 'success'});
                }
            });

            // Добавляем нашу карточку настроек
            Lampa.Settings.add(settings_object);
            Torb.log('Меню настроек успешно зарегистрировано в Lampa.');
        },

        /**
         * Перехватывает обработчик торрентов.
         */
        overrideHandler() {
            Torb.log('Попытка перехвата обработчика...');
            if (typeof Lampa.Torrents.start !== 'function') {
                Torb.log('Lampa.Torrents.start не найден!');
                return;
            }

            const originalStart = Lampa.Torrents.start;
            Lampa.Torrents.start = async (torrentData) => {
                const apiKey = Torb.config.decrypt(Torb.config.get('apiKey'));
                if (!Torb.config.validateApiKey(apiKey) || !torrentData.magnet) {
                    return originalStart(torrentData);
                }

                Torb.log('Перехвачен торрент:', torrentData.title);
                Lampa.Loading.start(undefined, 'TorBox: Обробка...');

                try {
                    const addResponse = await Torb.api.post('/torrents/createtorrent', { magnet: torrentData.magnet });
                    const torrentId = addResponse.data?.id;
                    if (!torrentId) throw new Error('TorBox не повернув ID торрента.');
                    
                    let videoFile;
                    for (let i = 0; i < 20; i++) {
                        const info = await Torb.api.get(`/torrents/torrentinfo?id=${torrentId}`);
                        videoFile = (info.data?.files || []).filter(f => /\.(mkv|mp4|avi)$/i.test(f.name)).sort((a, b) => b.size - a.size)[0];
                        if (videoFile) break;
                        await new Promise(resolve => setTimeout(resolve, 5000));
                    }
                    if (!videoFile) throw new Error('Не знайдено відеофайлів.');
                    
                    const streamInfo = await Torb.api.get(`/torrents/requestdl?token=${apiKey}&torrent_id=${torrentId}&file_id=${videoFile.id}&zip_link=false`);
                    const streamUrl = streamInfo.data;
                    if (!streamUrl) throw new Error('Не вдалося отримати посилання на стрім.');
                    
                    Lampa.Loading.stop();
                    Lampa.Player.play({ url: streamUrl, title: videoFile.name });

                    if (Torb.config.get('autoDelete')) {
                        Lampa.Player.listener.follow('destroy', () => {
                            Torb.log(`Видалення торрента ${torrentId}`);
                            Torb.api.put('/torrents/controltorrent', { torrent_id: torrentId, operation: 'delete' })
                               .catch(e => Torb.log('Помилка авто-видалення:', e.message));
                        });
                    }
                } catch (e) {
                    Lampa.Loading.stop();
                    Lampa.Noty.show(e.message, { type: 'error' });
                    Torb.log('Помилка обробки торрента:', e);
                }
            };
            Torb.log('Обработчик торрентов успешно перехвачен.');
        },

        // --- Инициализация плагина ---
        init() {
            console.log(`[${this.name}] v${this.version}: Запуск инициализации...`);
            try {
                // Проверяем наличие необходимых модулей Lampa перед их использованием
                if (window.Lampa && Lampa.Settings && Lampa.Listener && Lampa.Torrents) {
                    this.createSettings();
                    this.overrideHandler();
                    Lampa.Noty.show(`${this.name} завантажено!`, { type: 'success' });
                } else {
                    throw new Error("Необходимые модули Lampa не найдены.");
                }
            } catch (e) {
                console.error(`[${this.name}]`, 'Критическая ошибка при инициализации:', e);
                // Показываем ошибку пользователю, если это возможно
                if(window.Lampa && Lampa.Noty) {
                    Lampa.Noty.show(`Помилка запуску ${this.name}`, { type: 'error' });
                }
            }
        }
    };

    // --- ЗАПУСК ПЛАГИНА ---
    // Используем самый надежный способ дождаться полной загрузки Lampa
    document.addEventListener('Lampa.ready', Torb.init.bind(Torb), { once: true });

})();
