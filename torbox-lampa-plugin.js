/**
 * TorBox ↔ Lampa integration plugin
 * Version 5.0.1 – Web version compatible
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
    const NS = 'torbox_lampa_plugin_v5_0_1';
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
        const apiKey = Lampa.Storage.get(S.API_KEY, '');
        const cachedOnly = Lampa.Storage.get(S.CACHED_ONLY, false);

        // Пробуем использовать разные способы показа настроек
        if (typeof Lampa.Modal !== 'undefined' && typeof Lampa.Modal.open === 'function') {
            const inputs = [
                {
                    title: 'API ключ TorBox',
                    value: apiKey,
                    placeholder: 'Введите ваш API ключ с torbox.app',
                    type: 'input'
                },
                {
                    title: 'Только кэшированные торренты',
                    value: cachedOnly,
                    type: 'checkbox'
                }
            ];

            Lampa.Modal.open({
                title: 'Настройки TorBox',
                html: inputs.map((input, index) => {
                    if (input.type === 'input') {
                        return `
                            <div class="settings-param">
                                <div class="settings-param__name">${input.title}</div>
                                <div class="settings-param__value">
                                    <input type="text" id="torbox-input-${index}" value="${input.value}" placeholder="${input.placeholder}" style="width: 100%; padding: 8px; border: 1px solid #333; background: #1a1a1a; color: #fff; border-radius: 4px;">
                                </div>
                            </div>
                        `;
                    } else if (input.type === 'checkbox') {
                        return `
                            <div class="settings-param">
                                <div class="settings-param__name">${input.title}</div>
                                <div class="settings-param__value">
                                    <input type="checkbox" id="torbox-checkbox-${index}" ${input.value ? 'checked' : ''}>
                                </div>
                            </div>
                        `;
                    }
                }).join(''),
                onSelect: () => {
                    const newApiKey = document.getElementById('torbox-input-0')?.value || '';
                    const newCachedOnly = document.getElementById('torbox-checkbox-1')?.checked || false;
                    
                    Lampa.Storage.set(S.API_KEY, newApiKey.trim());
                    Lampa.Storage.set(S.CACHED_ONLY, newCachedOnly);
                    
                    Lampa.Noty.show('Настройки сохранены', { type: 'success' });
                    Lampa.Modal.close();
                },
                onBack: () => {
                    Lampa.Modal.close();
                }
            });
        } else if (typeof Lampa.Select !== 'undefined') {
            // Альтернативный способ через Select
            const items = [
                {
                    title: 'API ключ TorBox',
                    subtitle: apiKey || 'Не установлен',
                    type: 'api_key'
                },
                {
                    title: 'Только кэшированные торренты',
                    subtitle: cachedOnly ? 'Включено' : 'Выключено',
                    type: 'cached_only'
                }
            ];

            Lampa.Select.show({
                title: 'Настройки TorBox',
                items: items,
                onSelect: (item) => {
                    if (item.type === 'api_key') {
                        const newKey = prompt('Введите API ключ TorBox:', apiKey);
                        if (newKey !== null) {
                            Lampa.Storage.set(S.API_KEY, newKey.trim());
                            Lampa.Noty.show('API ключ сохранен', { type: 'success' });
                        }
                    } else if (item.type === 'cached_only') {
                        const newValue = !cachedOnly;
                        Lampa.Storage.set(S.CACHED_ONLY, newValue);
                        Lampa.Noty.show(`Кэшированные торренты: ${newValue ? 'включено' : 'выключено'}`, { type: 'success' });
                    }
                },
                onBack: () => {
                    Lampa.Controller.toggle('content');
                }
            });
        } else {
            // Простой prompt как последний вариант
            const newKey = prompt('Введите API ключ TorBox:', apiKey);
            if (newKey !== null) {
                Lampa.Storage.set(S.API_KEY, newKey.trim());
                Lampa.Noty.show('API ключ сохранен', { type: 'success' });
            }
        }
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

        // Добавляем пункт в настройки
        Lampa.Listener.follow('app', (e) => {
            if (e.type === 'ready') {
                // Добавляем в настройки через Lampa.Settings
                if (typeof Lampa.Settings !== 'undefined' && typeof Lampa.Settings.add === 'function') {
                    console.log('TorBox: Добавляем в настройки через Lampa.Settings');
                    Lampa.Settings.add({
                        component: 'torbox_settings',
                        param: {
                            name: 'TorBox',
                            description: 'Настройки интеграции с TorBox'
                        },
                        onSelect: () => {
                            showSettings();
                        },
                        onLong: () => {
                            showSettings();
                        }
                    });
                } else {
                    console.log('TorBox: Lampa.Settings недоступен, используем альтернативный метод');
                }
                
                // Попытка добавить через событие settings
                setTimeout(() => {
                    try {
                        if (typeof Lampa.Listener !== 'undefined') {
                            Lampa.Listener.follow('settings', (e) => {
                                if (e.type === 'ready') {
                                    console.log('TorBox: Добавляем через событие settings');
                                    const settingsContainer = $('.settings .settings__content');
                                    if (settingsContainer.length && !settingsContainer.find('.torbox-settings-item').length) {
                                        const torboxSetting = $(`
                                            <div class="settings-param torbox-settings-item selector">
                                                <div class="settings-param__name">TorBox</div>
                                                <div class="settings-param__descr">Настройки интеграции с TorBox</div>
                                            </div>
                                        `);
                                        
                                        torboxSetting.on('hover:enter', () => {
                                            showSettings();
                                        });
                                        
                                        settingsContainer.append(torboxSetting);
                                    }
                                }
                            });
                        }
                    } catch (e) {
                        console.log('TorBox: Ошибка при добавлении через settings:', e);
                    }
                }, 500);
                
                // Прямое добавление в настройки через DOM
                 setTimeout(() => {
                     const settingsContent = $('.settings .settings__content, .settings-main .settings__content');
                     if (settingsContent.length && !settingsContent.find('.torbox-settings-direct').length) {
                         console.log('TorBox: Добавляем напрямую в DOM настроек');
                         const torboxSettingDirect = $(`
                             <div class="settings-param torbox-settings-direct selector">
                                 <div class="settings-param__name">TorBox</div>
                                 <div class="settings-param__descr">Настройки интеграции с TorBox</div>
                                 <div class="settings-param__status">Нажмите для настройки</div>
                             </div>
                         `);
                         
                         torboxSettingDirect.on('hover:enter', () => {
                             showSettings();
                         });
                         
                         settingsContent.append(torboxSettingDirect);
                     }
                 }, 2000);
                 
                 // Альтернативный способ - добавление в главное меню
                 setTimeout(() => {
                     if ($('.menu .menu__list .torbox-menu-item').length === 0) {
                         console.log('TorBox: Добавляем в главное меню');
                         const settingsItem = $(`
                             <li class="menu__item selector torbox-menu-item">
                                 <div class="menu__ico">
                                     <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                         <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                                         <path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                                         <path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                                     </svg>
                                 </div>
                                 <div class="menu__text">TorBox</div>
                             </li>
                         `);

                         settingsItem.on('hover:enter', () => {
                             showSettings();
                         });

                         $('.menu .menu__list').append(settingsItem);
                      }
                  }, 3000);
                  
                  // Наблюдение за изменениями DOM для настроек
                  if (typeof MutationObserver !== 'undefined') {
                      const observer = new MutationObserver((mutations) => {
                          mutations.forEach((mutation) => {
                              if (mutation.type === 'childList') {
                                  const settingsContent = $('.settings .settings__content, .settings-main .settings__content');
                                  if (settingsContent.length && !settingsContent.find('.torbox-settings-observer').length) {
                                      console.log('TorBox: Обнаружены настройки через MutationObserver');
                                      const torboxSettingObserver = $(`
                                          <div class="settings-param torbox-settings-observer selector">
                                              <div class="settings-param__name">TorBox</div>
                                              <div class="settings-param__descr">Настройки интеграции с TorBox</div>
                                              <div class="settings-param__status">Нажмите для настройки</div>
                                          </div>
                                      `);
                                      
                                      torboxSettingObserver.on('hover:enter', () => {
                                          showSettings();
                                      });
                                      
                                      settingsContent.append(torboxSettingObserver);
                                  }
                              }
                          });
                      });
                      
                      observer.observe(document.body, {
                          childList: true,
                          subtree: true
                      });
                      
                      // Отключаем наблюдатель через 10 секунд
                      setTimeout(() => {
                          observer.disconnect();
                      }, 10000);
                  }
             }
         });
    }

    /* ---------- INITIALIZATION ---------- */
    function init() {
        // Регистрируем компонент
        if (typeof Lampa.Component.add === 'function') {
            Lampa.Component.add('torbox', TorBoxComponent);
        }

        // Добавляем в меню
        addToMovieMenu();
        
        console.log('%cTorBox v5.0.1 – Initialized for web version with multiple settings integration methods', 'color:#0f0');
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
