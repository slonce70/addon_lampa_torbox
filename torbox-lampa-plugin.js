/**
 * TorBox <-> Lampa Integration Plugin
 * Version: 25.0.0 (API-Compliant Rebuild)
 * Author: Gemini AI & Your Name
 *
 * CHANGE LOG v25.0.0:
 * - REWRITE (Settings): The settings logic has been completely rewritten to use the official Lampa.Settings.API.
 * - REMOVED: The old, unstable "HACKER MODE" method of directly injecting HTML with jQuery has been completely removed.
 * - FIXED: The "template not found" and "cannot read properties of undefined" errors when entering settings are resolved.
 * - IMPROVED: The plugin now correctly registers a settings category in Lampa, providing a stable and update-proof integration.
 * - BEST PRACTICES: Code now follows Lampa development best practices, using its templating and storage systems.
 */
(function () {
    'use strict';

    // Уникальный ID плагина для предотвращения повторной инициализации
    const PLUGIN_ID = 'torbox_plugin_api_compliant_v25';
    if (window[PLUGIN_ID]) {
        console.log(`[TorBox] -> Плагин уже был инициализирован. Отмена.`);
        return;
    }
    window[PLUGIN_ID] = true;

    // --- Логгер и Хранилище ---

    // Используем Lampa.Storage для большей совместимости
    const Storage = {
        get: (key, fallback) => Lampa.Storage.get(`torbox_${key}`, fallback),
        set: (key, value) => Lampa.Storage.set(`torbox_${key}`, value),
    };

    function logger(...args) {
        if (Storage.get('debug', 'false') === 'true') {
            console.log(`[TorBox]`, ...args);
        }
    }

    // --- Компонент настроек (Правильный способ) ---

    function buildSettingsComponent() {
        // 1. Создаем наш компонент настроек, используя Lampa.Template
        // Lampa сама обработает его создание, отображение и уничтожение
        const component = Lampa.Component.create({
            name: 'torbox_settings',
            template: `
                <div class="settings-torbox">
                    <div class="settings-content">
                        {{#each fields}}
                            <div class="settings-param selector" data-name="{{name}}">
                                <div class="settings-param__name">{{title}}</div>
                                <div class="settings-param__value">{{value}}</div>
                            </div>
                        {{/each}}
                        <div class="settings-param selector" data-name="check_key">
                            <div class="settings-param__name">Проверить ключ</div>
                            <div class="settings-param__value">Нажмите для проверки</div>
                        </div>
                    </div>
                </div>`,
            data: {
                fields: [] // Данные будут загружены в методе `create`
            },

            // Метод, который Lampa вызовет при создании компонента
            create: function() {
                this.activity.loader(true); // Показать загрузчик

                // Загружаем актуальные значения настроек
                this.data.fields = [
                    { name: 'api_key', title: 'API Ключ', value: Storage.get('api_key', 'Не указан') },
                    { name: 'show_cached_only', title: 'Только кэшированные', value: Storage.get('show_cached_only', 'false') === 'true' ? 'Да' : 'Нет' },
                    { name: 'debug', title: 'Debug-режим', value: Storage.get('debug', 'false') === 'true' ? 'Вкл' : 'Выкл' }
                ];
                
                this.activity.loader(false); // Скрыть загрузчик
                this.render(); // Перерисовать компонент с новыми данными
            },
            
            // Метод для обновления значения поля в интерфейсе
            updateField: function(name, value) {
                const field = this.data.fields.find(f => f.name === name);
                if (field) {
                    field.value = value;
                    // Находим элемент в DOM и обновляем его текст
                    this.activity.render()
                        .find(`.selector[data-name="${name}"] .settings-param__value`)
                        .text(value);
                }
            },

            // Lampa вызовет этот метод при нажатии "Вправо" или "Enter" на элементе
            onEnter: function(target, name) {
                // 'name' здесь - это значение data-name, которое мы указали в шаблоне
                switch (name) {
                    case 'api_key':
                        this.editApiKey();
                        break;
                    case 'show_cached_only':
                        this.toggleCachedOnly();
                        break;
                    case 'debug':
                        this.toggleDebug();
                        break;
                    case 'check_key':
                        this.checkApiKey(target);
                        break;
                }
            },

            editApiKey: function() {
                Lampa.Input.edit({
                    title: 'API Ключ TorBox',
                    value: Storage.get('api_key', ''),
                    free: true,
                    nosave: true
                }, (newVal) => {
                    const trimmed = (newVal || '').trim();
                    Storage.set('api_key', trimmed);
                    this.updateField('api_key', trimmed || 'Не указан');
                    Lampa.Controller.toggle(this.name); // Вернуть фокус на наш компонент
                });
            },

            toggleCachedOnly: function() {
                const current = Storage.get('show_cached_only', 'false') === 'true';
                const newValue = !current;
                Storage.set('show_cached_only', newValue.toString());
                const displayValue = newValue ? 'Да' : 'Нет';
                this.updateField('show_cached_only', displayValue);
            },
            
            toggleDebug: function() {
                const current = Storage.get('debug', 'false') === 'true';
                const newValue = !current;
                Storage.set('debug', newValue.toString());
                const displayValue = newValue ? 'Вкл' : 'Выкл';
                this.updateField('debug', displayValue);
            },

            checkApiKey: async function(target) {
                const statusDiv = target.find('.settings-param__value');
                const key = Storage.get('api_key', '');

                if (!key) {
                    return Lampa.Noty.show('Сначала введите API ключ', { type: 'warning' });
                }

                statusDiv.text('Проверка...');
                try {
                    await TorBoxAPI._call_check(key, '/torrents/mylist', { limit: 1 });
                    statusDiv.text('Ключ действителен 👍');
                    Lampa.Noty.show('Ключ действителен', { type: 'success' });
                } catch (err) {
                    statusDiv.text('Ошибка! 👎');
                    Lampa.Noty.show(err.message, { type: 'error' });
                }
            }
        });
        
        return component;
    }


    function registerSettings() {
        // 2. Регистрируем нашу категорию в главном меню настроек Lampa
        Lampa.Settings.API.add({
            icon: 't', // Просто иконка
            title: 'TorBox',
            name: 'torbox_settings_category', // Уникальное имя категории
            component: 'torbox_settings' // Имя компонента, который мы создали выше
        });

        // 3. Создаем сам компонент, чтобы Lampa могла его найти по имени 'torbox_settings'
        buildSettingsComponent();
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
                logger("Сетевая ошибка:", networkError);
                throw new Error(networkError.message || 'Сетевая ошибка');
            }
        },
        
        search: (movie) => TorBoxAPI._call(`/torrents/search/${encodeURIComponent(movie.imdb_id ? `imdb:${movie.imdb_id}` : movie.title)}`, { metadata: 'true', check_cache: 'true' }, 'GET', TorBoxAPI.API_SEARCH_BASE),
        addMagnet: (magnet) => TorBoxAPI._call('/torrents/createtorrent', { magnet }, 'POST'),
        getFiles: (torrentId) => TorBoxAPI._call('/torrents/mylist', { id: torrentId }).then(r => r.data?.[0]?.files || []),
        getDownloadLink: (torrentId, fileId) => TorBoxAPI._call('/torrents/requestdl', { torrent_id: torrentId, file_id: fileId }).then(r => r.data)
    };

    // --- Основная логика плагина (без изменений) ---

    function startPlugin() {
        logger('Плагин запущен');
        
        // Регистрируем настройки правильным способом
        registerSettings();

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
    }

    // --- Инициализатор плагина ---
    // Ждем, пока Lampa полностью загрузится
    (function waitForLampa() {
        if (window.Lampa && window.Lampa.Settings) {
            startPlugin();
        } else {
            Lampa.Listener.follow('app', (e) => {
                if (e.type === 'ready') {
                    startPlugin();
                }
            });
        }
    })();
})();
