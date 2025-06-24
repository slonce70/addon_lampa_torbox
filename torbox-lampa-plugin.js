/**
 * TorBox ↔ Lampa integration plugin
 * Version 4.1.0 – Compatibility patch
 *
 * Changelog:
 *  - Added dual registration: Lampa.Parsers.add (new) and Lampa.Sources.add (old)
 *  - Safe guards against missing API objects
 *  - Fixed video file sorting (size property)
 *  - Non‑fatal warning instead of TypeError when registration API absent
 *  - Kept original network / UI logic unchanged
 *
 * Author: GOD MODE
 */
(function () {
    'use strict';

    /** ----------  GLOBAL GUARD  ---------- */
    const NS = 'torbox_lampa_plugin_v4_1';
    if (window[NS]) return;
    window[NS] = true;

    /** ----------  CONSTANTS & STORAGE KEYS  ---------- */
    const S = {
        API_KEY:     'torbox_api_key',
        PROXY_URL:   'torbox_proxy_url',
        CACHED_ONLY: 'torbox_show_cached_only',
    };

    /** ----------  CORE PARSER OBJECT  ---------- */
    const TorBoxParser = {
        /**
         * Unified TorBox API caller with proxy and error handling
         * @param {string} endpoint
         * @param {Object} params
         * @param {'GET'|'POST'} method
         * @param {Function} on_success
         * @param {Function} on_error
         */
        apiCall(endpoint, params = {}, method = 'GET', on_success, on_error) {
            const api_key  = Lampa.Storage.get(S.API_KEY, '');
            let   proxyUrl = Lampa.Storage.get(S.PROXY_URL, '');

            if (!api_key || !proxyUrl) {
                on_error('API Key and Proxy URL must be set in TorBox settings');
                return;
            }

            if (proxyUrl.endsWith('/')) proxyUrl = proxyUrl.slice(0, -1);

            const HOST = {
                search: 'search-api.torbox.app',
                api:    'api.torbox.app/v1/api'
            };

            /* pick host by endpoint */
            const host    = endpoint.startsWith('/torrents/search') ? HOST.search : HOST.api;
            let   url     = `${proxyUrl}/${host}${endpoint}`;
            const options = {
                headers : { 'x-api-key': api_key },
                timeout : 20_000
            };

            if (method.toUpperCase() === 'POST') {
                options.method = 'POST';
                options.body   = params;
            } else if (Object.keys(params).length) {
                url += '?' + new URLSearchParams(params).toString();
            }

            Lampa.Request.get(
                url,
                (data) => {
                    try {
                        const json = JSON.parse(data);
                        if (json.success === false) {
                            on_error(json.error || json.detail || 'API Error');
                        } else {
                            on_success(json);
                        }
                    } catch (e) {
                        on_error('Failed to parse API response');
                    }
                },
                (err) => on_error(typeof err === 'object'
                                  ? 'Network Error or Invalid Proxy'
                                  : String(err)),
                false,
                options
            );
        },

        /**
         * Entry point invoked by Lampa when searching torrents for a movie/series
         * @param {Object} movie
         * @param {Function} on_data
         */
        start(movie, on_data) {
            const query    = movie.imdb_id
                           ? `imdb:${movie.imdb_id}`
                           : `${movie.title} ${movie.year || ''}`.trim();
            const endpoint = `/torrents/search/${encodeURIComponent(query)}`;

            this.apiCall(
                endpoint,
                { metadata: 1, check_cache: 1, check_owned: 1 },
                'GET',
                (json) => {
                    const torrents = (json.data?.torrents) ? this.processResults(json.data.torrents) : [];
                    on_data(torrents);
                },
                (err) => {
                    Lampa.Noty.show(err, { type: 'error' });
                    on_data([]);
                }
            );
        },

        /**
         * Convert raw TorBox torrent objects → Lampa items
         * @param {Array<Object>} torrents
         * @return {Array<Object>}
         */
        processResults(torrents) {
            const showCachedOnly = Lampa.Storage.get(S.CACHED_ONLY, false);

            return torrents
                .filter(t => showCachedOnly ? t.cached : true)
                .map(t => ({
                    title  : t.raw_title || t.name,
                    info   : `${(t.cached || t.owned ? '⚡ ' : '')}${(t.size / 2 ** 30).toFixed(2)} GB • S:${t.seeders ?? '?'}`,
                    quality: t.resolution || t.quality || '—',
                    _torbox: {
                        id    : t.id,
                        magnet: t.magnet,
                        cached: !!t.cached,
                        owned : !!t.owned
                    }
                }));
        },

        /**
         * Called when user selects a torrent from the list
         * @param {Object} torrent
         * @param {Function} call_callback
         */
        select(torrent, call_callback) {
            Lampa.Controller.loading(true);

            if (torrent._torbox.cached || torrent._torbox.owned) {
                this.playCached(torrent, call_callback);
            } else {
                this.addForDownload(torrent);
            }
        },

        /** -------- Cached / Owned flow -------- */
        playCached(torrent, call_callback) {
            const ep = `/torrents/mylist?id=${torrent._torbox.id}`;

            this.apiCall(
                ep,
                {},
                'GET',
                (json) => {
                    Lampa.Controller.loading(false);

                    const videoFiles = (json.data?.files || [])
                        .filter(f => /\.(mkv|mp4|avi|mov|wmv|flv)$/i.test(f.name))
                        .map(f => ({
                            title             : f.name,
                            info              : `${(f.size / 2 ** 30).toFixed(2)} GB`,
                            size              : f.size, /* needed for sorting */
                            _torbox_file_id   : f.id
                        }))
                        .sort((a, b) => b.size - a.size);

                    if (!videoFiles.length) {
                        Lampa.Noty.show('No video files found in this torrent.', { type: 'error' });
                        return;
                    }

                    const play = (fileId) => {
                        Lampa.Controller.loading(true);
                        const dl_ep = `/torrents/requestdl?torrent_id=${torrent._torbox.id}&file_id=${fileId}`;

                        this.apiCall(
                            dl_ep,
                            {},
                            'GET',
                            (linkJson) => {
                                Lampa.Controller.loading(false);
                                if (linkJson.data) {
                                    call_callback({ url: linkJson.data });
                                } else {
                                    Lampa.Noty.show('Failed to get stream link.', { type: 'error' });
                                }
                            },
                            (err) => {
                                Lampa.Controller.loading(false);
                                Lampa.Noty.show(err, { type: 'error' });
                            }
                        );
                    };

                    if (videoFiles.length === 1) {
                        play(videoFiles[0]._torbox_file_id);
                    } else {
                        Lampa.Select.show({
                            title  : 'Select a file',
                            items  : videoFiles,
                            onSelect: (sel) => play(sel._torbox_file_id),
                            onBack : () => Lampa.Controller.toggle('content')
                        });
                    }
                },
                (err) => {
                    Lampa.Controller.loading(false);
                    Lampa.Noty.show(err, { type: 'error' });
                }
            );
        },

        /** -------- Download-and-stream flow -------- */
        addForDownload(torrent) {
            const ep = '/torrents/createtorrent';

            this.apiCall(
                ep,
                { magnet: torrent._torbox.magnet },
                'POST',
                () => {
                    Lampa.Controller.loading(false);
                    Lampa.Noty.show('Torrent added successfully!', { type: 'success' });
                    Lampa.Controller.toggle('content');
                },
                (err) => {
                    Lampa.Controller.loading(false);
                    Lampa.Noty.show(err, { type: 'error' });
                }
            );
        },

        /* required by Lampa but not used in our case */
        back() {
            Lampa.Controller.toggle('content');
        }
    };

    /** ----------  REGISTRATION WRAPPER  ---------- */
    function registerParser() {
        /* Modern builds (≥ 3.2) */
        if (typeof Lampa?.Parsers?.add === 'function') {
            Lampa.Parsers.add('torrents', {
                handler: TorBoxParser,
                name   : 'TorBox',
                icon   : 'fa-cloud-bolt'
            });
            return true;
        }

        /* Legacy builds (≈ 2020‑2022 forks / Android TV) */
        if (typeof Lampa?.Sources?.add === 'function') {
            Lampa.Sources.add({
                name  : 'TorBox',
                type  : 'torrents',
                active: true,
                object: TorBoxParser
            });
            return true;
        }

        console.warn('[TorBox] Unable to register: no compatible parser API found');
        return false;
    }

    /** ----------  SETTINGS PANEL  ---------- */
    function injectSettings() {
        Lampa.Settings.add({
            name : 'torbox_settings',
            title: 'TorBox',
            icon : 'fa-cloud-bolt'
        });

        Lampa.Listener.follow('settings', (e) => {
            if (e.type !== 'open' || e.name !== 'torbox_settings') return;

            e.body.empty();

            /** Helpers */
            const addInput = (label, key, placeholder = '') => {
                const current = Lampa.Storage.get(key, '');
                const $item = $(`<div class="settings-param selector">
                    <div class="settings-param__name">${label}</div>
                    <div class="settings-param__value">${current}</div>
                    <div class="settings-param__descr">${placeholder}</div>
                </div>`);

                $item.on('hover:enter', () => {
                    Lampa.Settings.pget($item, key, (val) => {
                        Lampa.Storage.set(key, val.trim());
                        $item.find('.settings-param__value').text(val.trim() || '—');
                    }, current);
                });
                e.body.append($item);
            };

            const addCheckbox = (label, key) => {
                const val = Lampa.Storage.get(key, false);

                const $item = $(`<div class="settings-param-checkbox selector">
                    <div class="settings-param-checkbox__body">
                        <div class="settings-param-checkbox__name">${label}</div>
                        <div class="settings-param-checkbox__value"></div>
                    </div>
                </div>`);

                const check = Lampa.Utils.check($item.find('.settings-param-checkbox__value'), val);
                check.on('change', (_, isChecked) => Lampa.Storage.set(key, isChecked));
                e.body.append($item);
            };

            /** Build panel */
            e.body.append('<div class="settings-param__title">TorBox</div>');
            addInput('API Key', S.API_KEY, 'Your key from torbox.app');
            addInput('Proxy URL', S.PROXY_URL, 'e.g., https://proxy.cors.sh');
            addCheckbox('Show cached only', S.CACHED_ONLY);

            Lampa.Scroll.update(e.body);
        });
    }

    /** ----------  INITIALIZATION  ---------- */
    function init() {
        if (!registerParser()) {
            Lampa.Noty.show('TorBox: your Lampa build does not support custom torrent parsers.', { type: 'error' });
            return;
        }

        injectSettings();
        console.log('%cTorBox Plugin v4.1.0 – Loaded', 'color:#0f0');
    }

    /* Wait for Lampa app bootstrap */
    if (window.appready) {
        init();
    } else {
        Lampa.Listener.follow('app', (e) => e.type === 'ready' && init());
    }
})();
