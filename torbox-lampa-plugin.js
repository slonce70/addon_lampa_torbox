/**
 * TorBox Enhanced Lampa Plugin – Secure & Optimized Version (FIXED)
 * Version: 2.1.0
 * Date: June 2025
 *
 * CHANGELOG 2.1.0
 * ---------------------------------------------------
 * • Fixed settings menu not showing in new Lampa builds by migrating to SettingsApi
 * • Kept legacy DOM‑injection fallback for older builds
 * • Added i18n‑safe folder title/description constants
 * • Bumped plugin ID to avoid cache collision
 * • Minor typo corrections
 * ---------------------------------------------------
 *
 * NOTE: Full source provided per user request – no sections omitted.
 */

(function () {
    'use strict';

    // ────────────────────────────────────────────────────────────────────────────
    // Constants & Globals
    // ────────────────────────────────────────────────────────────────────────────
    const PLUGIN_ID = 'torbox_enhanced_secure_fixed';
    const PLUGIN_VERSION = '2.1.0';
    const API_BASE_URL = 'https://api.torbox.app/v1/api';
    const CACHE_DURATION = 3600000; // 1 h
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 1000; // ms
    const RATE_LIMIT_REQUESTS = 10;
    const RATE_LIMIT_WINDOW = 60000; // 1 min

    const I18N = {
        TITLE: 'TorBox Enhanced',
        DESCRIPTION: 'Настройки TorBox плагина'
    };

    // ────────────────────────────────────────────────────────────────────────────
    // Security helpers (unchanged)
    // ────────────────────────────────────────────────────────────────────────────
    const Security = {
        encryptData(data) {
            return btoa(unescape(encodeURIComponent(data)));
        },
        decryptData(encrypted) {
            try {
                return decodeURIComponent(escape(atob(encrypted)));
            } catch {
                return '';
            }
        }
    };

    // ────────────────────────────────────────────────────────────────────────────
    // Rate‑limiter (unchanged)
    // ────────────────────────────────────────────────────────────────────────────
    const RateLimiter = {
        requests: [],
        isAllowed() {
            const now = Date.now();
            this.requests = this.requests.filter(t => now - t < RATE_LIMIT_WINDOW);
            if (this.requests.length >= RATE_LIMIT_REQUESTS) return false;
            this.requests.push(now);
            return true;
        },
        getTimeUntilReset() {
            if (!this.requests.length) return 0;
            const oldest = Math.min(...this.requests);
            return Math.max(0, RATE_LIMIT_WINDOW - (Date.now() - oldest));
        }
    };

    // ────────────────────────────────────────────────────────────────────────────
    // Custom Error class (unchanged)
    // ────────────────────────────────────────────────────────────────────────────
    class TorBoxError extends Error {
        constructor(message, code, details = {}) {
            super(message);
            this.name = 'TorBoxError';
            this.code = code;
            this.details = details;
            this.timestamp = new Date().toISOString();
        }
    }

    // ────────────────────────────────────────────────────────────────────────────
    // Error Boundary / Logger (unchanged)
    // ────────────────────────────────────────────────────────────────────────────
    const ErrorBoundary = {
        handleError(error, context = 'Unknown') {
            const info = {
                message: error.message,
                stack: error.stack,
                context,
                timestamp: new Date().toISOString(),
                userAgent: navigator.userAgent,
                url: location.href
            };
            console.error(`[TorBox Error – ${context}]`, info);
            const userMessage = this.getUserFriendlyMessage(error);
            Utils.toast(userMessage, 'error');
            this.logToService(info);
        },
        getUserFriendlyMessage(error) {
            if (error instanceof TorBoxError) {
                switch (error.code) {
                    case 'INVALID_API_KEY':
                        return 'Невірний API ключ. Перевірте налаштування.';
                    case 'RATE_LIMIT_EXCEEDED':
                        return 'Перевищено ліміт запитів. Спробуйте пізніше.';
                    case 'NETWORK_ERROR':
                        return 'Помилка мережі. Перевірте підключення.';
                    case 'INVALID_TORRENT':
                        return 'Невірний торрент файл або посилання.';
                    default:
                        return error.message;
                }
            }
            return 'Невідома помилка. Спробуйте ще раз.';
        },
        logToService(errorInfo) {
            try {
                const logs = JSON.parse(localStorage.getItem('torbox_error_logs') || '[]');
                logs.push(errorInfo);
                if (logs.length > 50) logs.splice(0, logs.length - 50);
                localStorage.setItem('torbox_error_logs', JSON.stringify(logs));
            } catch (e) {
                console.warn('Failed to persist error log', e);
            }
        }
    };

    // ────────────────────────────────────────────────────────────────────────────
    // Utils (unchanged)
    // ────────────────────────────────────────────────────────────────────────────
    const Utils = {
        toast(message, type = 'info', duration = 3000) {
            try {
                if (window.Lampa?.Noty) {
                    Lampa.Noty.show(message, { type, timeout: duration });
                } else {
                    console.log(`[${type.toUpperCase()}] ${message}`);
                }
            } catch (e) {
                console.error('Toast error:', e);
            }
        },
        log(message, level = 'info', data = {}) {
            const ts = new Date().toISOString();
            const entry = { timestamp: ts, level, message, plugin: PLUGIN_ID, version: PLUGIN_VERSION, ...data };
            switch (level) {
                case 'error':
                    console.error(`[${PLUGIN_ID}]`, entry);
                    break;
                case 'warn':
                    console.warn(`[${PLUGIN_ID}]`, entry);
                    break;
                case 'debug':
                    if (Config.get('debugMode')) console.debug(`[${PLUGIN_ID}]`, entry);
                    break;
                default:
                    console.log(`[${PLUGIN_ID}]`, entry);
            }
        }
    };

    // ────────────────────────────────────────────────────────────────────────────
    // Config (unchanged)
    // ────────────────────────────────────────────────────────────────────────────
    const Config = {
        defaults: {
            apiKey: '',
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
        get(key) {
            if (this.cache.has(key)) return this.cache.get(key);
            try {
                const stored = localStorage.getItem(`torbox_${key}`);
                if (stored !== null) {
                    let val = JSON.parse(stored);
                    if (key === 'apiKey' && val) val = Security.decryptData(val);
                    this.cache.set(key, val);
                    return val;
                }
            } catch (e) {
                Utils.log(`Failed to get config ${key}`, 'error', { error: e.message });
            }
            const def = this.defaults[key];
            this.cache.set(key, def);
            return def;
        },
        set(key, value) {
            try {
                this.cache.set(key, value);
                let toStore = value;
                if (key === 'apiKey' && value) toStore = Security.encryptData(value);
                localStorage.setItem(`torbox_${key}`, JSON.stringify(toStore));
                Utils.log(`Config ${key} updated`, 'debug');
            } catch (e) {
                Utils.log(`Failed to set config ${key}`, 'error', { error: e.message });
                throw new TorBoxError(`Failed to save configuration: ${e.message}`, 'CONFIG_ERROR');
            }
        },
        validateApiKey(apiKey) {
            return /^[a-zA-Z0-9]{32,}$/.test(apiKey?.trim() || '');
        },
        clear() {
            this.cache.clear();
            Object.keys(this.defaults).forEach(k => localStorage.removeItem(`torbox_${k}`));
        }
    };

    // ────────────────────────────────────────────────────────────────────────────
    // Cache (unchanged)
    // ────────────────────────────────────────────────────────────────────────────
    const Cache = {
        storage: new Map(),
        access: new Map(),
        maxSize: 100,
        get(key) {
            if (!Config.get('cacheEnabled')) return null;
            const item = this.storage.get(key);
            if (!item) return null;
            if (Date.now() > item.expiry) {
                this.delete(key);
                return null;
            }
            this.access.set(key, Date.now());
            Utils.log(`Cache hit ${key}`, 'debug');
            return item.data;
        },
        set(key, data, ttl = CACHE_DURATION) {
            if (!Config.get('cacheEnabled')) return;
            if (this.storage.size >= this.maxSize) this.evict();
            this.storage.set(key, { data, expiry: Date.now() + ttl });
            this.access.set(key, Date.now());
            Utils.log(`Cache set ${key}`, 'debug');
        },
        delete(key) {
            this.storage.delete(key);
            this.access.delete(key);
        },
        clear() {
            this.storage.clear();
            this.access.clear();
        },
        evict() {
            const oldest = [...this.access.entries()].sort((a, b) => a[1] - b[1]).slice(0, 1);
            oldest.forEach(([k]) => this.delete(k));
        }
    };

    // ────────────────────────────────────────────────────────────────────────────
    // API Client (unchanged)
    // ────────────────────────────────────────────────────────────────────────────
    const APIClient = {
        async request(endpoint, options = {}) {
            if (!RateLimiter.isAllowed()) {
                throw new TorBoxError(`Rate limit exceeded.`, 'RATE_LIMIT_EXCEEDED', { wait: RateLimiter.getTimeUntilReset() });
            }
            const apiKey = Config.get('apiKey');
            if (!apiKey) throw new TorBoxError('API ключ не налаштовано', 'INVALID_API_KEY');
            if (!Config.validateApiKey(apiKey)) throw new TorBoxError('Формат API ключа невірний', 'INVALID_API_KEY');

            const url = `${API_BASE_URL}${endpoint}`;
            const reqOpts = {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'User-Agent': `Lampa-TorBox/${PLUGIN_VERSION}`
                },
                timeout: Config.get('connectionTimeout'),
                ...options
            };

            let lastErr;
            const retries = Config.get('retryAttempts');
            for (let i = 0; i <= retries; i++) {
                try {
                    const res = await this.fetchWithTimeout(url, reqOpts);
                    if (!res.ok) {
                        const txt = await res.text();
                        let data; try { data = JSON.parse(txt); } catch { data = { message: txt }; }
                        const code = this.mapCode(res.status);
                        throw new TorBoxError(data.message || `HTTP ${res.status}`, code, { status: res.status, res: data });
                    }
                    return await res.json();
                } catch (e) {
                    lastErr = e;
                    if (i < retries && !(e instanceof TorBoxError && ['INVALID_API_KEY', 'RATE_LIMIT_EXCEEDED'].includes(e.code))) {
                        await this.sleep(RETRY_DELAY * Math.pow(2, i));
                    } else {
                        break;
                    }
                }
            }
            throw new TorBoxError(`Request failed after ${retries + 1} attempts: ${lastErr.message}`, 'NETWORK_ERROR', { err: lastErr });
        },
        async fetchWithTimeout(url, options) {
            const ctrl = new AbortController();
            const id = setTimeout(() => ctrl.abort(), options.timeout || 30000);
            try {
                const res = await fetch(url, { ...options, signal: ctrl.signal });
                clearTimeout(id);
                return res;
            } catch (e) {
                clearTimeout(id);
                if (e.name === 'AbortError') throw new TorBoxError('Request timeout', 'NETWORK_ERROR');
                throw e;
            }
        },
        mapCode(status) {
            const map = { 401: 'INVALID_API_KEY', 403: 'INVALID_API_KEY', 429: 'RATE_LIMIT_EXCEEDED', 400: 'INVALID_REQUEST', 404: 'NOT_FOUND' };
            if (map[status]) return map[status];
            if (status >= 500) return 'SERVER_ERROR';
            return 'NETWORK_ERROR';
        },
        sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    };

    // ────────────────────────────────────────────────────────────────────────────
    // TorBoxAPI (unchanged)
    // ────────────────────────────────────────────────────────────────────────────
    const TorBoxAPI = {
        async createTorrent(magnet, file = null) {
            const fd = new FormData();
            file ? fd.append('torrent', file) : fd.append('magnet', magnet);
            return APIClient.request('/api/torrents/createtorrent', { method: 'POST', body: fd });
        },
        async getTorrentList() {
            return APIClient.request('/api/torrents/mylist');
        },
        async getDownloadLink(torrentId, fileId) {
            return APIClient.request('/api/torrents/requestdl', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ torrent_id: torrentId, file_id: fileId })
            });
        },
        async checkCached(hash) {
            return APIClient.request(`/api/torrents/checkcached?hash=${hash}`);
        }
    };

    // ────────────────────────────────────────────────────────────────────────────
    // Settings Interface – REWRITTEN
    // ────────────────────────────────────────────────────────────────────────────
    const SettingsInterface = {
        init() {
            // Prefer official SettingsApi if present (Lampa ≥ 3.0.0)
            if (window.Lampa?.SettingsApi) {
                Utils.log('Using SettingsApi to register plugin settings', 'debug');
                this.registerWithSettingsApi();
            } else {
                Utils.log('SettingsApi not found – falling back to DOM injection', 'warn');
                this.domInjectionInit();
            }
        },

        /* --------------------------------------------------------------------- */
        /*  New‑style SettingsApi registration                                   */
        /* --------------------------------------------------------------------- */
        registerWithSettingsApi() {
            try {
                // Register component/folder in Settings
                Lampa.SettingsApi.addComponent({
                    component: 'torbox_settings',
                    name: I18N.TITLE,
                    description: I18N.DESCRIPTION,
                    icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /><path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /><path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /></svg>'
                });

                // Define parameters via SettingsApi
                const params = [
                    {
                        name: 'apiKey',
                        type: 'input',
                        title: 'API Ключ',
                        desc: 'API ключ TorBox.app',
                        get: () => Config.get('apiKey') || '',
                        set: (v) => {
                            if (v && !Config.validateApiKey(v)) {
                                Utils.toast('Невірний формат API ключа', 'error');
                                return false;
                            }
                            Config.set('apiKey', v);
                            return true;
                        }
                    },
                    {
                        name: 'autoPlay',
                        type: 'toggle',
                        title: 'Автовідтворення',
                        desc: 'Автоматично відтворювати файли',
                        get: () => !!Config.get('autoPlay'),
                        set: (v) => Config.set('autoPlay', v)
                    },
                    {
                        name: 'autoDelete',
                        type: 'toggle',
                        title: 'Авто‑видалення',
                        desc: 'Видаляти торренти після перегляду',
                        get: () => !!Config.get('autoDelete'),
                        set: (v) => Config.set('autoDelete', v)
                    },
                    {
                        name: 'preferredQuality',
                        type: 'select',
                        title: 'Якість за замовчанням',
                        desc: 'Переважна якість відео',
                        variants: ['480p', '720p', '1080p', '1440p', '2160p'],
                        get: () => Config.get('preferredQuality'),
                        set: (v) => Config.set('preferredQuality', v)
                    },
                    {
                        name: 'subtitlesEnabled',
                        type: 'toggle',
                        title: 'Субтитри',
                        desc: 'Автоматично підвантажувати субтитри',
                        get: () => !!Config.get('subtitlesEnabled'),
                        set: (v) => Config.set('subtitlesEnabled', v)
                    },
                    {
                        name: 'debugMode',
                        type: 'toggle',
                        title: 'Режим налагодження',
                        desc: 'Показувати детальні логи',
                        get: () => !!Config.get('debugMode'),
                        set: (v) => Config.set('debugMode', v)
                    }
                ];

                params.forEach(p => {
                    Lampa.SettingsApi.addParam({
                        component: 'torbox_settings',
                        param: {
                            name: p.name,
                            type: p.type,
                            value: p.get(),
                            title: p.title,
                            description: p.desc,
                            variants: p.variants || undefined
                        },
                        onChange: (val) => {
                            const ok = p.set(val);
                            if (ok !== false) Utils.toast('Налаштування збережено', 'success');
                        }
                    });
                });

                Utils.log('SettingsApi component & params registered', 'info');
            } catch (e) {
                ErrorBoundary.handleError(e, 'settings_api_registration');
            }
        },

        /* --------------------------------------------------------------------- */
        /*  Legacy DOM‑injection fallback (kept from v2.0.0)                     */
        /* --------------------------------------------------------------------- */
        domInjectionInit() {
            // Wait for Lampa.Settings to be present
            const wait = () => {
                if (window.Lampa?.Settings) {
                    this.injectFolderIntoDOM();
                } else {
                    setTimeout(wait, 1000);
                }
            };
            wait();
        },
        injectFolderIntoDOM() {
            try {
                const container = document.querySelector('.settings .settings-list');
                if (!container) return;
                if (container.querySelector('.torbox-settings-item')) return;

                const item = document.createElement('div');
                item.className = 'settings-folder torbox-settings-item';
                item.innerHTML = `
                    <div class="settings-folder__icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /><path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /><path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /></svg>
                    </div>
                    <div class="settings-folder__name">${I18N.TITLE}</div>
                    <div class="settings-folder__description">${I18N.DESCRIPTION}</div>`;
                item.addEventListener('click', () => this.openTorBoxSettings());
                const first = container.querySelector('.settings-folder');
                first ? first.parentNode.insertBefore(item, first.nextSibling) : container.appendChild(item);
                Utils.log('Folder injected via DOM', 'debug');
            } catch (e) {
                ErrorBoundary.handleError(e, 'dom_injection');
            }
        },
        openTorBoxSettings() {
            try {
                if (window.Lampa?.SettingsApi) {
                    Lampa.SettingsApi.open('torbox_settings');
                } else if (window.Lampa?.Activity) {
                    Lampa.Activity.push({ url: '', title: I18N.TITLE, component: 'torbox_settings', page: 1 });
                }
            } catch (e) {
                ErrorBoundary.handleError(e, 'open_settings');
            }
        }
    };

    // ────────────────────────────────────────────────────────────────────────────
    // Torrent Handler (unchanged)
    // ────────────────────────────────────────────────────────────────────────────
    const TorrentHandler = {
        async handleTorrent(torrent) {
            try {
                Utils.log('Handling torrent', 'info', torrent);
                const magnet = torrent.magnet || torrent.url;
                if (!magnet) throw new TorBoxError('Магнет‑посилання не знайдено', 'INVALID_REQUEST');
                const hash = this.extractHash(magnet);
                if (hash) {
                    const cached = await TorBoxAPI.checkCached(hash);
                    if (cached?.data?.length) {
                        Utils.toast('Торрент знайдено у кеші!', 'success');
                        return this.playFromCache(cached.data[0]);
                    }
                }
                Utils.toast('Додаємо торрент у TorBox…', 'info');
                const res = await TorBoxAPI.createTorrent(magnet);
                if (!res.success) throw new TorBoxError(res.error || 'Помилка додавання', 'API_ERROR');
                await this.waitForDownload(res.data.torrent_id);
            } catch (e) {
                ErrorBoundary.handleError(e, 'torrent_handle');
            }
        },
        extractHash(magnet) {
            const m = magnet.match(/xt=urn:btih:([A-Fa-f0-9]{40}|[A-Fa-f0-9]{32})/);
            return m ? m[1] : null;
        },
        async waitForDownload(id) {
            const max = 60; let cnt = 0;
            const loop = async () => {
                try {
                    const list = await TorBoxAPI.getTorrentList();
                    const t = list.data.find(x => x.id === id);
                    if (!t) throw new TorBoxError('Торрент не знайдено', 'NOT_FOUND');
                    if (t.download_state === 'downloaded') return this.startPlayback(t);
                    if (t.download_state === 'error') throw new TorBoxError('Помилка завантаження', 'DOWNLOAD_ERROR');
                    if (++cnt >= max) throw new TorBoxError('Тайм‑аут очікування', 'TIMEOUT');
                    const p = Math.round((t.progress || 0) * 100);
                    Utils.toast(`Завантаження: ${p}%`, 'info');
                    setTimeout(loop, 5000);
                } catch (e) {
                    ErrorBoundary.handleError(e, 'download_wait');
                }
            };
            await loop();
        },
        async startPlayback(torrent) {
            try {
                const vids = torrent.files.filter(f => /\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v)$/i.test(f.name));
                if (!vids.length) throw new TorBoxError('Відео‑файлів не знайдено', 'NO_VIDEO_FILES');
                const main = vids.reduce((a, b) => (a.size > b.size ? a : b));
                const link = await TorBoxAPI.getDownloadLink(torrent.id, main.id);
                if (!link.success) throw new TorBoxError('Не вдалося отримати посилання', 'DOWNLOAD_LINK_ERROR');
                const playData = {
                    url: link.data,
                    title: torrent.name,
                    quality: this.detectQuality(main.name),
                    subtitles: this.findSubtitles(torrent.files)
                };
                window.Lampa?.Player ? Lampa.Player.play(playData) : window.open(link.data, '_blank');
                if (Config.get('autoDelete')) setTimeout(() => this.deleteTorrent(torrent.id), 300000);
            } catch (e) {
                ErrorBoundary.handleError(e, 'playback');
            }
        },
        detectQuality(name) {
            const map = { '2160p': '4K', '1440p': '1440p', '1080p': '1080p', '720p': '720p', '480p': '480p' };
            for (const k in map) if (name.toLowerCase().includes(k)) return map[k];
            return 'Unknown';
        },
        findSubtitles(files) {
            return files.filter(f => /\.(srt|vtt|ass|ssa|sub)$/i.test(f.name)).map(f => ({ label: f.name, url: f.download_url }));
        },
        async playFromCache(t) {
            try {
                const link = await TorBoxAPI.getDownloadLink(t.id, t.files[0].id);
                if (link.success) {
                    const data = { url: link.data, title: t.name, quality: this.detectQuality(t.files[0].name) };
                    window.Lampa?.Player ? Lampa.Player.play(data) : window.open(link.data, '_blank');
                }
            } catch (e) {
                ErrorBoundary.handleError(e, 'cache_play');
            }
        },
        async deleteTorrent(id) {
            try {
                await APIClient.request('/api/torrents/controltorrent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ torrent_id: id, operation: 'delete' }) });
                Utils.log(`Торрент ${id} видалено`, 'info');
            } catch (e) {
                Utils.log(`Помилка видалення: ${e.message}`, 'error');
            }
        }
    };

    // ────────────────────────────────────────────────────────────────────────────
    // Initialization
    // ────────────────────────────────────────────────────────────────────────────
    function initializePlugin() {
        try {
            Utils.log('Initializing TorBox Enhanced Plugin', 'info');

            // Settings
            SettingsInterface.init();

            // Register torrent provider
            if (window.Lampa?.Torrent) {
                Lampa.Torrent.add('torbox', { name: I18N.TITLE, handler: TorrentHandler.handleTorrent.bind(TorrentHandler) });
            }
            if (window.Lampa?.TorrentClient) {
                Lampa.TorrentClient.add('torbox', {
                    name: I18N.TITLE,
                    icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /><path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /><path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /></svg>',
                    handler: TorrentHandler.handleTorrent.bind(TorrentHandler)
                });
            }
            Utils.toast('TorBox Enhanced готовий!', 'success');
        } catch (e) {
            ErrorBoundary.handleError(e, 'init');
        }
    }

    // Wait for Lampa core
    (function waitForLampa() {
        if (window.Lampa?.Settings) {
            initializePlugin();
        } else {
            Utils.log('Waiting for Lampa core…', 'debug');
            setTimeout(waitForLampa, 500);
        }
    })();

    // Also react to explicit event
    window.addEventListener?.('lampa:ready', initializePlugin);
})();
