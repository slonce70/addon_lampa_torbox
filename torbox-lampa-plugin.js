/**
 * TorBox <-> Lampa integration plugin
 * Version 7.0.0 - Settings API fix and improved structure
 *
 * Author: Gemini AI, based on user feedback and examples
 */
(function () {
    'use strict';

    //--- Глобальная защита от повторной инициализации ---
    const PLUGIN_NAME = 'TorBoxPluginV7';
    if (window[PLUGIN_NAME]) return;
    window[PLUGIN_NAME] = true;

    //--- Константы ---
    const S = {
        API_KEY: 'torbox_api_key',
        CACHED_ONLY: 'torbox_show_cached_only'
    };
    const API_BASE = 'https://api.torbox.app/v1/api';
    const API_SEARCH_BASE = 'https://search-api.torbox.app';

    //--- API-клиент для TorBox ---
    const TorBoxAPI = {
        async call(endpoint, params = {}, method = 'GET', base = API_BASE) {
            const apiKey = Lampa.Storage.get(S.API_KEY, '');
            if (!apiKey) {
                Lampa.Noty.show('Необходимо указать API ключ TorBox в настройках Lampa', { type: 'error' });
                return Promise.reject('API ключ не установлен');
            }

            let url = `${base}${endpoint}`;
            const options = {
                method: method,
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            };

            if (method === 'GET' && Object.keys(params).length > 0) {
                url += '?' + new URLSearchParams(params).toString();
            } else if (method === 'POST') {
                options.body = JSON.stringify(params);
            }
            
            try {
                const response = await fetch(url, options);
                const data = await response.json();

                if (!response.ok || data.success === false) {
                    throw new Error(data.error || data.detail || `Ошибка API TorBox (статус: ${response.status})`);
                }
                return data;
            } catch (error) {
                 throw new Error(`Сетевая ошибка или ошибка API: ${error.message}`);
            }
        },

        async search(movie) {
            const query = movie.imdb_id ? `imdb:${movie.imdb_id}` : movie.title;
            const params = {
                metadata: 'true',
                check_cache: 'true',
            };
            const endpoint = `/torrents/search/${encodeURIComponent(query)}`;
            const response = await this.call(endpoint, params, 'GET', API_SEARCH_BASE);
            return response.data?.torrents || [];
        },

        async add(magnet) {
            return await this.call('/torrents/createtorrent', { magnet }, 'POST');
        },

        async files(torrentId) {
             const response = await this.call(`/torrents/mylist?id=${torrentId}`);
             const torrentData = response.data.find(t => t.id == torrentId);
             return torrentData ? torrentData.files : [];
        },

        async getDownloadLink(torrentId, fileId) {
            const params = { torrent_id: torrentId, file_id: fileId };
            const response = await this.call('/torrents/requestdl', params, 'GET');
            return response.data;
        }
    };

    //--- Основной компонент плагина ---
    const TorBoxComponent = {
        async searchAndShow(movie) {
            const apiKey = Lampa.Storage.get(S.API_KEY, '');
            if (!apiKey) {
                Lampa.Noty.show('API-ключ TorBox не настроен. Пожалуйста, укажите его в Настройки -> Плагины -> TorBox.', { type: 'warning', time: 5000 });
                return;
            }

            Lampa.Loading.start();
            try {
                const torrents = await TorBoxAPI.search(movie);
                if (!torrents.length) {
                    Lampa.Noty.show('Торренты не найдены в TorBox', { type: 'info' });
                    return;
                }
                this.displayResults(torrents, movie);
            } catch (error) {
                Lampa.Noty.show(error.message, { type: 'error' });
            } finally {
                Lampa.Loading.stop();
            }
        },

        displayResults(torrents, movie) {
            const cachedOnly = Lampa.Storage.get(S.CACHED_ONLY, 'false') === 'true';
            
            const items = torrents
                .filter(t => cachedOnly ? t.cached : true)
                .map(t => ({
                    title: t.name || t.raw_title,
                    subtitle: `${t.cached ? '⚡ Кэш' : '☁️ Не кэш'} | 💿 ${(t.size / 1024**3).toFixed(2)} GB | 🟢 ${t.seeders || 0}`,
                    torrent: t
                }))
                .sort((a,b) => (b.torrent.seeders || 0) - (a.torrent.seeders || 0));

            Lampa.Select.show({
                title: 'TorBox',
                items: items,
                onSelect: (item) => {
                    this.handleTorrentSelection(item.torrent, movie);
                },
                onBack: () => {
                    Lampa.Controller.toggle('content');
                }
            });
        },

        async handleTorrentSelection(torrent, movie) {
            Lampa.Loading.start();
            try {
                if (torrent.cached) {
                    const files = await TorBoxAPI.files(torrent.id);
                    const videoFiles = files.filter(f => /\.(mkv|mp4|avi|mov)$/i.test(f.name));

                    if (videoFiles.length === 0) {
                        Lampa.Noty.show('Видеофайлы не найдены в торренте', {type: 'warning'});
                        return;
                    }

                    if (videoFiles.length === 1) {
                        await this.playFile(torrent.id, videoFiles[0].id, movie);
                    } else {
                        Lampa.Select.show({
                            title: 'Выберите файл для воспроизведения',
                            items: videoFiles.map(f => ({
                                title: f.name,
                                subtitle: `${(f.size / 1024**3).toFixed(2)} GB`,
                                torrent_id: torrent.id,
                                file_id: f.id,
                                movie: movie
                            })).sort((a, b) => b.title.localeCompare(a.title)),
                            onSelect: (selectedFile) => {
                                this.playFile(selectedFile.torrent_id, selectedFile.file_id, selectedFile.movie);
                            },
                            onBack: () => Lampa.Controller.toggle('content')
                        });
                    }
                } else {
                    await TorBoxAPI.add(torrent.magnet);
                    Lampa.Noty.show('Торрент добавлен в TorBox для скачивания.', { type: 'success', time: 5000 });
                }
            } catch(error) {
                Lampa.Noty.show(error.message, {type: 'error'});
            } finally {
                Lampa.Loading.stop();
            }
        },

        async playFile(torrentId, fileId, movie) {
            Lampa.Loading.start();
            try {
                const url = await TorBoxAPI.getDownloadLink(torrentId, fileId);
                const playerConfig = {
                    url: url,
                    title: movie.title,
                    poster: movie.img
                };
                Lampa.Player.play(playerConfig);
                Lampa.Player.callback(()=>{
                     Lampa.Activity.backward();
                });
            } catch(error) {
                Lampa.Noty.show(error.message, {type: 'error'});
            } finally {
                Lampa.Loading.stop();
            }
        }
    };

    /**
     * Создает страницу настроек плагина
     */
    function buildSettingsPage() {
        var comp = Lampa.Settings.create({
            title: 'TorBox',
            component: 'torbox_settings_page',
            onBack: ()=>{ Lampa.Controller.toggle('settings_component'); }
        });

        comp.onRender = function(html){
            let field_api = Lampa.Settings.p({
                name: S.API_KEY,
                placeholder: 'Введите ваш API ключ',
                type: 'text',
                label: 'API Ключ TorBox'
            });
            html.append(field_api);

            let field_cached = Lampa.Settings.p({
                name: S.CACHED_ONLY,
                type: 'select',
                values: {
                    'true': 'Да',
                    'false': 'Нет'
                },
                label: 'Показывать только кэшированные'
            });
            html.append(field_cached);
        }
        
        Lampa.Controller.add('torbox_settings_page', comp);
        Lampa.Controller.toggle('torbox_settings_page');
    }

    //--- Инициализация плагина ---
    function init() {
        function addSettingsButton() {
            // Проверка, что компонент не был добавлен ранее
            if (Lampa.Settings.main && !Lampa.Settings.main().render().find('[data-component="torbox_settings"]').length) {
                // HTML-код для кнопки настроек, как в store.js
                var button_html = `
                    <div class="settings-folder selector" data-component="torbox_settings" data-static="true">
                        <div class="settings-folder__icon">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="white" stroke-width="2" stroke-linejoin="round"/><path d="M2 17L12 22L22 17" stroke="white" stroke-width="2" stroke-linejoin="round"/><path d="M2 12L12 17L22 12" stroke="white" stroke-width="2" stroke-linejoin="round"/></svg>
                        </div>
                        <div class="settings-folder__name">TorBox</div>
                    </div>`;
                
                // Вставляем кнопку после элемента "Остальное"
                Lampa.Settings.main().render().find('[data-component="more"]').after(button_html);
                
                // Обновляем отображение меню настроек
                Lampa.Settings.main().update();
            }
        }
        
        function addTorboxButton() {
            Lampa.Listener.follow('full', (e) => {
                if (e.type === 'complite' && !e.object.activity.render().find('.view--torbox').length) {
                    let movie = e.data.movie;
                    let button = $(`
                        <div class="full-start__button selector view--torbox" data-subtitle="Поиск в TorBox">
                           <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
                            <span>TorBox</span>
                        </div>`);

                    button.on('hover:enter', () => TorBoxComponent.searchAndShow(movie));
                    e.object.activity.render().find('.view--torrent, .view--online').first().after(button);
                }
            });
        }
        
        // Добавляем обработчик для открытия нашего окна настроек
        Lampa.Settings.listener.follow('open', function(e) {
            if (e.name == 'main') {
                // Навешиваем событие на нашу кнопку
                e.body.find('[data-component="torbox_settings"]').on('hover:enter', function() {
                    buildSettingsPage();
                });
            }
        });

        addSettingsButton();
        addTorboxButton();
        
        console.log(`%c${PLUGIN_NAME} v7.0.0`, 'color: #2E7D32; font-weight: bold;', '– плагин успешно загружен.');
    }

    //--- Запуск ---
    if(window.appready) init();
    else Lampa.Listener.follow('app', (e) => {
        if(e.type == 'ready') init();
    });

})();
