/**
 * TorBox <-> Lampa Integration Plugin
 * Version: 15.0.0 (Монолитная версия, финальное исправление)
 * Author: Gemini AI
 *
 * Полностью переработанный, единый файл плагина для максимальной производительности и предсказуемости.
 * Включает в себя надежную обработку ошибок, улучшенный пользовательский интерфейс и прямую интеграцию API.
 * Без сокращений. Без компромиссов.
 *
 * CHANGE LOG v15.0.0:
 * - КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Полностью переписан механизм обработки настроек. Вместо нестабильного Lampa.Params.update
 * теперь используется прямое управление элементами и их событиями. Это решает проблему с невозможностью
 * ввода данных и некорректным отображением значений в меню настроек.
 */
(function () {
    'use strict';

    // ===========================================================================================
    // Глобальная защита от повторной инициализации
    // ===========================================================================================
    const PLUGIN_NAME = 'TorBoxPluginV15_Monolith';
    if (window[PLUGIN_NAME]) {
        console.log(`TorBox Plugin: ${PLUGIN_NAME} уже был запущен. Повторная инициализация отменена.`);
        return;
    }
    window[PLUGIN_NAME] = true;

    // ===========================================================================================
    // БЛОК 1: КОНФИГУРАЦИЯ И НАСТРОЙКИ (полностью переработан для интерактивности)
    // ===========================================================================================
    
    function addTorboxSettings() {
        // 1. Создаем и регистрируем HTML-шаблон для страницы настроек.
        const settingsTemplate = `
            <div>
                <div class="settings-param selector" data-name="torbox_api_key">
                    <div class="settings-param__name">API Ключ TorBox</div>
                    <div class="settings-param__value"></div>
                </div>
                <div class="settings-param selector" data-name="torbox_show_cached_only">
                    <div class="settings-param__name">Показывать только кэшированные</div>
                    <div class="settings-param__value"></div>
                </div>
                <div class="settings-param__descr" style="margin-top: 1em;">
                    API ключ можно получить в личном кабинете на сайте <a href="https://torbox.app/settings" target="_blank">torbox.app</a>
                </div>
            </div>`;
        
        Lampa.Template.add('settings_torbox', settingsTemplate);

        // 2. Создаем кнопку в главном меню настроек.
        const settingsButton = $(`
            <div class="settings-folder selector" data-component="torbox">
                <div class="settings-folder__icon">
                    <svg width="58" height="57" viewBox="0 0 58 57" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M20.9474 13.0001L20.9474 45.0001L28.1404 45.0001L28.1404 34.116L38.7018 26.9723L28.1404 19.8286L28.1404 24.3801C28.1404 21.585 30.3333 19.8253 32.7368 19.8253L40.0526 19.8253L40.0526 13.0001L28.1404 13.0001C24.7895 13.0001 20.9474 15.4845 20.9474 20.3725L20.9474 13.0001Z" fill="white"/>
                        <rect x="2" y="2" width="54" height="53" rx="5" stroke="white" stroke-width="4"/>
                    </svg>
                </div>
                <div class="settings-folder__name">TorBox</div>
                <div class="settings-folder__auth"></div>
            </div>`);

        // 3. Добавляем слушателя, который сработает при нажатии на нашу кнопку.
        Lampa.Settings.listener.follow('open', (e) => {
            if (e.name === 'torbox') {
                const body = e.body;
                body.html(Lampa.Template.get('settings_torbox'));

                // Находим элементы
                const apiKeyElement = body.find('[data-name="torbox_api_key"]');
                const cachedOnlyElement = body.find('[data-name="torbox_show_cached_only"]');

                // Вручную устанавливаем начальные значения
                apiKeyElement.find('.settings-param__value').text(Lampa.Storage.get('torbox_api_key', ''));
                cachedOnlyElement.find('.settings-param__value').text(Lampa.Storage.get('torbox_show_cached_only', 'false') === 'true' ? 'Да' : 'Нет');

                // Вручную привязываем обработчики событий
                apiKeyElement.on('hover:enter', () => {
                    Lampa.Input.edit({
                        value: Lampa.Storage.get('torbox_api_key', ''),
                        title: 'API Ключ TorBox',
                        free: true
                    }, (new_value) => {
                        Lampa.Storage.set('torbox_api_key', new_value.trim());
                        apiKeyElement.find('.settings-param__value').text(new_value.trim());
                        Lampa.Controller.toggle('settings_component');
                    });
                });

                cachedOnlyElement.on('hover:enter', () => {
                    Lampa.Select.show({
                        title: 'Показывать только кэшированные',
                        items: [
                            { title: 'Нет', value: 'false' },
                            { title: 'Да', value: 'true' }
                        ],
                        onSelect: (selected_item) => {
                            Lampa.Storage.set('torbox_show_cached_only', selected_item.value);
                            cachedOnlyElement.find('.settings-param__value').text(selected_item.title);
                            Lampa.Controller.toggle('settings_component');
                        },
                        onBack: () => {
                            Lampa.Controller.toggle('settings_component');
                        }
                    });
                });
            }
        });

        // 4. Внедряем кнопку в DOM
        const mainSettings = Lampa.Settings.main();
        if (mainSettings && mainSettings.render) {
            if (!mainSettings.render().find('[data-component="torbox"]').length) {
                mainSettings.render().find('[data-component="more"]').after(settingsButton);
                mainSettings.update();
            }
        }
    }


    // ===========================================================================================
    // БЛОК 2: API-ВРАППЕР (без изменений)
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
    // БЛОК 3: ОСНОВНАЯ ЛОГИКА ПЛАГИНА (без изменений)
    // ===========================================================================================

    function startPlugin() {
        // 1. Инициализация настроек
        addTorboxSettings();
        
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
