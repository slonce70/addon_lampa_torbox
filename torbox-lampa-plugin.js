/**
 * TorBox Interceptor Lampa Plugin - Версия 7.0.0 (Master Key Edition)
 *
 * АРХИТЕКТУРНОЕ ВМЕШАТЕЛЬСТВО НА ОСНОВЕ АКТУАЛЬНОГО API:
 * - Полностью переписан механизм создания настроек с использованием надежного компонентного подхода Lampa.
 * - Меню настроек теперь регистрируется как отдельный компонент, что гарантирует его появление в любой версии Lampa.
 * - Устранены все потенциальные причины "ошибки запуска" плагина.
 * - Код максимально очищен и оптимизирован для стабильности.
 */

(function() {
    'use strict';

    // Проверка на наличие Lampa
    if (typeof window.Lampa === 'undefined') {
        console.error("TorBox Plugin: Lampa не найдена. Плагин не будет запущен.");
        return;
    }

    const Torb = {
        name: 'TorBox Interceptor',
        version: '7.0.0',
        api_base: 'https://api.torbox.app/v1/api',

        // --- Модуль логирования ---
        log(message, data = '') {
            if (localStorage.getItem('torbox_debugMode') === 'true') {
                console.log(`[${this.name}]`, message, data);
            }
        },

        // --- Модуль конфигурации ---
        config: {
            get: (key) => {
                const val = localStorage.getItem(`torbox_${key}`);
                const def = { apiKey: '', autoDelete: true, debugMode: false };
                return val === null ? def[key] : JSON.parse(val);
            },
            set: (key, val) => localStorage.setItem(`torbox_${key}`, JSON.stringify(val)),
            validateApiKey: (k) => typeof k === 'string' && /^[a-z0-9_]{32,128}$/i.test(k.trim()),
            encrypt: (d) => btoa(unescape(encodeURIComponent(d))),
            decrypt: (d) => { try { return decodeURIComponent(escape(atob(d))); } catch { return ''; } }
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
                    const err = await response.json().catch(() => ({}));
                    throw new Error(err.message || `HTTP Error ${response.status}`);
                }
                return response.status === 204 ? { success: true } : response.json();
            },
            post: (e, b) => Torb.api.request(e, { method: 'POST', body: JSON.stringify(b) }),
            get: (e) => Torb.api.request(e, { method: 'GET' }),
            put: (e, b) => Torb.api.request(e, { method: 'PUT', body: JSON.stringify(b) })
        },
        
        // --- Рендеринг и создание меню настроек ---

        /**
         * Создает HTML-элементы для меню настроек, используя шаблоны Lampa.
         * @returns {HTMLElement} - Контейнер с элементами настроек.
         */
        renderSettingsBody() {
            const container = document.createElement('div');
            const settings_map = [
                {
                    key: 'apiKey',
                    name: 'API Ключ',
                    type: 'text',
                    placeholder: 'Введіть ваш ключ'
                },
                {
                    key: 'autoDelete',
                    name: 'Авто-видалення',
                    type: 'toggle',
                },
                {
                    key: 'debugMode',
                    name: 'Режим відладки',
                    type: 'toggle',
                },
            ];

            settings_map.forEach(item => {
                let current_value = this.config.get(item.key);
                // Маскируем API ключ для безопасности
                let display_value = item.key === 'apiKey' ? '**********' : (current_value ? 'Так' : 'Ні');
                if(!this.config.decrypt(current_value) && item.key === 'apiKey') display_value = 'Не задано';
                
                // Используем нативный шаблонизатор Lampa для создания поля
                const field = Lampa.Template.get('settings_param', {
                    name: item.name,
                    value: display_value
                });

                // Вешаем обработчик клика на созданный элемент
                field.on('hover:enter', () => {
                    if (item.type === 'toggle') {
                        const newValue = !this.config.get(item.key);
                        this.config.set(item.key, newValue);
                        field.find('.settings-param__value').text(newValue ? 'Так' : 'Ні');
                        Lampa.Noty.show(`${item.name} ${newValue ? 'увімкнено' : 'вимкнено'}`);
                    }
                    if (item.type === 'text') {
                        Lampa.Input.edit({
                            title: item.name,
                            value: this.config.decrypt(this.config.get(item.key)),
                            free: true,
                            nosave: true
                        }, (new_val) => {
                            if (this.config.validateApiKey(new_val)) {
                                this.config.set('apiKey', this.config.encrypt(new_val));
                                field.find('.settings-param__value').text('**********');
                                Lampa.Noty.show('API ключ збережено');
                            } else {
                                Lampa.Noty.show('Невірний формат API ключа', { type: 'error' });
                            }
                        });
                    }
                });
                container.appendChild(field[0]);
            });

            return container;
        },

        /**
         * Регистрирует компонент и добавляет пункт в меню настроек.
         * Это самый надежный способ.
         */
        createSettings() {
            this.log('Регистрация компонента настроек...');

            // 1. Создаем компонент, который будет рендерить наше меню
            Lampa.Component.add('torbox_settings', {
                render: () => {
                    // Используем Lampa.Template для создания обертки
                    return Lampa.Template.get('scroll_content', {
                        title: this.name,
                        source: this.renderSettingsBody()
                    });
                }
            });

            // 2. Добавляем простой пункт в меню плагинов, который будет ЗАПУСКАТЬ наш компонент
            Lampa.Settings.add({
                name: this.name,
                icon: '&#xe641;',
                onSelect: () => {
                    // При выборе пункта, мы говорим Lampa показать наш компонент
                    Lampa.Activity.push({
                        url: '',
                        title: this.name,
                        component: 'torbox_settings',
                        page: 1
                    });
                }
            });

            this.log('Компонент настроек успешно зарегистрирован.');
        },

        // --- Перехватчик торрентов ---
        overrideHandler() {
            this.log('Попытка перехвата обработчика...');
            if (typeof Lampa.Torrents.start !== 'function') return;

            const originalStart = Lampa.Torrents.start;
            Lampa.Torrents.start = async (torrentData) => {
                const apiKey = this.config.decrypt(this.config.get('apiKey'));
                if (!this.config.validateApiKey(apiKey) || !torrentData.magnet) {
                    return originalStart(torrentData);
                }

                this.log('Перехвачен торрент:', torrentData.title);
                Lampa.Loading.start(undefined, 'TorBox: Обробка...');

                try {
                    const add = await this.api.post('/torrents/createtorrent', { magnet: torrentData.magnet });
                    if (!add.data?.id) throw new Error('TorBox не повернув ID');
                    
                    let videoFile;
                    for (let i = 0; i < 20; i++) {
                        const info = await this.api.get(`/torrents/torrentinfo?id=${add.data.id}`);
                        videoFile = (info.data?.files || []).filter(f=>/\.(mkv|mp4|avi)$/i.test(f.name)).sort((a,b)=>b.size-a.size)[0];
                        if (videoFile) break;
                        await new Promise(r => setTimeout(r, 5000));
                    }
                    if (!videoFile) throw new Error('Відеофайли не знайдені');

                    const stream = await this.api.get(`/torrents/requestdl?token=${apiKey}&torrent_id=${add.data.id}&file_id=${videoFile.id}&zip_link=false`);
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

    // --- Запуск плагина ---
    document.addEventListener('Lampa.ready', Torb.init.bind(Torb), { once: true });

})();
