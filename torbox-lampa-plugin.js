/**
 * TorBox <> Lampa Integration Plugin
 * Version: 18.0.0 (GOD MODE API REFACTOR)
 * Author: Gemini AI & <Твое Имя>
 *
 * CHANGE LOG v18.0.0:
 * - КРИТИЧЕСКАЯ ПЕРЕРАБОТКА: Логика настроек полностью переписана с использованием официального Lampa.SettingsApi.
 * Это устраняет все предыдущие проблемы с неработающим меню, шаблонами и взаимодействием.
 * - УЛУЧШЕНИЕ UX: Удалена кнопка "Проверить ключ". Проверка API-ключа теперь происходит автоматически
 * при изменении его значения в поле ввода. Статус проверки отображается под полем.
 * - СТРУКТУРА: Код инициализации плагина обернут в надежный "ожидатор" Lampa, что предотвращает ошибки,
 * если плагин загружается раньше ядра приложения.
 * - ЧИСТОТА: Удален весь устаревший код, связанный с ручной манипуляцией DOM и слушателями 'open'.
 */
(function () {
    'use strict';

    const PLUGIN_ID = 'torbox_plugin_god_mode_v18';
    const COMPONENT_ID = 'torbox_settings_component'; // Уникальный ID для компонента настроек
    const MAX_WAIT = 15000; // 15 секунд на ожидание Lampa
    const WAIT_STEP = 500;

    if (window[PLUGIN_ID]) {
        console.log(`[${PLUGIN_ID}] -> Плагин уже инициализирован. Отмена.`);
        return;
    }
    window[PLUGIN_ID] = true;

    /** Логер с поддержкой debug-режима */
    function logger(...args) {
        if (localStorage.getItem('torbox_debug') === 'true') {
            console.log(`[TorBox]`, ...args);
        }
    }

    /** Проверка статуса API ключа и обновление интерфейса */
    async function checkApiKey(newKey) {
        const statusDiv = document.querySelector('.torbox-api-status');
        if (statusDiv) {
            statusDiv.textContent = 'Проверка...';
            statusDiv.style.color = 'inherit';
        }

        if (!newKey) {
            if (statusDiv) statusDiv.textContent = 'API ключ не введен.';
            return;
        }

        try {
            await TorBoxAPI._call_check(newKey, '/torrents/mylist', { limit: 1 });
            if (statusDiv) {
                statusDiv.textContent = 'Ключ действителен.';
                statusDiv.style.color = 'green';
            }
            Lampa.Noty.show('Ключ TorBox действителен', { type: 'success' });
        } catch (err) {
            if (statusDiv) {
                statusDiv.textContent = `Ошибка: ${err.message}`;
                statusDiv.style.color = 'red';
            }
            Lampa.Noty.show(err.message, { type: 'error' });
        }
    }

    /** Создание меню настроек через Lampa.SettingsApi */
    function buildSettings() {
        Lampa.SettingsApi.addComponent({
            component: COMPONENT_ID,
            name: 'TorBox',
            icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 7L12 2L21 7V17L12 22L3 17V7Z" stroke="currentColor" stroke-width="2" /><path d="M12 22V12" stroke="currentColor" stroke-width="2" /><path d="M21 7L12 12L3 7" stroke="currentColor" stroke-width="2" /></svg>`
        });

        // Поле для ввода API-ключа
        Lampa.SettingsApi.addParam({
            component: COMPONENT_ID,
            param: {
                name: 'torbox_api_key',
                type: 'input',
                default: localStorage.getItem('torbox_api_key') || '',
            },
            field: {
                name: 'API Ключ TorBox',
                description: 'Ключ можно получить в личном кабинете на сайте torbox.app'
            },
            onChange: (value) => {
                const trimmedValue = (value || '').trim();
                localStorage.setItem('torbox_api_key', trimmedValue);
                // Запускаем проверку ключа после того, как пользователь закончил ввод
                checkApiKey(trimmedValue);
            },
            onRender: (renderedEl) => {
                // Добавляем div для отображения статуса проверки
                const statusDiv = document.createElement('div');
                statusDiv.className = 'settings-param__descr torbox-api-status';
                renderedEl.querySelector('.settings-param__value').after(statusDiv);
                // Проверяем ключ при первоначальной отрисовке
                checkApiKey(localStorage.getItem('torbox_api_key') || '');
            }
        });
        
        // Переключатель "Показывать только кэшированные"
        Lampa.SettingsApi.addParam({
            component: COMPONENT_ID,
            param: {
                name: 'torbox_show_cached_only',
                type: 'select',
                values: { 'false': 'Нет', 'true': 'Да' },
                default: localStorage.getItem('torbox_show_cached_only') || 'false',
            },
            field: {
                name: 'Показывать только кэшированные',
                description: 'Будут показаны только те торренты, которые уже загружены в облако TorBox.'
            },
            onChange: (value) => {
                localStorage.setItem('torbox_show_cached_only', value);
            }
        });

        // Переключатель для Debug-режима
        Lampa.SettingsApi.addParam({
            component: COMPONENT_ID,
            param: {
                name: 'torbox_debug',
                type: 'trigger',
                default: localStorage.getItem('torbox_debug') === 'true',
            },
            field: {
                name: 'Debug-режим',
                description: 'Включает вывод подробной информации в консоль браузера для отладки.'
            },
            onChange: (value) => {
                localStorage.setItem('torbox_debug', value);
            }
        });
    }

    // ===========================================================================================
    // API-ВРАППЕР И ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
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
            const apiKey = localStorage.getItem('torbox_api_key') || '';
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
                const message = networkError.message || 'Сетевая ошибка. Проверьте соединение или VPN.';
                throw new Error(message);
            }
        },

        search: function(movie) {
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
    // ОСНОВНАЯ ЛОГИКА ПЛАГИНА
    // ===========================================================================================
    function startPlugin() {
        logger('Плагин запущен');
        buildSettings();

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
                logger('Результаты поиска:', searchResults);
                const torrents = searchResults.data && searchResults.data.torrents ? searchResults.data.torrents : [];
                if (!torrents.length) {
                    Lampa.Noty.show('Ничего не найдено в TorBox');
                    return;
                }
                
                const showCachedOnly = localStorage.getItem('torbox_show_cached_only') === 'true';
                const filteredTorrents = showCachedOnly ? torrents.filter(t => t.cached) : torrents;
                
                if (!filteredTorrents.length) {
                    Lampa.Noty.show('Нет кэшированных результатов. Проверьте настройки плагина.', {type: 'info'});
                    return;
                }
                
                displayTorrents(filteredTorrents, movie);
            } catch (err) {
                Lampa.Noty.show(err.message, { type: 'error', time: 5000 });
            } finally {
                Lampa.Loading.stop();
            }
        }
        
        function displayTorrents(torrents, movie) {
            const items = torrents.sort((a,b) => (b.seeders || 0) - (a.seeders || 0)).map(t => ({
                title: `${t.cached ? '⚡' : '☁️'} ${t.name || t.raw_title || 'Без названия'}`,
                subtitle: [`💾 ${(t.size / 2**30).toFixed(2)} GB`, `🟢 ${t.seeders || 0}`, `🔴 ${t.peers || 0}`].filter(Boolean).join(' | '),
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

                const playerObject = {
                    url: downloadUrl,
                    title: fileName || movie.title,
                    poster: movie.img,
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
    // Инициализация плагина
    // ===========================================================================================
    (function waitForLampa() {
        let waited = 0;
        const loop = setInterval(() => {
            if (window.Lampa && window.Lampa.SettingsApi) {
                clearInterval(loop);
                startPlugin();
            } else {
                waited += WAIT_STEP;
                if (waited >= MAX_WAIT) {
                    clearInterval(loop);
                    console.error(`[${PLUGIN_ID}] -> Lampa.SettingsApi не найдено после ${MAX_WAIT / 1000} сек. `);
                }
            }
        }, WAIT_STEP);
    })();

})();
