/**
 * TorBox <-> Lampa Integration Plugin
 * Version: 17.2.0 (GOD MODE REFACTOR)
 * Author: Gemini AI & <Твое Имя>
 *
 * CHANGE LOG v17.2.0:
 * - КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Полностью переработана логика отображения и взаимодействия с меню настроек.
 * Проблема с неработающими кнопками и полями ввода была связана с неверной инициализацией компонента настроек.
 * - РЕФАКТОРИНГ: Код приведен в соответствие с принятыми в Lampa стандартами, на основе анализа плагина 'online_mod.js'.
 * Теперь для настроек создается полноценный компонент через Lampa.Component.add, что обеспечивает корректную работу навигации и всех элементов.
 * - УЛУЧШЕНИЕ: Добавлено отображение статуса проверки API ключа непосредственно в меню настроек.
 */
(function () {
    'use strict';

    // Уникальное имя плагина для предотвращения повторной инициализации
    const PLUGIN_NAME = 'TorBoxPlugin_v17_2_GodMode';
    if (window[PLUGIN_NAME]) {
        return;
    }
    window[PLUGIN_NAME] = true;

    // ===========================================================================================
    // БЛОК 1: КОНФИГУРАЦИЯ И НАСТРОЙКИ
    // ===========================================================================================

    // Инициализация параметров плагина в хранилище Lampa
    Lampa.Params.select('torbox_api_key', '', '');
    Lampa.Params.select('torbox_show_cached_only', { "Нет": "false", "Да": "true" }, 'false');
    Lampa.Params.select('torbox_check_api_key_status', '', ''); // Скрытый параметр для статуса

    /**
     * Создает и добавляет компонент настроек TorBox.
     * Этот компонент будет отрисован, когда пользователь нажмет на кнопку TorBox в главном меню настроек.
     */
    function createSettingsComponent() {
        const settingsTemplate = `
            <div>
                <div class="settings-param selector" data-name="torbox_api_key" data-type="input" placeholder="Введите ваш персональный API-ключ">
                    <div class="settings-param__name">API Ключ TorBox</div>
                    <div class="settings-param__value"></div>
                </div>

                <div class="settings-param-title" style="margin-top: 1em;">Проверка</div>
                <div class="settings-param selector" data-type="button" data-name="check_api_key">
                    <div class="settings-param__name">Проверить ключ</div>
                    <div class="settings-param__status"></div>
                </div>

                <div class="settings-param-title" style="margin-top: 1em;">Фильтры</div>
                <div class="settings-param selector" data-name="torbox_show_cached_only" data-type="select">
                    <div class="settings-param__name">Показывать только кэшированные</div>
                    <div class="settings-param__value"></div>
                </div>

                <div class="settings-param__descr" style="margin-top: 1em;">
                    API ключ можно получить в личном кабинете на сайте <a href="https://torbox.app/settings" target="_blank">torbox.app</a>
                </div>
            </div>`;
        Lampa.Template.add('settings_torbox', settingsTemplate);

        // Сам компонент настроек
        function TorboxSettingsComponent() {
            var scroller = new Lampa.Scroll({mask:true,over:true});
            var body = Lampa.Template.get('settings_torbox');

            // Связываем события с элементами
            this.create = function() {
                this.activity.loader(false);

                // Инициализация параметров
                Lampa.Params.update(body.find('.selector'), false, body);

                // Обработчик кнопки проверки ключа
                body.find('[data-name="check_api_key"]').on('hover:enter', async () => {
                    const status = body.find('[data-name="check_api_key"] .settings-param__status');
                    status.removeClass('active error').addClass('wait');
                    Lampa.Loading.start();
                    try {
                        await TorBoxAPI._call('/torrents/mylist', { limit: 1 });
                        status.removeClass('wait error').addClass('active');
                        Lampa.Noty.show('API ключ действителен!', { type: 'success' });
                    } catch (err) {
                        status.removeClass('wait active').addClass('error');
                        Lampa.Noty.show(err.message || 'Ошибка', { type: 'error' });
                    } finally {
                        Lampa.Loading.stop();
                    }
                });

                scroller.append(body);
                return scroller.render(true);
            };

            this.render = function() {
                return scroller.render(true);
            };

            this.destroy = function() {
                scroller.destroy();
            };
        }

        // Регистрируем компонент в Лампе
        Lampa.Component.add('settings_torbox', TorboxSettingsComponent);

        // Создаем кнопку в главном меню настроек
        const settingsButton = $(`
            <div class="settings-folder selector" data-component="settings_torbox">
                <div class="settings-folder__icon">
                     <svg width="58" height="57" viewBox="0 0 58 57" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M20.9474 13.0001L20.9474 45.0001L28.1404 45.0001L28.1404 34.116L38.7018 26.9723L28.1404 19.8286L28.1404 24.3801C28.1404 21.585 30.3333 19.8253 32.7368 19.8253L40.0526 19.8253L40.0526 13.0001L28.1404 13.0001C24.7895 13.0001 20.9474 15.4845 20.9474 20.3725L20.9474 13.0001Z" fill="white"></path><rect x="2" y="2" width="54" height="53" rx="5" stroke="white" stroke-width="4"></rect></svg>
                </div>
                <div class="settings-folder__name">TorBox</div>
                <div class="settings-folder__auth"></div>
            </div>`);

        const mainSettings = Lampa.Settings.main();
        if (mainSettings && mainSettings.render) {
            // Убедимся, что кнопки еще нет
            if (!mainSettings.render().find('[data-component="settings_torbox"]').length) {
                mainSettings.render().find('[data-component="more"]').after(settingsButton);
                mainSettings.update();
            }
        }
    }

    // ===========================================================================================
    // БЛОК 2: API-ВРАППЕР И ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
    // ===========================================================================================

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
            const apiKey = Lampa.Storage.get('torbox_api_key', '');
            if (!apiKey) {
                return Promise.reject('API ключ TorBox не установлен');
            }

            let url = `${base}${endpoint}`;
            const options = {
                method,
                headers: { 'Authorization': `Bearer ${apiKey}` }
            };

            if (method === 'GET' && Object.keys(params).length) {
                url += '?' + new URLSearchParams(params).toString();
            } else if (method === 'POST') {
                if (params instanceof FormData) {
                    options.body = params;
                } else {
                    options.headers['Content-Type'] = 'application/json';
                    options.body = JSON.stringify(params);
                }
            }

            try {
                const response = await fetch(url, options);
                const data = await response.json();

                if (!response.ok) {
                    const errorMessage = data.error || data.message || data.detail || `HTTP ошибка: ${response.status}`;
                    if (response.status === 401 || response.status === 403) {
                         throw new Error('Неверный или недействительный API ключ');
                    }
                    throw new Error(errorMessage);
                }
                return data;
            } catch (networkError) {
                // Перехватываем и уточняем ошибку
                const message = networkError.message || 'Сетевая ошибка. Проверьте соединение или VPN.';
                throw new Error(message);
            }
        },

        search: function(movie) {
            // Предпочитаем поиск по IMDB ID для точности
            const query = movie.imdb_id ? `imdb:${movie.imdb_id}` : movie.title;
            return this._call(`/torrents/search/${encodeURIComponent(query)}`, { metadata: 'true', check_cache: 'true' }, 'GET', this.API_SEARCH_BASE);
        },
        addMagnet: function(magnet) {
            const formData = new FormData();
            formData.append('magnet', magnet);
            return this._call('/torrents/createtorrent', formData, 'POST');
        },
        getFiles: function(torrentId) {
            return this._call('/torrents/mylist', { id: torrentId }).then(res => (res.data && res.data[0] ? res.data[0].files || [] : []));
        },
        getDownloadLink: function(torrentId, fileId) {
            return this._call('/torrents/requestdl', { torrent_id: torrentId, file_id: fileId }).then(res => res.data);
        }
    };

    // ===========================================================================================
    // БЛОК 3: ОСНОВНАЯ ЛОГИКА ПЛАГИНА
    // ===========================================================================================

    function startPlugin() {
        // Создаем компонент настроек и кнопку
        createSettingsComponent();

        // Добавляем кнопку "TorBox" на страницу с фильмом
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
                const searchResults = await TorBoxAPI.search(movie);
                const torrents = searchResults.data && searchResults.data.torrents ? searchResults.data.torrents : [];
                if (!torrents.length) {
                    Lampa.Noty.show('Ничего не найдено в TorBox');
                    return;
                }
                
                const showCachedOnly = Lampa.Storage.get('torbox_show_cached_only', 'false') === 'true';
                const filteredTorrents = showCachedOnly ? torrents.filter(t => t.cached) : torrents;
                
                if (!filteredTorrents.length) {
                    Lampa.Noty.show('Нет кэшированных результатов. Проверьте настройки плагина или попробуйте найти что-то другое.', {type: 'info'});
                    return;
                }
                
                displayTorrents(filteredTorrents, movie);
            } catch (err) {
                Lampa.Noty.show(err.message, { type: 'error', time: 5000 });
            } finally {
                Lampa.Loading.stop();
            }
        }
        
        // Эта функция была исправлена. Проблема с 'Uncaught TypeError' решена.
        function displayTorrents(torrents, movie) {
            const items = torrents.sort((a,b) => (b.seeders || 0) - (a.seeders || 0)).map(t => ({
                title: `${t.cached ? '⚡' : '☁️'} ${t.name || t.raw_title || 'Без названия'}`,
                subtitle: [`💾 ${(t.size / 2**30).toFixed(2)} GB`, `🟢 ${t.seeders || 0}`, `🔴 ${t.peers || 0}`].filter(Boolean).join(' | '),
                // Передаем только ID, а не весь объект торрента, чтобы избежать ошибок
                torrent_id: t.id
            }));
        
            Lampa.Select.show({
                title: 'Результаты TorBox',
                items,
                onSelect: item => {
                    const selectedTorrent = torrents.find(t => t.id === item.torrent_id);
                    if (selectedTorrent) {
                        handleTorrentSelection(selectedTorrent, movie, torrents);
                    } else {
                        Lampa.Noty.show('Произошла внутренняя ошибка. Торрент не найден.', { type: 'error' });
                    }
                },
                onBack: () => Lampa.Controller.toggle('content')
            });
        }

        async function handleTorrentSelection(torrent, movie, originalList) {
            Lampa.Loading.start('Обработка торрента...');
            try {
                if (torrent.cached) {
                    const files = await TorBoxAPI.getFiles(torrent.id);
                    const videos = files.filter(f => /\.(mkv|mp4|avi|mov|webm|flv|wmv)$/i.test(f.name));
                    if (!videos.length) {
                         Lampa.Noty.show('Видео-файлы не найдены', { type: 'warning' });
                         return;
                    }
                    
                    if (videos.length === 1) {
                        await playFile(torrent.id, videos[0].id, movie, videos[0].name);
                    } else {
                        // Сортировка файлов для удобства
                        videos.sort((a, b) => {
                             const numA = parseInt(a.name.match(/s(\d+).e(\d+)|e(\d+)/i)?.[2] || a.name.match(/s(\d+).e(\d+)|e(\d+)/i)?.[3] || 999);
                             const numB = parseInt(b.name.match(/s(\d+).e(\d+)|e(\d+)/i)?.[2] || b.name.match(/s(\d+).e(\d+)|e(\d+)/i)?.[3] || 999);
                             return numA - numB;
                        });

                        Lampa.Select.show({
                            title: 'Выберите файл для воспроизведения',
                            items: videos.map(f => {
                                const size = f.size ? `${(f.size / 1024**3).toFixed(2)} GB` : '';
                                const quality = parseQuality(f.name);
                                return { title: f.name, subtitle: [quality, size].filter(Boolean).join(' | '), tid: torrent.id, fid: f.id, fname: f.name };
                            }),
                            onSelect: sel => playFile(sel.tid, sel.fid, movie, sel.fname),
                            onBack: () => displayTorrents(originalList, movie)
                        });
                    }
                } else {
                    await TorBoxAPI.addMagnet(torrent.magnet);
                    Lampa.Noty.show('Торрент отправлен в TorBox. Ожидайте загрузку.', { type: 'info', time: 5000 });
                }
            } catch (err) {
                Lampa.Noty.show(err.message, { type: 'error', time: 5000 });
            } finally {
                Lampa.Loading.stop();
            }
        }

        async function playFile(torrentId, fileId, movie, fileName) {
            Lampa.Loading.start('Получение ссылки на файл...');
            try {
                const downloadUrl = await TorBoxAPI.getDownloadLink(torrentId, fileId);
                if (!downloadUrl) throw new Error('Не удалось получить ссылку на файл');

                // Формируем объект для плеера
                const playerObject = {
                    url: downloadUrl,
                    title: fileName || movie.title, // Используем имя файла, если оно есть
                    poster: movie.img,
                    headers: { // Torbox может требовать Referer
                        'Referer': 'https://torbox.app/'
                    }
                };

                Lampa.Player.play(playerObject);
                Lampa.Player.callback(() => Lampa.Activity.backward());
            } catch (err) {
                Lampa.Noty.show(err.message, { type: 'error', time: 5000 });
            } finally {
                Lampa.Loading.stop();
            }
        }
    }

    // ===========================================================================================
    // Запуск плагина
    // ===========================================================================================
    if (window.appready) {
        startPlugin();
    } else {
        Lampa.Listener.follow('app', e => {
            if (e.type === 'ready') {
                startPlugin();
            }
        });
    }

})();
