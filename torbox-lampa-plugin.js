/**
 * TorBox <-> Lampa Integration Plugin
 * Version: 20.0.0 (HACKER MODE REBUILD V2)
 * Author: Gemini AI & Your Name
 *
 * CHANGE LOG v20.0.0:
 * - CRITICAL FIX: The entire settings logic has been completely rebuilt using a legacy-compatible, direct-injection method based on the user-provided working 'torbox_enhanced_secure_24' script.
 * - REMOVED: All previous settings implementations (SettingsApi, component listeners) have been purged.
 * - IMPLEMENTED: The plugin now directly appends its settings as a new folder into the main settings list. This bypasses the Lampa component/navigation system and resolves the "template not found" and "cannot read properties" errors.
 * - REWORKED: All interactive elements (inputs, buttons, selects) are now manually controlled via jQuery, ensuring they are active and responsive.
 */
(function () {
    'use strict';

    const PLUGIN_ID = 'torbox_plugin_hacker_mode_v20';
    if (window[PLUGIN_ID]) {
        console.log(`[${PLUGIN_ID}] -> Plugin already initialized. Aborting.`);
        return;
    }
    window[PLUGIN_ID] = true;

    // --- Configuration and Helpers ---

    function logger(...args) {
        if (localStorage.getItem('torbox_debug') === 'true') {
            console.log(`[TorBox]`, ...args);
        }
    }

    /**
     * Creates and injects the settings block directly into the main settings page.
     * This method is based on a working example and avoids Lampa's component navigation system.
     */
    function buildSettings() {
        // Wait for settings page to be ready
        function checkSettingsReady() {
            // Try multiple selectors for different Lampa versions
            let settingsList = $('.settings .settings-list');
            if (settingsList.length === 0) {
                settingsList = $('.settings-content .settings-list');
            }
            if (settingsList.length === 0) {
                settingsList = $('[data-name="settings"] .settings-list');
            }
            if (settingsList.length === 0) {
                settingsList = $('.settings-list');
            }
            
            if (settingsList.length === 0) {
                setTimeout(checkSettingsReady, 100);
                return;
            }
            
            // Check if already added
            if (settingsList.find('.torbox-settings-folder').length > 0) {
                return;
            }
            
            createSettingsFolder(settingsList);
        }
        
        checkSettingsReady();
    }
    
    function createSettingsFolder(settingsList) {
        const folder = $(
            `<div class="settings-folder torbox-settings-folder">
                <div class="settings-folder__title">TorBox</div>
                <div class="settings-folder__body"></div>
            </div>`
        );

        const body = folder.find('.settings-folder__body');

        // 1. API Key Input
        const apiKeyRow = $(`<div class="settings-param selector">
            <div class="settings-param__name">API Ключ</div>
            <div class="settings-param__value">${localStorage.getItem('torbox_api_key') || 'Не указан'}</div>
        </div>`);
        
        apiKeyRow.on('hover:enter', function() {
            Lampa.Input.edit({
                title: 'API Ключ TorBox',
                value: localStorage.getItem('torbox_api_key') || '',
                free: true,
                nosave: true
            }, function(newVal) {
                const trimmed = (newVal || '').trim();
                localStorage.setItem('torbox_api_key', trimmed);
                apiKeyRow.find('.settings-param__value').text(trimmed || 'Не указан');
                Lampa.Controller.toggle('settings');
            });
        });
        body.append(apiKeyRow);

        // 2. Check Key Button
        const checkBtnRow = $(`<div class="settings-param selector">
            <div class="settings-param__name">Проверить ключ</div>
            <div class="settings-param__status"></div>
        </div>`);
        
        checkBtnRow.on('hover:enter', function() {
            const status = checkBtnRow.find('.settings-param__status');
            const key = localStorage.getItem('torbox_api_key') || '';
            if (!key) {
                Lampa.Noty.show('Сначала введите API ключ', {type: 'warning'});
                return;
            }
            
            status.removeClass('active error').addClass('wait');
            
            TorBoxAPI._call_check(key, '/torrents/mylist', { limit: 1 })
                .then(function() {
                    status.removeClass('wait error').addClass('active');
                    Lampa.Noty.show('Ключ действителен', {type: 'success'});
                })
                .catch(function(err) {
                    status.removeClass('wait active').addClass('error');
                    Lampa.Noty.show(err.message, {type: 'error'});
                });
        });
        body.append(checkBtnRow);
        
        // 3. Cached Only Select
        const cachedValues = { 'false': 'Нет', 'true': 'Да' };
        const cachedSelectRow = $(`<div class="settings-param selector">
            <div class="settings-param__name">Только кэшированные</div>
            <div class="settings-param__value">${cachedValues[localStorage.getItem('torbox_show_cached_only') || 'false']}</div>
        </div>`);
        
        cachedSelectRow.on('hover:enter', function() {
            const currentCached = localStorage.getItem('torbox_show_cached_only') || 'false';
            Lampa.Select.show({
                title: 'Показывать только кэшированные',
                items: Object.keys(cachedValues).map(function(key) { 
                    return { title: cachedValues[key], value: key }; 
                }),
                current: Object.keys(cachedValues).findIndex(function(k) { return k === currentCached; }),
                onSelect: function(item) {
                    localStorage.setItem('torbox_show_cached_only', item.value);
                    cachedSelectRow.find('.settings-param__value').text(item.title);
                    Lampa.Controller.toggle('settings');
                },
                onBack: function() { 
                    Lampa.Controller.toggle('settings'); 
                }
            });
        });
        body.append(cachedSelectRow);

        // 4. Debug Mode Toggle
        const debugToggleRow = $(`<div class="settings-param selector">
            <div class="settings-param__name">Debug-режим</div>
            <div class="settings-param__value"></div>
        </div>`);
        
        try {
            Lampa.Settings.switch(debugToggleRow, 'torbox_debug');
        } catch (e) {
            // Fallback if Lampa.Settings.switch is not available
            const isDebug = localStorage.getItem('torbox_debug') === 'true';
            debugToggleRow.find('.settings-param__value').text(isDebug ? 'Включен' : 'Выключен');
            debugToggleRow.on('hover:enter', function() {
                const current = localStorage.getItem('torbox_debug') === 'true';
                const newValue = !current;
                localStorage.setItem('torbox_debug', newValue.toString());
                debugToggleRow.find('.settings-param__value').text(newValue ? 'Включен' : 'Выключен');
            });
        }
        body.append(debugToggleRow);

        // Inject the entire block into the main settings list
        settingsList.append(folder);
        
        logger('Settings folder created and injected');
    }


    // --- API Wrapper & Helpers ---

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
                throw new Error(networkError.message || 'Сетевая ошибка');
            }
        },
        
        search: function(movie) {
            const query = movie.imdb_id ? 'imdb:' + movie.imdb_id : movie.title;
            return TorBoxAPI._call('/torrents/search/' + encodeURIComponent(query), { metadata: 'true', check_cache: 'true' }, 'GET', TorBoxAPI.API_SEARCH_BASE);
        },
        addMagnet: function(magnet) {
            return TorBoxAPI._call('/torrents/createtorrent', { magnet: magnet }, 'POST');
        },
        getFiles: function(torrentId) {
            return TorBoxAPI._call('/torrents/mylist', { id: torrentId }).then(function(r) {
                return (r.data && r.data[0] && r.data[0].files) ? r.data[0].files : [];
            });
        },
        getDownloadLink: function(torrentId, fileId) {
            return TorBoxAPI._call('/torrents/requestdl', { torrent_id: torrentId, file_id: fileId }).then(function(r) {
                return r.data;
            });
        }
    };

    // --- Main Plugin Logic ---

    function startPlugin() {
        logger('Plugin started');
        
        // Listen for settings page opening
        Lampa.Listener.follow('activity', function(e) {
            if (e.type === 'start' && e.component === 'settings') {
                setTimeout(buildSettings, 100);
            }
        });
        
        // Also try to build settings immediately if settings are already open
        if (Lampa.Activity && Lampa.Activity.active) {
            const activeActivity = Lampa.Activity.active();
            if (activeActivity && activeActivity.component === 'settings') {
                setTimeout(buildSettings, 100);
            }
        }

        Lampa.Listener.follow('full', function(e) {
            if (e.type !== 'complite' || e.object.activity.render().find('.view--torbox').length) return;
            const button = $(`<div class="full-start__button selector view--torbox" data-subtitle="TorBox">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
                <span>TorBox</span></div>`);
            const movie = e.data.movie;
            button.on('hover:enter', function() {
                searchAndShow(movie);
            });
            e.object.activity.render().find('.view--torrent').after(button);
        });

        function searchAndShow(movie) {
            Lampa.Loading.start('Поиск в TorBox...');
            
            TorBoxAPI.search(movie)
                .then(function(results) {
                    const torrents = results.data && results.data.torrents ? results.data.torrents : [];
                    if (!torrents.length) {
                        Lampa.Noty.show('Ничего не найдено в TorBox');
                        return;
                    }
                    
                    const cachedOnly = localStorage.getItem('torbox_show_cached_only') === 'true';
                    const filtered = cachedOnly ? torrents.filter(function(t) { return t.cached; }) : torrents;
                    
                    if (!filtered.length) {
                        Lampa.Noty.show('Нет кэшированных результатов', { type: 'info' });
                        return;
                    }
                    
                    displayTorrents(filtered, movie);
                })
                .catch(function(err) {
                    Lampa.Noty.show(err.message, { type: 'error' });
                })
                .finally(function() {
                    Lampa.Loading.stop();
                });
        }
        
        function displayTorrents(torrents, movie) {
            const items = torrents
                .sort(function(a, b) {
                    return (b.seeders || 0) - (a.seeders || 0);
                })
                .map(function(t) {
                    return {
                        title: (t.cached ? '⚡' : '☁️') + ' ' + (t.name || t.raw_title || 'Без названия'),
                        subtitle: ['💾 ' + (t.size / Math.pow(2, 30)).toFixed(2) + ' GB', '🟢 ' + (t.seeders || 0), '🔴 ' + (t.peers || 0)].join(' | '),
                        torrent_id: t.id
                    };
                });
        
            Lampa.Select.show({
                title: 'Результаты TorBox',
                items: items,
                onSelect: function(item) {
                    const selected = torrents.find(function(t) {
                        return t.id === item.torrent_id;
                    });
                    if (selected) handleTorrentSelection(selected, movie, torrents);
                },
                onBack: function() {
                    Lampa.Controller.toggle('content');
                }
            });
        }

        function handleTorrentSelection(torrent, movie, originalList) {
            Lampa.Loading.start('Обработка торрента...');
            
            if (torrent.cached) {
                TorBoxAPI.getFiles(torrent.id)
                    .then(function(files) {
                        const videos = files.filter(function(f) {
                            return /\.(mkv|mp4|avi)$/i.test(f.name);
                        });
                        
                        if (!videos.length) {
                            Lampa.Noty.show('Видео-файлы не найдены');
                            Lampa.Loading.stop();
                            return;
                        }
                        
                        if (videos.length === 1) {
                            playFile(torrent.id, videos[0].id, movie, videos[0].name);
                        } else {
                            videos.sort(function(a, b) {
                                return a.name.localeCompare(b.name, undefined, {numeric: true});
                            });
                            
                            Lampa.Select.show({
                                title: 'Выберите файл',
                                items: videos.map(function(f) {
                                    return {
                                        title: f.name,
                                        subtitle: (f.size / Math.pow(1024, 3)).toFixed(2) + ' GB | ' + parseQuality(f.name),
                                        tid: torrent.id,
                                        fid: f.id,
                                        fname: f.name
                                    };
                                }),
                                onSelect: function(sel) {
                                    playFile(sel.tid, sel.fid, movie, sel.fname);
                                },
                                onBack: function() {
                                    displayTorrents(originalList, movie);
                                }
                            });
                            Lampa.Loading.stop();
                        }
                    })
                    .catch(function(err) {
                        Lampa.Noty.show(err.message, { type: 'error' });
                        Lampa.Loading.stop();
                    });
            } else {
                TorBoxAPI.addMagnet(torrent.magnet)
                    .then(function() {
                        Lampa.Noty.show('Торрент отправлен в TorBox.', { type: 'info' });
                        Lampa.Loading.stop();
                    })
                    .catch(function(err) {
                        Lampa.Noty.show(err.message, { type: 'error' });
                        Lampa.Loading.stop();
                    });
            }
        }

        function playFile(torrentId, fileId, movie, fileName) {
            Lampa.Loading.start('Получение ссылки...');
            
            TorBoxAPI.getDownloadLink(torrentId, fileId)
                .then(function(url) {
                    if (!url) {
                        throw new Error('Не удалось получить ссылку');
                    }
                    
                    Lampa.Player.play({ 
                        url: url, 
                        title: fileName || movie.title, 
                        poster: movie.img 
                    });
                    Lampa.Player.callback(Lampa.Activity.backward);
                    Lampa.Loading.stop();
                })
                .catch(function(err) {
                    Lampa.Noty.show(err.message, { type: 'error' });
                    Lampa.Loading.stop();
                });
        }
    }

    // --- Plugin Initializer ---

    (function waitForLampa() {
        let waited = 0;
        const loop = setInterval(function() {
            if (window.Lampa && window.Lampa.Settings && window.Lampa.Listener && window.$ && window.jQuery) {
                clearInterval(loop);
                try {
                    startPlugin();
                    logger('Plugin successfully initialized');
                } catch (error) {
                    console.error('[' + PLUGIN_ID + '] -> Plugin initialization failed:', error);
                }
            } else {
                waited += 500;
                if (waited >= 15000) {
                    clearInterval(loop);
                    console.error('[' + PLUGIN_ID + '] -> Lampa dependencies not found after 15 seconds');
                }
            }
        }, 500);
    })();
})();
