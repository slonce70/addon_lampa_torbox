(function () {
    'use strict';

    /**
     * TorBox ↔ Lampa integration plugin – **2025‑06‑24**
     * • Waits until the Lampa core signals `app:ready`
     * • Registers a new source „TorBox“
     * • Adds a settings page & 24h search-cache
     * • Streams cached torrents directly, non-cached are added to downloads
     * @version 2.1.0 - With robust source registration
     * @author GOD MODE
     */

    const PLUGIN_NS = "torbox_lampa_plugin_v2_1_ready";
    if (window[PLUGIN_NS]) return; // Protect from double-load
    window[PLUGIN_NS] = true;

    /** ========== Storage keys / Constants ========== */
    const S = {
        API_KEY: "torbox_api_key",
        PROXY: "torbox_proxy_url",
        CACHED_ONLY: "torbox_show_cached_only",
    };

    // Note: Using relative paths for proxy. Proxy URL should be the base path to TorBox API.
    const EP = {
        SEARCH: "/torrents/search/",
        ADD: "/torrents/createtorrent",
        DETAILS: "/torrents/mylist?id=",
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

        loadSettings() {
            this.settings.api_key = Lampa.Storage.get(S.API_KEY, '');
            let proxy = Lampa.Storage.get(S.PROXY, '');
            if (proxy.endsWith('/')) {
                proxy = proxy.slice(0, -1);
            }
            this.settings.proxy_url = proxy;
        }

        init() {
            // Register this class as a Lampa component
            Lampa.Component.add('torbox_parser', this);
            
            // --- Reliable source registration ---
            // Different Lampa builds use different APIs for this.
            // We will try them all to ensure maximum compatibility.
            const filter = {
                title: 'TorBox',
                name: 'torbox_parser',
                wait: true
            };
    
            let registered = false;
            try {
                if (typeof Lampa.Filter?.add === 'function') {
                    Lampa.Filter.add('torrents', filter);
                    registered = true;
                    console.log('TorBox: Registered with Lampa.Filter.add');
                } else if (typeof Lampa.Source?.add === 'function') {
                    Lampa.Source.add('torbox', filter); // Some versions require a name here
                    registered = true;
                    console.log('TorBox: Registered with Lampa.Source.add');
                } else if (typeof Lampa.Sources?.add === 'function') {
                    Lampa.Sources.add(filter);
                    registered = true;
                    console.log('TorBox: Registered with Lampa.Sources.add');
                }
            } catch(e) {
                console.error("TorBox Plugin: Registration error", e);
            }
    
            if (!registered) {
                console.error('TorBox Plugin: Could not find a valid method to register the source (Lampa.Filter.add, Lampa.Source.add, Lampa.Sources.add are all missing).');
                Lampa.Noty.show('TorBox: Incompatible Lampa version.', { type: 'error' });
            }
            // --- End of registration block ---

            // Inject the settings panel
            this.addSettingsPanel();
        }

        async apiCall(endpointKey, params = {}, method = 'GET', path_param = '') {
            this.loadSettings();
            if (!this.settings.api_key || !this.settings.proxy_url) {
                return Promise.reject('TorBox API Key and Proxy URL must be set.');
            }
            
            const real_api_host = 'https://api.torbox.app/v1/api';
            const search_api_host = 'https://search-api.torbox.app';
            
            const isSearch = ['SEARCH'].includes(endpointKey);
            const base_url = isSearch ? search_api_host : real_api_host;

            const final_url = this.settings.proxy_url + base_url.replace(/^https?:\/\//, '') + EP[endpointKey] + path_param;

            const options = {
                headers: { 'x-api-key': this.settings.api_key },
                timeout: 20000,
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
             
            // Using Lampa's built-in network wrapper
            return new Promise((resolve, reject) => {
                 Lampa.Network.native(final_url, resolve, reject, options);
            }).then(JSON.parse).then(data => {
                if (data.success === false) {
                    throw new Error(data.error || data.detail || 'Unknown API error');
                }
                return data;
            }).catch(err => {
                 console.error("TorBox API Call Failed:", err);
                 throw err;
            });
        }

        async start(movie, on_data) {
            const query = movie.imdb_id ? `imdb:${movie.imdb_id}` : `${movie.title} ${movie.year || ''}`.trim();
            const cached = SearchCache.get(query);
            if (cached) {
                on_data(cached);
                return;
            }

            try {
                const searchPath = encodeURIComponent(query);
                const response = await this.apiCall('SEARCH', { metadata: 1, check_cache: 1, check_owned: 1 }, 'GET', searchPath);

                if (response.data && response.data.torrents) {
                    const torrents = this.processResults(response.data.torrents);
                    SearchCache.set(query, torrents);
                    on_data(torrents);
                } else {
                    on_data([]);
                }
            } catch (error) {
                Lampa.Noty.show(error.toString(), { type: 'error' });
                on_data([]);
            }
        }
        
        async select(torrent_data, call_callback) {
            Lampa.Controller.loading(true);
            try {
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
                _torbox: {
                    id: torrent.id,
                    cached: !!torrent.cached,
                    owned: !!torrent.owned
                }
            }));
        }

        async playCachedTorrent(torrent_data, call_callback) {
            Lampa.Noty.show('Requesting files from cache...');
            const torrent_details = await this.apiCall('DETAILS', {}, 'GET', torrent_data._torbox.id);

            if (!torrent_details.data || !torrent_details.data.files || torrent_details.data.files.length === 0) {
                throw new Error('Failed to get file list or torrent is empty.');
            }

            const files = torrent_details.data.files
                .filter(f => /\.(mkv|mp4|avi|mov|wmv|flv)$/i.test(f.name))
                .map(file => ({
                    title: file.name,
                    size: file.size,
                    info: `${(file.size / (1024**3)).toFixed(2)} GB`,
                    _torbox_file_id: file.id
                })).sort((a, b) => b.size - a.size);

            if (files.length === 0) {
                throw new Error('No video files found in this torrent.');
            }

            if (files.length === 1) {
                await this.getStreamAndPlay(torrent_data._torbox.id, files[0]._torbox_file_id, call_callback);
            } else {
                Lampa.Select.show({
                    title: 'Select a file to play',
                    items: files,
                    onSelect: async (selected_file) => {
                        await this.getStreamAndPlay(torrent_data._torbox.id, selected_file._torbox_file_id, call_callback);
                    },
                    onBack: () => Lampa.Controller.toggle('content')
                });
            }
        }

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

        async getStreamAndPlay(torrent_id, file_id, call_callback) {
             Lampa.Controller.loading(true);
             Lampa.Noty.show('Requesting stream link...');
             try {
                const response = await this.apiCall('DOWNLOAD', { torrent_id, file_id });
                if (response.success && response.data) {
                    call_callback({ url: response.data });
                } else {
                    throw new Error('Failed to get stream link.');
                }
             } finally {
                Lampa.Controller.loading(false);
             }
        }

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
                addInput("Proxy URL", "Required. Base URL of TorBox API (e.g., https://api.torbox.app/v1/api)", S.PROXY);
                addCheckbox("Show cached only", S.CACHED_ONLY);
            };

            Lampa.Listener.follow("settings", ({ type, object }) => {
                if (type === "open") onOpen(object);
            });
            
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
