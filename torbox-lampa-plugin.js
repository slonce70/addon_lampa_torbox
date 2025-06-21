/**
 * TorBox Enhanced Lampa Plugin - Secure & Optimized Version
 * Version: 2.0.0
 * Date: December 2024
 * 
 * CRITICAL SECURITY IMPROVEMENTS:
 * - Removed hardcoded API key
 * - Added input validation
 * - Implemented rate limiting
 * - Added error boundaries
 * - Modular architecture
 */

(function() {
    'use strict';
    
    // Constants
    const PLUGIN_ID = 'torbox_enhanced_secure';
    const PLUGIN_VERSION = '2.0.0';
    const API_BASE_URL = 'https://api.torbox.app/v1/api';
    const CACHE_DURATION = 3600000; // 1 hour
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 1000;
    const RATE_LIMIT_REQUESTS = 10;
    const RATE_LIMIT_WINDOW = 60000; // 1 minute
    
    // Security utilities
    const Security = {
        /**
         * Encrypts sensitive data for storage
         * @param {string} data - Data to encrypt
         * @returns {string} - Encrypted data
         */
        encryptData(data) {
            // Simple base64 encoding for basic obfuscation
            // In production, use proper encryption
            return btoa(unescape(encodeURIComponent(data)));
        },
        
        /**
         * Decrypts sensitive data from storage
         * @param {string} encryptedData - Encrypted data
         * @returns {string} - Decrypted data
         */
        decryptData(encryptedData) {
            try {
                return decodeURIComponent(escape(atob(encryptedData)));
            } catch {
                return '';
            }
        }
    };
    
    // Rate limiter
    const RateLimiter = {
        requests: [],
        
        /**
         * Checks if request is allowed under rate limit
         * @returns {boolean} - True if allowed
         */
        isAllowed() {
            const now = Date.now();
            this.requests = this.requests.filter(time => now - time < RATE_LIMIT_WINDOW);
            
            if (this.requests.length >= RATE_LIMIT_REQUESTS) {
                return false;
            }
            
            this.requests.push(now);
            return true;
        },
        
        /**
         * Gets time until next request is allowed
         * @returns {number} - Milliseconds until next request
         */
        getTimeUntilReset() {
            if (this.requests.length === 0) return 0;
            const oldestRequest = Math.min(...this.requests);
            return Math.max(0, RATE_LIMIT_WINDOW - (Date.now() - oldestRequest));
        }
    };
    
    // Enhanced error handling
    class TorBoxError extends Error {
        constructor(message, code, details = {}) {
            super(message);
            this.name = 'TorBoxError';
            this.code = code;
            this.details = details;
            this.timestamp = new Date().toISOString();
        }
    }
    
    // Error boundary
    const ErrorBoundary = {
        /**
         * Handles errors with proper logging and user notification
         * @param {Error} error - The error to handle
         * @param {string} context - Context where error occurred
         */
        handleError(error, context = 'Unknown') {
            const errorInfo = {
                message: error.message,
                stack: error.stack,
                context,
                timestamp: new Date().toISOString(),
                userAgent: navigator.userAgent,
                url: window.location.href
            };
            
            console.error(`[TorBox Error - ${context}]:`, errorInfo);
            
            // Show user-friendly message
            const userMessage = this.getUserFriendlyMessage(error);
            Utils.toast(userMessage, 'error');
            
            // Log to external service in production
            this.logToService(errorInfo);
        },
        
        /**
         * Gets user-friendly error message
         * @param {Error} error - The error
         * @returns {string} - User-friendly message
         */
        getUserFriendlyMessage(error) {
            if (error instanceof TorBoxError) {
                switch (error.code) {
                    case 'INVALID_API_KEY':
                        return 'Невірний API ключ. Перевірте налаштування.';
                    case 'RATE_LIMIT_EXCEEDED':
                        return 'Перевищено ліміт запитів. Спробуйте пізніше.';
                    case 'NETWORK_ERROR':
                        return 'Помилка мережі. Перевірте з\'єднання.';
                    case 'INVALID_TORRENT':
                        return 'Невірний торрент файл або посилання.';
                    default:
                        return error.message;
                }
            }
            return 'Виникла непередбачена помилка. Спробуйте ще раз.';
        },
        
        /**
         * Logs error to external service
         * @param {Object} errorInfo - Error information
         */
        logToService(errorInfo) {
            // In production, send to logging service
            // For now, just store locally
            try {
                const logs = JSON.parse(localStorage.getItem('torbox_error_logs') || '[]');
                logs.push(errorInfo);
                // Keep only last 50 errors
                if (logs.length > 50) {
                    logs.splice(0, logs.length - 50);
                }
                localStorage.setItem('torbox_error_logs', JSON.stringify(logs));
            } catch (e) {
                console.warn('Failed to log error:', e);
            }
        }
    };
    
    // Enhanced utilities
    const Utils = {
        
        /**
         * Shows toast notification with enhanced styling
         * @param {string} message - Message to show
         * @param {string} type - Type: success, error, warning, info
         * @param {number} duration - Duration in ms
         */
        toast(message, type = 'info', duration = 3000) {
            try {
                if (window.Lampa && Lampa.Noty) {
                    Lampa.Noty.show(message, {
                        type: type,
                        timeout: duration
                    });
                } else {
                    console.log(`[${type.toUpperCase()}] ${message}`);
                }
            } catch (e) {
                console.error('Toast error:', e);
            }
        },
        
        /**
         * Enhanced logging with levels
         * @param {string} message - Message to log
         * @param {string} level - Log level
         * @param {Object} data - Additional data
         */
        log(message, level = 'info', data = {}) {
            const timestamp = new Date().toISOString();
            const logEntry = {
                timestamp,
                level,
                message,
                plugin: PLUGIN_ID,
                version: PLUGIN_VERSION,
                ...data
            };
            
            switch (level) {
                case 'error':
                    console.error(`[${PLUGIN_ID}]`, logEntry);
                    break;
                case 'warn':
                    console.warn(`[${PLUGIN_ID}]`, logEntry);
                    break;
                case 'debug':
                    if (Config.get('debugMode')) {
                        console.debug(`[${PLUGIN_ID}]`, logEntry);
                    }
                    break;
                default:
                    console.log(`[${PLUGIN_ID}]`, logEntry);
            }
        },
        

    };
    
    // Secure configuration manager
    const Config = {
        defaults: {
            apiKey: '', // Never hardcode!
            autoPlay: false,
            autoDelete: true,
            subtitlesEnabled: true,
            preferredQuality: '1080p',
            allowZip: false,
            cacheEnabled: true,
            debugMode: false,
            maxConcurrentDownloads: 3,
            connectionTimeout: 30000,
            retryAttempts: 3
        },
        
        cache: new Map(),
        
        /**
         * Gets configuration value
         * @param {string} key - Configuration key
         * @returns {*} - Configuration value
         */
        get(key) {
            if (this.cache.has(key)) {
                return this.cache.get(key);
            }
            
            try {
                const stored = localStorage.getItem(`torbox_${key}`);
                if (stored !== null) {
                    let value = JSON.parse(stored);
                    
                    // Decrypt sensitive data
                    if (key === 'apiKey' && value) {
                        value = Security.decryptData(value);
                    }
                    
                    this.cache.set(key, value);
                    return value;
                }
            } catch (e) {
                Utils.log(`Failed to get config ${key}:`, 'error', { error: e.message });
            }
            
            const defaultValue = this.defaults[key];
            this.cache.set(key, defaultValue);
            return defaultValue;
        },
        
        /**
         * Sets configuration value
         * @param {string} key - Configuration key
         * @param {*} value - Configuration value
         */
        set(key, value) {
            try {
                this.cache.set(key, value);
                
                let valueToStore = value;
                
                // Encrypt sensitive data
                if (key === 'apiKey' && value) {
                    valueToStore = Security.encryptData(value);
                }
                
                localStorage.setItem(`torbox_${key}`, JSON.stringify(valueToStore));
                Utils.log(`Config ${key} updated`, 'debug');
            } catch (e) {
                Utils.log(`Failed to set config ${key}:`, 'error', { error: e.message });
                throw new TorBoxError(`Failed to save configuration: ${e.message}`, 'CONFIG_ERROR');
            }
        },
        
        /**
         * Validates API key format
         * @param {string} apiKey - API key to validate
         * @returns {boolean} - True if valid
         */
        validateApiKey(apiKey) {
            if (!apiKey || typeof apiKey !== 'string') return false;
            // TorBox API keys are typically 32+ characters alphanumeric
            return /^[a-zA-Z0-9]{32,}$/.test(apiKey.trim());
        },
        
        /**
         * Clears all configuration
         */
        clear() {
            this.cache.clear();
            Object.keys(this.defaults).forEach(key => {
                try {
                    localStorage.removeItem(`torbox_${key}`);
                } catch (e) {
                    Utils.log(`Failed to clear config ${key}:`, 'warn', { error: e.message });
                }
            });
        }
    };
    
    // Enhanced cache with LRU eviction
    const Cache = {
        storage: new Map(),
        accessOrder: new Map(),
        maxSize: 100,
        
        /**
         * Gets cached value
         * @param {string} key - Cache key
         * @returns {*} - Cached value or null
         */
        get(key) {
            if (!Config.get('cacheEnabled')) return null;
            
            const item = this.storage.get(key);
            if (!item) return null;
            
            // Check expiration
            if (Date.now() > item.expiry) {
                this.delete(key);
                return null;
            }
            
            // Update access order for LRU
            this.accessOrder.set(key, Date.now());
            
            Utils.log(`Cache hit: ${key}`, 'debug');
            return item.data;
        },
        
        /**
         * Sets cached value
         * @param {string} key - Cache key
         * @param {*} data - Data to cache
         * @param {number} ttl - Time to live in ms
         */
        set(key, data, ttl = CACHE_DURATION) {
            if (!Config.get('cacheEnabled')) return;
            
            // Evict oldest items if at capacity
            if (this.storage.size >= this.maxSize) {
                this.evictOldest();
            }
            
            const item = {
                data,
                expiry: Date.now() + ttl,
                size: this.estimateSize(data)
            };
            
            this.storage.set(key, item);
            this.accessOrder.set(key, Date.now());
            
            Utils.log(`Cache set: ${key}`, 'debug', { size: item.size });
        },
        
        /**
         * Deletes cached value
         * @param {string} key - Cache key
         */
        delete(key) {
            this.storage.delete(key);
            this.accessOrder.delete(key);
        },
        
        /**
         * Clears all cache
         */
        clear() {
            this.storage.clear();
            this.accessOrder.clear();
            Utils.log('Cache cleared', 'debug');
        },
        
        /**
         * Evicts oldest accessed items
         */
        evictOldest() {
            const sortedByAccess = Array.from(this.accessOrder.entries())
                .sort((a, b) => a[1] - b[1]);
            
            // Remove oldest 10% of items
            const toRemove = Math.max(1, Math.floor(sortedByAccess.length * 0.1));
            
            for (let i = 0; i < toRemove; i++) {
                const [key] = sortedByAccess[i];
                this.delete(key);
            }
        },
        
        /**
         * Estimates data size for cache management
         * @param {*} data - Data to estimate
         * @returns {number} - Estimated size in bytes
         */
        estimateSize(data) {
            try {
                return JSON.stringify(data).length * 2; // Rough estimate
            } catch {
                return 1000; // Default estimate
            }
        }
    };
    
    // Secure API client
    const ApiClient = {
        /**
         * Makes authenticated API request with rate limiting and retry logic
         * @param {string} endpoint - API endpoint
         * @param {Object} options - Request options
         * @returns {Promise<Object>} - API response
         */
        async request(endpoint, options = {}) {
            // Check rate limit
            if (!RateLimiter.isAllowed()) {
                const waitTime = RateLimiter.getTimeUntilReset();
                throw new TorBoxError(
                    `Rate limit exceeded. Try again in ${Math.ceil(waitTime / 1000)} seconds.`,
                    'RATE_LIMIT_EXCEEDED',
                    { waitTime }
                );
            }
            
            const apiKey = Config.get('apiKey');
            if (!apiKey) {
                throw new TorBoxError('API key not configured', 'INVALID_API_KEY');
            }
            
            if (!Config.validateApiKey(apiKey)) {
                throw new TorBoxError('Invalid API key format', 'INVALID_API_KEY');
            }
            
            const url = `${API_BASE_URL}${endpoint}`;
            const requestOptions = {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'User-Agent': `Lampa-TorBox-Plugin/${PLUGIN_VERSION}`,
                    ...options.headers
                },
                timeout: Config.get('connectionTimeout'),
                ...options
            };
            
            let lastError;
            const maxRetries = Config.get('retryAttempts');
            
            for (let attempt = 0; attempt <= maxRetries; attempt++) {
                try {
                    Utils.log(`API request: ${url}`, 'debug', { attempt, options: requestOptions });
                    
                    const response = await this.fetchWithTimeout(url, requestOptions);
                    
                    if (!response.ok) {
                        const errorText = await response.text();
                        let errorData;
                        
                        try {
                            errorData = JSON.parse(errorText);
                        } catch {
                            errorData = { message: errorText };
                        }
                        
                        const errorCode = this.getErrorCode(response.status, errorData);
                        throw new TorBoxError(
                            errorData.message || `HTTP ${response.status}`,
                            errorCode,
                            { status: response.status, response: errorData }
                        );
                    }
                    
                    const data = await response.json();
                    Utils.log(`API response: ${url}`, 'debug', { data });
                    
                    return data;
                    
                } catch (error) {
                    lastError = error;
                    
                    // Don't retry on certain errors
                    if (error instanceof TorBoxError && 
                        ['INVALID_API_KEY', 'RATE_LIMIT_EXCEEDED'].includes(error.code)) {
                        throw error;
                    }
                    
                    if (attempt < maxRetries) {
                        const delay = RETRY_DELAY * Math.pow(2, attempt); // Exponential backoff
                        Utils.log(`Request failed, retrying in ${delay}ms`, 'warn', { 
                            attempt, 
                            error: error.message 
                        });
                        await this.sleep(delay);
                    }
                }
            }
            
            throw new TorBoxError(
                `Request failed after ${maxRetries + 1} attempts: ${lastError.message}`,
                'NETWORK_ERROR',
                { originalError: lastError }
            );
        },
        
        /**
         * Fetch with timeout support
         * @param {string} url - Request URL
         * @param {Object} options - Request options
         * @returns {Promise<Response>} - Fetch response
         */
        async fetchWithTimeout(url, options) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), options.timeout || 30000);
            
            try {
                const response = await fetch(url, {
                    ...options,
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                return response;
            } catch (error) {
                clearTimeout(timeoutId);
                if (error.name === 'AbortError') {
                    throw new TorBoxError('Request timeout', 'NETWORK_ERROR');
                }
                throw error;
            }
        },
        
        /**
         * Maps HTTP status codes to error codes
         * @param {number} status - HTTP status code
         * @param {Object} errorData - Error response data
         * @returns {string} - Error code
         */
        getErrorCode(status, errorData) {
            switch (status) {
                case 401:
                case 403:
                    return 'INVALID_API_KEY';
                case 429:
                    return 'RATE_LIMIT_EXCEEDED';
                case 400:
                    return 'INVALID_REQUEST';
                case 404:
                    return 'NOT_FOUND';
                case 500:
                case 502:
                case 503:
                case 504:
                    return 'SERVER_ERROR';
                default:
                    return 'NETWORK_ERROR';
            }
        },
        
        /**
         * Sleep utility for delays
         * @param {number} ms - Milliseconds to sleep
         * @returns {Promise} - Sleep promise
         */
        sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }
    };
    
    // TorBox API integration
    const TorBoxAPI = {
        /**
         * Creates a torrent in TorBox
         * @param {string} magnetOrHash - Magnet link or torrent hash
         * @param {File} torrentFile - Optional torrent file
         * @returns {Promise<Object>} - API response
         */
        async createTorrent(magnetOrHash, torrentFile = null) {
            const apiKey = Config.get('apiKey');
            if (!apiKey) {
                throw new TorBoxError('API ключ не настроен', 'INVALID_API_KEY');
            }

            const formData = new FormData();
            if (torrentFile) {
                formData.append('torrent', torrentFile);
            } else {
                formData.append('magnet', magnetOrHash);
            }

            return await APIClient.request('/api/torrents/createtorrent', {
                method: 'POST',
                body: formData,
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                }
            });
        },

        /**
         * Gets torrent list
         * @returns {Promise<Object>} - API response
         */
        async getTorrentList() {
            const apiKey = Config.get('apiKey');
            if (!apiKey) {
                throw new TorBoxError('API ключ не настроен', 'INVALID_API_KEY');
            }

            return await APIClient.request('/api/torrents/mylist', {
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                }
            });
        },

        /**
         * Gets download link for torrent
         * @param {string} torrentId - Torrent ID
         * @param {string} fileId - File ID
         * @returns {Promise<Object>} - API response
         */
        async getDownloadLink(torrentId, fileId) {
            const apiKey = Config.get('apiKey');
            if (!apiKey) {
                throw new TorBoxError('API ключ не настроен', 'INVALID_API_KEY');
            }

            return await APIClient.request('/api/torrents/requestdl', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    torrent_id: torrentId,
                    file_id: fileId
                })
            });
        },

        /**
         * Checks if torrent is cached
         * @param {string} hash - Torrent hash
         * @returns {Promise<Object>} - API response
         */
        async checkCached(hash) {
            const apiKey = Config.get('apiKey');
            if (!apiKey) {
                throw new TorBoxError('API ключ не настроен', 'INVALID_API_KEY');
            }

            return await APIClient.request(`/api/torrents/checkcached?hash=${hash}`, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                }
            });
        }
    };

    // Settings interface for Lampa
    const SettingsInterface = {
        init() {
            try {
                // Wait for Lampa.Settings to be ready
                if (!window.Lampa || !Lampa.Settings) {
                    Utils.log('Lampa.Settings not ready, retrying...', 'warn');
                    setTimeout(() => this.init(), 1000);
                    return;
                }

                // Create settings component
                this.createSettingsComponent();
                
                // Add TorBox settings to existing settings menu
                Lampa.Settings.listener.follow('open', (e) => {
                    if (e.name === 'main') {
                        this.addToMainSettings();
                    }
                });

                Utils.log('TorBox settings listener registered successfully', 'info');
            } catch (error) {
                Utils.log('Failed to register TorBox settings:', 'error', error);
            }
        },

        addToMainSettings() {
            try {
                const settingsContainer = document.querySelector('.settings .settings-list');
                if (!settingsContainer) {
                    Utils.log('Settings container not found', 'warn');
                    return;
                }

                // Check if already added
                if (settingsContainer.querySelector('.torbox-settings-item')) {
                    return;
                }

                // Create TorBox settings item
                const settingsItem = document.createElement('div');
                settingsItem.className = 'settings-folder torbox-settings-item';
                settingsItem.innerHTML = `
                    <div class="settings-folder__icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                            <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                            <path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                            <path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                        </svg>
                    </div>
                    <div class="settings-folder__name">TorBox Enhanced</div>
                    <div class="settings-folder__description">Настройки TorBox плагина</div>
                `;

                // Add click handler
                settingsItem.addEventListener('click', () => {
                    this.openTorBoxSettings();
                });

                // Insert after first item
                const firstItem = settingsContainer.querySelector('.settings-folder');
                if (firstItem) {
                    firstItem.parentNode.insertBefore(settingsItem, firstItem.nextSibling);
                } else {
                    settingsContainer.appendChild(settingsItem);
                }

                Utils.log('TorBox settings item added to main settings', 'info');
            } catch (error) {
                Utils.log('Failed to add TorBox settings to main menu:', 'error', error);
            }
        },

        openTorBoxSettings() {
            try {
                Lampa.Activity.push({
                    url: '',
                    title: 'TorBox Enhanced',
                    component: 'torbox_settings',
                    page: 1
                });
            } catch (error) {
                Utils.log('Failed to open TorBox settings:', 'error', error);
            }
        },

        createSettingsComponent() {
            // Register TorBox settings component
            Lampa.Component.add('torbox_settings', {
                create: function() {
                    const activity = this;
                    
                    activity.create = function() {
                        activity.html = document.createElement('div');
                        activity.html.className = 'activity-content';
                        
                        const settingsContainer = document.createElement('div');
                        settingsContainer.className = 'settings';
                        
                        const settingsList = document.createElement('div');
                        settingsList.className = 'settings-list';
                        
                        // Create settings items
                        const settings = [
                            {
                                name: 'apiKey',
                                title: 'API Ключ',
                                description: 'API ключ от TorBox.app для доступа к сервису',
                                type: 'input',
                                value: Config.get('apiKey') || 'Не задан'
                            },
                            {
                                name: 'autoPlay',
                                title: 'Автовоспроизведение',
                                description: 'Автоматически начинать воспроизведение найденных файлов',
                                type: 'toggle',
                                value: Config.get('autoPlay') ? 'Включено' : 'Выключено'
                            },
                            {
                                name: 'autoDelete',
                                title: 'Автоудаление торрентов',
                                description: 'Удалять торренты из TorBox после просмотра',
                                type: 'toggle',
                                value: Config.get('autoDelete') ? 'Включено' : 'Выключено'
                            },
                            {
                                name: 'preferredQuality',
                                title: 'Предпочитаемое качество',
                                description: 'Выберите предпочитаемое качество видео для воспроизведения',
                                type: 'select',
                                value: Config.get('preferredQuality') || '1080p'
                            },
                            {
                                name: 'subtitlesEnabled',
                                title: 'Субтитры',
                                description: 'Автоматически загружать и подключать субтитры',
                                type: 'toggle',
                                value: Config.get('subtitlesEnabled') ? 'Включены' : 'Выключены'
                            },
                            {
                                name: 'debugMode',
                                title: 'Режим отладки',
                                description: 'Включить подробное логирование для диагностики',
                                type: 'toggle',
                                value: Config.get('debugMode') ? 'Включен' : 'Выключен'
                            }
                        ];
                        
                        settings.forEach(setting => {
                            const settingElement = SettingsInterface.createSettingElement(setting);
                            settingsList.appendChild(settingElement);
                        });
                        
                        settingsContainer.appendChild(settingsList);
                        activity.html.appendChild(settingsContainer);
                    };
                    
                    activity.render = function() {
                        return activity.html;
                    };
                    
                    activity.destroy = function() {
                        // Cleanup
                    };
                    
                    return activity;
                }
            });
        },
        
        createSettingElement(setting) {
            const element = document.createElement('div');
            element.className = 'settings-param selector';
            element.setAttribute('data-type', setting.type);
            element.setAttribute('data-name', setting.name);
            
            element.innerHTML = `
                <div class="settings-param__name">${setting.title}</div>
                <div class="settings-param__value">${setting.value}</div>
                <div class="settings-param__descr">${setting.description}</div>
            `;
            
            element.addEventListener('click', () => {
                this.handleSettingClick(setting.type, setting.name, element);
            });
            
            return element;
        },


        
        handleSettingClick(type, name, element) {
            try {
                switch (type) {
                    case 'input':
                        this.showInputDialog(name, element);
                        break;
                    case 'toggle':
                        this.toggleSetting(name, element);
                        break;
                    case 'select':
                        this.showSelectDialog(name, element);
                        break;
                    default:
                        Utils.log('Unknown setting type:', 'warn', type);
                }
            } catch (error) {
                Utils.log('Failed to handle setting click:', 'error', error);
            }
        },
        
        showInputDialog(name, element) {
            const currentValue = Config.get(name) || '';
            const title = name === 'apiKey' ? 'API Ключ TorBox' : 'Введите значение';
            
            Lampa.Input.edit({
                title: title,
                value: currentValue,
                free: true,
                nosave: true
            }, (newValue) => {
                if (name === 'apiKey') {
                    if (newValue && Config.validateApiKey(newValue)) {
                        Config.set('apiKey', newValue);
                        element.querySelector('.settings-param__value').textContent = newValue;
                        Utils.toast('API ключ сохранен', 'success');
                    } else if (newValue) {
                        Utils.toast('Неверный формат API ключа', 'error');
                        return;
                    } else {
                        Config.set('apiKey', '');
                        element.querySelector('.settings-param__value').textContent = 'Не задан';
                    }
                } else {
                    Config.set(name, newValue);
                    element.querySelector('.settings-param__value').textContent = newValue || 'Не задано';
                    Utils.toast('Настройка обновлена', 'success');
                }
            });
        },
        
        toggleSetting(name, element) {
            const currentValue = Config.get(name);
            const newValue = !currentValue;
            
            Config.set(name, newValue);
            
            let displayText = '';
            switch (name) {
                case 'autoPlay':
                    displayText = newValue ? 'Включено' : 'Выключено';
                    Utils.toast('Автовоспроизведение ' + (newValue ? 'включено' : 'выключено'), 'success');
                    break;
                case 'autoDelete':
                    displayText = newValue ? 'Включено' : 'Выключено';
                    Utils.toast('Автоудаление ' + (newValue ? 'включено' : 'выключено'), 'success');
                    break;
                case 'subtitlesEnabled':
                    displayText = newValue ? 'Включены' : 'Выключены';
                    Utils.toast('Субтитры ' + (newValue ? 'включены' : 'выключены'), 'success');
                    break;
                case 'debugMode':
                    displayText = newValue ? 'Включен' : 'Выключен';
                    Utils.toast('Режим отладки ' + (newValue ? 'включен' : 'выключен'), 'success');
                    break;
                default:
                    displayText = newValue ? 'Включено' : 'Выключено';
            }
            
            element.querySelector('.settings-param__value').textContent = displayText;
        },
        
        showSelectDialog(name, element) {
            if (name === 'preferredQuality') {
                const qualities = ['480p', '720p', '1080p', '1440p', '2160p'];
                const currentValue = Config.get('preferredQuality') || '1080p';
                
                Lampa.Select.show({
                    title: 'Выберите качество',
                    items: qualities.map(quality => ({
                        title: quality,
                        selected: quality === currentValue,
                        value: quality
                    })),
                    onSelect: (item) => {
                        Config.set('preferredQuality', item.value);
                        element.querySelector('.settings-param__value').textContent = item.value;
                        Utils.toast('Качество установлено: ' + item.value, 'success');
                    }
                });
            }
        },
        
        updateSettingValue(name, value) {
            try {
                Utils.log('Setting changed:', 'debug', { name, value });
                return true;
            } catch (error) {
                Utils.log('Error handling setting change:', 'error', { name, value, error });
                Utils.toast('Ошибка при сохранении настройки', 'error');
                return false;
            }
        }
    };

    // Torrent handler for Lampa
    const TorrentHandler = {
        /**
         * Handles torrent from other plugins
         * @param {Object} torrent - Torrent data
         * @returns {Promise<void>}
         */
        async handleTorrent(torrent) {
            try {
                Utils.log('Handling torrent:', 'info', torrent);
                
                const magnetLink = torrent.magnet || torrent.url;
                if (!magnetLink) {
                    throw new TorBoxError('Магнет-ссылка не найдена', 'INVALID_REQUEST');
                }

                // Check if cached first
                const hash = this.extractHashFromMagnet(magnetLink);
                if (hash) {
                    const cached = await TorBoxAPI.checkCached(hash);
                    if (cached.data && cached.data.length > 0) {
                        Utils.toast('Торрент найден в кэше!', 'success');
                        return await this.playFromCache(cached.data[0]);
                    }
                }

                // Create torrent in TorBox
                Utils.toast('Добавляем торрент в TorBox...', 'info');
                const result = await TorBoxAPI.createTorrent(magnetLink);
                
                if (result.success) {
                    Utils.toast('Торрент добавлен! Ожидаем загрузки...', 'success');
                    await this.waitForDownload(result.data.torrent_id);
                } else {
                    throw new TorBoxError(result.error || 'Ошибка добавления торрента', 'API_ERROR');
                }
                
            } catch (error) {
                ErrorBoundary.handleError(error, 'torrent_handling');
            }
        },

        /**
         * Extracts hash from magnet link
         * @param {string} magnet - Magnet link
         * @returns {string|null} - Hash or null
         */
        extractHashFromMagnet(magnet) {
            const match = magnet.match(/xt=urn:btih:([a-fA-F0-9]{40}|[a-fA-F0-9]{32})/);
            return match ? match[1] : null;
        },

        /**
         * Waits for torrent download and starts playback
         * @param {string} torrentId - Torrent ID
         * @returns {Promise<void>}
         */
        async waitForDownload(torrentId) {
            const maxAttempts = 60; // 5 minutes
            let attempts = 0;

            const checkStatus = async () => {
                try {
                    const torrents = await TorBoxAPI.getTorrentList();
                    const torrent = torrents.data.find(t => t.id === torrentId);
                    
                    if (!torrent) {
                        throw new TorBoxError('Торрент не найден', 'NOT_FOUND');
                    }

                    if (torrent.download_state === 'downloaded') {
                        Utils.toast('Торрент загружен! Начинаем воспроизведение...', 'success');
                        return await this.startPlayback(torrent);
                    }

                    if (torrent.download_state === 'error') {
                        throw new TorBoxError('Ошибка загрузки торрента', 'DOWNLOAD_ERROR');
                    }

                    attempts++;
                    if (attempts >= maxAttempts) {
                        throw new TorBoxError('Превышено время ожидания загрузки', 'TIMEOUT');
                    }

                    // Update progress
                    const progress = Math.round((torrent.progress || 0) * 100);
                    Utils.toast(`Загрузка: ${progress}%`, 'info');

                    // Check again in 5 seconds
                    setTimeout(checkStatus, 5000);
                    
                } catch (error) {
                    ErrorBoundary.handleError(error, 'download_waiting');
                }
            };

            await checkStatus();
        },

        /**
         * Starts playback of downloaded torrent
         * @param {Object} torrent - Torrent data
         * @returns {Promise<void>}
         */
        async startPlayback(torrent) {
            try {
                // Find video files
                const videoFiles = torrent.files.filter(file => 
                    /\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v)$/i.test(file.name)
                );

                if (videoFiles.length === 0) {
                    throw new TorBoxError('Видеофайлы не найдены', 'NO_VIDEO_FILES');
                }

                // Get largest video file
                const mainFile = videoFiles.reduce((prev, current) => 
                    (prev.size > current.size) ? prev : current
                );

                // Get download link
                const downloadLink = await TorBoxAPI.getDownloadLink(torrent.id, mainFile.id);
                
                if (downloadLink.success && downloadLink.data) {
                    // Start playback in Lampa
                    const playData = {
                        url: downloadLink.data,
                        title: torrent.name,
                        quality: this.detectQuality(mainFile.name),
                        subtitles: this.findSubtitles(torrent.files)
                    };
                    
                    if (window.Lampa && Lampa.Player) {
                        Lampa.Player.play(playData);
                        Utils.toast('Воспроизведение началось!', 'success');
                    } else {
                        // Fallback to direct link
                        window.open(downloadLink.data, '_blank');
                    }
                    
                    // Auto-delete if enabled
                    if (Config.get('autoDelete')) {
                        setTimeout(() => {
                            this.deleteTorrent(torrent.id);
                        }, 300000); // Delete after 5 minutes
                    }
                } else {
                    throw new TorBoxError('Не удалось получить ссылку для скачивания', 'DOWNLOAD_LINK_ERROR');
                }
                
            } catch (error) {
                ErrorBoundary.handleError(error, 'playback_start');
            }
        },
        
        /**
         * Deletes torrent from TorBox
         * @param {string} torrentId - Torrent ID
         */
        async deleteTorrent(torrentId) {
            try {
                const apiKey = Config.get('apiKey');
                if (!apiKey) return;
                
                await APIClient.request(`/api/torrents/controltorrent`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        torrent_id: torrentId,
                        operation: 'delete'
                    })
                });
                
                Utils.log(`Торрент ${torrentId} удален`, 'info');
            } catch (error) {
                Utils.log(`Ошибка удаления торрента: ${error.message}`, 'error');
            }
        },
        
        /**
         * Plays from cached torrent
         * @param {Object} cachedTorrent - Cached torrent data
         */
        async playFromCache(cachedTorrent) {
            try {
                const downloadLink = await TorBoxAPI.getDownloadLink(cachedTorrent.id, cachedTorrent.files[0].id);
                
                if (downloadLink.success) {
                    const playData = {
                        url: downloadLink.data,
                        title: cachedTorrent.name,
                        quality: this.detectQuality(cachedTorrent.files[0].name)
                    };
                    
                    if (window.Lampa && Lampa.Player) {
                        Lampa.Player.play(playData);
                    }
                }
            } catch (error) {
                ErrorBoundary.handleError(error, 'cache_playback');
            }
        },
        
        /**
         * Detects video quality from filename
         * @param {string} filename - File name
         * @returns {string} - Quality string
         */
        detectQuality(filename) {
            const qualityMap = {
                '2160p': '4K',
                '1440p': '1440p',
                '1080p': '1080p',
                '720p': '720p',
                '480p': '480p'
            };
            
            for (const [key, value] of Object.entries(qualityMap)) {
                if (filename.toLowerCase().includes(key)) {
                    return value;
                }
            }
            
            return 'Unknown';
        },
        
        /**
         * Finds subtitle files in torrent
         * @param {Array} files - Torrent files
         * @returns {Array} - Subtitle files
         */
        findSubtitles(files) {
            return files.filter(file => 
                /\.(srt|vtt|ass|ssa|sub)$/i.test(file.name)
            ).map(file => ({
                label: file.name,
                url: file.download_url
            }));
        }
    };

    // Initialize plugin with error boundary
    function initializePlugin() {
        try {
            Utils.log('Initializing TorBox Enhanced Plugin', 'info');
            
            if (!window.Lampa) {
                throw new TorBoxError('Lampa не найдена', 'INITIALIZATION_ERROR');
            }

            // Wait for Lampa to be fully loaded
            if (!Lampa.Settings || !Lampa.Activity) {
                Utils.log('Waiting for Lampa components to load...', 'info');
                setTimeout(initializePlugin, 1000);
                return;
            }

            // Initialize settings interface
            SettingsInterface.init();
            
            // Register torrent handler
            if (window.Lampa.Torrent) {
                Lampa.Torrent.add('torbox', {
                    name: 'TorBox Enhanced',
                    handler: TorrentHandler.handleTorrent.bind(TorrentHandler)
                });
                Utils.log('TorBox torrent handler registered', 'debug');
            }
            
            // Register as torrent client
            if (window.Lampa.TorrentClient) {
                Lampa.TorrentClient.add('torbox', {
                    name: 'TorBox Enhanced',
                    icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
                    handler: TorrentHandler.handleTorrent.bind(TorrentHandler)
                });
                Utils.log('TorBox torrent client registered', 'debug');
            }
            
            Utils.log('TorBox Enhanced Plugin успешно инициализирован', 'info');
            Utils.toast('TorBox Enhanced готов к работе!', 'success');
            
        } catch (error) {
            ErrorBoundary.handleError(error, 'initialization');
        }
    }
    
    // Start plugin when Lampa is ready
    function startPlugin() {
        if (window.Lampa && window.Lampa.Source && window.Lampa.Settings) {
            Utils.log('Lampa detected, starting TorBox Enhanced plugin', 'info');
            initializePlugin();
        } else {
            Utils.log('Waiting for Lampa to load...', 'debug');
            // Wait for Lampa to load
            const checkInterval = setInterval(() => {
                if (window.Lampa && window.Lampa.Source && window.Lampa.Settings) {
                    clearInterval(checkInterval);
                    Utils.log('Lampa fully loaded, initializing TorBox Enhanced', 'info');
                    initializePlugin();
                }
            }, 500);
            
            // Timeout after 30 seconds
            setTimeout(() => {
                clearInterval(checkInterval);
                console.error('TorBox Enhanced: Lampa not found after 30 second timeout');
                Utils.toast('Ошибка: Lampa не загрузилась', 'error');
            }, 30000);
        }
    }

    // Start the plugin
    startPlugin();

    // Also listen for Lampa ready event if available
    if (window.addEventListener) {
        window.addEventListener('lampa:ready', () => {
            Utils.log('Lampa ready event received', 'debug');
            startPlugin();
        });
    }
    
})();
