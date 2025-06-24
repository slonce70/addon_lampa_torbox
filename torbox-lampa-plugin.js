/**
 * TorBox <-> Lampa Integration Plugin
 * Version: 41.0.0 (Ultimate Stable Merge)
 * Author: Gemini AI & Your Name
 *
 * CHANGE LOG v41.0.0:
 * - FINAL ATTEMPT: This version is a direct implementation of the user's request.
 * - It uses the EXACT hybrid settings logic from the user's proven 'torbox_enhanced_secure_24' script to ensure the settings menu works without errors.
 * - The settings panel has been simplified to only include essential options: API Key, Cached Only, and Debug mode.
 * - The search-and-play button functionality is preserved.
 * - All other complex or conflicting logic has been removed. This should be the most stable version.
 */
(function () {
    'use strict';

    const PLUGIN_ID = 'torbox_stable_merge_v41';
    if (window[PLUGIN_ID]) {
        return;
    }
    window[PLUGIN_ID] = true;

    const COMPONENT_ID = 'torbox_player_settings_stable';

    // --- Утилиты ---
    function logger(...args) {
        if (storage('torbox_debug') === 'true') {
            console.log(`[TorBox Stable]`, ...args);
        }
    }

    function storage(key, value) {
        try {
            if (typeof value === 'undefined') {
                return window.localStorage.getItem(key);
            }
            window.localStorage.setItem(key, String(value));
            return value;
        } catch (e) {
            console.error("[TorBox] LocalStorage Error:", e);
            return typeof value === 'undefined' ? null : value;
        }
    }

    // --- API Оболочка ---
    const TorBoxAPI = {
        API_BASE: 'https://api.torbox.app/v1/api',
        API_SEARCH_BASE: 'https://search-api.torbox.app',

        _call_check: async function(apiKey, endpoint, params = {}, method = 'GET', base = this.API_BASE) {
            if (!apiKey) {
                return Promise.reject(new Error('API ключ TorBox не установлен'));
            }
            let url = `${base}${endpoint}`;
            const options = { method, headers: { 'Authorization': `Bearer ${apiKey}` } };
            if (method === 'GET' && Object.keys(params).length) {
                url += '?' + new URLSearchParams(params).toString();
            } else if (method === 'POST') {
                options.headers['Content-Type'] = 'application/json';
                options.body = JSON.stringify(params);
            }
            const response = await fetch(url, options);
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || data.message || `HTTP ${response.status}`);
            }
            return data;
        },
        
        search: (movie) => TorBoxAPI._call_check(storage('torbox_api_key'), `/torrents/search/${encodeURIComponent(movie.imdb_id ? `imdb:${movie.imdb_id}` : movie.title)}`, { metadata: 'true', check_cache: 'true' }, 'GET', TorBoxAPI.API_SEARCH_BASE),
        getFiles: (torrentId) => TorBoxAPI._call_check(storage('torbox_api_key'), '/torrents/mylist', { id: torrentId }).then(r => r.data?.[0]?.files || []),
        getDownloadLink: (torrentId, fileId) => TorBoxAPI._call_check(storage('torbox_api_key'), '/torrents/requestdl', { torrent_id: torrentId, file_id: fileId }).then(r => r.data)
    };

    // --- Логика воспроизведения ---
    function parseQuality(name) {
        const lowerName = (name || '').toLowerCase();
        if (lowerName.includes('2160p') || lowerName.includes('4k')) return '✨ 4K UHD';
        if (lowerName.includes('1080p')) return '🔥 Full HD';
        if (lowerName.includes('720p')) return 'HD';
        if (lowerName.includes('480p')) return 'SD';
        return '';
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

    async function handleTorrentSelection(torrent, movie, originalList) {
        Lampa.Loading.start('Обработка торрента...');
        try {
            if (!torrent.cached) {
                 return Lampa.Noty.show('Эта раздача не кэширована в TorBox.', { type: 'info' });
            }
            
            const files = await TorBoxAPI.getFiles(torrent.id);
            const videos = files.filter(f => /\.(mkv|mp4|avi)$/i.test(f.name));
            if (!videos.length) return Lampa.Noty.show('Видео-файлы не найдены');
            
            if (videos.length === 1) {
                await playFile(torrent.id, videos[0].id, movie, videos[0].name);
            } else {
                videos.sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true}));
                Lampa.Select.show({
                    title: 'Выберите файл для воспроизведения',
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
        } catch (err) {
            Lampa.Noty.show(err.message, { type: 'error' });
        } finally {
            Lampa.Loading.stop();
        }
    }

    function displayTorrents(torrents, movie) {
        const cachedOnly = storage('torbox_cached_only') === 'true';
        let filtered = cachedOnly ? torrents.filter(t => t.cached) : torrents;

        if (!filtered.length) {
            return Lampa.Noty.show('Нет доступных раздач по вашим фильтрам', { type: 'info' });
        }

        const items = filtered
            .sort((a,b) => (b.seeders || 0) - (a.seeders || 0))
            .map(t => ({
                title: `${t.cached ? '⚡' : '☁️'} ${t.name || t.raw_title || 'Без названия'}`,
                subtitle: [`💾 ${(t.size / 1024**3).toFixed(2)} GB`, `🟢 ${t.seeders||0}`, `🔴 ${t.peers||0}`].join(' | '),
                torrent: t
            }));
    
        Lampa.Select.show({
            title: 'Результаты TorBox',
            items: items,
            onSelect: item => {
                handleTorrentSelection(item.torrent, movie, torrents);
            },
            onBack: () => Lampa.Controller.toggle('content')
        });
    }

    async function searchAndShow(movie) {
        Lampa.Loading.start('Поиск в TorBox...');
        try {
            const results = await TorBoxAPI.search(movie);
            const torrents = results.data?.torrents || [];
            if (!torrents.length) return Lampa.Noty.show('Ничего не найдено в TorBox');
            displayTorrents(torrents, movie);
        } catch (err) {
            Lampa.Noty.show(err.message, { type: 'error' });
        } finally {
            Lampa.Loading.stop();
        }
    }

    // --- Гибридные настройки (на основе рабочего скрипта) ---

    // Современный метод
    function buildSettingsApi() {
        const icon = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" /><path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2"/><path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2"/></svg>`;
        Lampa.SettingsApi.addComponent({ component: COMPONENT_ID, name: 'TorBox', icon: icon });

        const params = [
            { key: 'torbox_api_key', field: { name: 'API-Key', description: 'Персональный ключ из личного кабинета TorBox' }, type: 'input', def: storage('torbox_api_key') || '' },
            { key: 'torbox_cached_only', field: { name: 'Только кэшированные', description: 'Показывать только те раздачи, которые уже загружены в облако TorBox' }, type: 'trigger', def: storage('torbox_cached_only') === 'true' },
            { key: 'torbox_debug', field: { name: 'Debug-режим', description: 'Выводить подробные логи в консоль разработчика' }, type: 'trigger', def: storage('torbox_debug') === 'true' },
        ];

        params.forEach((p) => {
            Lampa.SettingsApi.addParam({
                component: COMPONENT_ID,
                param: { name: p.key, type: p.type, default: p.def },
                field: p.field,
                onChange: (value) => storage(p.key, p.type === 'trigger' ? Boolean(value) : (value || '').trim()),
            });
        });
    }

    // Старый, надежный метод
    function buildSettingsLegacy() {
        const folder = $(`<div class="settings-folder" data-torbox-legacy><div class="settings-folder__title">TorBox</div><div class="settings-folder__body"></div></div>`);
        const body = folder.find('.settings-folder__body');

        const items = [
            { label: 'API Ключ', key: 'torbox_api_key', type: 'input' },
            { label: 'Только кэшированные', key: 'torbox_cached_only', type: 'trigger' },
            { label: 'Debug-режим', key: 'torbox_debug', type: 'trigger' },
        ];

        items.forEach((p) => {
            const row = $(`<div class="settings-param selector"><div class="settings-param__name">${p.label}</div><div class="settings-param__value"></div></div>`);
            if (p.type === 'input') {
                row.find('.settings-param__value').text(storage(p.key) || 'Не указан');
                row.on('hover:enter', () => {
                    Lampa.Input.edit({ title: p.label, value: storage(p.key) || '', free: true }, (val) => {
                        storage(p.key, val.trim());
                        row.find('.settings-param__value').text(val.trim() || 'Не указан');
                    });
                });
            } else if (p.type === 'trigger') {
                const update = () => row.find('.settings-param__value').text(storage(p.key) === 'true' ? 'Вкл' : 'Выкл');
                update();
                row.on('hover:enter', () => { storage(p.key, !(storage(p.key) === 'true')); update(); });
            }
            body.append(row);
        });
        // Находим главный контейнер и вставляем наш блок
        $('.settings .settings-list').append(folder);
    }

    // --- Инициализация ---
    function initPlugin(useApi) {
        logger(`Инициализация плагина. Использовать SettingsApi: ${useApi}`);
        
        // Создаем настройки подходящим методом
        useApi ? buildSettingsApi() : buildSettingsLegacy();

        // Добавляем кнопку "Смотреть в TorBox" на карточку фильма
        Lampa.Listener.follow('full', (e) => {
            if (e.type !== 'complite' || e.object.activity.render().find('.view--torbox_player').length) return;
            const button = $(`<div class="full-start__button selector view--torbox_player" data-subtitle="TorBox">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" /><path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2"/><path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2"/></svg>
                <span>TorBox</span></div>`);
            button.on('hover:enter', () => searchAndShow(e.data.movie));
            e.object.activity.render().find('.view--torrent').after(button);
        });

        logger('Плагин готов');
    }

    // Ожидание Lampa (взято из рабочего скрипта)
    (function waitForLampa() {
        let waited = 0;
        const loop = setInterval(() => {
            const isReady = window.Lampa && window.jQuery && (window.Lampa.SettingsApi || (window.Lampa.Settings && Lampa.Settings.main));
            if (isReady) {
                clearInterval(loop);
                initPlugin(Boolean(window.Lampa.SettingsApi));
            } else {
                waited += 200;
                if (waited >= 20000) {
                    clearInterval(loop);
                    console.error("[TorBox] Lampa не загрузилась вовремя.");
                }
            }
        }, 200);
    })();

})();
