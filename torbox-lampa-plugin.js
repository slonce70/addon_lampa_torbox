/**
 * TorBox Interceptor Lampa Plugin - Версия 5.0.0 (Master Key Edition)
 *
 * АРХИТЕКТУРНОЕ ВМЕШАТЕЛЬСТВО:
 * - Полностью переписан механизм создания меню настроек с использованием надежного компонентного подхода Lampa.
 * - Код очищен от всех избыточных модулей и оптимизирован для максимальной производительности и читаемости.
 * - Упрощена и усилена логика перехвата торрентов и взаимодействия с API.
 * - Это окончательное решение проблемы с отображением меню.
 */

(function() {
    'use strict';

    // --- ЕДИНЫЙ ОБЪЕКТ ПЛАГИНА ДЛЯ ЧИСТОТЫ КОДА ---
    const Torb = {
        name: 'TorBox Interceptor',
        version: '5.0.0',
        api_base: 'https://api.torbox.app/v1/api',

        // --- Утилиты ---
        utils: {
            toast(message, type = 'info') {
                if (window.Lampa) Lampa.Noty.show(message, { type, timeout: 4000 });
            },
            log(message, data = '') {
                if (Torb.config.get('debugMode')) {
                    console.log(`[${Torb.name}]`, message, data);
                }
            },
            humanFileSize(bytes) {
                if (bytes == 0) return '0 B';
                const i = Math.floor(Math.log(bytes) / Math.log(1024));
                return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${['B', 'KB', 'MB', 'GB', 'TB'][i]}`;
            }
        },

        // --- Управление конфигурацией ---
        config: {
            defaults: {
                apiKey: '',
                autoDelete: true,
                debugMode: false,
            },
            get(key) {
                const stored = localStorage.getItem(`torbox_${key}`);
                return stored === null ? this.defaults[key] : JSON.parse(stored);
            },
            set(key, value) {
                localStorage.setItem(`torbox_${key}`, JSON.stringify(value));
            },
            validateApiKey: (key) => typeof key === 'string' && /^[a-zA-Z0-9_]{32,128}$/.test(key.trim()),
            encrypt: (data) => btoa(unescape(encodeURIComponent(data))),
            decrypt: (data) => { try { return decodeURIComponent(escape(atob(data))); } catch { return ''; } }
        },

        // --- Клиент API ---
        api: {
            async request(endpoint, options = {}) {
                const apiKey = Torb.config.decrypt(Torb.config.get('apiKey'));
                if (!Torb.config.validateApiKey(apiKey)) {
                    throw new Error('API ключ не налаштовано або невірний.');
                }
                const url = Torb.api_base + endpoint;
                const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...options.headers };
                
                const response = await fetch(url, { ...options, headers });
                if (!response.ok) {
                    const errorBody = await response.json().catch(() => ({ message: `HTTP Помилка ${response.status}` }));
                    throw new Error(errorBody.message);
                }
                return response.status === 204 ? { success: true } : response.json();
            },
            get: (endpoint) => Torb.api.request(endpoint, { method: 'GET' }),
            post: (endpoint, body) => Torb.api.request(endpoint, { method: 'POST', body: JSON.stringify(body) }),
            put: (endpoint, body) => Torb.api.request(endpoint, { method: 'PUT', body: JSON.stringify(body) }),
        },

        // --- Основная логика ---

        /**
         * Рендерит HTML-содержимое для окна настроек.
         * @returns {HTMLElement} - Готовый HTML элемент.
         */
        renderSettings() {
            const container = document.createElement('div');
            const settingsMap = [
                { key: 'apiKey', name: 'API Ключ', type: 'text', placeholder: 'Введіть ваш ключ' },
                { key: 'autoDelete', name: 'Авто-видалення', type: 'toggle' },
                { key: 'debugMode', name: 'Режим відладки (Debug)', type: 'toggle' },
            ];

            settingsMap.forEach(item => {
                let current_value = Torb.config.get(item.key);
                if (item.key === 'apiKey') current_value = '********'; // Маскируем ключ

                const field = Lampa.Template.get('settings_param', {
                    name: item.name,
                    value: item.type === 'toggle' ? (current_value ? 'Так' : 'Ні') : current_value
                });

                field.on('hover:enter', () => {
                    if (item.type === 'toggle') {
                        const newValue = !Torb.config.get(item.key);
                        Torb.config.set(item.key, newValue);
                        field.find('.settings-param__value').text(newValue ? 'Так' : 'Ні');
                        Torb.utils.toast(`${item.name} ${newValue ? 'увімкнено' : 'вимкнено'}`);
                    }
                    if (item.type === 'text') {
                        Lampa.Input.edit({
                            title: item.name,
                            value: Torb.config.decrypt(Torb.config.get(item.key)),
                            free: true,
                            nosave: true
                        }, (new_val) => {
                            if (Torb.config.validateApiKey(new_val)) {
                                Torb.config.set('apiKey', Torb.config.encrypt(new_val));
                                field.find('.settings-param__value').text('********');
                                Torb.utils.toast('API ключ збережено');
                            } else if (new_val === '') {
                                Torb.config.set('apiKey', '');
                                field.find('.settings-param__value').text('');
                                Torb.utils.toast('API ключ видалено');
                            } else {
                                Torb.utils.toast('Невірний формат API ключа', 'error');
                            }
                        });
                    }
                });
                container.appendChild(field[0]);
            });
            return container;
        },

        /**
         * Создает компонент настроек и регистрирует его в Lampa.
         */
        createSettings() {
            Lampa.Component.add('torbox_settings_component', {
                render: () => {
                    const content = Torb.renderSettings();
                    // Возвращаем объект, который Lampa может обработать
                    return Lampa.Template.get('scroll_content', {
                        title: Torb.name,
                        source: content
                    });
                }
            });

            // Теперь добавляем ПУНКТ в меню, который запускает наш компонент
            Lampa.Settings.add({
                name: Torb.name,
                icon: '&#xe641;',
                onSelect: () => {
                    Lampa.Activity.push({
                        url: '', //
                        title: Torb.name,
                        component: 'torbox_settings_component',
                        page: 1
                    });
                }
            });
            Torb.utils.log('Компонент настроек успешно создан и зарегистрирован.');
        },

        /**
         * Перехватывает стандартный обработчик торрентов.
         */
        overrideHandler() {
            if (typeof Lampa.Torrents.start !== 'function') return;

            const originalStart = Lampa.Torrents.start;
            Lampa.Torrents.start = async (torrentData) => {
                const apiKey = Torb.config.decrypt(Torb.config.get('apiKey'));
                if (!Torb.config.validateApiKey(apiKey) || !torrentData.magnet) {
                    return originalStart(torrentData);
                }

                Torb.utils.log('Перехоплено торрент:', torrentData.title);
                Lampa.Loading.start(undefined, `TorBox: Відправка...`);

                try {
                    const addResponse = await Torb.api.post('/torrents/createtorrent', { magnet: torrentData.magnet });
                    const torrentId = addResponse.data?.id || addResponse.id;
                    if (!torrentId) throw new Error('TorBox не повернув ID торрента.');
                    
                    Torb.utils.log(`Торрент додано: ${torrentId}`);

                    let videoFile;
                    for (let i = 0; i < 20; i++) { // Ждем до 100 секунд
                        Lampa.Loading.update(`TorBox: Обробка файлів...`);
                        const info = await Torb.api.get(`/torrents/torrentinfo?id=${torrentId}`);
                        const files = info.data?.files || [];
                        const potentialVideo = files.filter(f => /\.(mkv|mp4|avi)$/i.test(f.name)).sort((a, b) => b.size - a.size)[0];
                        if (potentialVideo) {
                            videoFile = potentialVideo;
                            break;
                        }
                        await new Promise(resolve => setTimeout(resolve, 5000));
                    }

                    if (!videoFile) throw new Error('Не знайдено відеофайлів у торренті.');
                    
                    Lampa.Loading.update(`TorBox: Отримання посилання...`);
                    const streamInfo = await Torb.api.get(`/torrents/requestdl?token=${apiKey}&torrent_id=${torrentId}&file_id=${videoFile.id}&zip_link=false`);
                    const streamUrl = streamInfo.data || streamInfo.url || streamInfo;
                    if (!streamUrl) throw new Error('Не вдалося отримати посилання на стрім.');
                    
                    Lampa.Loading.stop();
                    Lampa.Player.play({ url: streamUrl, title: videoFile.name });

                    if (Torb.config.get('autoDelete')) {
                        Lampa.Player.listener.follow('destroy', () => {
                            Torb.utils.log(`Видалення торрента ${torrentId} після перегляду.`);
                            Torb.api.put('/torrents/controltorrent', { torrent_id: torrentId, operation: 'delete' })
                                .catch(e => Torb.utils.log('Помилка авто-видалення:', e.message));
                        });
                    }

                } catch (e) {
                    Lampa.Loading.stop();
                    Torb.utils.toast(e.message, 'error');
                    Torb.utils.log('Помилка обробки:', e);
                }
            };
            Torb.utils.log('Перехоплювач торрентів активовано.');
        },

        /**
         * Инициализация всего плагина.
         */
        init() {
            try {
                this.createSettings();
                this.overrideHandler();
                this.utils.toast(`${this.name} v${this.version} завантажено!`, 'success');
            } catch (e) {
                this.utils.toast(`Помилка запуску ${this.name}`, 'error');
                console.error(`[${this.name}]`, 'Критична помилка ініціалізації:', e);
            }
        }
    };

    // --- ЗАПУСК ПЛАГИНА ---
    // Единственный надежный способ дождаться полной загрузки Lampa
    if (window.Lampa) {
        Torb.init();
    } else {
        document.addEventListener('Lampa.ready', Torb.init.bind(Torb), { once: true });
    }

})();
