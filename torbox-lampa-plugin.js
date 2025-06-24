/**
 * TorBox <-> Lampa integration plugin
 * Version 10.0.0 - Fixed controller rendering logic for settings.
 *
 * Author: Gemini AI, corrected based on user feedback.
 */
;(function () {
    'use strict';

    //--- Глобальная защита от повторной инициализации ---
    const PLUGIN_NAME = 'TorBoxPluginV10';
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
                return Promise.reject('API ключ TorBox не установлен');
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
             const torrentData = Array.isArray(response.data) ? response.data.find(t => t.id == torrentId) : null;
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
                if (!torrents || torrents.length === 0) {
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
                    const videoFiles = files.filter(f => /\.(mkv|mp4|avi|mov|webm)$/i.test(f.name));

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
                            })).sort((a, b) => a.title.localeCompare(b.title)),
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
    
    function showSettings() {
        var component = Lampa.Component.create({
            template: `
                <div class="settings-content">
                    <div class="settings-content__body"></div>
                    <div class="settings-content__template">
                        <div class="settings-param selector" data-name="{name}">
                            <div class="settings-param__name">{label}</div>
                            <div class="settings-param__value"></div>
                        </div>
                    </div>
                </div>`,
            name: 'torbox_settings_page',
            onRender: function() {
                let field_api = Lampa.Template.get('settings_input', {
                    name: S.API_KEY,
                    label: 'API Ключ TorBox',
                    placeholder: 'Введите ваш API ключ',
                    value: Lampa.Storage.get(S.API_KEY, '')
                });
                field_api.find('input').on('change', function () {
                    Lampa.Storage.set(S.API_KEY, $(this).val());
                });
                this.find('.settings-content__body').append(field_api);

                let field_cached = Lampa.Template.get('settings_select', {
                    name: S.CACHED_ONLY,
                    label: 'Показывать только кэшированные',
                    value: Lampa.Storage.get(S.CACHED_ONLY, 'false'),
                    options: [
                        {title: 'Нет', value: 'false'},
                        {title: 'Да', value: 'true'}
                    ]
                });
                field_cached.find('select').on('change', function () {
                    Lampa.Storage.set(S.CACHED_ONLY, $(this).val());
                });
                this.find('.settings-content__body').append(field_cached);
            }
        });

        Lampa.Controller.add('torbox_settings_activity', {
            title: 'Настройки TorBox',
            component: component,
            toggle: function() {
                // ИСПРАВЛЕНИЕ: Используем this.component.render()
                Lampa.Controller.collectionSet(this.component.render());
                Lampa.Controller.collectionFocus(false, this.component.render());
            },
            back: function() {
                Lampa.Controller.toggle('settings');
            }
        });
        Lampa.Controller.toggle('torbox_settings_activity');
    }

    function init() {
        function addSettingsButton() {
            if (Lampa.Settings.main && !Lampa.Settings.main().render().find('[data-component="torbox_settings"]').length) {
                var button_html = `
                    <div class="settings-folder selector" data-component="torbox_settings" data-static="true">
                        <div class="settings-folder__icon">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="white" stroke-width="2" stroke-linejoin="round"/><path d="M2 17L12 22L22 17" stroke="white" stroke-width="2" stroke-linejoin="round"/><path d="M2 12L12 17L22 12" stroke="white" stroke-width="2" stroke-linejoin="round"/></svg>
                        </div>
                        <div class="settings-folder__name">TorBox</div>
                    </div>`;
                
                Lampa.Settings.main().render().find('[data-component="more"]').after(button_html);
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
        
        Lampa.Settings.listener.follow('open', function(e) {
            if (e.name == 'main') {
                e.body.find('[data-component="torbox_settings"]').on('hover:enter', function() {
                    showSettings();
                });
            }
        });

        addSettingsButton();
        addTorboxButton();
        
        console.log(`%c${PLUGIN_NAME} v10.0.0`, 'color: #2E7D32; font-weight: bold;', '– плагин успешно загружен.');
    }

    if(window.appready) init();
    else Lampa.Listener.follow('app', (e) => {
        if(e.type == 'ready') init();
    });

})();
