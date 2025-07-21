/* TorBox Lampa Plugin - Optimized & Stable Version */
(function () {
    'use strict';

    // ───────────────────────────── GUARD & NAMESPACE ──────────────────────────────
    const PLUGIN_ID = 'torbox_lampa_plugin_optimized';
    if (window[PLUGIN_ID]) return;
    window[PLUGIN_ID] = true;

    // Namespace isolation to prevent conflicts
    const TorBoxPlugin = {};

    // ───────────────────── CORE ▸ UTILITIES ───────────────────────────────
    TorBoxPlugin.Utils = {
        escapeHtml(str = '') {
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        },
        
        formatBytes(bytes = 0, speed = false) {
            const B = Number(bytes);
            if (isNaN(B) || B === 0) return speed ? '0 KB/s' : '0 B';
            const k = 1024;
            const sizes = speed
                ? ['B/s', 'KB/s', 'MB/s', 'GB/s']
                : ['B', 'KB', 'MB', 'GB', 'TB'];
            const i = Math.floor(Math.log(B) / Math.log(k));
            return (B / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
        },
        
        formatTime(sec = 0) {
            const s = parseInt(sec, 10);
            if (isNaN(s) || s < 0) return 'н/д';
            if (s === Infinity || s > 2592000) return '∞';
            const h = Math.floor(s / 3600);
            const m = Math.floor((s % 3600) / 60);
            const r = Math.floor(s % 60);
            return [h ? h + 'ч' : null, m ? m + 'м' : null, r + 'с']
                .filter(Boolean)
                .join(' ');
        },
        
        formatAge(iso) {
            if (!iso) return 'н/д';
            const d = new Date(iso);
            if (isNaN(d)) return 'н/д';
            const diff = Math.floor((Date.now() - d) / 1000);
            const m = Math.floor(diff / 60);
            const h = Math.floor(m / 60);
            const days = Math.floor(h / 24);
            if (diff < 60) return diff + ' сек. назад';
            if (m < 60) return m + ' мин. назад';
            if (h < 24) return h + ' ч. назад';
            return days + ' д. назад';
        },
        
        getQualityLabel(title = '', raw) {
            if (raw?.info?.quality) return raw.info.quality + 'p';
            if (/2160p|4K|UHD/i.test(title)) return '4K';
            if (/1080p|FHD/i.test(title)) return 'FHD';
            if (/720p|HD/i.test(title)) return 'HD';
            return 'SD';
        },
        
        naturalSort(a, b) {
            const re = /(\d+)/g;
            const aParts = a.name.split(re);
            const bParts = b.name.split(re);
            for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
                if (i % 2) {
                    const diff = parseInt(aParts[i], 10) - parseInt(bParts[i], 10);
                    if (diff) return diff;
                } else if (aParts[i] !== bParts[i]) {
                    return aParts[i].localeCompare(bParts[i]);
                }
            }
            return a.name.length - b.name.length;
        },
        
        // Debounce function to prevent excessive API calls
        debounce(func, wait) {
            let timeout;
            return function executedFunction(...args) {
                const later = () => {
                    clearTimeout(timeout);
                    func(...args);
                };
                clearTimeout(timeout);
                timeout = setTimeout(later, wait);
            };
        },
        
        // Throttle function for scroll events
        throttle(func, limit) {
            let inThrottle;
            return function() {
                const args = arguments;
                const context = this;
                if (!inThrottle) {
                    func.apply(context, args);
                    inThrottle = true;
                    setTimeout(() => inThrottle = false, limit);
                }
            }
        }
    };

    // ───────────────────── CORE ▸ SAFE STORAGE ───────────────────────────────
    TorBoxPlugin.SafeStorage = (() => {
        let storage;
        try {
            localStorage.setItem('__torbox_test', '1');
            localStorage.removeItem('__torbox_test');
            storage = localStorage;
        } catch {
            const mem = new Map();
            storage = {
                getItem: k => mem.get(k) || null,
                setItem: (k, v) => mem.set(k, String(v)),
                removeItem: k => mem.delete(k),
                clear: () => mem.clear()
            };
        }
        
        return {
            get(key, def = null) {
                const v = storage.getItem(key);
                return v !== null ? v : def;
            },
            set(key, val) {
                try {
                    storage.setItem(key, String(val));
                } catch (e) {
                    TorBoxPlugin.Logger.warn('Storage write failed:', e);
                }
            },
            remove(key) {
                try {
                    storage.removeItem(key);
                } catch (e) {
                    TorBoxPlugin.Logger.warn('Storage remove failed:', e);
                }
            }
        };
    })();

    // ───────────────────── CORE ▸ ENHANCED CACHE ───────────────────────────────
    TorBoxPlugin.Cache = (() => {
        const map = new Map();
        const LIMIT = 256; // Increased cache size
        const TTL_MS = 600000; // 10 minutes
        
        // Cleanup expired entries periodically
        const cleanup = () => {
            const now = Date.now();
            for (const [key, value] of map.entries()) {
                if (now - value.ts > TTL_MS) {
                    map.delete(key);
                }
            }
        };
        
        // Run cleanup every 5 minutes
        setInterval(cleanup, 300000);
        
        return {
            get(k) {
                if (!map.has(k)) return null;
                const o = map.get(k);
                if (Date.now() - o.ts > TTL_MS) {
                    map.delete(k);
                    return null;
                }
                // Move to end (LRU)
                map.delete(k);
                map.set(k, o);
                return o.val;
            },
            
            set(k, v) {
                if (map.has(k)) map.delete(k);
                map.set(k, { ts: Date.now(), val: v });
                
                // Evict oldest if over limit
                if (map.size > LIMIT) {
                    const firstKey = map.keys().next().value;
                    map.delete(firstKey);
                }
            },
            
            clear() {
                map.clear();
            },
            
            size() {
                return map.size;
            }
        };
    })();

    // ───────────────────── CORE ▸ CONFIGURATION ───────────────────────────────
    TorBoxPlugin.Config = (() => {
        const defaults = {
            proxyUrl: '',
            apiKey: '',
            debug: false
        };
        
        const config = {
            get debug() { 
                return TorBoxPlugin.SafeStorage.get('torbox_debug', '0') === '1'; 
            },
            set debug(v) { 
                TorBoxPlugin.SafeStorage.set('torbox_debug', v ? '1' : '0'); 
            },
            
            get proxyUrl() { 
                return TorBoxPlugin.SafeStorage.get('torbox_proxy_url') || defaults.proxyUrl; 
            },
            set proxyUrl(v) { 
                TorBoxPlugin.SafeStorage.set('torbox_proxy_url', v); 
            },
            
            get apiKey() {
                const b64 = TorBoxPlugin.SafeStorage.get('torbox_api_key_b64', '');
                if (!b64) return defaults.apiKey;
                try { 
                    return atob(b64); 
                } catch { 
                    TorBoxPlugin.SafeStorage.set('torbox_api_key_b64', ''); 
                    return defaults.apiKey; 
                }
            },
            set apiKey(v) {
                if (!v) return TorBoxPlugin.SafeStorage.set('torbox_api_key_b64', '');
                try {
                    TorBoxPlugin.SafeStorage.set('torbox_api_key_b64', btoa(v));
                } catch (e) {
                    TorBoxPlugin.Logger.error('Failed to encode API key:', e);
                }
            }
        };
        
        const PUBLIC_PARSERS = [
            { name: 'Viewbox', url: 'jacred.viewbox.dev', key: 'viewbox' },
            { name: 'Jacred', url: 'jacred.xyz', key: '' }
        ];
        
        const ICON = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 7L12 2L21 7V17L12 22L3 17V7Z" stroke="currentColor" stroke-width="2"/><path d="M12 22V12" stroke="currentColor" stroke-width="2"/><path d="M21 7L12 12L3 7" stroke="currentColor" stroke-width="2"/></svg>`;
        
        return { config, PUBLIC_PARSERS, ICON, defaults };
    })();

    // ───────────────────── CORE ▸ ENHANCED LOGGER ───────────────────────────────
    TorBoxPlugin.Logger = (() => {
        const prefix = '[TorBox]';
        
        return {
            log(...args) {
                if (TorBoxPlugin.Config.config.debug) {
                    console.log(prefix, ...args);
                }
            },
            warn(...args) {
                if (TorBoxPlugin.Config.config.debug) {
                    console.warn(prefix, ...args);
                }
            },
            error(...args) {
                console.error(prefix, ...args);
            },
            info(...args) {
                if (TorBoxPlugin.Config.config.debug) {
                    console.info(prefix, ...args);
                }
            }
        };
    })();

    // ───────────────────── CORE ▸ ENHANCED API ───────────────────────────────
    TorBoxPlugin.Api = (() => {
        const MAIN_API = 'https://api.torbox.app/v1/api';
        const REQUEST_TIMEOUT = 25000; // Increased timeout
        
        const processResponse = (txt, status) => {
            if (status === 401) throw { type: 'auth', message: '401 – неверный API-ключ' };
            if (status === 403) throw { type: 'auth', message: '403 – доступ запрещен, проверьте права ключа' };
            if (status === 429) throw { type: 'network', message: '429 – слишком много запросов, попробуйте позже' };
            if (status >= 500) throw { type: 'network', message: `Ошибка сервера TorBox (${status})` };
            if (status >= 400) throw { type: 'network', message: `Ошибка клиента (${status})` };
            if (!txt) throw { type: 'api', message: 'Пустой ответ от сервера' };
            
            try {
                if (typeof txt === 'string' && txt.startsWith('http')) {
                    return { success: true, url: txt };
                }
                const json = typeof txt === 'object' ? txt : JSON.parse(txt);
                if (json?.success === false) {
                    const errorMsg = json.detail || json.message || 'Неизвестная ошибка API';
                    throw { type: 'api', message: errorMsg };
                }
                return json;
            } catch (e) {
                if (e.type) throw e;
                throw { type: 'api', message: 'Некорректный JSON в ответе' };
            }
        };
        
        const makeRequest = async (url, options = {}, signal) => {
            const { config } = TorBoxPlugin.Config;
            
            if (!config.proxyUrl) {
                throw { type: 'validation', message: 'CORS-proxy не задан в настройках' };
            }
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
            
            if (signal) {
                signal.addEventListener('abort', () => controller.abort());
            }
            
            const proxyUrl = `${config.proxyUrl}?url=${encodeURIComponent(url)}`;
            const headers = options.headers || {};
            
            if (options.is_torbox_api !== false) {
                headers['X-Api-Key'] = config.apiKey;
            }
            
            // Remove potentially conflicting headers
            delete headers['Authorization'];
            
            try {
                const response = await fetch(proxyUrl, {
                    ...options,
                    headers,
                    signal: controller.signal
                });
                
                const text = await response.text();
                return processResponse(text, response.status);
                
            } catch (error) {
                if (error.name === 'AbortError') {
                    if (!signal || !signal.aborted) {
                        throw { 
                            type: 'network', 
                            message: `Таймаут запроса (${REQUEST_TIMEOUT / 1000} сек)` 
                        };
                    }
                    throw error;
                }
                throw { type: 'network', message: error.message };
            } finally {
                clearTimeout(timeoutId);
            }
        };
        
        const searchPublicTrackers = async (movie, signal) => {
            const { PUBLIC_PARSERS } = TorBoxPlugin.Config;
            
            for (const parser of PUBLIC_PARSERS) {
                const params = new URLSearchParams({
                    apikey: parser.key,
                    Query: `${movie.title} ${movie.year || ''}`.trim(),
                    title: movie.title,
                    title_original: movie.original_title,
                    Category: '2000,5000'
                });
                
                if (movie.year) params.append('year', movie.year);
                
                const url = `https://${parser.url}/api/v2.0/indexers/all/results?${params}`;
                TorBoxPlugin.Logger.log('Parser attempt:', parser.name, url);
                
                try {
                    const response = await makeRequest(url, { 
                        method: 'GET', 
                        is_torbox_api: false 
                    }, signal);
                    
                    if (response && Array.isArray(response.Results) && response.Results.length) {
                        TorBoxPlugin.Logger.log('Parser success:', parser.name, response.Results.length);
                        return response.Results;
                    }
                    TorBoxPlugin.Logger.log('Parser empty:', parser.name);
                } catch (error) {
                    TorBoxPlugin.Logger.warn('Parser failed:', parser.name, error.message);
                }
            }
            
            throw { 
                type: 'api', 
                message: 'Все публичные парсеры недоступны или без результатов' 
            };
        };
        
        const checkCached = async (hashes, signal) => {
            if (!hashes.length) return {};
            
            const data = {};
            const CHUNK_SIZE = 100;
            
            for (let i = 0; i < hashes.length; i += CHUNK_SIZE) {
                const chunk = hashes.slice(i, i + CHUNK_SIZE);
                const params = new URLSearchParams();
                
                chunk.forEach(hash => params.append('hash', hash));
                params.append('format', 'object');
                params.append('list_files', 'false');
                
                try {
                    const response = await makeRequest(
                        `${MAIN_API}/torrents/checkcached?${params}`, 
                        { method: 'GET' }, 
                        signal
                    );
                    
                    if (response?.data) {
                        Object.assign(data, response.data);
                    }
                } catch (error) {
                    TorBoxPlugin.Logger.warn('checkCached chunk error:', error.message);
                }
            }
            
            return data;
        };
        
        const addMagnet = (magnet, signal) => {
            const formData = new FormData();
            formData.append('magnet', magnet);
            formData.append('seed', '3');
            
            return makeRequest(`${MAIN_API}/torrents/createtorrent`, {
                method: 'POST',
                body: formData
            }, signal);
        };
        
        const getTorrentList = async (id, signal) => {
            const response = await makeRequest(
                `${MAIN_API}/torrents/mylist?id=${id}&bypass_cache=true`, 
                { method: 'GET' }, 
                signal
            );
            
            if (response && response.data && !Array.isArray(response.data)) {
                response.data = [response.data];
            }
            
            return response;
        };
        
        const requestDownload = (torrentId, fileId, signal) => {
            const { config } = TorBoxPlugin.Config;
            return makeRequest(
                `${MAIN_API}/torrents/requestdl?torrent_id=${torrentId}&file_id=${fileId}&token=${config.apiKey}`, 
                { method: 'GET' }, 
                signal
            );
        };
        
        return {
            searchPublicTrackers,
            checkCached,
            addMagnet,
            getTorrentList,
            requestDownload
        };
    })();

    // ───────────────────── CORE ▸ ERROR HANDLER ───────────────────────────────
    TorBoxPlugin.ErrorHandler = {
        show(type, error) {
            const message = error.message || 'Неизвестная ошибка';
            const title = type === 'network' ? 'Сетевая ошибка' : 'Ошибка';
            
            if (window.Lampa && Lampa.Noty) {
                Lampa.Noty.show(`${title}: ${message}`, { type: 'error' });
            }
            
            TorBoxPlugin.Logger.error(type, error);
        },
        
        handle(error, context = '') {
            TorBoxPlugin.Logger.error(`Error in ${context}:`, error);
            
            if (error.type) {
                this.show(error.type, error);
            } else {
                this.show('unknown', { message: error.message || 'Неизвестная ошибка' });
            }
        }
    };

    // ───────────────────── UTILITIES ▸ SEARCH COMBINATIONS ───────────────────
    function generateSearchCombinations(movie) {
        const combinations = new Set();
        const title = movie.title?.trim();
        const originalTitle = movie.original_title?.trim();
        const year = (movie.release_date || movie.first_air_date || '').slice(0, 4);
        
        const addCombination = (value) => {
            if (value) {
                combinations.add(value.trim().replace(/\s+/g, ' '));
            }
        };
        
        if (title) {
            addCombination(title);
            if (year) addCombination(`${title} ${year}`);
        }
        
        if (originalTitle && originalTitle.toLowerCase() !== title?.toLowerCase()) {
            addCombination(originalTitle);
            if (year) addCombination(`${originalTitle} ${year}`);
            
            addCombination(`${title} ${originalTitle}`);
            if (year) addCombination(`${title} ${originalTitle} ${year}`);
        }
        
        return Array.from(combinations).filter(Boolean);
    }

    // ───────────────────── COMPONENT ▸ FOCUS MANAGER ───────────────────────────
    TorBoxPlugin.FocusManager = class {
        constructor() {
            this.currentFocus = null;
            this.focusHistory = [];
            this.eventListeners = new Map();
        }
        
        setFocus(element) {
            if (this.currentFocus !== element) {
                this.focusHistory.push(this.currentFocus);
                this.currentFocus = element;
            }
        }
        
        restoreFocus() {
            if (this.focusHistory.length > 0) {
                this.currentFocus = this.focusHistory.pop();
                return this.currentFocus;
            }
            return null;
        }
        
        addEventListener(element, event, handler) {
            if (!this.eventListeners.has(element)) {
                this.eventListeners.set(element, new Map());
            }
            
            const elementListeners = this.eventListeners.get(element);
            if (!elementListeners.has(event)) {
                elementListeners.set(event, []);
            }
            
            elementListeners.get(event).push(handler);
            element.addEventListener(event, handler);
        }
        
        removeAllListeners() {
            for (const [element, events] of this.eventListeners) {
                for (const [event, handlers] of events) {
                    handlers.forEach(handler => {
                        element.removeEventListener(event, handler);
                    });
                }
            }
            this.eventListeners.clear();
        }
        
        destroy() {
            this.removeAllListeners();
            this.currentFocus = null;
            this.focusHistory = [];
        }
    };

    // ───────────────────── COMPONENT ▸ MAIN COMPONENT ───────────────────────────
    function MainComponent(object) {
        // Component state
        let scroll = new Lampa.Scroll({ mask: true, over: true, step: 250 });
        let files = new Lampa.Explorer(object);
        let filter = new Lampa.Filter(object);
        let focusManager = new TorBoxPlugin.FocusManager();
        let abortController = new AbortController();
        let initialized = false;
        let cachedToggleButton;
        let isDestroyed = false;
        
        this.activity = object.activity;
        
        // Sort types configuration
        const sortTypes = [
            { key: 'seeders', title: 'По сидам (убыв.)', field: 'last_known_seeders', reverse: true },
            { key: 'size_desc', title: 'По размеру (убыв.)', field: 'size', reverse: true },
            { key: 'size_asc', title: 'По размеру (возр.)', field: 'size', reverse: false },
            { key: 'age', title: 'По дате добавления', field: 'publish_timestamp', reverse: true }
        ];
        
        const defaultFilters = {
            quality: 'all',
            tracker: 'all',
            video_type: 'all',
            translation: 'all',
            lang: 'all',
            video_codec: 'all',
            audio_codec: 'all'
        };
        
        // Component state
        const state = {
            allTorrents: [],
            sort: TorBoxPlugin.SafeStorage.get('torbox_sort_method', 'seeders'),
            filters: JSON.parse(TorBoxPlugin.SafeStorage.get('torbox_filters_v2', JSON.stringify(defaultFilters))),
            lastHash: null,
            view: 'torrents',
            currentTorrentData: null,
            searchQuery: null,
            showOnlyCached: TorBoxPlugin.SafeStorage.get('torbox_show_only_cached', '0') === '1'
        };
        
        // Process raw torrent data
        const processRawTorrent = (raw, hash, cachedSet) => {
            const video = raw.ffprobe?.find(s => s.codec_type === 'video');
            const audio = raw.ffprobe?.filter(s => s.codec_type === 'audio') || [];
            
            const techInfo = {
                video_codec: video?.codec_name,
                video_resolution: video ? `${video.width}x${video.height}` : null,
                audio_langs: [...new Set(audio.map(s => s.tags?.language).filter(Boolean))],
                audio_codecs: [...new Set(audio.map(s => s.codec_name).filter(Boolean))],
                has_hdr: /hdr/i.test(raw.Title) || raw.info?.videotype?.toLowerCase() === 'hdr',
                has_dv: /dv|dolby vision/i.test(raw.Title) || raw.info?.videotype?.toLowerCase() === 'dovi'
            };
            
            const isCached = cachedSet.has(hash.toLowerCase());
            const publishDate = raw.PublishDate ? new Date(raw.PublishDate) : null;
            
            return {
                title: TorBoxPlugin.Utils.escapeHtml(raw.Title),
                raw_title: raw.Title,
                size: raw.Size,
                magnet: raw.MagnetUri,
                hash,
                last_known_seeders: raw.Seeders,
                last_known_peers: raw.Peers || raw.Leechers,
                trackers: (raw.Tracker || '').split(/, ?/).filter(Boolean),
                icon: isCached ? '⚡' : '☁️',
                cached: isCached,
                publish_date: raw.PublishDate,
                publish_timestamp: publishDate ? publishDate.getTime() : 0,
                age: TorBoxPlugin.Utils.formatAge(raw.PublishDate),
                quality: TorBoxPlugin.Utils.getQualityLabel(raw.Title, raw),
                video_type: raw.info?.videotype?.toLowerCase(),
                voices: raw.info?.voices,
                ...techInfo,
                raw_data: raw,
                info_formated: `[${TorBoxPlugin.Utils.getQualityLabel(raw.Title, raw)}] ${TorBoxPlugin.Utils.formatBytes(raw.Size)} | 🟢<span style="color:var(--color-good);">${raw.Seeders || 0}</span> / 🔴<span style="color:var(--color-bad);">${raw.Peers || 0}</span>`,
                meta_formated: `Трекеры: ${((raw.Tracker || '').split(/, ?/)[0] || 'н/д')} | Добавлено: ${TorBoxPlugin.Utils.formatAge(raw.PublishDate) || 'н/д'}`,
                tech_bar_html: this.buildTechBar(techInfo, raw)
            };
        };
        
        // Build technical information bar
        this.buildTechBar = function(techInfo, raw) {
            const createTag = (text, className) => 
                `<div class="torbox-item__tech-item torbox-item__tech-item--${className}">${text}</div>`;
            
            let html = '';
            
            if (techInfo.video_resolution) {
                html += createTag(TorBoxPlugin.Utils.escapeHtml(techInfo.video_resolution), 'res');
            }
            if (techInfo.video_codec) {
                html += createTag(TorBoxPlugin.Utils.escapeHtml(techInfo.video_codec.toUpperCase()), 'codec');
            }
            if (techInfo.has_hdr) {
                html += createTag('HDR', 'hdr');
            }
            if (techInfo.has_dv) {
                html += createTag('Dolby Vision', 'dv');
            }
            
            const audioStreams = raw.ffprobe?.filter(s => s.codec_type === 'audio') || [];
            let voiceIndex = 0;
            
            audioStreams.forEach(stream => {
                let langOrVoice = stream.tags?.language?.toUpperCase() || stream.tags?.LANGUAGE?.toUpperCase();
                
                if (!langOrVoice || langOrVoice === 'UND') {
                    if (raw.info?.voices && raw.info.voices[voiceIndex]) {
                        langOrVoice = raw.info.voices[voiceIndex];
                        voiceIndex++;
                    } else {
                        langOrVoice = null;
                    }
                }
                
                const codec = stream.codec_name?.toUpperCase() || '';
                const layout = stream.channel_layout || '';
                const displayText = [langOrVoice, codec, layout].filter(Boolean).join(' ').trim();
                
                if (displayText) {
                    html += createTag(TorBoxPlugin.Utils.escapeHtml(displayText), 'audio');
                }
            });
            
            return html ? `<div class="torbox-item__tech-bar">${html}</div>` : '';
        };
        
        // Debounced search function
        const debouncedSearch = TorBoxPlugin.Utils.debounce((force = false, customTitle = null) => {
            if (isDestroyed) return;
            
            // Abort previous search
            abortController.abort();
            abortController = new AbortController();
            const signal = abortController.signal;
            
            this.activity.loader(true);
            this.reset();
            
            state.searchQuery = customTitle;
            
            const movieForSearch = customTitle
                ? { ...object.movie, title: customTitle, original_title: customTitle, year: '' }
                : object.movie;
            
            const cacheKey = customTitle 
                ? `torbox_custom_search_${customTitle}` 
                : `torbox_hybrid_${object.movie.id || object.movie.imdb_id}`;
            
            // Check cache first
            if (!force && TorBoxPlugin.Cache.get(cacheKey)) {
                state.allTorrents = TorBoxPlugin.Cache.get(cacheKey);
                TorBoxPlugin.Logger.log('Loaded torrents from cache');
                this.build();
                this.activity.loader(false);
                return;
            }
            
            const searchMessage = customTitle 
                ? `Поиск по запросу: "${customTitle}"...` 
                : 'Получение списка…';
            this.empty(searchMessage);
            
            // Perform search
            TorBoxPlugin.Api.searchPublicTrackers(movieForSearch, signal)
                .then(results => {
                    if (signal.aborted || isDestroyed) return;
                    
                    if (!results.length) {
                        return this.empty('Парсер не вернул результатов.');
                    }
                    
                    // Extract hashes from magnet links
                    const withHashes = results.map(result => {
                        const match = result.MagnetUri.match(/urn:btih:([a-fA-F0-9]{40})/i);
                        return match ? { raw: result, hash: match[1] } : null;
                    }).filter(Boolean);
                    
                    if (!withHashes.length) {
                        return this.empty('Не найдено валидных торрентов.');
                    }
                    
                    this.empty(`Проверка кэша (${withHashes.length})…`);
                    
                    // Check which torrents are cached
                    return TorBoxPlugin.Api.checkCached(
                        withHashes.map(item => item.hash), 
                        signal
                    ).then(cached => ({ withHashes, cached }));
                })
                .then(({ withHashes, cached }) => {
                    if (signal.aborted || isDestroyed) return;
                    
                    const cachedSet = new Set(
                        Object.keys(cached).map(hash => hash.toLowerCase())
                    );
                    
                    state.allTorrents = withHashes.map(({ raw, hash }) => 
                        processRawTorrent(raw, hash, cachedSet)
                    );
                    
                    TorBoxPlugin.Cache.set(cacheKey, state.allTorrents);
                    this.build();
                })
                .catch(error => {
                    if (signal.aborted || isDestroyed) return;
                    
                    const message = error.message || 'Ошибка поиска';
                    this.empty(message);
                    TorBoxPlugin.ErrorHandler.handle(error, 'search');
                })
                .finally(() => {
                    if (!isDestroyed) {
                        this.activity.loader(false);
                    }
                });
        }, 300); // 300ms debounce
        
        // Search function
        const search = (force = false, customTitle = null) => {
            debouncedSearch(force, customTitle);
        };
        
        // Play torrent file
        const playTorrentFile = async (torrentData, file, onEnd) => {
            try {
                // Add to history if movie has ID
                if (object.movie.id && window.Lampa && Lampa.Favorite) {
                    Lampa.Favorite.add('history', object.movie);
                }
                
                // Request download link
                const downloadResponse = await TorBoxPlugin.Api.requestDownload(
                    torrentData.id, 
                    file.id
                );
                
                const link = downloadResponse.url || downloadResponse.data;
                if (!link) {
                    throw { type: 'api', message: 'Не удалось получить ссылку на файл' };
                }
                
                // Update watched episodes
                const movieId = object.movie.imdb_id || object.movie.id;
                const torrentId = torrentData.hash || torrentData.id;
                const watchedKey = `torbox_watched_episodes_${movieId}_${torrentId}`;
                
                let watchedEpisodes = JSON.parse(
                    TorBoxPlugin.SafeStorage.get(watchedKey, '[]')
                );
                
                if (!watchedEpisodes.includes(file.id)) {
                    watchedEpisodes.push(file.id);
                }
                
                TorBoxPlugin.SafeStorage.set(watchedKey, JSON.stringify(watchedEpisodes));
                TorBoxPlugin.SafeStorage.set(`torbox_last_played_file_${movieId}`, file.id);
                
                // Prepare player configuration
                const cleanName = file.name.split('/').pop();
                const playerConfig = {
                    url: link,
                    title: cleanName || object.movie.title,
                    poster: Lampa.Utils.cardImgBackgroundBlur(object.movie),
                    id: object.movie.id,
                    movie: object.movie
                };
                
                // Extract season/episode information
                const seasonMatch = cleanName.match(/[Ss](\d{1,2})/);
                const episodeMatch = cleanName.match(/[Ee](\d{1,3})/);
                
                if (seasonMatch) playerConfig.season = parseInt(seasonMatch[1], 10);
                if (episodeMatch) playerConfig.episode = parseInt(episodeMatch[1], 10);
                
                // Start playback
                if (window.Lampa && Lampa.Player) {
                    Lampa.Player.play(playerConfig);
                    if (onEnd) Lampa.Player.callback(onEnd);
                }
                
            } catch (error) {
                TorBoxPlugin.ErrorHandler.handle(error, 'playTorrentFile');
            }
        };
        
        // Handle torrent click
        const handleTorrentClick = (torrent) => {
            if (!torrent.magnet || !torrent.hash) {
                return TorBoxPlugin.ErrorHandler.show('validation', {
                    message: 'Magnet-ссылка или хеш не найдены'
                });
            }
            
            const movieId = object.movie.imdb_id || object.movie.id;
            
            try {
                const torrentForHistory = state.allTorrents.find(t => t.hash === torrent.hash) || torrent;
                TorBoxPlugin.SafeStorage.set(
                    `torbox_last_torrent_data_${movieId}`, 
                    JSON.stringify(torrentForHistory)
                );
                
                if (torrent.markAsLastPlayed) {
                    setTimeout(() => torrent.markAsLastPlayed(), 100);
                }
                
                updateContinueWatchingPanel();
                
            } catch (error) {
                TorBoxPlugin.Logger.warn('Failed to update last torrent data:', error);
            }
            
            const requestAbort = new AbortController();
            const signal = requestAbort.signal;
            const storageKey = `torbox_id_for_hash_${torrent.hash}`;
            const savedTorboxId = TorBoxPlugin.SafeStorage.get(storageKey);
            
            if (window.Lampa && Lampa.Loading) {
                Lampa.Loading.start(() => {
                    requestAbort.abort();
                }, 'TorBox: Обработка...');
            }
            
            const addAndTrack = (magnet, hash) => {
                TorBoxPlugin.Api.addMagnet(magnet, signal)
                    .then(response => {
                        const newTorboxId = response.data.torrent_id || response.data.id;
                        if (!newTorboxId) {
                            throw { 
                                type: 'api', 
                                message: 'ID торрента не получен после добавления' 
                            };
                        }
                        
                        TorBoxPlugin.SafeStorage.set(storageKey, newTorboxId);
                        TorBoxPlugin.Logger.log(`Saved new TorBox ID: ${newTorboxId} for hash ${hash}`);
                        
                        return trackTorrent(newTorboxId, signal);
                    })
                    .then(data => processTrackedData(data, hash))
                    .catch(handleTrackingError);
            };
            
            const processTrackedData = (data, hash) => {
                data.hash = hash;
                if (window.Lampa && Lampa.Loading) {
                    Lampa.Loading.stop();
                }
                selectFile(data);
            };
            
            const handleTrackingError = (error) => {
                if (window.Lampa && Lampa.Loading) {
                    Lampa.Loading.stop();
                }
                if (error.name !== 'AbortError') {
                    TorBoxPlugin.ErrorHandler.handle(error, 'torrentTracking');
                }
            };
            
            if (savedTorboxId) {
                TorBoxPlugin.Logger.log(`Found saved TorBox ID: ${savedTorboxId}`);
                trackTorrent(savedTorboxId, signal)
                    .then(data => processTrackedData(data, torrent.hash))
                    .catch(error => {
                        if ((error.type === 'api' || error.message.includes('not found')) && 
                            error.name !== 'AbortError') {
                            TorBoxPlugin.Logger.log(`Stale TorBox ID ${savedTorboxId}. Removing and re-adding.`);
                            TorBoxPlugin.SafeStorage.set(storageKey, '');
                            addAndTrack(torrent.magnet, torrent.hash);
                        } else {
                            handleTrackingError(error);
                        }
                    });
            } else {
                TorBoxPlugin.Logger.log('No saved TorBox ID. Adding new magnet.');
                addAndTrack(torrent.magnet, torrent.hash);
            }
        };
        
        // Track torrent progress
        const trackTorrent = (id, signal) => {
            return new Promise((resolve, reject) => {
                let isActive = true;
                
                const cancel = () => {
                    if (isActive) {
                        isActive = false;
                        signal.removeEventListener('abort', cancel);
                        if (window.Lampa && Lampa.Loading) {
                            Lampa.Loading.stop();
                        }
                        reject({ name: 'AbortError', message: 'Отменено пользователем' });
                    }
                };
                
                signal.addEventListener('abort', cancel);
                
                const poll = async () => {
                    if (!isActive) return;
                    
                    try {
                        const response = await TorBoxPlugin.Api.getTorrentList(id, signal);
                        const data = response.data[0];
                        
                        if (!data) {
                            if (isActive) {
                                setTimeout(poll, 10000);
                            }
                            return;
                        }
                        
                        TorBoxPlugin.Logger.log('Torrent status:', data.download_state);
                        
                        if (data.download_state === 'downloaded') {
                            if (isActive) {
                                isActive = false;
                                signal.removeEventListener('abort', cancel);
                                resolve(data);
                            }
                        } else {
                            // Update progress display
                            const progress = Math.round((data.progress || 0) * 100);
                            const speed = TorBoxPlugin.Utils.formatBytes(data.download_speed || 0, true);
                            const eta = TorBoxPlugin.Utils.formatTime(data.eta || 0);
                            
                            if (window.Lampa && Lampa.Loading) {
                                Lampa.Loading.update(`Загрузка: ${progress}% | ${speed} | ETA: ${eta}`);
                            }
                            
                            if (isActive) {
                                setTimeout(poll, 5000);
                            }
                        }
                    } catch (error) {
                        if (isActive && error.name !== 'AbortError') {
                            TorBoxPlugin.Logger.error('Polling error:', error);
                            setTimeout(poll, 10000);
                        }
                    }
                };
                
                poll();
            });
        };
        
        // Select file from torrent
        const selectFile = (torrentData) => {
            if (!torrentData.files || !torrentData.files.length) {
                return TorBoxPlugin.ErrorHandler.show('api', {
                    message: 'Файлы в торренте не найдены'
                });
            }
            
            const videoFiles = torrentData.files.filter(file => {
                const ext = file.name.split('.').pop().toLowerCase();
                return ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v'].includes(ext);
            });
            
            if (!videoFiles.length) {
                return TorBoxPlugin.ErrorHandler.show('api', {
                    message: 'Видеофайлы в торренте не найдены'
                });
            }
            
            if (videoFiles.length === 1) {
                // Single file - play directly
                playTorrentFile(torrentData, videoFiles[0]);
            } else {
                // Multiple files - show selection
                showFileSelection(torrentData, videoFiles);
            }
        };
        
        // Show file selection interface
        const showFileSelection = (torrentData, files) => {
            state.view = 'episodes';
            state.currentTorrentData = torrentData;
            
            if (filter && filter.render) {
                filter.render().hide();
            }
            
            this.reset();
            
            const movieId = object.movie.imdb_id || object.movie.id;
            const torrentId = torrentData.hash || torrentData.id;
            const watchedKey = `torbox_watched_episodes_${movieId}_${torrentId}`;
            const lastPlayedKey = `torbox_last_played_file_${movieId}`;
            
            const watchedEpisodes = JSON.parse(
                TorBoxPlugin.SafeStorage.get(watchedKey, '[]')
            );
            const lastPlayedFile = TorBoxPlugin.SafeStorage.get(lastPlayedKey);
            
            // Sort files naturally
            const sortedFiles = files.sort(TorBoxPlugin.Utils.naturalSort);
            
            sortedFiles.forEach(file => {
                const isWatched = watchedEpisodes.includes(file.id);
                const isLastPlayed = file.id === lastPlayedFile;
                
                const fileData = {
                    title: file.name.split('/').pop(),
                    size: TorBoxPlugin.Utils.formatBytes(file.size),
                    file_id: file.id
                };
                
                const item = Lampa.Template.get('torbox_episode_item', fileData);
                
                if (isWatched) {
                    item.addClass('torbox-file-item--watched');
                }
                
                if (isLastPlayed) {
                    item.addClass('torbox-file-item--last-played');
                }
                
                focusManager.addEventListener(item[0], 'hover:focus', (e) => {
                    focusManager.setFocus(e.target);
                    scroll.update($(e.target), true);
                });
                
                focusManager.addEventListener(item[0], 'hover:enter', () => {
                    playTorrentFile(torrentData, file, () => {
                        // Return to file selection after playback
                        showFileSelection(torrentData, files);
                    });
                });
                
                scroll.append(item);
            });
            
            // Focus on last played or first file
            let focusElement = scroll.render().find('.selector').first();
            if (lastPlayedFile) {
                const lastPlayedElement = scroll.render().find(`[data-file-id="${lastPlayedFile}"]`);
                if (lastPlayedElement.length) {
                    focusElement = lastPlayedElement;
                }
            }
            
            if (focusElement.length) {
                focusManager.setFocus(focusElement[0]);
            }
            
            if (window.Lampa && Lampa.Controller) {
                Lampa.Controller.enable('content');
            }
        };
        
        // Apply filters to torrents
        this.applyFilters = function(torrents) {
            let filtered = [...torrents];
            
            // Apply cached filter
            if (state.showOnlyCached) {
                filtered = filtered.filter(t => t.cached);
            }
            
            // Apply other filters
            Object.entries(state.filters).forEach(([key, value]) => {
                if (value === 'all') return;
                
                switch (key) {
                    case 'quality':
                        filtered = filtered.filter(t => t.quality === value);
                        break;
                    case 'tracker':
                        filtered = filtered.filter(t => 
                            t.trackers.some(tracker => tracker.includes(value))
                        );
                        break;
                    case 'video_type':
                        filtered = filtered.filter(t => t.video_type === value);
                        break;
                    case 'video_codec':
                        filtered = filtered.filter(t => t.video_codec === value);
                        break;
                    case 'audio_codec':
                        filtered = filtered.filter(t => 
                            t.audio_codecs.includes(value)
                        );
                        break;
                    case 'lang':
                        filtered = filtered.filter(t => 
                            t.audio_langs.includes(value)
                        );
                        break;
                }
            });
            
            return filtered;
        };
        
        // Sort torrents
        this.sortTorrents = function(torrents) {
            const sortConfig = sortTypes.find(s => s.key === state.sort);
            if (!sortConfig) return torrents;
            
            const sorted = [...torrents].sort((a, b) => {
                const aVal = a[sortConfig.field] || 0;
                const bVal = b[sortConfig.field] || 0;
                return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
            });
            
            return sortConfig.reverse ? sorted.reverse() : sorted;
        };
        
        // Draw torrents list
        this.draw = function(items) {
            focusManager.setFocus(null);
            scroll.clear();
            
            if (!items.length) {
                return this.empty('Ничего не найдено по заданным фильтрам');
            }
            
            const movieId = object.movie.imdb_id || object.movie.id;
            const lastTorrentData = TorBoxPlugin.SafeStorage.get(`torbox_last_torrent_data_${movieId}`);
            const lastHash = lastTorrentData ? JSON.parse(lastTorrentData).hash : null;
            
            // Get view information for progress bars
            const viewInfo = window.Lampa && Lampa.Storage ? 
                Lampa.Storage.get('view', '{}') : '{}';
            const viewData = JSON.parse(viewInfo)[object.movie.id];
            
            items.forEach(itemData => {
                // Reset last played icon
                itemData.last_played_icon = '';
                
                // Add last played icon if this is the last played torrent
                if (lastHash && itemData.hash === lastHash) {
                    itemData.last_played_icon = `<span class="torbox-item__last-played-icon"><svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5V7.5l5.25 3.5L11 16.5z" fill="currentColor"></path></svg></span>`;
                }
                
                const item = Lampa.Template.get('torbox_item', itemData);
                
                // Add progress bar if view data exists
                if (viewData && viewData.total > 0) {
                    const percent = Math.round((viewData.time / viewData.total) * 100);
                    const progressLine = `<div class="torbox-item__progress"><div style="width: ${percent}%"></div></div>`;
                    item.append(progressLine);
                    
                    // Add time information
                    if (window.Lampa && Lampa.Template && Lampa.Utils) {
                        const timeInfo = Lampa.Template.get('player_time', {
                            time: Lampa.Utils.secondsToTime(viewData.time),
                            left: Lampa.Utils.secondsToTime(viewData.total - viewData.time)
                        });
                        item.find('.torbox-item__main-info').after(timeInfo);
                    }
                }
                
                // Mark as last played function
                itemData.markAsLastPlayed = () => {
                    // Remove all previous last played icons
                    scroll.render().find('.torbox-item__last-played-icon').remove();
                    
                    // Add icon to current element
                    const iconHtml = `<span class="torbox-item__last-played-icon"><svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5V7.5l5.25 3.5L11 16.5z" fill="currentColor"></path></svg></span>`;
                    
                    const titleElement = item.find('.torbox-item__title');
                    if (titleElement.length && !titleElement.find('.torbox-item__last-played-icon').length) {
                        titleElement.prepend(iconHtml);
                    }
                    
                    // Update localStorage
                    TorBoxPlugin.SafeStorage.set(
                        `torbox_last_torrent_data_${movieId}`, 
                        JSON.stringify(itemData)
                    );
                };
                
                // Add event listeners
                focusManager.addEventListener(item[0], 'hover:focus', (e) => {
                    focusManager.setFocus(e.target);
                    state.lastHash = itemData.hash;
                    scroll.update($(e.target), true);
                });
                
                focusManager.addEventListener(item[0], 'hover:enter', () => {
                    handleTorrentClick(itemData);
                });
                
                focusManager.addEventListener(item[0], 'hover:long', () => {
                    if (window.Lampa && Lampa.Select && Lampa.Utils && Lampa.Controller) {
                        Lampa.Select.show({
                            title: 'Действия',
                            items: [{ title: 'Скопировать Magnet' }],
                            onSelect: () => {
                                Lampa.Utils.copyTextToClipboard(itemData.magnet, () => {
                                    if (Lampa.Noty) {
                                        Lampa.Noty.show('Magnet-ссылка скопирована');
                                    }
                                });
                                Lampa.Controller.toggle('content');
                            },
                            onBack: () => Lampa.Controller.toggle('content')
                        });
                    }
                });
                
                scroll.append(item);
            });
            
            // Set focus
            let focusElement = scroll.render().find('.selector').first();
            if (state.lastHash) {
                const focused = scroll.render().find(`[data-hash="${state.lastHash}"]`);
                if (focused.length) {
                    focusElement = focused;
                }
            }
            
            if (focusElement.length) {
                focusManager.setFocus(focusElement[0]);
            }
            
            if (window.Lampa && Lampa.Controller) {
                Lampa.Controller.enable('content');
            }
            
            // Update continue watching panel
            updateContinueWatchingPanel();
        };
        
        // Update continue watching panel
        const updateContinueWatchingPanel = () => {
            if (state.view !== 'torrents') return;
            
            const movieId = object.movie.imdb_id || object.movie.id;
            const lastWatchedData = TorBoxPlugin.SafeStorage.get(`torbox_last_torrent_data_${movieId}`);
            
            let panel = scroll.body().find('.torbox-watched-item');
            
            if (lastWatchedData) {
                try {
                    const lastTorrent = JSON.parse(lastWatchedData);
                    const infoText = lastTorrent.title;
                    
                    if (panel.length) {
                        // Update existing panel
                        panel.find('.torbox-watched-item__info').text(infoText);
                    } else {
                        // Create new panel
                        const historyItem = Lampa.Template.get('torbox_watched_item', {
                            title: 'Продолжить просмотр',
                            info: infoText
                        });
                        
                        focusManager.addEventListener(historyItem[0], 'hover:focus', (e) => {
                            focusManager.setFocus(e.target);
                            scroll.update($(e.target), true);
                        });
                        
                        focusManager.addEventListener(historyItem[0], 'hover:enter', () => {
                             handleTorrentClick(lastTorrent);
                         });
                         
                         scroll.body().prepend(historyItem);
                     }
                 } catch (error) {
                     TorBoxPlugin.Logger.warn('Failed to parse last watched torrent data:', error);
                 }
             } else if (panel.length) {
                 // Remove panel if no data
                 panel.remove();
             }
         };
         
         // Component lifecycle methods
         this.create = function() {
             this.activity.loader(false);
             scroll.body().addClass('torbox-list-container');
             files.appendFiles(scroll.render());
             files.appendHead(filter.render());
             scroll.minus(files.render().find('.explorer__files-head'));
             return this.render();
         };
         
         this.render = function() {
             return files.render();
         };
         
         this.empty = function(msg) {
             scroll.clear();
             const emptyElem = Lampa.Template.get('torbox_empty', { 
                 message: msg || 'Торренты не найдены' 
             });
             emptyElem.addClass('selector');
             
             focusManager.addEventListener(emptyElem[0], 'hover:focus', (e) => {
                 focusManager.setFocus(e.target);
                 scroll.update($(e.target), true);
             });
             
             focusManager.addEventListener(emptyElem[0], 'hover:enter', () => {
                 if (window.Lampa && Lampa.Noty) {
                     Lampa.Noty.show('Нет доступных торрентов. Попробуйте изменить фильтры или уточнить поиск.');
                 }
             });
             
             scroll.append(emptyElem);
             
             if (window.Lampa && Lampa.Controller) {
                 Lampa.Controller.enable('content');
             }
         };
         
         this.reset = function() {
             focusManager.setFocus(null);
             scroll.clear();
             scroll.reset();
         };
         
         this.build = function() {
             this.buildFilter();
             
             if (cachedToggleButton) {
                 const isCachedOnly = state.showOnlyCached;
                 cachedToggleButton.toggleClass('filter__item--active', isCachedOnly);
                 cachedToggleButton.find('span').text(isCachedOnly ? '⚡' : '☁️');
                 cachedToggleButton.attr('title', 
                     isCachedOnly ? 'Показаны только кешированные' : 'Показать только кешированные'
                 );
             }
             
             this.draw(this.applyFiltersAndSort());
         };
         
         this.buildFilter = function() {
             const buildFilterItem = (key, title, arr) => {
                 const unique = [...new Set(arr.flat().filter(Boolean))].sort();
                 const items = ['all', ...unique].map(v => ({
                     title: v === 'all' ? 'Все' : v.toUpperCase(),
                     value: v,
                     selected: state.filters[key] === v
                 }));
                 const subtitle = state.filters[key] === 'all' ? 'Все' : state.filters[key].toUpperCase();
                 return { title, subtitle, items, stype: key };
             };
             
             const filterItems = [
                 { title: 'Уточнить поиск', refine: true },
                 buildFilterItem('quality', 'Качество', state.allTorrents.map(t => t.quality)),
                 buildFilterItem('video_type', 'Тип видео', state.allTorrents.map(t => t.video_type)),
                 buildFilterItem('translation', 'Перевод', state.allTorrents.map(t => t.voices)),
                 buildFilterItem('lang', 'Язык аудио', state.allTorrents.map(t => t.audio_langs)),
                 buildFilterItem('video_codec', 'Видео кодек', state.allTorrents.map(t => t.video_codec)),
                 buildFilterItem('audio_codec', 'Аудио кодек', state.allTorrents.map(t => t.audio_codecs)),
                 buildFilterItem('tracker', 'Трекер', state.allTorrents.map(t => t.trackers)),
                 { title: 'Сбросить фильтры', reset: true },
                 { title: 'Обновить список', refresh: true }
             ];
             
             filter.set('filter', filterItems);
             filter.render().find('.filter--filter span').text('Фильтр');
             filter.render().find('.filter--search input').attr('placeholder', 
                 state.searchQuery || object.movie.title
             );
             
             const activeFilters = filterItems.filter(f => 
                 f.stype && state.filters[f.stype] !== 'all'
             ).map(f => `${f.title}: ${state.filters[f.stype]}`);
             
             filter.chosen('filter', activeFilters);
             
             const sortItems = sortTypes.map(item => ({
                 ...item,
                 selected: item.key === state.sort
             }));
             
             filter.set('sort', sortItems);
             filter.render().find('.filter--sort span').text('Сортировка');
         };
         
         this.applyFiltersAndSort = function() {
             const filtered = this.applyFilters(state.allTorrents);
             return this.sortTorrents(filtered);
         };
         
         this.initialize = function() {
             // Setup controller
             if (window.Lampa && Lampa.Controller) {
                 Lampa.Controller.add('content', {
                     toggle: () => {
                         Lampa.Controller.collectionSet(filter.render(), scroll.render());
                         Lampa.Controller.collectionFocus(focusManager.currentFocus || false, scroll.render());
                     },
                     up: () => {
                         if (Navigator.canmove('up')) {
                             Navigator.move('up');
                         } else {
                             Lampa.Controller.toggle('head');
                         }
                     },
                     down: () => {
                         if (Navigator.canmove('down')) {
                             Navigator.move('down');
                         }
                     },
                     left: () => {
                         if (Navigator.canmove('left')) {
                             Navigator.move('left');
                         } else {
                             Lampa.Controller.toggle('menu');
                         }
                     },
                     right: () => {
                         if (Navigator.canmove('right')) {
                             Navigator.move('right');
                         } else if (filter && filter.show) {
                             filter.show(Lampa.Lang.translate('title_filter'), 'filter');
                         }
                     },
                     back: this.back.bind(this)
                 });
                 
                 Lampa.Controller.toggle('content');
             }
             
             // Setup filter callbacks
             if (filter) {
                 filter.onSelect = (type, selectedItem, selectedValue) => {
                     if (window.Lampa && Lampa.Select) {
                         Lampa.Select.close();
                     }
                     
                     if (type === 'sort') {
                         state.sort = selectedItem.key;
                         TorBoxPlugin.SafeStorage.set('torbox_sort_method', selectedItem.key);
                     } else if (type === 'filter') {
                         if (selectedItem.refine) {
                             this.handleRefineSearch();
                             return;
                         }
                         if (selectedItem.refresh) {
                             return search(true);
                         }
                         if (selectedItem.reset) {
                             state.filters = JSON.parse(JSON.stringify(defaultFilters));
                         } else if (selectedItem.stype) {
                             state.filters[selectedItem.stype] = selectedValue.value;
                         }
                         
                         TorBoxPlugin.SafeStorage.set('torbox_filters_v2', JSON.stringify(state.filters));
                     }
                     
                     // Save current focus hash
                     if (focusManager.currentFocus && focusManager.currentFocus.getAttribute) {
                         state.lastHash = focusManager.currentFocus.getAttribute('data-hash');
                     }
                     
                     this.build();
                     
                     if (window.Lampa && Lampa.Controller) {
                         Lampa.Controller.toggle('content');
                     }
                 };
                 
                 filter.onBack = () => {
                     this.start();
                 };
                 
                 filter.onSearch = (value) => {
                     search(true, value);
                 };
                 
                 if (filter.addButtonBack) {
                     filter.addButtonBack();
                 }
             }
             
             // Create cached toggle button
             cachedToggleButton = $(`
                 <div class="filter__item selector torbox-cached-toggle">
                     <span></span>
                 </div>
             `);
             
             cachedToggleButton.on('hover:enter', () => {
                 state.showOnlyCached = !state.showOnlyCached;
                 TorBoxPlugin.SafeStorage.set('torbox_show_only_cached', state.showOnlyCached ? '1' : '0');
                 this.build();
             });
             
             if (filter && filter.render) {
                 filter.render().find('.filter--sort').before(cachedToggleButton);
             }
             
             this.empty('Загрузка...');
             search();
         };
         
         this.handleRefineSearch = function() {
             const combinations = generateSearchCombinations(object.movie);
             const selectItems = combinations.map(c => ({ title: c, search_query: c }));
             
             if (!combinations.length) {
                 if (window.Lampa && Lampa.Noty) {
                     Lampa.Noty.show('Недостаточно данных для создания комбинаций поиска.');
                 }
                 if (window.Lampa && Lampa.Controller) {
                     return Lampa.Controller.toggle('content');
                 }
                 return;
             }
             
             if (window.Lampa && Lampa.Select) {
                 Lampa.Select.show({
                     title: 'Уточнить поиск',
                     items: selectItems,
                     onSelect: (selected) => {
                         search(true, selected.search_query);
                         if (window.Lampa && Lampa.Controller) {
                             Lampa.Controller.toggle('content');
                         }
                     },
                     onBack: () => {
                         if (window.Lampa && Lampa.Controller) {
                             Lampa.Controller.toggle('content');
                         }
                     }
                 });
             }
         };
         
         this.start = function() {
             if (window.Lampa && Lampa.Activity && Lampa.Activity.active().activity !== this.activity) {
                 return;
             }
             
             if (window.Lampa && Lampa.Background && Lampa.Utils) {
                 Lampa.Background.immediately(Lampa.Utils.cardImgBackgroundBlur(object.movie));
             }
             
             if (!initialized) {
                 initialized = true;
                 this.initialize();
             } else {
                 this.build();
                 if (window.Lampa && Lampa.Controller) {
                     Lampa.Controller.toggle('content');
                 }
             }
         };
         
         this.back = function() {
             if (state.view === 'episodes') {
                 state.view = 'torrents';
                 if (filter && filter.render) {
                     filter.render().show();
                 }
                 this.build();
             } else {
                 abortController.abort();
                 if (window.Lampa && Lampa.Activity) {
                     Lampa.Activity.backward();
                 }
             }
         };
         
         this.destroy = function() {
             isDestroyed = true;
             abortController.abort();
             
             if (focusManager) {
                 focusManager.destroy();
             }
             
             if (window.Lampa && Lampa.Controller) {
                 Lampa.Controller.clear('content');
             }
             
             if (scroll) {
                 scroll.destroy();
                 scroll = null;
             }
             
             if (files) {
                 files.destroy();
                 files = null;
             }
             
             if (filter) {
                 filter.destroy();
                 filter = null;
             }
             
             focusManager = null;
         };
         
         this.pause = function() {};
         this.stop = function() {};
     }

     // ───────────────────── PLUGIN ▸ MAIN INTEGRATION ──────────────────────────────
     (function() {
         const manifest = {
             type: 'video',
             version: '51.0.0',
             name: 'TorBox Optimized',
             description: 'Оптимизированный плагин для просмотра торрентов через TorBox',
             component: 'torbox_optimized'
         };
         
         // Add language translations
         if (window.Lampa && Lampa.Lang) {
             Lampa.Lang.add({
                 torbox_watch: { 
                     ru: 'Смотреть через TorBox', 
                     en: 'Watch via TorBox', 
                     uk: 'Дивитися через TorBox' 
                 },
                 title_torbox: { 
                     ru: 'TorBox', 
                     uk: 'TorBox', 
                     en: 'TorBox' 
                 }
             });
         }
         
         // Add templates
         function addTemplates() {
             if (window.Lampa && Lampa.Template) {
                 Lampa.Template.add('torbox_item', 
                     '<div class="torbox-item selector" data-hash="{hash}">' +
                         '<div class="torbox-item__title">{last_played_icon}{icon} {title}</div>' +
                         '<div class="torbox-item__main-info">{info_formated}</div>' +
                         '<div class="torbox-item__meta">{meta_formated}</div>' +
                         '{tech_bar_html}' +
                     '</div>'
                 );
                 
                 Lampa.Template.add('torbox_empty', 
                     '<div class="empty">' +
                         '<div class="empty__text">{message}</div>' +
                     '</div>'
                 );
                 
                 Lampa.Template.add('torbox_watched_item', 
                     '<div class="torbox-watched-item selector">' +
                         '<div class="torbox-watched-item__icon">' +
                             '<svg viewBox="0 0 24 24">' +
                                 '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5V7.5l5.25 3.5L11 16.5z" fill="currentColor"></path>' +
                             '</svg>' +
                         '</div>' +
                         '<div class="torbox-watched-item__body">' +
                             '<div class="torbox-watched-item__title">{title}</div>' +
                             '<div class="torbox-watched-item__info">{info}</div>' +
                         '</div>' +
                     '</div>'
                 );
                 
                 Lampa.Template.add('torbox_episode_item', 
                     '<div class="torbox-file-item selector" data-file-id="{file_id}">' +
                         '<div class="torbox-file-item__title">{title}</div>' +
                         '<div class="torbox-file-item__subtitle">{size}</div>' +
                     '</div>'
                 );
             }
         }
         
         // Add settings
         function addSettings() {
             if (!window.Lampa || !Lampa.SettingsApi) return;
             
             const { config, ICON } = TorBoxPlugin.Config;
             
             Lampa.SettingsApi.addComponent({ 
                 component: 'torbox_optimized_settings', 
                 name: 'TorBox Optimized', 
                 icon: ICON 
             });
             
             const settings = [
                 {
                     key: 'torbox_proxy_url',
                     name: 'URL CORS-прокси',
                     description: 'Введите URL для CORS-прокси',
                     type: 'input',
                     value: config.proxyUrl
                 },
                 {
                     key: 'torbox_api_key',
                     name: 'API-Key',
                     description: 'Введите ваш API-ключ от TorBox',
                     type: 'input',
                     value: config.apiKey
                 },
                 {
                     key: 'torbox_debug',
                     name: 'Debug-режим',
                     description: 'Выводить лог в консоль',
                     type: 'trigger',
                     value: config.debug
                 }
             ];
             
             settings.forEach(setting => {
                 Lampa.SettingsApi.addParam({
                     component: 'torbox_optimized_settings',
                     param: {
                         name: setting.key,
                         type: setting.type,
                         values: '',
                         default: setting.value
                     },
                     field: {
                         name: setting.name,
                         description: setting.description
                     },
                     onChange: (value) => {
                         const val = typeof value === 'object' ? value.value : value;
                         
                         if (setting.key === 'torbox_proxy_url') {
                             config.proxyUrl = String(val).trim();
                         } else if (setting.key === 'torbox_api_key') {
                             config.apiKey = String(val).trim();
                         } else if (setting.key === 'torbox_debug') {
                             config.debug = Boolean(val);
                         }
                     },
                     onRender: (field) => {
                         if (setting.key === 'torbox_api_key') {
                             field.find('input').attr('type', 'password');
                         }
                     }
                 });
             });
         }
         
         // Boot function
         function boot() {
             if (!window.Lampa) return;
             
             // Register component
             if (Lampa.Component) {
                 Lampa.Component.add('torbox_optimized', MainComponent);
             }
             
             addTemplates();
             addSettings();
             
             // Add button to movie card
             if (Lampa.Listener) {
                 Lampa.Listener.follow('full', (event) => {
                     if (event.type !== 'complite' || !event.data.movie) return;
                     
                     const root = event.object.activity.render();
                     if (!root?.length || root.find('.view--torbox-optimized').length) return;
                     
                     const { ICON } = TorBoxPlugin.Config;
                     const button = $(`
                         <div class="full-start__button selector view--torbox-optimized" data-subtitle="TorBox">
                             ${ICON}
                             <span>TorBox</span>
                         </div>
                     `);
                     
                     button.on('hover:enter', () => {
                         if (Lampa.Activity && Lampa.Lang) {
                             Lampa.Activity.push({
                                 component: 'torbox_optimized',
                                 title: Lampa.Lang.translate('title_torbox') + ' - ' + 
                                        (event.data.movie.title || event.data.movie.name),
                                 movie: event.data.movie
                             });
                         }
                     });
                     
                     const torrentButton = root.find('.view--torrent');
                     if (torrentButton.length) {
                         torrentButton.after(button);
                     } else {
                         root.find('.full-start__play').after(button);
                     }
                 });
             }
             
             // Add CSS styles
             const css = document.createElement('style');
             css.id = 'torbox-optimized-styles';
             css.textContent = `
                 .torbox-list-container { 
                     display: block; 
                     padding: 1em; 
                 }
                 
                 .torbox-item { 
                     position: relative; 
                     padding: 1em 1.2em; 
                     margin: 0 0 1em 0; 
                     border-radius: .8em; 
                     background: var(--color-background-light); 
                     cursor: pointer; 
                     transition: all .3s ease; 
                     border: 2px solid transparent; 
                     overflow: hidden; 
                 }
                 
                 .torbox-item:last-child { 
                     margin-bottom: 0; 
                 }
                 
                 .torbox-item__last-played-icon { 
                     display: inline-flex; 
                     align-items: center; 
                     justify-content: center; 
                     width: 1.2em; 
                     height: 1.2em; 
                     margin-right: .5em; 
                     color: var(--color-second); 
                     flex-shrink: 0; 
                 }
                 
                 .torbox-item__last-played-icon svg { 
                     width: 100%; 
                     height: 100%; 
                 }
                 
                 .torbox-item:hover, 
                 .torbox-item.focus, 
                 .torbox-watched-item:hover, 
                 .torbox-watched-item.focus, 
                 .torbox-file-item:hover, 
                 .torbox-file-item.focus { 
                     background: var(--color-primary); 
                     color: var(--color-background); 
                     transform: scale(1.01); 
                     border-color: rgba(255, 255, 255, .3); 
                     box-shadow: 0 4px 20px rgba(0, 0, 0, .2); 
                 }
                 
                 .torbox-item:hover .torbox-item__tech-bar, 
                 .torbox-item.focus .torbox-item__tech-bar { 
                     background: rgba(0, 0, 0, .2); 
                 }
                 
                 .torbox-item__title { 
                     font-weight: 600; 
                     margin-bottom: .3em; 
                     font-size: 1.1em; 
                     line-height: 1.3; 
                     white-space: nowrap; 
                     overflow: hidden; 
                     text-overflow: ellipsis; 
                     display: flex; 
                     align-items: center; 
                 }
                 
                 .torbox-item__main-info { 
                     font-size: .95em; 
                     opacity: .9; 
                     line-height: 1.4; 
                     margin-bottom: .3em; 
                 }
                 
                 .torbox-item__meta { 
                     font-size: .9em; 
                     opacity: .7; 
                     line-height: 1.4; 
                     margin-bottom: .8em; 
                 }
                 
                 .torbox-item__progress { 
                     position: absolute; 
                     bottom: 0; 
                     left: 0; 
                     right: 0; 
                     height: 3px; 
                     background: rgba(255,255,255,0.2); 
                 }
                 
                 .torbox-item__progress div { 
                     height: 100%; 
                     background: var(--color-primary); 
                 }
                 
                 .torbox-item__tech-bar { 
                     display: flex; 
                     flex-wrap: wrap; 
                     gap: .6em; 
                     margin: 0 -1.2em -1em -1.2em; 
                     padding: .6em 1.2em; 
                     background: rgba(0, 0, 0, .1); 
                     font-size: .85em; 
                     font-weight: 500; 
                     transition: background .3s ease; 
                 }
                 
                 .torbox-item__tech-item { 
                     padding: .2em .5em; 
                     border-radius: .4em; 
                     color: #fff; 
                 }
                 
                 .torbox-item__tech-item--res { 
                     background: #3b82f6; 
                 }
                 
                 .torbox-item__tech-item--codec { 
                     background: #16a34a; 
                 }
                 
                 .torbox-item__tech-item--audio { 
                     background: #f97316; 
                 }
                 
                 .torbox-item__tech-item--hdr { 
                     background: linear-gradient(45deg, #ff8c00, #ffa500); 
                 }
                 
                 .torbox-item__tech-item--dv { 
                     background: linear-gradient(45deg, #4b0082, #8a2be2); 
                 }
                 
                 .torbox-cached-toggle { 
                     display: inline-flex; 
                     align-items: center; 
                     justify-content: center; 
                     border: 2px solid transparent; 
                     transition: all .3s ease; 
                 }
                 
                 .torbox-cached-toggle span { 
                     font-size: 1.5em; 
                     line-height: 1; 
                 }
                 
                 .torbox-cached-toggle.filter__item--active,
                 .torbox-cached-toggle.focus,
                 .torbox-cached-toggle:hover {
                     background: var(--color-primary);
                     color: var(--color-background);
                 }
                 
                 .torbox-cached-toggle.focus,
                 .torbox-cached-toggle:hover {
                     border-color: rgba(255, 255, 255, .3);
                 }
                 
                 .torbox-file-item { 
                     display: flex; 
                     justify-content: space-between; 
                     align-items: center; 
                     padding: 1em 1.2em; 
                     margin-bottom: 1em; 
                     border-radius: .8em; 
                     background: var(--color-background-light); 
                     transition: all .3s ease; 
                     border: 2px solid transparent; 
                 }
                 
                 .torbox-file-item__title { 
                     font-weight: 600; 
                 }
                 
                 .torbox-file-item__subtitle { 
                     font-size: .9em; 
                     opacity: .7; 
                 }
                 
                 .torbox-file-item--last-played { 
                     border-left: 4px solid var(--color-second); 
                 }
                 
                 .torbox-file-item--watched { 
                     color: #888; 
                 }
                 
                 .torbox-watched-item { 
                     display: flex; 
                     align-items: center; 
                     padding: 1em; 
                     margin-bottom: 1em; 
                     border-radius: .8em; 
                     background: var(--color-background-light); 
                     border-left: 4px solid var(--color-second); 
                     transition: all .3s ease; 
                     border: 2px solid transparent; 
                 }
                 
                 .torbox-watched-item__icon { 
                     flex-shrink: 0; 
                     margin-right: 1em; 
                 }
                 
                 .torbox-watched-item__icon svg { 
                     width: 2em; 
                     height: 2em; 
                 }
                 
                 .torbox-watched-item__body { 
                     flex-grow: 1; 
                 }
                 
                 .torbox-watched-item__title { 
                     font-weight: 600; 
                 }
                 
                 .torbox-watched-item__info { 
                     font-size: .9em; 
                     opacity: .7; 
                 }
             `;
             
             document.head.appendChild(css);
             
             // Register manifest
             if (Lampa.Manifest) {
                 Lampa.Manifest.plugins[manifest.name] = manifest;
             }
             
             TorBoxPlugin.Logger.log('TorBox Optimized v51.0.0 ready');
         }
         
         // Initialize when Lampa is ready
         if (window.Lampa && Lampa.Activity) {
             boot();
         } else {
             const lampaBootListener = Lampa.Listener.follow('app', (event) => {
                 if (event.type === 'ready') {
                     boot();
                     Lampa.Listener.remove('app', lampaBootListener);
                 }
             });
         }
     })();
 })();
