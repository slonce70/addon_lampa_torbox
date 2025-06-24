(function () {
    'use strict';

    /**
     * TorBox ↔ Lampa integration plugin – **2025‑06‑24**
     * • Waits until the Lampa core signals `app:ready`
     * • Registers a new source „TorBox“
     * • Adds a settings page & 24h search-cache
     * • Streams cached torrents directly, non-cached are added to downloads
     * @version 2.0.0
     * @author GOD MODE
     */

    const PLUGIN_NS = "torbox_lampa_plugin_v2_ready";
    if (window[PLUGIN_NS]) return; // Protect from double-load
    window[PLUGIN_NS] = true;

    /** ========== Storage keys / Constants ========== */
    const S = {
        API_KEY: "torbox_api_key",
        PROXY: "torbox_proxy_url",
        CACHED_ONLY: "torbox_show_cached_only",
    };

    const EP = {
        SEARCH: "/torrents/search/", // Note: Using relative paths for proxy
        ADD: "/torrents/createtorrent",
        DETAILS: "/torrents/mylist?id=", // Torbox API uses mylist with an ID to get details
        DOWNLOAD: "/torrents/requestdl"
    };

    /* --- 24h Search Cache --- */
    const SearchCache = (() => {
        const TTL = 86400; // 24 hours in seconds
        const mem = new Map();
        const now = () => Math.floor(Date.now() / 1000);
        const key = q => `torbox_cache_${q}`;
        return {
            get(q) {
                if (mem.has(q)) return mem.get(q);
                try {
                    const raw = Lampa.Storage.get(key(q));
                    if (!raw || now() - raw.ts > TTL) return null;
                    mem.set(q, raw.data);
                    return raw.data;
                } catch (e) { return null; }
            },
            set(q, data) {
                mem.set(q, data);
                Lampa.Storage.set(key(q), { ts: now(), data });
            },
        };
    })();

    class TorBoxPlugin {
        constructor() {
            this.settings = {};
            this.loadSettings();
        }

        /**
         * Loads settings from Lampa's storage.
         */
        loadSettings() {
            this.settings.api_key = Lampa.Storage.get(S.API_KEY, '');
            let proxy = Lampa.Storage.get(S.PROXY, '');
            if (proxy.endsWith('/')) {
                proxy = proxy.slice(0, -1);
            }
            this.settings.proxy_url = proxy;
        }

        /**
         * The main initialization method for the plugin.
         */
        init() {
            // Register this class as a Lampa component
            Lampa.Component.add('torbox_parser', this);

            // Add the filter (source) to the Lampa interface
            const filter = {
                title: 'TorBox',
                name: 'torbox_parser',
                wait: true // Tell Lampa our parser is asynchronous
            };
            if(Lampa.Filter) {
                Lampa.Filter.add('torrents', filter);
            } else if (Lampa.Sources) {
                Lampa.Sources.add(filter);
            }

            // Inject the settings panel
            this.addSettingsPanel();
        }

        /**
         * Centralized method for making API calls to Torbox via the proxy.
         * @param {string} endpoint - The key for the endpoint from the EP object.
         * @param {object} params - Request parameters (query for GET, body for POST).
         * @param {string} method - HTTP method ('GET' or 'POST').
         * @param {string} path_param - Additional path parameter (e.g., torrent ID).
         * @returns {Promise<object>} - A promise that resolves with the API response.
         */
        async apiCall(endpoint, params = {}, method = 'GET', path_param = '') {
            this.loadSettings();
            if (!this.settings.api_key || !this.settings.proxy_url) {
                return Promise.reject('TorBox API Key and Proxy URL must be set.');
            }

            let url = this.settings.proxy_url + EP[endpoint] + path_param;
            const options = {
                headers: { 'x-api-key': this.settings.api_key },
                timeout: 20000, // 20 seconds
            };

            if (method.toUpperCase() === 'GET') {
                if (Object.keys(params).length > 0) {
                    url += (url.includes('?') ? '&' : '?') + new URLSearchParams(params).toString();
                }
            } else { // POST
                options.method = 'POST';
                options.body = JSON.stringify(params);
                options.headers['Content-Type'] = 'application/json';
            }

            try {
                const response = await fetch(url, options);
                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`API Error: ${response.status} ${response.statusText} - ${errorText}`);
                }
                const data = await response.json();
                if (data.success === false) {
                    throw new Error(data.error || data.detail || 'Unknown API error');
                }
                return data;
            } catch (error) {
                console.error("TorBox API Call Failed:", error);
                throw error;
            }
        }

        /**
         * Method called by Lampa to start the search.
         * @param {object} movie - Movie information object (title, year, imdb_id).
         * @param {function} on_data - Callback to return results.
         */
        async start(movie, on_data) {
            const query = movie.imdb_id ? `imdb:${movie.imdb_id}` : `${movie.title} ${movie.year || ''}`.trim();

            const cached = SearchCache.get(query);
            if (cached) {
                on_data(cached);
                return;
            }

            try {
                // The search API from jittarao/torbox-app is a GET request with the query in the path
                const searchPath = encodeURIComponent(query);
                const response = await this.apiCall('SEARCH', { metadata: 1, check_cache: 1, check_owned: 1 }, 'GET', searchPath);

                if (response.data && response.data.torrents) {
                    const torrents = this.processResults(response.data.torrents);
                    SearchCache.set(query, torrents);
                    on_data(torrents);
                } else {
                    on_data([]); // Return empty array if no torrents found
                }
            } catch (error) {
                Lampa.Noty.show(error.toString(), { type: 'error' });
                on_data([]); // Return empty array on error
            }
        }
        
        /**
         * Lampa's entry point for handling a user's selection.
         * @param {object} torrent_data - Data of the selected torrent.
         * @param {function} call_callback - Callback to start the player.
         */
        async select(torrent_data, call_callback) {
            Lampa.Controller.loading(true);
            try {
                // Scenario dispatcher
                if (torrent_data._torbox.cached || torrent_data._torbox.owned) {
                    await this.playCachedTorrent(torrent_data, call_callback);
                } else {
                    await this.addTorrentToDownloads(torrent_data);
                }
            } catch (error) {
                Lampa.Noty.show(error.toString(), { type: 'error' });
            } finally {
                Lampa.Controller.loading(false);
            }
        }

        /**
         * Processes search results and formats them for display in Lampa.
         * @param {Array} torrents - Array of torrents from the API.
         * @returns {Array} - Formatted array for Lampa.
         */
        processResults(torrents) {
            if (Lampa.Storage.get(S.CACHED_ONLY, false)) {
                torrents = torrents.filter(t => t.cached);
            }
            return torrents.map(torrent => ({
                title: torrent.raw_title || torrent.name,
                info: `${torrent.cached || torrent.owned ? '⚡ ' : ''}${(torrent.size / 2 ** 30).toFixed(2)} GB • S:${torrent.seeders ?? '?'}/${torrent.peers ?? '?'}`,
                quality: torrent.resolution || torrent.quality || "—",
                size: torrent.size,
                magnet: torrent.magnet,
                // Custom data for further processing
                _torbox: {
                    id: torrent.id,
                    cached: !!torrent.cached,
                    owned: !!torrent.owned
                }
            }));
        }

        /**
         * Logic for playing a cached torrent.
         */
        async playCachedTorrent(torrent_data, call_callback) {
            Lampa.Noty.show('Requesting files from cache...');
            const torrent_details = await this.apiCall('DETAILS', {}, 'GET', torrent_data._torbox.id);

            if (!torrent_details.data || !torrent_details.data.files || torrent_details.data.files.length === 0) {
                throw new Error('Failed to get file list or torrent is empty.');
            }

            const files = torrent_details.data.files
                .filter(f => /\.(mkv|mp4|avi)$/i.test(f.name))
                .map(file => ({
                    title: file.name,
                    size: file.size,
                    _torbox_file_id: file.id
                })).sort((a, b) => b.size - a.size);

            if (files.length === 1) {
                await this.getStreamAndPlay(torrent_data._torbox.id, files[0]._torbox_file_id, call_callback);
            } else {
                Lampa.Select.show({
                    title: 'Select a file to play',
                    items: files,
                    onSelect: async (selected_file) => {
                        Lampa.Controller.loading(true);
                        try {
                            await this.getStreamAndPlay(torrent_data._torbox.id, selected_file._torbox_file_id, call_callback);
                        } finally {
                            Lampa.Controller.loading(false);
                        }
                    },
                    onBack: () => Lampa.Controller.toggle('content')
                });
            }
        }

        /**
         * Logic for adding a non-cached torrent to downloads.
         */
        async addTorrentToDownloads(torrent_data) {
            Lampa.Noty.show('Adding to TorBox downloads...');
            const response = await this.apiCall('ADD', { magnet: torrent_data.magnet }, 'POST');
            if (response.success) {
                Lampa.Noty.show('Torrent added successfully!', { type: 'success' });
            } else {
                throw new Error(response.error || response.detail || 'Unknown error adding torrent.');
            }
            Lampa.Controller.toggle('content');
        }

        /**
         * Gets the stream link and passes it to the player.
         */
        async getStreamAndPlay(torrent_id, file_id, call_callback) {
            Lampa.Noty.show('Requesting stream link...');
            const response = await this.apiCall('DOWNLOAD', { torrent_id, file_id });
            if (response.success && response.data) {
                call_callback({ url: response.data });
            } else {
                throw new Error('Failed to get stream link.');
            }
        }

        /**
         * Adds the settings panel for the plugin.
         */
        addSettingsPanel() {
            const onOpen = ({ name }) => {
                if (name !== "torbox") return;
                const body = $(".settings-body").empty();
                body.append(`<div class="settings-param__title">TorBox</div>`);
                
                const addInput = (label, placeholder, key) => {
                    const val = Lampa.Storage.get(key, "");
                    const item = $(`<div class="settings-param selector" data-name="${key}">
                        <div class="settings-param__name">${label}</div>
                        <div class="settings-param__value">${val}</div>
                        <div class="settings-param__descr">${placeholder}</div>
                    </div>`);
                    item.on('hover:enter', () => {
                        Lampa.Settings.pget(item, key, (newVal) => {
                            Lampa.Storage.set(key, newVal.trim());
                            this.loadSettings();
                        }, val);
                    });
                    body.append(item);
                };

                const addCheckbox = (label, key) => {
                     const val = Lampa.Storage.get(key, false);
                     const item = $(`<div class="settings-param-checkbox selector" data-name="${key}">
                        <div class="settings-param-checkbox__body">
                            <div class="settings-param-checkbox__name">${label}</div>
                            <div class="settings-param-checkbox__value"></div>
                        </div>
                     </div>`);
                     const check = Lampa.Utils.check(item.find('.settings-param-checkbox__value'), val);
                     check.on('change', (e, isChecked) => {
                        Lampa.Storage.set(key, isChecked);
                     });
                     body.append(item);
                }

                addInput("API Key", "Required. Your key from torbox.app.", S.API_KEY);
                addInput("Proxy URL", "Required. Your CORS-proxy server address.", S.PROXY);
                addCheckbox("Show cached only", S.CACHED_ONLY);
            };

            Lampa.Listener.follow("settings", ({ type, object }) => {
                if (type === "open") onOpen(object);
            });
            
            // Add the menu item
            if(Lampa.Settings.main) {
                Lampa.Settings.main().add({
                    title: 'TorBox',
                    name: 'torbox'
                });
            } else if (Lampa.Settings.menu) {
                 Lampa.Settings.menu().push({ name: "torbox", title: "TorBox", icon: "fa-cloud-bolt" });
            }
        }
    }

    // Initialize the plugin once Lampa is ready
    function initializePlugin() {
        if (window.appready) {
            new TorBoxPlugin().init();
        } else {
            Lampa.Listener.follow("app", (e) => {
                if (e.type === "ready") new TorBoxPlugin().init();
            });
        }
    }

    initializePlugin();

})();
