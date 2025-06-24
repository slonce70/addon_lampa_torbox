/**
 * TorBox <-> Lampa Integration Plugin
 * Version: 33.0.0 (Template Naming Fix)
 * Author: Gemini AI & Your Name
 *
 * CHANGE LOG v33.0.0:
 * - CRITICAL FIX: The 'Template not found' error is resolved by correcting a typo in the template name. The 'data-component' attribute on the button now correctly matches the name used in 'Lampa.Template.add'.
 */
(function () {
    'use strict';

    // Уникальный ID плагина для предотвращения повторной инициализации
    const PLUGIN_ID = 'torbox_plugin_naming_fix_v33';
    if (window[PLUGIN_ID]) {
        return;
    }
    window[PLUGIN_ID] = true;

    // 1. Определяем HTML-шаблон для страницы настроек
    const settings_html = `
        <div class="settings-torbox-page">
            <div class="settings-param selector" data-name="api_key">
                <div class="settings-param__name">API Ключ</div>
                <div class="settings-param__value"></div>
            </div>
            <div class="settings-param selector" data-name="check_key">
                <div class="settings-param__name">Проверить ключ</div>
                <div class="settings-param__status">Нажмите для проверки</div>
            </div>
            <div class="settings-param selector" data-name="cached_only">
                <div class="settings-param__name">Только кэшированные</div>
                <div class="settings-param__value"></div>
            </div>
            <div class="settings-param selector" data-name="debug">
                <div class="settings-param__name">Debug-режим</div>
                <div class="settings-param__value"></div>
            </div>
        </div>`;
    
    // 2. Немедленно регистрируем шаблон с правильным именем
    // Имя 'torbox_settings_manual' должно совпадать с 'data-component' у кнопки
    Lampa.Template.add('torbox_settings_manual', settings_html);


    // --- Логгер и Хранилище ---
    const Storage = {
        get: (key, fallback) => Lampa.Storage.get(`torbox_${key}`, fallback),
        set: (key, value) => Lampa.Storage.set(`torbox_${key}`, value),
    };

    function logger(...args) {
        if (Storage.get('debug', 'false') === 'true') {
            console.log(`[TorBox]`, ...args);
        }
    }

    // --- API Wrapper & Helpers (без изменений) ---
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
            const apiKey = Storage.get('api_key', '');
            return this._call_check(apiKey, endpoint, params, method, base);
        },
        
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
            try {
                const response = await fetch(url, options);
                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.error || data.message || `HTTP ${response.status}`);
                }
                return data;
            } catch (networkError) {
                logger("Сетевая ошибка:", networkError);
                throw new Error(networkError.message || 'Сетевая ошибка');
            }
        },
        
        search: (movie) => TorBoxAPI._call(`/torrents/search/${encodeURIComponent(movie.imdb_id ? `imdb:${movie.imdb_id}` : movie.title)}`, { metadata: 'true', check_cache: 'true' }, 'GET', TorBoxAPI.API_SEARCH_BASE),
        addMagnet: (magnet) => TorBoxAPI._call('/torrents/createtorrent', { magnet }, 'POST'),
        getFiles: (torrentId) => TorBoxAPI._call('/torrents/mylist', { id: torrentId }).then(r => r.data?.[0]?.files || []),
        getDownloadLink: (torrentId, fileId) => TorBoxAPI._call('/torrents/requestdl', { torrent_id: torrentId, file_id: fileId }).then(r => r.data)
    };

    // --- Основная логика поиска и воспроизведения (без изменений) ---
    async function searchAndShow(movie) {
        Lampa.Loading.start('Поиск в TorBox...');
        try {
            const results = await TorBoxAPI.search(movie);
            const torrents = results.data?.torrents || [];
            if (!torrents.length) return Lampa.Noty.show('Ничего не найдено в TorBox');
            const cachedOnly = Storage.get('show_cached_only', 'false') === 'true';
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

    // --- Логика интерфейса ---

    // 3. Обработчик события 'open', который наполняет готовый шаблон
    Lampa.Settings.listener.follow('open', function (e) {
        if (e.name !== 'torbox_settings_manual') return;

        e.activity.title('TorBox');

        // Получаем предварительно зарегистрированный шаблон по правильному имени
        let html = $(Lampa.Template.get('torbox_settings_manual'));

        // Заполняем актуальными значениями
        html.find('[data-name="api_key"] .settings-param__value').text(Storage.get('api_key', 'Не указан'));
        html.find('[data-name="cached_only"] .settings-param__value').text(Storage.get('show_cached_only', 'false') === 'true' ? 'Да' : 'Нет');
        html.find('[data-name="debug"] .settings-param__value').text(Storage.get('debug', 'false') === 'true' ? 'Вкл' : 'Выкл');

        // Вешаем обработчики событий
        html.find('[data-name="api_key"]').on('hover:enter', function () {
            Lampa.Input.edit({
                title: 'API Ключ TorBox',
                value: Storage.get('api_key', ''),
                free: true,
                nosave: true
            }, (newVal) => {
                const trimmed = (newVal || '').trim();
                Storage.set('api_key', trimmed);
                $(this).find('.settings-param__value').text(trimmed || 'Не указан');
                Lampa.Controller.toggle('settings_component');
            });
        });

        html.find('[data-name="check_key"]').on('hover:enter', async function () {
            const status = $(this).find('.settings-param__status');
            const key = Storage.get('api_key', '');
            if (!key) return Lampa.Noty.show('Сначала введите API ключ', { type: 'warning' });
            status.text('Проверка...');
            try {
                await TorBoxAPI._call_check(key, '/torrents/mylist', { limit: 1 });
                status.text('Ключ действителен 👍');
                Lampa.Noty.show('Ключ действителен', { type: 'success' });
            } catch (err) {
                status.text('Ошибка! 👎');
                Lampa.Noty.show(err.message, { type: 'error' });
            }
        });

        html.find('[data-name="cached_only"]').on('hover:enter', function() {
            const current = Storage.get('show_cached_only', 'false') === 'true';
            const newValue = !current;
            Storage.set('show_cached_only', newValue.toString());
            $(this).find('.settings-param__value').text(newValue ? 'Да' : 'Нет');
        });

        html.find('[data-name="debug"]').on('hover:enter', function() {
            const current = Storage.get('debug', 'false') === 'true';
            const newValue = !current;
            Storage.set('debug', newValue.toString());
            $(this).find('.settings-param__value').text(newValue ? 'Вкл' : 'Выкл');
        });

        // Отображаем готовый HTML
        e.body.empty().append(html);
        Lampa.Controller.enable('settings_component');
    });
    
    // 4. Логика добавления кнопки в главное меню настроек (безопасная)
    function addSettingsButton() {
        if ($('.settings-main [data-component="torbox_settings_manual"]').length) return;
        
        if (Lampa.Settings.main && Lampa.Settings.main()) {
            // Используем 'data-component' с тем же именем, что и у шаблона
            const folder = $(`
                <div class="settings-folder selector" data-component="torbox_settings_manual">
                    <div class="settings-folder__icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
                    </div>
                    <div class="settings-folder__name">TorBox</div>
                </div>`);

            Lampa.Settings.main().render().find('[data-component="more"]').after(folder);
            Lampa.Settings.main().update();
            logger('Кнопка настроек TorBox добавлена.');
        }
    }
    
    // --- Инициализатор плагина ---
    
    Lampa.Listener.follow('full', (e) => {
        if (e.type !== 'complite' || e.object.activity.render().find('.view--torbox').length) return;
        const button = $(`<div class="full-start__button selector view--torbox" data-subtitle="TorBox">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
            <span>TorBox</span></div>`);
        button.on('hover:enter', () => searchAndShow(e.data.movie));
        e.object.activity.render().find('.view--torrent').after(button);
    });

    if (window.appready) {
        addSettingsButton();
    } else {
        Lampa.Listener.follow('app', (e) => {
            if (e.type === 'ready') {
                addSettingsButton();
            }
        });
    }
    
    logger('Плагин TorBox v33.0.0 инициализирован.');

})();
