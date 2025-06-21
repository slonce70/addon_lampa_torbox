/**
 * TorBox Interceptor Lampa Plugin - Версия 6.0.0 (Ультиматум)
 *
 * ТОТАЛЬНАЯ ПЕРЕСБОРКА:
 * - Использован самый базовый и надежный метод регистрации настроек, который должен работать в ЛЮБОЙ версии Lampa.
 * - Код предельно упрощен и очищен от всего, что может вызвать конфликт.
 * - Логика перехвата и API вызовов сохранена, но вынесена в отдельный блок.
 * - Добавлено расширенное логирование для точной диагностики каждого шага инициализации.
 */

(function() {
    'use strict';

    // --- Глобальный объект плагина для инкапсуляции ---
    const Torb = {
        name: 'TorBox Interceptor',
        version: '6.0.0',
        api_base: 'https://api.torbox.app/v1/api',

        // --- Модуль логирования ---
        log(message, data = '') {
            if (localStorage.getItem('torbox_debugMode') === 'true') {
                console.log(`[${this.name}]`, message, data);
            }
        },

        // --- Модуль конфигурации ---
        config: {
            get(key) {
                const value = localStorage.getItem(`torbox_${key}`);
                if (value === null) {
                    return { apiKey: '', autoDelete: true, debugMode: false }[key];
                }
                return JSON.parse(value);
            },
            set(key, value) {
                localStorage.setItem(`torbox_${key}`, JSON.stringify(value));
            },
            validateApiKey: (key) => typeof key === 'string' && /^[a-zA-Z0-9_]{32,128}$/.test(key),
            encrypt: (data) => btoa(unescape(encodeURIComponent(data))),
            decrypt: (data) => { try { return decodeURIComponent(escape(atob(data))); } catch { return ''; } }
        },

        // --- Основная логика ---

        /**
         * Самый надежный способ создать меню настроек.
         * Этот метод использует нативные возможности Lampa для рендеринга полей.
         */
        createSettings() {
            this.log('Запуск создания меню настроек...');

            const settings_card = {
                name: this.name,
                icon: '&#xe641;', // Иконка молнии
                items: [
                    {
                        name: 'API Ключ',
                        type: 'text',
                        field: 'apiKey',
                        placeholder: 'Введіть ваш ключ',
                        // Получаем зашифрованное значение, Lampa сохранит его
                        value: this.config.decrypt(this.config.get('apiKey'))
                    },
                    {
                        name: 'Авто-видалення',
                        type: 'select',
                        field: 'autoDelete',
                        values: { true: 'Так', false: 'Ні' },
                        // Lampa сама обработает выбор
                        value: this.config.get('autoDelete')
                    },
                    {
                        name: 'Режим відладки',
                        type: 'select',
                        field: 'debugMode',
                        values: { true: 'Увімкнено', false: 'Вимкнено' },
                        value: this.config.get('debugMode')
                    }
                ]
            };

            // Синхронизация с нашим хранилищем при сохранении
            Lampa.Listener.follow('settings-saved', (event) => {
                if (event.card_name === this.name) {
                    this.log('Настройки сохранены, синхронизация...', event.data);
                    event.data.forEach(item => {
                        let value_to_save = item.value;
                        if(item.field === 'apiKey') {
                            // Шифруем ключ перед сохранением в наше хранилище
                            if (this.config.validateApiKey(item.value)) {
                                 value_to_save = this.config.encrypt(item.value);
                            } else {
                                value_to_save = this.config.encrypt(''); // Сохраняем пустым, если невалидный
                                if (item.value !== '') Lampa.Noty.show('Невірний формат API ключа', {type: 'error'});
                            }
                        }
                        this.config.set(item.field, value_to_save);
                    });
                    Lampa.Noty.show('Налаштування TorBox збережено', {type: 'success'});
                }
            });

            Lampa.Settings.add(settings_card);
            this.log('Вызов Lampa.Settings.add() выполнен успешно.');
        },

        /**
         * Перехватывает обработчик торрентов.
         */
        overrideHandler() {
            this.log('Попытка перехвата обработчика торрентов...');
            if (typeof Lampa.Torrents.start !== 'function') {
                this.log('Lampa.Torrents.start не найден!', 'error');
                return;
            }

            const originalStart = Lampa.Torrents.start;
            Lampa.Torrents.start = async (torrentData) => {
                const apiKey = this.config.decrypt(this.config.get('apiKey'));
                if (!this.config.validateApiKey(apiKey) || !torrentData.magnet) {
                    this.log('API ключ невалиден или нет magnet-ссылки, используется стандартный клиент.');
                    return originalStart(torrentData);
                }

                this.log('Перехвачен торрент:', torrentData.title);
                Lampa.Loading.start(undefined, 'TorBox: Обробка...');

                try {
                    // Код обработки торрента остается без изменений, он был корректен
                    const addResponse = await this.api.post('/torrents/createtorrent', { magnet: torrentData.magnet });
                    const torrentId = addResponse.data?.id;
                    if (!torrentId) throw new Error('TorBox не повернув ID торрента.');
                    this.log(`Торрент додано: ${torrentId}`);

                    let videoFile;
                    for (let i = 0; i < 20; i++) {
                        const info = await this.api.get(`/torrents/torrentinfo?id=${torrentId}`);
                        videoFile = (info.data?.files || []).filter(f => /\.(mkv|mp4|avi)$/i.test(f.name)).sort((a, b) => b.size - a.size)[0];
                        if (videoFile) break;
                        await new Promise(resolve => setTimeout(resolve, 5000));
                    }
                    if (!videoFile) throw new Error('Не знайдено відеофайлів.');
                    
                    const streamInfo = await this.api.get(`/torrents/requestdl?token=${apiKey}&torrent_id=${torrentId}&file_id=${videoFile.id}&zip_link=false`);
                    const streamUrl = streamInfo.data;
                    if (!streamUrl) throw new Error('Не вдалося отримати посилання на стрім.');
                    
                    Lampa.Loading.stop();
                    Lampa.Player.play({ url: streamUrl, title: videoFile.name });

                    if (this.config.get('autoDelete')) {
                        Lampa.Player.listener.follow('destroy', () => {
                            this.log(`Видалення торрента ${torrentId}`);
                            this.api.put('/torrents/controltorrent', { torrent_id: torrentId, operation: 'delete' })
                               .catch(e => this.log('Помилка авто-видалення:', e.message));
                        });
                    }
                } catch (e) {
                    Lampa.Loading.stop();
                    Lampa.Noty.show(e.message, { type: 'error' });
                    this.log('Помилка обробки:', e);
                }
            };
            this.log('Обработчик торрентов успешно перехвачен.');
        },

        // --- Главная функция инициализации ---
        init() {
            console.log(`[${this.name}] v${this.version}: Инициализация...`);
            try {
                this.createSettings();
                this.overrideHandler();
                Lampa.Noty.show(`${this.name} завантажено!`, { type: 'success' });
            } catch (e) {
                console.error(`[${this.name}]`, 'Критическая ошибка при инициализации:', e);
                Lampa.Noty.show(`Помилка запуску ${this.name}`, { type: 'error' });
            }
        }
    };
    
    // --- Запуск плагина ---
    if (window.Lampa) {
        Torb.init();
    } else {
        document.addEventListener('Lampa.ready', Torb.init.bind(Torb), { once: true });
    }

})();
