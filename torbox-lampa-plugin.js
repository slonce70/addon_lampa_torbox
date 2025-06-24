/**
 * TorBox <-> Lampa integration plugin
 * Version 6.0.0 - Refactored for modern Lampa API and robustness
 *
 * Author: Gemini AI, based on analysis of user-provided code
 */
(function () {
    'use strict';

    //--- Глобальная защита от повторной инициализации ---
    const PLUGIN_NAME = 'TorBoxPlugin';
    if (window[PLUGIN_NAME]) return;
    window[PLUGIN_NAME] = true;

    //--- Константы ---
    const S = {
        API_KEY: 'torbox_api_key',
        CACHED_ONLY: 'torbox_show_cached_only'
    };
    const API_BASE = 'https://api.torbox.app/v1/api'; //
    const API_SEARCH_BASE = 'https://search-api.torbox.app'; //

    //--- API-клиент для TorBox ---
    const TorBoxAPI = {
        /**
         * Основной метод для вызова API
         * @param {string} endpoint - эндпоинт API
         * @param {object} params - параметры
         * @param {string} method - HTTP метод
         * @param {string} base - базовый URL
         * @returns {Promise<any>}
         */
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
                    'Authorization': `Bearer ${apiKey}`, //
                    'Content-Type': 'application/json'
                }
            };

            if (method === 'GET' && Object.keys(params).length > 0) {
                url += '?' + new URLSearchParams(params).toString();
            } else if (method === 'POST') {
                options.body = JSON.stringify(params);
            }
            
            const response = await fetch(url, options);
            const data = await response.json();

            if (!response.ok || data.success === false) {
                throw new Error(data.error || data.detail || 'Ошибка API TorBox');
            }
            return data;
        },

        /**
         * Поиск торрентов
         * @param {object} movie - объект фильма из Lampa
         * @returns {Promise<Array>}
         */
        async search(movie) {
            const query = movie.imdb_id ? `imdb:${movie.imdb_id}` : movie.title; //
            const params = {
                metadata: true,
                check_cache: true,
            };
            const endpoint = `/torrents/search/${encodeURIComponent(query)}`; //
            const response = await this.call(endpoint, params, 'GET', API_SEARCH_BASE);
            return response.data?.torrents || [];
        },

        /**
         * Добавление торрента в аккаунт
         * @param {string} magnet - Magnet-ссылка
         * @returns {Promise<any>}
         */
        async add(magnet) {
            return await this.call('/torrents/createtorrent', { magnet }, 'POST'); //
        },

        /**
         * Получение списка файлов торрента
         * @param {string} torrentId
         * @returns {Promise<Array>}
         */
        async files(torrentId) {
             const response = await this.call(`/torrents/mylist?id=${torrentId}`);
             const torrentData = response.data.find(t => t.id == torrentId);
             return torrentData ? torrentData.files : [];
        },

        /**
         * Запрос ссылки на скачивание
         * @param {string} torrentId
         * @param {string} fileId
         * @returns {Promise<string>}
         */
        async getDownloadLink(torrentId, fileId) {
            const params = { torrent_id: torrentId, file_id: fileId };
            const response = await this.call('/torrents/requestdl', params, 'GET'); //
            return response.data;
        }
    };

    //--- Основной компонент плагина ---
    const TorBoxComponent = {
        async searchAndShow(movie) {
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
                    subtitle: `⚡${t.cached ? 'Кэш' : 'Нет'} | 💿 ${(t.size / 1024**3).toFixed(2)} GB | 🟢 ${t.seeders || 0}`,
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
                        this.playFile(torrent.id, videoFiles[0].id, movie);
                    } else {
                        // Показываем выбор файла
                        Lampa.Select.show({
                            title: 'Выберите файл для воспроизведения',
                            items: videoFiles.map(f => ({
                                title: f.name,
                                subtitle: `${(f.size / 1024**3).toFixed(2)} GB`,
                                torrent_id: torrent.id,
                                file_id: f.id,
                                movie: movie
                            })),
                            onSelect: (selectedFile) => {
                                this.playFile(selectedFile.torrent_id, selectedFile.file_id, selectedFile.movie);
                            },
                            onBack: () => Lampa.Controller.toggle('content')
                        });
                    }
                } else {
                    await TorBoxAPI.add(torrent.magnet);
                    Lampa.Noty.show('Торрент добавлен в TorBox для скачивания.', { type: 'success' });
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
                Lampa.Player.play({
                    url: url,
                    title: movie.title,
                    poster: movie.img
                });
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

    //--- Инициализация плагина ---
    function init() {
        /**
         * Добавляет кнопку на страницу фильма
         */
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
                    e.object.activity.render().find('.view--torrent').after(button);
                }
            });
        }

        /**
         * Добавляет раздел настроек
         */
        function addSettings() {
            var comp = Lampa.Settings.create({
                title: 'TorBox',
                component: 'torbox_settings',
                icon: '&#9883;',
                onBack: ()=>{ Lampa.Controller.toggle('settings_component') }
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
            
            Lampa.Settings.main().add(comp);
        }

        addTorboxButton();
        addSettings();
        
        console.log(`%c${PLUGIN_NAME} v6.0.0`, 'color: #2E7D32; font-weight: bold;', '– плагин успешно загружен.');
    }

    //--- Запуск ---
    if(window.appready) init();
    else Lampa.Listener.follow('app', (e) => {
        if(e.type == 'ready') init();
    });

})();
