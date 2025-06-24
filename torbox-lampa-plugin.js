(function () {
    'use strict';

    /**
     * TorBox ↔ Lampa integration plugin
     * @version 2.3.0 - Simplified Proxy & Standard Fetch
     * @author GOD MODE
     *
     * Changelog:
     * - Replaced Lampa.Network.native with standard window.fetch for max compatibility.
     * - Simplified Proxy URL setting: User now only needs to enter the proxy address.
     * The plugin handles the rest, preventing CORS configuration errors.
     */

    const PLUGIN_NS = "torbox_lampa_plugin_v2_3_ready";
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

    // --- Main Parser Object ---
    const TorBoxParser = {
        settings: {},

        loadSettings: function() {
            this.settings.api_key = Lampa.Storage.get(S.API_KEY, '');
            let proxy = Lampa.Storage.get(S.PROXY_URL, '');
            this.settings.proxy_url = proxy.endsWith('/') ? proxy.slice(0, -1) : proxy;
        },

        apiCall: async function(endpointKey, params = {}, method = 'GET', path_param = '') {
            this.loadSettings();
            if (!this.settings.api_key || !this.settings.proxy_url) {
                return Promise.reject('TorBox API Key and Proxy URL must be set in settings.');
            }

            const torbox_search_host = 'search-api.torbox.app';
            const torbox_api_host = 'api.torbox.app/v1/api';
            const target_host = endpointKey === 'SEARCH' ? torbox_search_host : torbox_api_host;

            let final_url = `${this.settings.proxy_url}/${target_host}${EP[endpointKey]}${path_param}`;

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
                Object.entries(params).forEach(([key, value]) => {
                    urlObj.searchParams.append(key, value);
                });
                final_url = urlObj.toString();
            }

            try {
                const response = await fetch(final_url, options);
                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`API Error: ${response.status} - ${errorText}`);
                }
                const data = await response.json();
                if (data.success === false) {
                    throw new Error(data.error || data.detail || 'Unknown API error');
                }
                return data;
            } catch (error) {
                console.error("TorBox API Call Failed:", error);
                throw new Error(`Network error or invalid proxy response: ${error.message}`);
            }
        },

        start: async function(movie, on_data) {
            const query = movie.imdb_id ? `imdb:${movie.imdb_id}` : `${movie.title} ${movie.year || ''}`.trim();

            try {
                const response = await this.apiCall('SEARCH', { metadata: 1, check_cache: 1, check_owned: 1 }, 'GET', encodeURIComponent(query));
                const torrents = response.data && response.data.torrents ? this.processResults(response.data.torrents) : [];
                on_data(torrents);
            } catch (error) {
                Lampa.Noty.show(error.toString(), { type: 'error' });
                on_data([]);
            }
        },

        processResults: function(torrents) {
            let filtered = Lampa.Storage.get(S.CACHED_ONLY, false) ? torrents.filter(t => t.cached) : torrents;
            return filtered.map(t => ({
                title: t.raw_title || t.name,
                info: `${t.cached || t.owned ? '⚡ ' : ''}${(t.size / 2**30).toFixed(2)} GB • S:${t.seeders ?? '?'}`,
                quality: t.resolution || t.quality || "—",
                _torbox: { id: t.id, magnet: t.magnet, cached: !!t.cached, owned: !!t.owned }
            }));
        },

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
        
        playCached: async function(torrent, call_callback) {
            Lampa.Noty.show('Requesting files from cache...');
            const details = await this.apiCall('DETAILS', {}, 'GET', torrent._torbox.id);
            if (!details.data?.files?.length) throw new Error('No files found in this torrent.');

            const videoFiles = details.data.files
                .filter(f => /\.(mkv|mp4|avi|mov|wmv|flv)$/i.test(f.name))
                .map(f => ({
                    title: f.name,
                    info: `${(f.size / (1024**3)).toFixed(2)} GB`,
                    _torbox_file_id: f.id
                })).sort((a, b) => b.size - a.size);

            if (!videoFiles.length) throw new Error('No video files found.');

            const playFile = async (fileId) => {
                Lampa.Noty.show('Requesting stream link...');
                const linkData = await this.apiCall('DOWNLOAD', { torrent_id: torrent._torbox.id, file_id: fileId }, 'GET');
                if (linkData.data) call_callback({ url: linkData.data });
                else throw new Error('Failed to get stream link.');
            };
            
            if (videoFiles.length === 1) await playFile(videoFiles[0]._torbox_file_id);
            else Lampa.Select.show({
                title: 'Select a file to play',
                items: videoFiles,
                onSelect: (selected) => playFile(selected._torbox_file_id),
                onBack: () => Lampa.Controller.toggle('content')
            });
        },

        addForDownload: async function(torrent) {
            Lampa.Noty.show('Adding to TorBox downloads...');
            await this.apiCall('ADD', { magnet: torrent._torbox.magnet }, 'POST');
            Lampa.Noty.show('Torrent added successfully!', { type: 'success' });
            Lampa.Controller.toggle('content');
        },

        back: function() { Lampa.Controller.toggle('content'); }
    };

    // --- Plugin Initialization ---
    function startPlugin() {
        if(window.plugin_torbox_ready) return;
        window.plugin_torbox_ready = true;
        
        Lampa.Component.add('torbox_parser', TorBoxParser);

        const torbox_filter = { title: 'TorBox', name: 'torbox_parser', wait: true };

        let torrents_component = Lampa.Component.get('torrents');
        if (torrents_component && Array.isArray(torrents_component.sources)) {
            torrents_component.sources.push(torbox_filter);
            console.log('TorBox: Injected directly into torrents component sources.');
        } else {
            console.error("TorBox Plugin: Failed to inject source into torrents component.");
            Lampa.Noty.show("TorBox: Failed to initialize source.", { type: 'error' });
        }

        // --- Settings Panel ---
        const settings_card = {
            title: 'TorBox',
            name: 'torbox_settings',
            render: () => {
                const body = $(`<div></div>`);
                const addInput = (label, key, placeholder) => {
                    const current_val = Lampa.Storage.get(key, "");
                    const item = $(`<div class="settings-param selector">
                        <div class="settings-param__name">${label}</div>
                        <div class="settings-param__value">${current_val}</div>
                    </div>`);
                    item.on('hover:enter', () => {
                        Lampa.Settings.pget(item, key, (newVal) => Lampa.Storage.set(key, newVal.trim()), current_val, placeholder);
                    });
                    body.append(item);
                };
                addInput("API Key", S.API_KEY, "Your key from torbox.app");
                addInput("Proxy URL", S.PROXY_URL, "e.g., https://proxy.cors.sh");
                return body;
            }
        };

        if(Lampa.Settings.main) Lampa.Settings.main().add(settings_card);
    }

    if (window.appready) startPlugin();
    else Lampa.Listener.follow("app", (e) => (e.type === "ready") && startPlugin());

})();
