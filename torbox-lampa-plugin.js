(function () {
    'use strict';

    /**
     * TorBox ↔ Lampa integration plugin
     * @version 4.0.0 - Final. Uses Lampa.Parsers.add for registration.
     * @author GOD MODE
     *
     * Changelog:
     * - Switched to Lampa.Parsers.add for source registration. This is the correct,
     * robust method for adding torrent sources in many Lampa builds.
     * - Kept the reliable Lampa.Request.get for network calls.
     * - Kept the manual settings panel injection for compatibility.
     */

    const PLUGIN_NS = "torbox_lampa_plugin_v4_0_ready";
    if (window[PLUGIN_NS]) return;
    window[PLUGIN_NS] = true;

    // --- Settings Keys ---
    const S = {
        API_KEY: "torbox_api_key",
        PROXY_URL: "torbox_proxy_url",
        CACHED_ONLY: "torbox_show_cached_only",
    };

    // --- Main Parser Object ---
    const TorBoxParser = {
        
        apiCall: function(endpoint, params, method, on_success, on_error) {
            const api_key = Lampa.Storage.get(S.API_KEY, '');
            let proxy_url = Lampa.Storage.get(S.PROXY_URL, '');

            if (!api_key || !proxy_url) return on_error("API Key and Proxy URL must be set.");
            
            if (proxy_url.endsWith('/')) proxy_url = proxy_url.slice(0, -1);

            const hosts = {
                search: 'search-api.torbox.app',
                api: 'api.torbox.app/v1/api'
            };
            
            const target_host = endpoint.startsWith('/torrents/search') ? hosts.search : hosts.api;
            let final_url = `${proxy_url}/${target_host}${endpoint}`;

            const options = {
                headers: { 'x-api-key': api_key },
                timeout: 20000,
            };

            if (method.toUpperCase() === 'POST') {
                options.method = 'POST';
                options.body = params;
            } else {
                 if (Object.keys(params).length > 0) {
                    final_url += '?' + new URLSearchParams(params).toString();
                }
            }
            
            Lampa.Request.get(final_url, (data) => {
                try {
                    const json = JSON.parse(data);
                    if (json.success === false) return on_error(json.error || json.detail || 'API Error');
                    on_success(json);
                } catch (e) { on_error("Failed to parse API response"); }
            }, (err) => {
                 on_error(typeof err === 'object' ? 'Network Error or Invalid Proxy' : err);
            }, false, options);
        },

        start: function(movie, on_data) {
            const query = movie.imdb_id ? `imdb:${movie.imdb_id}` : `${movie.title} ${movie.year || ''}`.trim();
            const endpoint = `/torrents/search/${encodeURIComponent(query)}`;
            
            this.apiCall(endpoint, { metadata: 1, check_cache: 1, check_owned: 1 }, 'GET', (json) => {
                const torrents = json.data && json.data.torrents ? this.processResults(json.data.torrents) : [];
                on_data(torrents);
            }, (error_text) => {
                Lampa.Noty.show(error_text, { type: 'error' });
                on_data([]);
            });
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

        select: function(torrent, call_callback) {
            Lampa.Controller.loading(true);
            if (torrent._torbox.cached || torrent._torbox.owned) {
                this.playCached(torrent, call_callback);
            } else {
                this.addForDownload(torrent);
            }
        },
        
        playCached: function(torrent, call_callback) {
            const endpoint = `/torrents/mylist?id=${torrent._torbox.id}`;
            this.apiCall(endpoint, {}, 'GET', (json) => {
                Lampa.Controller.loading(false);
                if (!json.data?.files?.length) return Lampa.Noty.show('No files found in torrent.', {type: 'error'});

                const videoFiles = json.data.files
                    .filter(f => /\.(mkv|mp4|avi|mov|wmv|flv)$/i.test(f.name))
                    .map(f => ({
                        title: f.name,
                        info: `${(f.size / (1024**3)).toFixed(2)} GB`,
                        _torbox_file_id: f.id
                    })).sort((a, b) => b.size - a.size);

                if (!videoFiles.length) return Lampa.Noty.show('No video files found.', {type: 'error'});

                const playFile = (fileId) => {
                    Lampa.Controller.loading(true);
                    const dl_endpoint = `/torrents/requestdl?torrent_id=${torrent._torbox.id}&file_id=${fileId}`;
                    this.apiCall(dl_endpoint, {}, 'GET', (linkJson) => {
                        Lampa.Controller.loading(false);
                        if (linkJson.data) call_callback({ url: linkJson.data });
                        else Lampa.Noty.show('Failed to get stream link.', {type: 'error'});
                    }, (err) => {
                        Lampa.Controller.loading(false);
                        Lampa.Noty.show(err, { type: 'error' });
                    });
                };
                
                if (videoFiles.length === 1) playFile(videoFiles[0]._torbox_file_id);
                else Lampa.Select.show({
                    title: 'Select a file',
                    items: videoFiles,
                    onSelect: (selected) => playFile(selected._torbox_file_id),
                    onBack: () => Lampa.Controller.toggle('content')
                });

            }, (err) => {
                Lampa.Controller.loading(false);
                Lampa.Noty.show(err, { type: 'error' });
            });
        },

        addForDownload: function(torrent) {
            const endpoint = `/torrents/createtorrent`;
            this.apiCall(endpoint, { magnet: torrent._torbox.magnet }, 'POST', (json) => {
                Lampa.Controller.loading(false);
                Lampa.Noty.show('Torrent added successfully!', { type: 'success' });
                Lampa.Controller.toggle('content');
            }, (err) => {
                Lampa.Controller.loading(false);
                Lampa.Noty.show(err, { type: 'error' });
            });
        },

        back: function() { Lampa.Controller.toggle('content'); }
    };

    // --- Plugin Initialization ---
    function startPlugin() {
        if (window.plugin_torbox_ready_v4) return;
        window.plugin_torbox_ready_v4 = true;
        
        // 1. THE DEFINITIVE FIX: Register the object as a parser for the 'torrents' type.
        Lampa.Parsers.add('torrents', {
            handler: TorBoxParser,
            name: 'TorBox',
            icon: 'fa-cloud-bolt'
        });

        // 2. Add the settings panel using the legacy method.
        Lampa.Settings.add({
            'name': 'torbox_settings',
            'title': 'TorBox',
            'icon': 'fa-cloud-bolt'
        });
        
        Lampa.Listener.follow('settings', (e) => {
            if (e.type === 'open' && e.name === 'torbox_settings') {
                e.body.empty();

                const addInput = (label, key, placeholder = '') => {
                    const current_val = Lampa.Storage.get(key, "");
                    const item = $(`<div class="settings-param selector">
                        <div class="settings-param__name">${label}</div>
                        <div class="settings-param__value">${current_val}</div>
                        <div class="settings-param__descr">${placeholder}</div>
                    </div>`);
                    item.on('hover:enter', () => {
                        Lampa.Settings.pget(item, key, (newVal) => {
                            Lampa.Storage.set(key, newVal.trim());
                        }, current_val);
                    });
                    e.body.append(item);
                };
                
                const addCheckbox = (label, key) => {
                     const val = Lampa.Storage.get(key, false);
                     const item = $(`<div class="settings-param-checkbox selector">
                        <div class="settings-param-checkbox__body">
                            <div class="settings-param-checkbox__name">${label}</div>
                            <div class="settings-param-checkbox__value"></div>
                        </div>
                     </div>`);
                     const check = Lampa.Utils.check(item.find('.settings-param-checkbox__value'), val);
                     check.on('change', (e, isChecked) => Lampa.Storage.set(key, isChecked));
                     e.body.append(item);
                };

                e.body.append('<div class="settings-param__title">TorBox</div>');
                addInput("API Key", S.API_KEY, "Your key from torbox.app");
                addInput("Proxy URL", S.PROXY_URL, "e.g., https://proxy.cors.sh");
                addCheckbox("Show cached only", S.CACHED_ONLY);
                
                Lampa.Scroll.update(e.body);
            }
        });
        
        console.log("TorBox Plugin v4.0.0 Initialized");
    }

    if (window.appready) startPlugin();
    else Lampa.Listener.follow("app", (e) => (e.type === "ready") && startPlugin());

})();
