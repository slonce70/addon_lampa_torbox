/**
 * TorBox Interceptor Lampa Plugin - Версия 4.0.0 (Божественное Вмешательство)
 *
 * АРХИТЕКТУРНЫЕ ИСПРАВЛЕНИЯ:
 * - Полностью удален некорректный модуль SettingsInterface и заменен на каноничный метод Lampa API.
 * - Полностью удален неэффективный TorrentHandler и заменен на прямой перехватчик Lampa.Torrents.start.
 * - Исправлены все эндпоинты и методы API в соответствии с предоставленной документацией.
 * - Удален весь избыточный и неиспользуемый код ("мусор").
 * - Структура приведена к чистому, рабочему состоянию.
 */

(function() {
    'use strict';

    // --- КОНСТАНТЫ И БАЗОВЫЕ МОДУЛИ ---
    const PLUGIN_ID = 'torbox_god_mode';
    const PLUGIN_VERSION = '4.0.0';
    const API_BASE_URL = 'https://api.torbox.app/v1/api'; //
    const RATE_LIMIT_REQUESTS = 10; //
    const RATE_LIMIT_WINDOW = 60000; //

    const Utils = {
        toast(message, type = 'info', duration = 4000) {
            if (window.Lampa && Lampa.Noty) Lampa.Noty.show(message, { type, timeout: duration });
            else console.log(`[${type.toUpperCase()}] ${message}`);
        },
        log(message, level = 'info', data = {}) {
            if (level === 'debug' && !Config.get('debugMode')) return;
            console[level](`[TorBox GOD MODE]`, { timestamp: new Date().toISOString(), message, ...data });
        }
    };

    class TorBoxError extends Error {
        constructor(message, code) {
            super(message);
            this.name = 'TorBoxError';
            this.code = code;
        }
    }

    const Security = {
        validateMagnetUri: (uri) => uri && typeof uri === 'string' && /^magnet:\?xt=urn:[a-z0-9]+:[a-z0-9]{32,40}/i.test(uri),
        encryptData: (data) => btoa(unescape(encodeURIComponent(data))),
        decryptData: (data) => { try { return decodeURIComponent(escape(atob(data))); } catch { return ''; } }
    };

    const Config = {
        defaults: {
            apiKey: '',
            autoDelete: true,
            debugMode: false,
            connectionTimeout: 30000, //
            retryAttempts: 3 //
        },
        get(key) {
            try {
                const stored = localStorage.getItem(`torbox_${key}`);
                if (stored === null) return this.defaults[key];
                let value = JSON.parse(stored);
                return key === 'apiKey' ? Security.decryptData(value) : value;
            } catch { return this.defaults[key]; }
        },
        set(key, value) {
            const valueToStore = key === 'apiKey' ? Security.encryptData(value) : value;
            localStorage.setItem(`torbox_${key}`, JSON.stringify(valueToStore));
        },
        validateApiKey: (key) => key && typeof key === 'string' && /^[a-zA-Z0-9_]{32,128}$/.test(key.trim()) //
    };
    
    const RateLimiter = {
        requests: [],
        isAllowed() {
            const now = Date.now();
            this.requests = this.requests.filter(time => now - time < RATE_LIMIT_WINDOW);
            if (this.requests.length >= RATE_LIMIT_REQUESTS) return false;
            this.requests.push(now);
            return true;
        }
    };

    const ApiClient = {
        async request(endpoint, options = {}) {
            if (!RateLimiter.isAllowed()) throw new TorBoxError('Перевищено ліміт запитів.', 'RATE_LIMIT');
            
            const apiKey = Config.get('apiKey');
            if (!Config.validateApiKey(apiKey)) throw new TorBoxError('API ключ не налаштовано або невірний.', 'INVALID_API_KEY');

            const url = `${API_BASE_URL}${endpoint}`;
            const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...options.headers };
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), Config.get('connectionTimeout'));

            try {
                const response = await fetch(url, { ...options, headers, signal: controller.signal });
                if (!response.ok) {
                    const errorBody = await response.json().catch(() => ({ message: `HTTP Помилка ${response.status}` }));
                    throw new TorBoxError(errorBody.message, `HTTP_${response.status}`);
                }
                // Для DELETE и других запросов без тела ответа
                return response.status === 204 ? { success: true } : await response.json();
            } catch (error) {
                if (error.name === 'AbortError') throw new TorBoxError('Запит перевищив час очікування.', 'TIMEOUT');
                throw error;
            } finally {
                clearTimeout(timeoutId);
            }
        },
        get: function(endpoint, options={}) { return this.request(endpoint, { ...options, method: 'GET' }); },
        post: function(endpoint, options={}) { return this.request(endpoint, { ...options, method: 'POST' }); },
        put: function(endpoint, options={}) { return this.request(endpoint, { ...options, method: 'PUT' }); }
    };

    // --- СЕКЦИЯ: ИСПРАВЛЕННАЯ И РАБОЧАЯ ЛОГИКА ---

    /**
     * ПРАВИЛЬНЫЙ способ добавить меню настроек. Оно появится в Настройки > Плагины.
     */
    function createSettingsMenu() {
        const settingsCard = {
            name: 'TorBox Interceptor',
            icon: '&#xe641;', // Иконка молнии
            items: [
                {
                    name: 'API Ключ',
                    type: 'text',
                    field: 'apiKey',
                    placeholder: 'Введіть ваш API ключ від TorBox',
                    description: 'Ключ необхідний для доступу до вашого аккаунту TorBox.'
                },
                {
                    name: 'Авто-видалення після перегляду',
                    type: 'select',
                    field: 'autoDelete',
                    values: { 'true': 'Так', 'false': 'Ні' },
                    description: 'Автоматично видаляти торрент з хмари TorBox після закриття плеєра.' //
                },
                {
                    name: 'Режим відладки (Debug)',
                    type: 'select',
                    field: 'debugMode',
                    values: { 'true': 'Увімкнено', 'false': 'Вимкнено' },
                    description: 'Включає докладне логування в консолі розробника (F12).' //
                }
            ]
        };

        // Связываем с нашим Config
        settingsCard.items.forEach(item => {
            const storedValue = Config.get(item.field);
            Lampa.Storage.set(item.field, typeof storedValue === 'boolean' ? String(storedValue) : storedValue);
        });

        Lampa.Listener.follow('settings-saved', (event) => {
            // Lampa 1.8.0+ использует card_name
            if (event.card_name === 'TorBox Interceptor' || event.card.name === 'TorBox Interceptor') {
                settingsCard.items.forEach(item => {
                    const valueFromLampa = Lampa.Storage.get(item.field);
                    const isBooleanSelect = item.type === 'select' && (valueFromLampa === 'true' || valueFromLampa === 'false');
                    const finalValue = isBooleanSelect ? (valueFromLampa === 'true') : valueFromLampa;
                    Config.set(item.field, finalValue);
                });
                Utils.toast('Налаштування TorBox збережено', 'success');
            }
        });

        Lampa.Settings.add(settingsCard);
        Utils.log('Меню налаштувань успішно створено.');
    }

    /**
     * ПРАВИЛЬНЫЙ способ перехвата торрентов.
     */
    function overrideTorrentHandler() {
        if (!window.Lampa || !Lampa.Torrents || typeof Lampa.Torrents.start !== 'function') {
            return Utils.log('Lampa.Torrents.start не знайдено, перехоплення неможливе.', 'error');
        }

        const originalTorrentStart = Lampa.Torrents.start;
        Utils.log('Оригінальний обробник Lampa.Torrents.start збережено.', 'debug');

        Lampa.Torrents.start = async function(torrentData, ...args) {
            if (!Config.validateApiKey(Config.get('apiKey'))) {
                Utils.log('API ключ не налаштовано. Використовується стандартний клієнт.', 'warn');
                return originalTorrentStart.apply(this, [torrentData, ...args]);
            }

            if (!torrentData.magnet || !Security.validateMagnetUri(torrentData.magnet)) {
                 Utils.log('Дані не містять magnet-посилання. Використовується стандартний клієнт.', 'warn');
                return originalTorrentStart.apply(this, [torrentData, ...args]);
            }

            Lampa.Loading.start(undefined, `TorBox: Відправка торрента...`);
            Utils.log('Перехоплено торрент для обробки через TorBox.', 'info', { title: torrentData.title });

            try {
                // Шаг 1: Добавляем торрент.
                const addResponse = await ApiClient.post('/torrents/createtorrent', {
                    body: JSON.stringify({ magnet: torrentData.magnet })
                });

                const torrentId = addResponse.data?.id || addResponse.id;
                if (!torrentId) throw new TorBoxError('TorBox не повернув ID торрента.', 'API_ERROR');
                Utils.log(`Торрент додано. ID: ${torrentId}`, 'debug');

                // Шаг 2: Эффективный опрос статуса ОДНОГО торрента.
                let videoFile;
                for (let i = 0; i < 20; i++) { // Максимум 100 секунд ожидания
                    Lampa.Loading.update(`TorBox: Обробка файлів...`);
                    const infoResponse = await ApiClient.get(`/torrents/torrentinfo?id=${torrentId}`); //
                    const files = infoResponse.data?.files || [];
                    
                    if (files.length > 0) {
                        videoFile = files.filter(f => /\.(mkv|mp4|avi|mov|wmv)$/i.test(f.name)).sort((a, b) => b.size - a.size)[0];
                        if (videoFile) {
                             Utils.log('Відеофайл знайдено.', 'info', { file: videoFile.name });
                             break;
                        }
                    }
                    if (i === 19) throw new TorBoxError('Таймаут очікування. TorBox не зміг обробити торрент.', 'TIMEOUT_ERROR');
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }

                // Шаг 3: Получаем ссылку на стриминг.
                Lampa.Loading.update(`TorBox: Отримання посилання...`);
                const streamResponse = await ApiClient.get(`/torrents/requestdl?token=${Config.get('apiKey')}&torrent_id=${torrentId}&file_id=${videoFile.id}&zip_link=false`);
                
                const streamUrl = streamResponse.data || streamResponse.url || streamResponse;
                if (!streamUrl || typeof streamUrl !== 'string') throw new TorBoxError('Не вдалося отримати посилання на стрім.', 'API_ERROR');
                
                Lampa.Loading.stop();

                // Шаг 4: Запускаем плеер
                Lampa.Player.play({ url: streamUrl, title: videoFile.name });

                // Шаг 5: Авто-удаление.
                if (Config.get('autoDelete')) {
                    Lampa.Player.listener.follow('destroy', () => {
                        Utils.log(`Плеєр закрито. Запуск видалення торрента ID: ${torrentId}`, 'info');
                        ApiClient.put('/torrents/controltorrent', { //
                           body: JSON.stringify({ torrent_id: torrentId, operation: 'delete' })
                        }).then(() => Utils.log(`Торрент ${torrentId} успішно видалено.`, 'info'))
                          .catch(e => Utils.log(`Помилка авто-видалення.`, 'error', { error: e.message }));
                    });
                }

            } catch (error) {
                Lampa.Loading.stop();
                Utils.toast(error.message, 'error');
                Utils.log('Критична помилка обробки.', 'error', { error });
            }
        };
        Utils.log('Перехоплювач торрентів успішно встановлено.');
    }

    /**
     * Главная функция инициализации плагина
     */
    function initializePlugin() {
        try {
            createSettingsMenu();
            overrideTorrentHandler();
            Utils.toast('TorBox Interceptor: готовий до роботи!', 'success');
        } catch (error) {
            Utils.toast('Критична помилка ініціалізації TorBox плагіна.', 'error');
            Utils.log('Помилка ініціалізації.', 'error', { error });
        }
    }

    // Единственный надежный способ дождаться полной загрузки Lampa
    document.addEventListener('Lampa.ready', initializePlugin, { once: true });

})();
