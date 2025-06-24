/**
 * TorBox <-> Lampa Integration Plugin
 * Version: 12.1.0 (Монолитная версия, исправленная)
 * Author: Gemini AI
 *
 * Полностью переработанный, единый файл плагина для максимальной производительности и предсказуемости.
 * Включает в себя надежную обработку ошибок, улучшенный пользовательский интерфейс и прямую интеграцию API.
 * Без сокращений. Без компромиссов.
 *
 * CHANGE LOG v12.1.0:
 * - ИСПРАВЛЕНО: Критическая ошибка 'Lampa.Settings.add is not a function', из-за которой плагин не загружался на новых версиях Lampa.
 * - УЛУЧШЕНО: Интеграция с меню настроек теперь использует современный и стабильный метод Lampa.Settings.Api.add.
 */
(function () {
    'use strict';

    // ===========================================================================================
    // Глобальная защита от повторной инициализации
    // ===========================================================================================
    const PLUGIN_NAME = 'TorBoxPluginV12_Monolith';
    if (window[PLUGIN_NAME]) {
        console.log(`TorBox Plugin: ${PLUGIN_NAME} уже был запущен. Повторная инициализация отменена.`);
        return;
    }
    window[PLUGIN_NAME] = true;

    // ===========================================================================================
    // БЛОК 1: КОНФИГУРАЦИЯ И НАСТРОЙКИ
    // ===========================================================================================

    /**
     * Создает и управляет страницей настроек TorBox в Lampa.
     */
    function TorBoxSettings() {
        const COMPONENT_NAME = 'torbox_settings_component';
        const STORAGE_KEY = {
            API: 'torbox_api_key',
            CACHED_ONLY: 'torbox_show_cached_only'
        };

        if (Lampa.Component.get(COMPONENT_NAME)) return;

        const settingsComponent = Lampa.Component.create({
            name: COMPONENT_NAME,
            template: `<div class="settings-content">
                           <div class="settings-content__body"></div>
                           <div class="settings-content__descr" style="margin-top: 1em;">
                               API ключ можно получить в личном кабинете на сайте <a href="https://torbox.app/settings" target="_blank">torbox.app</a>
                           </div>
                       </div>`,
            
            onRender: function() {
                const body = this.find('.settings-content__body');
                const storedApiKey = Lampa.Storage.get(STORAGE_KEY.API, '');
                const storedCachedOnly = Lampa.Storage.get(STORAGE_KEY.CACHED_ONLY, 'false');

                const apiKeyField = Lampa.Template.get('settings_input', {
                    name: 'torbox_api_key',
                    label: 'API Ключ TorBox',
                    placeholder: 'Введите ваш персональный API-ключ',
                    value: storedApiKey
                });

                const cachedOnlyField = Lampa.Template.get('settings_select', {
                    name: 'torbox_show_cached_only',
                    label: 'Показывать только кэшированные торренты',
                    value: storedCachedOnly,
                    options: [
                        { title: 'Нет', value: 'false' },
                        { title: 'Да', value: 'true' }
                    ]
                });

                apiKeyField.find('input').on('change', function() {
                    Lampa.Storage.set(STORAGE_KEY.API, this.value.trim());
                }).on('keyup', function(e) {
                    if (e.keyCode === 13) Lampa.Controller.toggle('content'); // Закрыть по Enter
                });

                cachedOnlyField.find('select').on('change', function() {
                    Lampa.Storage.set(STORAGE_KEY.CACHED_ONLY, this.value);
                });

                body.append(apiKeyField);
                body.append(cachedOnlyField);
            }
        });

        Lampa.Component.add(COMPONENT_NAME, settingsComponent);

        this.add = function() {
            const settings_component = {
                component: COMPONENT_NAME,
                name: 'TorBox',
                category: 'Плагины'
            };
            
            // ИСПРАВЛЕНИЕ: Используем новый API Lampa.Settings.Api.add для совместимости
            if (Lampa.Settings.Api && typeof Lampa.Settings.Api.add === 'function') {
                Lampa.Settings.Api.add(settings_component);
            } else {
                console.error("TorBox Plugin Error: Lampa.Settings.Api.add is not a function. Your Lampa version may be too old or incompatible.");
            }
        };
    }

    // ===========================================================================================
    // БЛОК 2: API-ВРАППЕР
    // ===========================================================================================

    const TorBoxAPI = {
        API_BASE: 'https://api.torbox.app/v1/api',
        API_SEARCH_BASE: 'https://search-api.torbox.app',

        _call: async function(endpoint, params = {}, method = 'GET', base = this.API_BASE) {
            const apiKey = Lampa.Storage.get('torbox_api_key', '');
            if (!apiKey) {
                Lampa.Noty.show('API ключ TorBox не установлен', { type: 'error', time: 5000 });
                return Promise.reject('API ключ не установлен');
            }

            let url = `${base}${endpoint}`;
            const options = {
                method,
                headers: { 'Authorization': `Bearer ${apiKey}` }
            };

            if (method === 'GET') {
                if (Object.keys(params).length) {
                    url += '?' + new URLSearchParams(params).toString();
                }
            } else if (method === 'POST') {
                if(params instanceof FormData){
                    options.body = params;
                } else {
                    options.headers['Content-Type'] = 'application/json';
                    options.body = JSON.stringify(params);
                }
            }
            
            try {
                const response = await fetch(url, options);
                const data = await response.json();

                if (!response.ok || data.success === false) {
                    const errorMessage = data.error || data.detail || `HTTP ошибка: ${response.status}`;
                    console.error("TorBox API Error:", errorMessage, data);
                    throw new Error(errorMessage);
                }
                
                return data;
            } catch (networkError) {
                console.error("TorBox Network Error:", networkError);
                throw new Error(`Сетевая ошибка: ${networkError.message}`);
            }
        },

        search: function(movie) {
            const query = movie.imdb_id ? `imdb:${movie.imdb_id}` : movie.title;
            const params = { metadata: 'true', check_cache: 'true', search_user_engines: 'true' };
            return this._call(`/torrents/search/${encodeURIComponent(query)}`, params, 'GET', this.API_SEARCH_BASE);
        },

        addMagnet: function(magnet) {
            const formData = new FormData();
            formData.append('magnet', magnet);
            return this._call('/torrents/createtorrent', formData, 'POST');
        },

        getFiles: function(torrentId) {
            return this._call(`/torrents/mylist`, {id: torrentId}).then(res => {
                return (res.data && res.data.length > 0) ? res.data[0].files || [] : [];
            });
        },

        getDownloadLink: function(torrentId, fileId) {
            const params = { torrent_id: torrentId, file_id: fileId };
            return this._call('/torrents/requestdl', params, 'GET').then(res => res.data);
        }
    };


    // ===========================================================================================
    // БЛОК 3: ОСНОВНАЯ ЛОГИКА ПЛАГИНА
    // ===========================================================================================

    function startPlugin() {
        // 1. Инициализация настроек
        const settings = new TorBoxSettings();
        settings.add();
        
        // 2. Внедрение кнопки на страницу фильма
        Lampa.Listener.follow('full', (e) => {
            if (e.type !== 'complite') return;
            
            const render = e.object.activity.render();
            if (render.find('.view--torbox').length) return;

            const button = $(`
                <div class="full-start__button selector view--torbox" data-subtitle="TorBox">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
                    <span>TorBox</span>
                </div>
            `);

            button.on('hover:enter', () => searchAndShow(e.data.movie));
            render.find('.view--torrent').after(button);
        });

        // 3. Функция поиска и отображения результатов
        async function searchAndShow(movie) {
            Lampa.Loading.start();
            try {
                const searchResults = await TorBoxAPI.search(movie);
                const torrents = (searchResults.data && searchResults.data.torrents) ? searchResults.data.torrents : [];
                
                if (!torrents.length) {
                    return Lampa.Noty.show('Ничего не найдено в TorBox');
                }

                const showCachedOnly = Lampa.Storage.get('torbox_show_cached_only', 'false') === 'true';
                const filteredTorrents = showCachedOnly ? torrents.filter(t => t.cached) : torrents;

                if (!filteredTorrents.length && showCachedOnly) {
                    return Lampa.Noty.show('Нет кэшированных результатов. Проверьте настройки плагина.');
                }
                
                displayTorrents(filteredTorrents, movie);
            } catch (err) {
                console.error("TorBox_Plugin_Error [searchAndShow]:", err);
                Lampa.Noty.show(err.message, { type: 'error', time: 5000 });
            } finally {
                Lampa.Loading.stop();
            }
        }

        // 4. Отображение списка торрентов
        function displayTorrents(torrents, movie) {
            const items = torrents
                .sort((a,b) => (b.seeders || 0) - (a.seeders || 0))
                .map(t => {
                    const isCached = t.cached ? '⚡' : '☁️';
                    const title = `${isCached} ${t.name || t.raw_title || 'Без названия'}`;
                    const size = t.size ? `💾 ${(t.size / 2**30).toFixed(2)} GB` : '';
                    const seeders = t.seeders !== undefined ? `🟢 ${t.seeders}` : '';
                    const leechers = t.peers !== undefined ? `🔴 ${t.peers}` : '';
                    const subtitle = [size, seeders, leechers].filter(Boolean).join(' | ');

                    return { title, subtitle, torrent: t };
                });

            Lampa.Select.show({
                title: 'Результаты TorBox',
                items,
                onSelect: (item) => handleTorrentSelection(item.torrent, movie, torrents),
                onBack: () => Lampa.Controller.toggle('content')
            });
        }

        // 5. Обработка выбора конкретного торрента
        async function handleTorrentSelection(torrent, movie, originalList) {
            Lampa.Loading.start();
            try {
                if (torrent.cached) {
                    const files = await TorBoxAPI.getFiles(torrent.id);
                    const videos = files.filter(f => /\.(mkv|mp4|avi|mov|webm|flv|wmv)$/i.test(f.name));

                    if (!videos.length) return Lampa.Noty.show('Видео-файлы не найдены в этом торренте', { type: 'warning' });
                    
                    if (videos.length === 1) {
                        await playFile(torrent.id, videos[0].id, movie);
                    } else {
                        Lampa.Select.show({
                            title: 'Выберите файл для воспроизведения',
                            items: videos.map(f => ({
                                title: f.name,
                                subtitle: f.size ? `${(f.size / 1024 / 1024 / 1024).toFixed(2)} GB` : '',
                                tid: torrent.id,
                                fid: f.id
                            })),
                            onSelect: (sel) => playFile(sel.tid, sel.fid, movie),
                            onBack: () => displayTorrents(originalList, movie)
                        });
                    }
                } else {
                    await TorBoxAPI.addMagnet(torrent.magnet);
                    Lampa.Noty.show('Торрент отправлен в TorBox. Ожидайте загрузку.', { type: 'info', time: 5000 });
                }
            } catch (err) {
                console.error("TorBox_Plugin_Error [handleTorrentSelection]:", err);
                Lampa.Noty.show(err.message, { type: 'error', time: 5000 });
            } finally {
                Lampa.Loading.stop();
            }
        }

        // 6. Запуск воспроизведения
        async function playFile(torrentId, fileId, movie) {
            Lampa.Loading.start();
            try {
                const downloadUrl = await TorBoxAPI.getDownloadLink(torrentId, fileId);
                if (!downloadUrl) throw new Error('Не удалось получить ссылку на файл');
                
                Lampa.Player.play({
                    url: downloadUrl,
                    title: movie.title,
                    poster: movie.img,
                    is_torbox: true
                });

                Lampa.Player.callback(() => {
                    Lampa.Activity.backward();
                });

            } catch (err) {
                console.error("TorBox_Plugin_Error [playFile]:", err);
                Lampa.Noty.show(err.message, { type: 'error', time: 5000 });
            } finally {
                Lampa.Loading.stop();
            }
        }
    }

    // Запуск плагина после полной загрузки Lampa
    if (window.appready) {
        startPlugin();
    } else {
        Lampa.Listener.follow('app', (e) => {
            if (e.type === 'ready') startPlugin();
        });
    }

})();
