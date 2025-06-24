(function () {
    'use strict';

    /**
     * TorBox ↔ Lampa integration plugin
     * @version 2.2.0 - Direct source injection method
     * @author GOD MODE
     *
     * This version uses a more robust method for adding the source,
     * inspired by other working plugins for various Lampa builds.
     */

    const PLUGIN_NS = "torbox_lampa_plugin_v2_2_ready";
    if (window[PLUGIN_NS]) return;
    window[PLUGIN_NS] = true;

    // --- Settings Keys and API Endpoints ---
    const S = {
        API_KEY: "torbox_api_key",
        PROXY_URL: "torbox_proxy_url",
        CACHED_ONLY: "torbox_show_cached_only",
    };

    const EP = {
        SEARCH: "/torrents/search/",
        ADD: "/torrents/createtorrent",
        DETAILS: "/torrents/mylist?id=",
        DOWNLOAD: "/torrents/requestdl"
    };

    // --- 24h Search Cache ---
    const SearchCache = (() => {
        const TTL = 86400; // 24 hours
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

    // --- Main Parser Object ---
    const TorBoxParser = {
        settings: {},

        /**
         * Load settings from Lampa Storage
         */
        loadSettings: function() {
            this.settings.api_key = Lampa.Storage.get(S.API_KEY, '');
            let proxy = Lampa.Storage.get(S.PROXY_URL, '');
            this.settings.proxy_url = proxy.endsWith('/') ? proxy.slice(0, -1) : proxy;
        },

        /**
         * Centralized API call handler
         */
        apiCall: async function(endpointKey, params = {}, method = 'GET', path_param = '') {
            this.loadSettings();
            if (!this.settings.api_key || !this.settings.proxy_url) {
                return Promise.reject('TorBox API Key and Proxy URL must be set.');
            }
            
            // Determine the correct API host
            const real_api_host = 'api.torbox.app/v1/api';
            const search_api_host = 'search-api.torbox.app';
            const base_host = endpointKey === 'SEARCH' ? search_api_host : real_api_host;
            
            const final_url = `${this.settings.proxy_url}/${base_host}${EP[endpointKey]}${path_param}`;

            const options = {
                method: method.toUpperCase(),
                headers: { 'X-API-Key': this.settings.api_key },
                timeout: 20000,
            };
            
            if (options.method === 'POST') {
                options.body = JSON.stringify(params);
                options.headers['Content-Type'] = 'application/json';
            } else { // GET
                const urlObj = new URL(final_url);
                Object.keys(params).forEach(key => urlObj.searchParams.append(key, params[key]));
            }

            return new Promise((resolve, reject) => {
                Lampa.Network.native(final_url, (data) => {
                    const json = JSON.parse(data);
                     if (json.success === false) {
                        return reject(json.error || json.detail || 'Unknown API error');
                    }
                    resolve(json);
                }, reject, options);
            });
        },

        /**
         * Lampa entry point for searching
         */
        start: async function(movie, on_data) {
            const query = movie.imdb_id ? `imdb:${movie.imdb_id}` : `${movie.title} ${movie.year || ''}`.trim();
            
            const cached = SearchCache.get(query);
            if (cached) return on_data(cached);

            try {
                const response = await this.apiCall('SEARCH', { metadata: 1, check_cache: 1, check_owned: 1 }, 'GET', encodeURIComponent(query));
                const torrents = response.data && response.data.torrents ? this.processResults(response.data.torrents) : [];
                SearchCache.set(query, torrents);
                on_data(torrents);
            } catch (error) {
                Lampa.Noty.show(error.toString(), { type: 'error' });
                on_data([]);
            }
        },

        /**
         * Process search results into Lampa format
         */
        processResults: function(torrents) {
            let filtered = Lampa.Storage.get(S.CACHED_ONLY, false) ? torrents.filter(t => t.cached) : torrents;
            return filtered.map(t => ({
                title: t.raw_title || t.name,
                info: `${t.cached || t.owned ? '⚡ ' : ''}${(t.size / 2**30).toFixed(2)} GB • S:${t.seeders ?? '?'}`,
                quality: t.resolution || t.quality || "—",
                size: t.size,
                magnet: t.magnet,
                _torbox: { id: t.id, cached: !!t.cached, owned: !!t.owned }
            }));
        },

        /**
         * Lampa entry point for handling a selection
         */
        select: async function(torrent, call_callback) {
            Lampa.Controller.loading(true);
            try {
                if (torrent._torbox.cached || torrent._torbox.owned) {
                    await this.playCached(torrent, call_callback);
                } else {
                    await this.addForDownload(torrent);
                }
            } catch (error) {
                Lampa.Noty.show(error.toString(), { type: 'error' });
            } finally {
                Lampa.Controller.loading(false);
            }
        },

        /**
         * Play a cached torrent
         */
        playCached: async function(torrent, call_callback) {
            Lampa.Noty.show('Requesting files from cache...');
            const details = await this.apiCall('DETAILS', {}, 'GET', torrent._torbox.id);
            if (!details.data?.files?.length) throw new Error('No files found in this torrent.');

            const videoFiles = details.data.files
                .filter(f => /\.(mkv|mp4|avi|mov|wmv|flv)$/i.test(f.name))
                .map(f => ({
                    title: f.name,
                    size: f.size,
                    info: `${(f.size / (1024**3)).toFixed(2)} GB`,
                    _torbox_file_id: f.id
                })).sort((a, b) => b.size - a.size);

            if (!videoFiles.length) throw new Error('No video files found.');

            const playFile = async (fileId) => {
                Lampa.Noty.show('Requesting stream link...');
                const linkData = await this.apiCall('DOWNLOAD', { torrent_id: torrent._torbox.id, file_id: fileId });
                if (linkData.data) {
                    call_callback({ url: linkData.data });
                } else {
                    throw new Error('Failed to get stream link.');
                }
            };
            
            if (videoFiles.length === 1) {
                await playFile(videoFiles[0]._torbox_file_id);
            } else {
                Lampa.Select.show({
                    title: 'Select a file to play',
                    items: videoFiles,
                    onSelect: (selected) => playFile(selected._torbox_file_id),
                    onBack: () => Lampa.Controller.toggle('content')
                });
            }
        },

        /**
         * Add a non-cached torrent for download
         */
        addForDownload: async function(torrent) {
            Lampa.Noty.show('Adding to TorBox downloads...');
            await this.apiCall('ADD', { magnet: torrent.magnet }, 'POST');
            Lampa.Noty.show('Torrent added successfully!', { type: 'success' });
            Lampa.Controller.toggle('content');
        },

        back: function() {
            Lampa.Controller.toggle('content');
        }
    };

    // --- Plugin Initialization ---
    function startPlugin() {
        window.plugin_torbox_ready = true;
        
        // 1. Register the main parser logic as a Lampa component
        Lampa.Component.add('torbox_parser', TorBoxParser);

        // 2. Define our source/filter object
        const torbox_filter = {
            title: 'TorBox',
            name: 'torbox_parser',
            wait: true
        };

        // 3. Inject the source into Lampa
        // This is the robust method inspired by online_mod.js
        try {
            let torrents_component = Lampa.Component.get('torrents');
            if (torrents_component && torrents_component.sources) {
                torrents_component.sources.push(torbox_filter);
                console.log('TorBox: Injected directly into torrents component sources.');
            } else if (typeof Lampa.Source?.add === 'function') {
                Lampa.Source.add('torbox', torbox_filter);
                 console.log('TorBox: Registered with Lampa.Source.add');
            } else {
                throw new Error("No known method to inject source.");
            }
        } catch (e) {
            console.error("TorBox Plugin: Failed to inject source.", e);
            Lampa.Noty.show("TorBox: Failed to initialize source.", { type: 'error' });
        }

        // 4. Add the settings panel
        const settings_card = {
            title: 'TorBox',
            name: 'torbox_settings',
            render: () => {
                const body = $(`<div class="settings-body"></div>`);
                body.append(`<div class="settings-param__title">TorBox</div>`);
                
                const addInput = (label, key, placeholder) => {
                    const val = Lampa.Storage.get(key, "");
                    const item = $(`<div class="settings-param selector" data-name="${key}">
                        <div class="settings-param__name">${label}</div>
                        <div class="settings-param__value">${val}</div>
                    </div>`);
                    item.on('hover:enter', () => {
                        Lampa.Settings.pget(item, key, (newVal) => {
                            Lampa.Storage.set(key, newVal.trim());
                        }, val, placeholder);
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
                     check.on('change', (e, isChecked) => Lampa.Storage.set(key, isChecked));
                     body.append(item);
                };

                addInput("API Key", S.API_KEY, "Your key from torbox.app");
                addInput("Proxy URL", S.PROXY_URL, "e.g., https://proxy.cors.sh");
                addCheckbox("Show cached only", S.CACHED_ONLY);
                
                return body;
            }
        };

        Lampa.Settings.main().add(settings_card);
    }

    // --- Lampa Lifecycle Hook ---
    if (window.appready) {
        startPlugin();
    } else {
        Lampa.Listener.follow("app", (e) => {
            if (e.type === "ready") startPlugin();
        });
    }

})();
