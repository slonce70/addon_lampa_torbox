/**
 * TorBox <-> Lampa Integration Plugin
 * Version: 21.0.0 (HACKER MODE - MANUAL TOGGLE FIX)
 * Author: Gemini AI & Your Name
 *
 * CHANGE LOG v21.0.0:
 * - CRITICAL FIX: Resolved "Uncaught TypeError: Lampa.Settings.switch is not a function".
 * - REWORKED: The debug mode toggle is no longer created using the non-existent 'Lampa.Settings.switch' helper.
 * - IMPLEMENTED: A fully manual checkbox handler has been implemented for the debug toggle, making its logic consistent with the other settings controls. This ensures stability across different Lampa versions.
 */
(function () {
    'use strict';

    const PLUGIN_ID = 'torbox_plugin_hacker_mode_v21';
    if (window[PLUGIN_ID]) {
        console.log(`[${PLUGIN_ID}] -> Plugin already initialized. Aborting.`);
        return;
    }
    window[PLUGIN_ID] = true;

    // --- Configuration and Helpers ---

    function logger(...args) {
        if (localStorage.getItem('torbox_debug') === 'true') {
            console.log(`[TorBox]`, ...args);
        }
    }

    /**
     * Creates and injects the settings block directly into the main settings page.
     * This method is based on a working example and avoids Lampa's component navigation system.
     */
    function buildSettings() {
        // Prevent duplicate injection
        if ($('.settings-torbox-custom-folder').length) return;

        const folder = $(
            `<div class="settings-folder settings-torbox-custom-folder">
                <div class="settings-folder__title">TorBox</div>
                <div class="settings-folder__body"></div>
            </div>`
        );

        const body = folder.find('.settings-folder__body');

        // 1. API Key Input
        const apiKeyRow = $(`<div class="settings-param selector">
            <div class="settings-param__name">API Ключ</div>
            <div class="settings-param__value">${localStorage.getItem('torbox_api_key') || 'Не указан'}</div>
        </div>`);
        apiKeyRow.on('hover:enter', () => {
            Lampa.Input.edit({
                title: 'API Ключ TorBox',
                value: localStorage.getItem('torbox_api_key') || '',
                free: true,
                nosave: true
            }, (newVal) => {
                const trimmed = (newVal || '').trim();
                localStorage.setItem('torbox_api_key', trimmed);
                apiKeyRow.find('.settings-param__value').text(trimmed || 'Не указан');
                Lampa.Controller.toggle('settings'); // Return focus to settings
            });
        });
        body.append(apiKeyRow);

        // 2. Check Key Button
        const checkBtnRow = $(`<div class="settings-param selector">
            <div class="settings-param__name">Проверить ключ</div>
            <div class="settings-param__status"></div>
        </div>`);
        checkBtnRow.on('hover:enter', async () => {
            const status = checkBtnRow.find('.settings-param__status');
            const key = localStorage.getItem('torbox_api_key') || '';
            if (!key) return Lampa.Noty.show('Сначала введите API ключ', {type: 'warning'});
            
            status.removeClass('active error').addClass('wait');
            try {
                await TorBoxAPI._call_check(key, '/torrents/mylist', { limit: 1 });
                status.removeClass('wait error').addClass('active');
                Lampa.Noty.show('Ключ действителен', {type: 'success'});
            } catch (err) {
                status.removeClass('wait active').addClass('error');
                Lampa.Noty.show(err.message, {type: 'error'});
            }
        });
        body.append(checkBtnRow);
        
        // 3. Cached Only Select
        const cachedValues = { 'false': 'Нет', 'true': 'Да' };
        const cachedSelectRow = $(`<div class="settings-param selector">
            <div class="settings-param__name">Только кэшированные</div>
            <div class="settings-param__value">${cachedValues[localStorage.getItem('torbox_show_cached_only') || 'false']}</div>
        </div>`);
        cachedSelectRow.on('hover:enter', () => {
            const currentCached = localStorage.getItem('torbox_show_cached_only') || 'false';
            Lampa.Select.show({
                title: 'Показывать только кэшированные',
                items: Object.keys(cachedValues).map(key => ({ title: cachedValues[key], value: key })),
                current: Object.keys(cachedValues).findIndex(k => k === currentCached),
                onSelect: (item) => {
                    localStorage.setItem('torbox_show_cached_only', item.value);
                    cachedSelectRow.find('.settings-param__value').text(item.title);
                    Lampa.Controller.toggle('settings');
                },
                onBack: () => { Lampa.Controller.toggle('settings'); }
            });
        });
        body.append(cachedSelectRow);

        // 4. Debug Mode Toggle - MANUAL IMPLEMENTATION
        const debugToggleRow = $(`<div class="settings-param selector">
            <div class="settings-param__name">Debug-режим</div>
            <div class="settings-param__value"></div>
        </div>`);
        const debugCheckbox = $('<input type="checkbox" />');
        debugCheckbox.prop('checked', localStorage.getItem('torbox_debug') === 'true');
        debugCheckbox.on('change', function() {
            localStorage.setItem('torbox_debug', $(this).is(':checked'));
        });
        debugToggleRow.find('.settings-param__value').append(debugCheckbox);
        debugToggleRow.on('hover:enter', () => {
            debugCheckbox.prop('checked', !debugCheckbox.prop('checked')).trigger('change');
        });
        body.append(debugToggleRow);

        // Inject the entire block into the main settings list
        $('.settings-content > .settings-list').append(folder);
    }


    // --- API Wrapper & Helpers ---

    function parseQuality(name) {
        const lowerName = (name || '').toLowerCase();
        if (lowerName.includes('2160p') || lowerName.includes('4k')) return '✨ 4K UHD';
        if (lowerName.includes('1080p')) return '🔥 Full HD';
        if (lowerName.includes('720p')) return 'HD';
        if (lowerName.includes('480p')) return 'SD';
        return '';
    }

    const TorBoxAPI = {
        API_BASE: 'https://api.torbox.app/v1/api',
        API_SEARCH_BASE: 'https://search-api.torbox.app',

        _call: async function(endpoint, params = {}, method = 'GET', base = this.API_BASE) {
            const apiKey = localStorage.getItem('torbox_api_key') || '';
            return this._call_check(apiKey, endpoint, params, method, base);
        },
        
        _call_check: async function(apiKey, endpoint, params = {}, method = 'GET', base = this.API_BASE) {
            if (!apiKey) {
                return Promise.reject(new Error('API ключ TorBox не установлен'));
            }

            let url = `${base}${endpoint}`;
            const options = {
                method,
                headers: { 'Authorization': `Bearer ${apiKey}` }
            };

            if (method === 'GET' && Object.keys(params).length) {
                url += '?' + new URLSearchParams(params).toString();
            } else if (method === 'POST') {
                options.headers['Content-Type'] = 'application/json';
                options.body = JSON.stringify(params);
            }

            try {
                const response = await fetch(url, options);
                const data = await response.json();
                if (!response.ok) {
                    const errorMessage = data.error || data.message || `HTTP ${response.status}`;
                    throw new Error(errorMessage);
                }
                return data;
            } catch (networkError) {
                throw new Error(networkError.message || 'Сетевая ошибка');
            }
        },
        
        search: (movie) => TorBoxAPI._call(`/torrents/search/${encodeURIComponent(movie.imdb_id ? `imdb:${movie.imdb_id}` : movie.title)}`, { metadata: 'true', check_cache: 'true' }, 'GET', TorBoxAPI.API_SEARCH_BASE),
        addMagnet: (magnet) => TorBoxAPI._call('/torrents/createtorrent', { magnet }, 'POST'),
        getFiles: (torrentId) => TorBoxAPI._call('/torrents/mylist', { id: torrentId }).then(r => r.data?.[0]?.files || []),
        getDownloadLink: (torrentId, fileId) => TorBoxAPI._call('/torrents/requestdl', { torrent_id: torrentId, file_id: fileId }).then(r => r.data)
    };

    // --- Main Plugin Logic ---

    function startPlugin() {
        logger('Plugin started');
        buildSettings();

        Lampa.Listener.follow('full', (e) => {
            if (e.type !== 'complite' || e.object.activity.render().find('.view--torbox').length) return;
            const button = $(`<div class="full-start__button selector view--torbox" data-subtitle="TorBox">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
                <span>TorBox</span></div>`);
            button.on('hover:enter', () => searchAndShow(e.data.movie));
            e.object.activity.render().find('.view--torrent').after(button);
        });

        async function searchAndShow(movie) {
            Lampa.Loading.start('Поиск в TorBox...');
            try {
                const results = await TorBoxAPI.search(movie);
                const torrents = results.data?.torrents || [];
                if (!torrents.length) return Lampa.Noty.show('Ничего не найдено в TorBox');
                
                const cachedOnly = localStorage.getItem('torbox_show_cached_only') === 'true';
                const filtered = cachedOnly ? torrents.filter(t => t.cached) : torrents;
                
                if (!filtered.length) return Lampa.Noty.show('Нет кэшированных результатов', { type: 'info' });
                
                displayTorrents(filtered, movie);
            } catch (err) {
                Lampa.Noty.show(err.message, { type: 'error' });
            } finally {
                Lampa.Loading.stop();
            }
        }
        
        function displayTorrents(torrents, movie) {
            const items = torrents
                .sort((a,b) => (b.seeders || 0) - (a.seeders || 0))
                .map(t => ({
                    title: `${t.cached ? '⚡' : '☁️'} ${t.name || t.raw_title || 'Без названия'}`,
                    subtitle: [`💾 ${(t.size / 2**30).toFixed(2)} GB`, `🟢 ${t.seeders||0}`, `🔴 ${t.peers||0}`].join(' | '),
                    torrent_id: t.id
                }));
        
            Lampa.Select.show({
                title: 'Результаты TorBox',
                items,
                onSelect: item => {
                    const selected = torrents.find(t => t.id === item.torrent_id);
                    if (selected) handleTorrentSelection(selected, movie, torrents);
                },
                onBack: () => Lampa.Controller.toggle('content')
            });
        }

        async function handleTorrentSelection(torrent, movie, originalList) {
            Lampa.Loading.start('Обработка торрента...');
            try {
                if (torrent.cached) {
                    const files = await TorBoxAPI.getFiles(torrent.id);
                    const videos = files.filter(f => /\.(mkv|mp4|avi)$/i.test(f.name));
                    if (!videos.length) return Lampa.Noty.show('Видео-файлы не найдены');
                    
                    if (videos.length === 1) {
                        await playFile(torrent.id, videos[0].id, movie, videos[0].name);
                    } else {
                        videos.sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true}));
                        Lampa.Select.show({
                            title: 'Выберите файл',
                            items: videos.map(f => ({
                                title: f.name,
                                subtitle: `${(f.size / 1024**3).toFixed(2)} GB | ${parseQuality(f.name)}`,
                                tid: torrent.id,
                                fid: f.id,
                                fname: f.name
                            })),
                            onSelect: sel => playFile(sel.tid, sel.fid, movie, sel.fname),
                            onBack: () => displayTorrents(originalList, movie)
                        });
                    }
                } else {
                    await TorBoxAPI.addMagnet(torrent.magnet);
                    Lampa.Noty.show('Торрент отправлен в TorBox.', { type: 'info' });
                }
            } catch (err) {
                Lampa.Noty.show(err.message, { type: 'error' });
            } finally {
                Lampa.Loading.stop();
            }
        }

        async function playFile(torrentId, fileId, movie, fileName) {
            Lampa.Loading.start('Получение ссылки...');
            try {
                const url = await TorBoxAPI.getDownloadLink(torrentId, fileId);
                if (!url) throw new Error('Не удалось получить ссылку');
                Lampa.Player.play({ url, title: fileName || movie.title, poster: movie.img });
                Lampa.Player.callback(Lampa.Activity.backward);
            } catch (err) {
                Lampa.Noty.show(err.message, { type: 'error' });
            } finally {
                Lampa.Loading.stop();
            }
        }
    }

    // --- Plugin Initializer ---

    (function waitForLampa() {
        let waited = 0;
        const loop = setInterval(() => {
            if (window.Lampa && window.Lampa.Settings) {
                clearInterval(loop);
                startPlugin();
            } else {
                waited += 500;
                if (waited >= 15000) {
                    clearInterval(loop);
                    console.error(`[${PLUGIN_ID}] -> Lampa not found`);
                }
            }
        }, 500);
    })();
})();
