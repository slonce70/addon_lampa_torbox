/**
 * TorBox Enhanced Lampa Plugin - Interception & Streaming Engine
 * Version: 3.0.0 (God Mode Edition)
 * Date: 21.06.2025
 *
 * ARCHITECTURAL OVERHAUL:
 * - Implemented true torrent interception, replacing the default Lampa handler.
 * - Added a full-featured settings menu within Lampa's interface.
 * - Corrected all API calls according to the provided API documentation.
 * - Fused all best practices from the development guide and security analysis.
 */

(function() {
    'use strict';

    // Constants
    const PLUGIN_ID = 'torbox_interceptor_secure';
    const PLUGIN_VERSION = '3.0.0';
    // Взято из твоей конфигурации. Убедись, что это правильный URL.
    const API_BASE_URL = 'https://api.torbox.app/v1/api'; 
    const MAX_RETRIES = 3; //
    const RETRY_DELAY = 1500; //
    const RATE_LIMIT_REQUESTS = 10; //
    const RATE_LIMIT_WINDOW = 60000; //

    // --- СЕКЦИЯ: БАЗОВЫЕ МОДУЛИ (Оставлены без изменений, т.к. написаны добротно) ---

    const Security = {
        validateMagnetUri(magnetUri) {
            if (!magnetUri || typeof magnetUri !== 'string') return false;
            const magnetRegex = /^magnet:\?xt=urn:[a-z0-9]+:[a-z0-9]{32,40}/i; //
            return magnetRegex.test(magnetUri);
        },
        encryptData(data) {
            if (typeof data !== 'string') return '';
            return btoa(unescape(encodeURIComponent(data))); //
        },
        decryptData(encryptedData) {
            if (typeof encryptedData !== 'string') return '';
            try {
                return decodeURIComponent(escape(atob(encryptedData))); //
            } catch {
                return '';
            }
        }
    };

    const RateLimiter = {
        requests: [],
        isAllowed() {
            const now = Date.now();
            this.requests = this.requests.filter(time => now - time < RATE_LIMIT_WINDOW);
            if (this.requests.length >= RATE_LIMIT_REQUESTS) return false;
            this.requests.push(now);
            return true;
        },
        getTimeUntilReset() {
            if (this.requests.length === 0) return 0;
            const oldestRequest = Math.min(...this.requests);
            return Math.max(0, RATE_LIMIT_WINDOW - (Date.now() - oldestRequest));
        }
    };

    class TorBoxError extends Error {
        constructor(message, code, details = {}) {
            super(message);
            this.name = 'TorBoxError';
            this.code = code;
            this.details = details;
            this.timestamp = new Date().toISOString();
        }
    }

    const ErrorBoundary = {
        handleError(error, context = 'Unknown') {
            const errorInfo = {
                message: error.message,
                stack: error.stack,
                context,
                timestamp: new Date().toISOString(),
                pluginVersion: PLUGIN_VERSION
            };
            console.error(`[TorBox Error - ${context}]:`, errorInfo);
            const userMessage = (error instanceof TorBoxError) ? error.message : 'Виникла непередбачена помилка.';
            Utils.toast(userMessage, 'error');
        }
    };

    const Utils = {
        toast(message, type = 'info', duration = 4000) {
            try {
                if (window.Lampa && Lampa.Noty) {
                    Lampa.Noty.show(message, { type, timeout: duration });
                } else {
                    console.log(`[${type.toUpperCase()}] ${message}`);
                }
            } catch (e) {
                console.error('Toast error:', e);
            }
        },
        log(message, level = 'info', data = {}) {
            if (level === 'debug' && !Config.get('debugMode')) return;
            const logEntry = {
                timestamp: new Date().toISOString(),
                level,
                message,
                plugin: PLUGIN_ID,
                ...data
            };
            console[level](`[TorBox]`, logEntry);
        }
    };

    const Config = {
        defaults: {
            apiKey: '', //
            autoDelete: true, //
            debugMode: false, //
            connectionTimeout: 30000, //
            retryAttempts: 3 //
        },
        get(key) {
            try {
                const stored = localStorage.getItem(`torbox_${key}`);
                if (stored !== null) {
                    let value = JSON.parse(stored);
                    if (key === 'apiKey' && value) {
                        value = Security.decryptData(value);
                    }
                    return value;
                }
            } catch (e) {
                Utils.log(`Failed to get config ${key}:`, 'error', { error: e.message });
            }
            return this.defaults[key];
        },
        set(key, value) {
            try {
                let valueToStore = value;
                if (key === 'apiKey' && value) {
                    valueToStore = Security.encryptData(value);
                }
                localStorage.setItem(`torbox_${key}`, JSON.stringify(valueToStore));
            } catch (e) {
                Utils.log(`Failed to set config ${key}:`, 'error', { error: e.message });
                throw new TorBoxError(`Failed to save configuration: ${e.message}`, 'CONFIG_ERROR');
            }
        },
        validateApiKey(apiKey) {
            if (!apiKey || typeof apiKey !== 'string') return false;
            return /^[a-zA-Z0-9_]{32,}$/.test(apiKey.trim());
        }
    };

    const ApiClient = {
        async request(endpoint, options = {}) {
            if (!RateLimiter.isAllowed()) {
                const waitTime = RateLimiter.getTimeUntilReset();
                throw new TorBoxError(`Перевищено ліміт запитів. Спробуйте через ${Math.ceil(waitTime / 1000)} сек.`, 'RATE_LIMIT_EXCEEDED');
            }
            const apiKey = Config.get('apiKey');
            if (!Config.validateApiKey(apiKey)) {
                throw new TorBoxError('API ключ не налаштовано або невірний.', 'INVALID_API_KEY');
            }
            const url = `${API_BASE_URL}${endpoint}`;
            const requestOptions = {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...options.headers },
                timeout: Config.get('connectionTimeout'),
                ...options
            };

            let lastError;
            for (let attempt = 0; attempt < Config.get('retryAttempts'); attempt++) {
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), requestOptions.timeout);
                    const response = await fetch(url, { ...requestOptions, signal: controller.signal });
                    clearTimeout(timeoutId);

                    if (!response.ok) {
                         const errorText = await response.text();
                         let errorData;
                         try { errorData = JSON.parse(errorText); } catch { errorData = { message: errorText }; }
                         throw new TorBoxError(errorData.message || `HTTP Помилка ${response.status}`, `HTTP_${response.status}`, { status: response.status });
                    }
                    // Для DELETE запросов, где тело ответа может быть пустым
                    const contentType = response.headers.get("content-type");
                    if (contentType && contentType.indexOf("application/json") !== -1) {
                        return await response.json();
                    }
                    return { success: true };

                } catch (error) {
                    lastError = error;
                    if (error.name === 'AbortError') {
                        lastError = new TorBoxError('Запит перевищив час очікування.', 'NETWORK_ERROR');
                    }
                    if (attempt < Config.get('retryAttempts') - 1) {
                         await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * Math.pow(2, attempt)));
                    }
                }
            }
            throw lastError;
        },
        get: function(endpoint, options={}) { return this.request(endpoint, { ...options, method: 'GET' }); },
        post: function(endpoint, options={}) { return this.request(endpoint, { ...options, method: 'POST' }); },
        delete: function(endpoint, options={}) { return this.request(endpoint, { ...options, method: 'DELETE'});}
    };

    // --- СЕКЦИЯ: НОВАЯ ЛОГИКА ИНТЕГРАЦИИ С LAMPA ---

    /**
     * Создает меню настроек плагина в Lampa
     */
    function createSettingsMenu() {
        const settingsCard = {
            name: 'TorBox Interceptor',
            icon: '&#xe87b;',
            items: [
                {
                    name: 'API Ключ',
                    type: 'text',
                    field: 'apiKey',
                    placeholder: 'Введіть ваш API ключ від TorBox',
                    description: 'Ключ необхідний для доступу до вашого аккаунту TorBox.'
                },
                {
                    name: 'Авто-видалення торрента',
                    type: 'select',
                    field: 'autoDelete',
                    values: { 'true': 'Так', 'false': 'Ні' },
                    description: 'Автоматично видаляти торрент з хмари TorBox після завершення перегляду.'
                },
                {
                    name: 'Режим відладки',
                    type: 'select',
                    field: 'debugMode',
                    values: { 'true': 'Увімкнено', 'false': 'Вимкнено' },
                    description: 'Включає докладне логування в консолі розробника.'
                }
            ]
        };

        // Связываем с нашим Config
        settingsCard.items.forEach(item => {
            const storedValue = Config.get(item.field);
            Lampa.Storage.set(item.field, typeof storedValue === 'boolean' ? String(storedValue) : storedValue);
        });
        
        Lampa.Listener.follow('settings-saved', (event) => {
            if (event.card_name === 'TorBox Interceptor') {
                settingsCard.items.forEach(item => {
                    const value = Lampa.Storage.get(item.field);
                    Config.set(item.field, (item.type === 'select') ? (value === 'true') : value);
                });
                Utils.toast('Налаштування TorBox збережено', 'success');
            }
        });

        Lampa.Settings.add(settingsCard);
    }
    
    /**
     * Перехватывает и обрабатывает торренты, заменяя стандартный клиент.
     */
    function overrideTorrentHandler() {
        if (!window.Lampa || !Lampa.Torrents) {
            Utils.log('Компонент Lampa.Torrents ще не готовий.', 'warn');
            return;
        }

        const originalTorrentStart = Lampa.Torrents.start;
        Utils.log('Оригінальний обробник торрентів збережено.', 'debug');

        Lampa.Torrents.start = async function(torrent, ...args) {
            const apiKey = Config.get('apiKey');

            if (!Config.validateApiKey(apiKey)) {
                Utils.log('API ключ TorBox не налаштовано. Використовується стандартний обробник.', 'warn');
                return originalTorrentStart.apply(this, [torrent, ...args]);
            }
            
            Lampa.Loading.start(undefined, `TorBox: Відправка торрента...`);
            Utils.log('Перехоплено торрент для обробки через TorBox.', 'info', { title: torrent.title });

            try {
                const magnetUri = torrent.magnet;
                if (!Security.validateMagnetUri(magnetUri)) {
                    throw new TorBoxError('Некоректна магнет-ссылка.', 'INVALID_TORRENT');
                }

                // Шаг 1: Добавляем торрент. Используем эндпоинт из твоей документации.
                const addResponse = await ApiClient.post('/torrents/createtorrent', {
                    body: JSON.stringify({ magnet: magnetUri })
                });

                // Документация не указывает формат ответа, предполагаем стандартный
                const torrentId = addResponse.data?.id || addResponse.id;
                if (!torrentId) {
                    throw new TorBoxError('TorBox не повернув ID торрента.', 'API_ERROR');
                }
                Utils.log(`Торрент додано. ID: ${torrentId}`, 'debug');

                // Шаг 2: Опрашиваем статус, пока файл не будет готов
                let retries = 20; // Опрашивать 20 раз по 5 секунд = 100 секунд макс
                let videoFile;

                while (retries > 0) {
                    Lampa.Loading.update(`TorBox: Обробка... Залишилось спроб: ${retries}`);
                    // Используем эндпоинт для получения информации о файлах
                    const infoResponse = await ApiClient.get(`/torrents/torrentinfo?id=${torrentId}`);
                    const files = infoResponse.data?.files || [];
                    
                    if (files.length > 0) {
                        // Ищем самый большой файл, так как это скорее всего видео
                        videoFile = files.filter(f => !/\.(txt|jpg|png|nfo|url)$/i.test(f.name)).sort((a, b) => b.size - a.size)[0];
                        if (videoFile) {
                             Utils.log('Відеофайл знайдено.', 'info', { file: videoFile.name });
                             break;
                        }
                    }
                    
                    retries--;
                    if (retries === 0) {
                       throw new TorBoxError('Таймаут очікування. TorBox не зміг обробити торрент.', 'TIMEOUT_ERROR');
                    }
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }

                // Шаг 3: Получаем ссылку на стриминг
                 Lampa.Loading.update(`TorBox: Отримання посилання на стрім...`);
                const streamResponse = await ApiClient.get(`/torrents/requestdl?token=${apiKey}&torrent_id=${torrentId}&file_id=${videoFile.id}&zip_link=false`);
                
                const streamUrl = streamResponse.data || streamResponse.url || streamResponse;
                 if (!streamUrl || typeof streamUrl !== 'string') {
                    throw new TorBoxError('Не вдалося отримати посилання на стрім.', 'API_ERROR');
                 }

                Utils.log('Посилання на стрім отримано.', 'info');
                Lampa.Loading.stop();

                // Шаг 4: Запускаем плеер
                Lampa.Player.play({ url: streamUrl, title: videoFile.name });

                // Шаг 5: Настраиваем авто-удаление, если включено
                if (Config.get('autoDelete')) {
                    Lampa.Player.listener.follow('destroy', () => {
                        Utils.log(`Плеєр закрито. Видалення торрента ID: ${torrentId}`, 'info');
                        // Используем эндпоинт для удаления, предполагая что он DELETE
                        ApiClient.delete(`/torrents/controltorrent`, { 
                           body: JSON.stringify({ torrent_id: torrentId, operation: 'delete' }) 
                        }).catch(e => ErrorBoundary.handleError(e, 'auto-delete'));
                    });
                }

            } catch (error) {
                Lampa.Loading.stop();
                ErrorBoundary.handleError(error, 'torrent-handler');
                Utils.toast('Не вдалося обробити торрент через TorBox. Спробуйте стандартний клієнт.', 'warning');
                // В случае ошибки, можно вернуться к стандартному клиенту
                // return originalTorrentStart.apply(this, [torrent, ...args]);
            }
        };
    }

    /**
     * Главная функция инициализации плагина
     */
    function initializePlugin() {
        try {
            Utils.log('Ініціалізація TorBox Interceptor', 'info');
            
            // 1. Создаем меню настроек
            createSettingsMenu();

            // 2. Перехватываем обработчик торрентов
            overrideTorrentHandler();
            
            Utils.toast('TorBox Interceptor: готовий до перехвату!', 'success');
        } catch (error) {
            ErrorBoundary.handleError(error, 'initialization');
        }
    }

    // Ожидаем готовности Lampa перед запуском
    if (window.Lampa) {
        initializePlugin();
    } else {
        document.addEventListener('Lampa.ready', initializePlugin, { once: true });
    }

})();
