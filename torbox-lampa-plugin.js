/**
 * TorBox ↔ Lampa integration plugin
 * Version 5.0.4 – Web version compatible
 *
 * Changelog vs 4.3.1:
 *  • Полная адаптация для веб-версии Lampa
 *  • Использование современных API (Component.add, Modal)
 *  • Исправлены проблемы с CORS
 *  • Обновлены эндпоинты TorBox API
 *  • Упрощенная интеграция через меню фильма
 *  • Множественные способы интеграции с настройками
 *  • Улучшенная совместимость с разными версиями Lampa
 *
 * Author: GOD MODE (adapted for web)
 */
(function () {
    'use strict';

    /* ---------- GLOBAL GUARD ---------- */
    const NS = 'torbox_lampa_plugin_v5_0_3';
    if (window[NS]) return;
    window[NS] = true;

    /* ---------- CONSTANTS ---------- */
    const S = {
        API_KEY    : 'torbox_api_key',
        CACHED_ONLY: 'torbox_show_cached_only'
    };

    const CORS_PROXY = 'https://api.allorigins.win/raw?url=';
    const API_BASE = 'https://api.torbox.app/v1/api';

    /* ---------- CORE API ---------- */
    const TorBoxAPI = {
        async apiCall(endpoint, params = {}, method = 'GET') {
            const key = Lampa.Storage.get(S.API_KEY, '');
            if (!key) {
                throw new Error('Установите API ключ TorBox в настройках');
            }

            let url = `${API_BASE}${endpoint}`;
            const options = {
                method: method,
                headers: {
                    'Authorization': `Bearer ${key}`,
                    'Content-Type': 'application/json'
                }
            };

            if (method === 'GET' && Object.keys(params).length) {
                url += '?' + new URLSearchParams(params).toString();
            } else if (method === 'POST') {
                options.body = JSON.stringify(params);
            }

            try {
                // Пробуем прямой запрос
                const response = await fetch(url, options);
                if (response.ok) {
                    return await response.json();
                }
            } catch (e) {
                console.log('Прямой запрос не удался, используем CORS прокси');
            }

            // Если прямой запрос не удался, используем CORS прокси
            const proxyUrl = CORS_PROXY + encodeURIComponent(url);
            const response = await fetch(proxyUrl, {
                method: 'GET', // Прокси поддерживает только GET
                headers: {
                    'X-Requested-With': 'XMLHttpRequest'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            if (data.success === false) {
                throw new Error(data.error || data.detail || 'API ошибка');
            }

            return data;
        },

        async searchTorrents(movie) {
            const query = movie.imdb_id ? `imdb:${movie.imdb_id}` : `${movie.title} ${movie.year || ''}`.trim();
            const endpoint = `/torrents/search`;
            
            try {
                const data = await this.apiCall(endpoint, {
                    query: query,
                    metadata: 1,
                    check_cache: 1
                });
                
                return this.formatTorrents(data.data || []);
            } catch (error) {
                console.error('TorBox search error:', error);
                Lampa.Noty.show(error.message, { type: 'error' });
                return [];
            }
        },

        formatTorrents(torrents) {
            const cachedOnly = Lampa.Storage.get(S.CACHED_ONLY, false);
            
            return torrents
                .filter(t => cachedOnly ? t.cached : true)
                .map(t => ({
                    title: t.name || t.raw_title,
                    info: `${t.cached ? '⚡ ' : ''}${(t.size / (1024**3)).toFixed(2)} GB • S:${t.seeders || '?'}`,
                    quality: t.resolution || t.quality || '—',
                    size: t.size,
                    cached: !!t.cached,
                    hash: t.hash,
                    magnet: t.magnet,
                    torrent_id: t.id
                }))
                .sort((a, b) => b.size - a.size);
        },

        async selectTorrent(torrent) {
            Lampa.Loading.start();
            
            try {
                if (torrent.cached) {
                    await this.playCached(torrent);
                } else {
                    await this.addTorrent(torrent);
                }
            } catch (error) {
                console.error('TorBox select error:', error);
                Lampa.Noty.show(error.message, { type: 'error' });
            } finally {
                Lampa.Loading.stop();
            }
        },

        async playCached(torrent) {
            try {
                const data = await this.apiCall(`/torrents/mylist`, { id: torrent.torrent_id });
                const files = data.data?.files || [];
                
                const videoFiles = files
                    .filter(f => /\.(mkv|mp4|avi|mov|wmv|flv|m4v|webm)$/i.test(f.name))
                    .map(f => ({
                        title: f.name,
                        info: `${(f.size / (1024**3)).toFixed(2)} GB`,
                        size: f.size,
                        file_id: f.id
                    }))
                    .sort((a, b) => b.size - a.size);

                if (!videoFiles.length) {
                    throw new Error('Видео файлы не найдены');
                }

                if (videoFiles.length === 1) {
                    await this.playFile(torrent.torrent_id, videoFiles[0].file_id);
                } else {
                    this.showFileSelector(torrent.torrent_id, videoFiles);
                }
            } catch (error) {
                throw error;
            }
        },

        async playFile(torrentId, fileId) {
            try {
                const data = await this.apiCall(`/torrents/requestdl`, {
                    torrent_id: torrentId,
                    file_id: fileId
                });
                
                if (data.data) {
                    Lampa.Player.play({ url: data.data });
                } else {
                    throw new Error('Не удалось получить ссылку для воспроизведения');
                }
            } catch (error) {
                throw error;
            }
        },

        showFileSelector(torrentId, files) {
            const items = files.map(f => ({
                title: f.title,
                subtitle: f.info,
                file_id: f.file_id
            }));

            Lampa.Select.show({
                title: 'Выберите файл',
                items: items,
                onSelect: (item) => {
                    this.playFile(torrentId, item.file_id);
                },
                onBack: () => {
                    Lampa.Controller.toggle('content');
                }
            });
        },

        async addTorrent(torrent) {
            try {
                await this.apiCall('/torrents/createtorrent', {
                    magnet: torrent.magnet
                }, 'POST');
                
                Lampa.Noty.show('Торрент добавлен в TorBox!', { type: 'success' });
                Lampa.Controller.toggle('content');
            } catch (error) {
                throw error;
            }
        }
    };

    /* ---------- SETTINGS ---------- */
    function showSettings() {
        console.log('TorBox: Открываем настройки');
        
        const apiKey = Lampa.Storage.get('torbox_api_key', '');
        const cachedOnly = Lampa.Storage.get('torbox_cached_only', false);
        
        const items = [
            {
                title: 'API ключ TorBox',
                subtitle: apiKey || 'Не установлен',
                description: 'Ваш API ключ для доступа к TorBox',
                input: true,
                value: apiKey,
                placeholder: 'Введите API ключ',
                onChange: (value) => {
                    Lampa.Storage.set('torbox_api_key', value);
                    console.log('TorBox: API ключ сохранен:', value);
                }
            },
            {
                title: 'Только кэшированные торренты',
                subtitle: cachedOnly ? 'Включено' : 'Выключено',
                description: 'Показывать только торренты, которые уже кэшированы в TorBox',
                toggle: true,
                value: cachedOnly,
                onChange: (value) => {
                    Lampa.Storage.set('torbox_cached_only', value);
                    console.log('TorBox: Кэшированные торренты:', value);
                }
            }
        ];
        
        Lampa.Select.show({
            title: 'Настройки TorBox',
            items: items,
            onSelect: (item) => {
                if (item.input) {
                    Lampa.Input.show({
                        title: item.title,
                        value: item.value,
                        placeholder: item.placeholder,
                        onSave: (value) => {
                            item.onChange(value);
                            showSettings(); // Обновляем меню
                        },
                        onBack: () => {
                            showSettings(); // Возвращаемся к настройкам
                        }
                    });
                } else if (item.toggle) {
                    const newValue = !item.value;
                    item.onChange(newValue);
                    showSettings(); // Обновляем меню
                }
            },
            onBack: () => {
                Lampa.Controller.toggle('content');
            }
        });
    }

    /* ---------- TORBOX COMPONENT ---------- */
    const TorBoxComponent = {
        create() {
            return this;
        },

        async searchAndShow(movie) {
            const apiKey = Lampa.Storage.get(S.API_KEY, '');
            if (!apiKey) {
                Lampa.Noty.show('Настройте API ключ TorBox в настройках', { type: 'error' });
                showSettings();
                return;
            }

            Lampa.Loading.start();
            
            try {
                const torrents = await TorBoxAPI.searchTorrents(movie);
                
                if (!torrents.length) {
                    Lampa.Noty.show('Торренты не найдены', { type: 'error' });
                    return;
                }

                this.showTorrentList(torrents);
            } catch (error) {
                console.error('TorBox search error:', error);
                Lampa.Noty.show(error.message, { type: 'error' });
            } finally {
                Lampa.Loading.stop();
            }
        },

        showTorrentList(torrents) {
            const items = torrents.map(torrent => ({
                title: torrent.title,
                subtitle: torrent.info,
                quality: torrent.quality,
                torrent: torrent
            }));

            Lampa.Select.show({
                title: 'TorBox - Выберите торрент',
                items: items,
                onSelect: (item) => {
                    TorBoxAPI.selectTorrent(item.torrent);
                },
                onBack: () => {
                    Lampa.Controller.toggle('content');
                }
            });
        }
    };

    /* ---------- MENU INTEGRATION ---------- */
    function addToMovieMenu() {
        // Добавляем кнопку в контекстное меню фильма
        Lampa.Listener.follow('full', (e) => {
            if (e.type === 'complite') {
                const movie = e.data.movie;
                
                // Создаем кнопку TorBox
                const torboxButton = $(`
                    <div class="full-start__button selector view--torbox" data-subtitle="Поиск через TorBox">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                            <path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                            <path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                        </svg>
                        <span>TorBox</span>
                    </div>
                `);

                torboxButton.on('hover:enter', () => {
                    TorBoxComponent.searchAndShow(movie);
                });

                // Добавляем кнопку в интерфейс
                $('.full-start__buttons').append(torboxButton);
            }
        });

        // Функция добавления настроек TorBox
        function addSettingsTorBox() {
            if (Lampa.Settings.main && !Lampa.Settings.main().render().find('[data-component="torbox"]').length) {
                var field = "<div class=\"settings-folder selector\" data-component=\"torbox\" data-static=\"true\">\n\t\t\t<div class=\"settings-folder__icon\">\n\t\t\t\t<svg width=\"57\" height=\"57\" viewBox=\"0 0 24 24\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n\t\t\t\t\t<path d=\"M12 2L2 7L12 12L22 7L12 2Z\" stroke=\"white\" stroke-width=\"2\" stroke-linejoin=\"round\"/>\n\t\t\t\t\t<path d=\"M2 17L12 22L22 17\" stroke=\"white\" stroke-width=\"2\" stroke-linejoin=\"round\"/>\n\t\t\t\t\t<path d=\"M2 12L12 17L22 12\" stroke=\"white\" stroke-width=\"2\" stroke-linejoin=\"round\"/>\n\t\t\t\t</svg>\n\t\t\t</div>\n\t\t\t<div class=\"settings-folder__name\">TorBox</div>\n\t\t</div>";
                Lampa.Settings.main().render().find('[data-component="more"]').after(field);
                Lampa.Settings.main().update();
            }
        }

        // Добавляем обработчик открытия настроек
        Lampa.Settings.listener.follow('open', function(e) {
            if (e.name == 'main') {
                e.body.find('[data-component="torbox"]').on('hover:enter', function() {
                    showSettings();
                });
            }
        });



        // Инициализация настроек
        if (window.appready) {
            addSettingsTorBox();
        } else {
            Lampa.Listener.follow('app', function (e) {
                if (e.type == 'ready') {
                    addSettingsTorBox();
                }
            });
        }
    }

    /* ---------- INITIALIZATION ---------- */
    function init() {
        // Регистрируем компонент
        if (typeof Lampa.Component.add === 'function') {
            Lampa.Component.add('torbox', TorBoxComponent);
        }

        // Добавляем в меню
        addToMovieMenu();
        
        console.log('%cTorBox v5.0.3 – Initialized with simplified settings integration using Lampa.Modal following store.js pattern', 'color:#0f0');
    }

    // Инициализация
    if (window.appready || (typeof Lampa !== 'undefined' && Lampa.Storage)) {
        init();
    } else {
        Lampa.Listener.follow('app', (e) => {
            if (e.type === 'ready') {
                init();
            }
        });
    }
})();
