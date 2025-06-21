/*
 * TorBox ⇄ Lampa — Enhanced Streaming Plugin
 * Version: 2.0.0 (Enhanced)
 * ------------------------------------------------------------
 * FEATURES
 * • Онлайн стрімінг торентів через TorBox.app (як TorrServer)
 * • Автовизначення серій та епізодів (SxxEyy)
 * • Підтримка субтитрів (.srt, .vtt)
 * • Покращена обробка помилок та retry логіка
 * • Кеш для швидшого доступу
 * • Розширені налаштування якості
 * • Автоматичне управління торентами
 * • Покращений UI та прогрес індикатор
 * ------------------------------------------------------------
 * © 2025 Enhanced for Ukrainian community
 */

(function() {
    'use strict';
    
    const PLUGIN_ID = 'torbox_enhanced';
    const API_BASE = 'https://api.torbox.app/v1/api';
    const STORAGE_KEY = 'torbox_enhanced_config';
    const CACHE_KEY = 'torbox_cache';
    
    // Конфігурація за замовчуванням
    const DEFAULT_CONFIG = {
        apiKey: '6dec1946-f318-41b8-a8fb-adfae98ddedf',
        autoPlay: true,
        autoDelete: true,
        allowZip: false,
        preferredQuality: '1080p',
        subtitlesEnabled: true,
        cacheEnabled: true,
        retryAttempts: 3,
        timeoutMinutes: 15,
        debugMode: false
    };
    
    // Утиліти
    const utils = {
        $: (selector) => document.querySelector(selector),
        sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
        
        toast: (message, type = 'info') => {
            if (window.Lampa?.Noty?.show) {
                Lampa.Noty.show(message, { type });
            } else {
                console.log(`[TorBox ${type.toUpperCase()}]`, message);
            }
        },
        
        log: (message, ...args) => {
            if (config.debugMode) {
                console.log('[TorBox Debug]', message, ...args);
            }
        },
        
        formatSize: (bytes) => {
            const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
            if (bytes === 0) return '0 B';
            const i = Math.floor(Math.log(bytes) / Math.log(1024));
            return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
        },
        
        formatTime: (seconds) => {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const secs = seconds % 60;
            return hours > 0 ? `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}` 
                             : `${minutes}:${secs.toString().padStart(2, '0')}`;
        }
    };
    
    // Конфігурація
    let config = Object.assign({}, DEFAULT_CONFIG);
    
    function loadConfig() {
        try {
            const saved = Lampa?.Storage?.get(STORAGE_KEY);
            if (saved) {
                config = Object.assign({}, DEFAULT_CONFIG, saved);
            }
        } catch (e) {
            utils.log('Error loading config:', e);
        }
    }
    
    function saveConfig() {
        try {
            Lampa?.Storage?.set(STORAGE_KEY, config);
        } catch (e) {
            utils.log('Error saving config:', e);
        }
    }
    
    // Кеш
    const cache = {
        get: (key) => {
            if (!config.cacheEnabled) return null;
            try {
                const cached = Lampa?.Storage?.get(CACHE_KEY) || {};
                const item = cached[key];
                if (item && Date.now() - item.timestamp < 3600000) { // 1 година
                    return item.data;
                }
            } catch (e) {
                utils.log('Cache get error:', e);
            }
            return null;
        },
        
        set: (key, data) => {
            if (!config.cacheEnabled) return;
            try {
                const cached = Lampa?.Storage?.get(CACHE_KEY) || {};
                cached[key] = {
                    data: data,
                    timestamp: Date.now()
                };
                Lampa?.Storage?.set(CACHE_KEY, cached);
            } catch (e) {
                utils.log('Cache set error:', e);
            }
        },
        
        clear: () => {
            try {
                Lampa?.Storage?.set(CACHE_KEY, {});
            } catch (e) {
                utils.log('Cache clear error:', e);
            }
        }
    };
    
    // API клієнт
    const api = {
        async request(endpoint, options = {}) {
            const url = API_BASE + endpoint;
            const headers = {
                'Authorization': `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json',
                ...options.headers
            };
            
            utils.log(`API Request: ${options.method || 'GET'} ${url}`);
            
            for (let attempt = 1; attempt <= config.retryAttempts; attempt++) {
                try {
                    const response = await fetch(url, {
                        ...options,
                        headers
                    });
                    
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }
                    
                    const data = await response.json();
                    
                    if (!data.success) {
                        throw new Error(data.detail || data.error || 'API Error');
                    }
                    
                    utils.log('API Response:', data);
                    return data.data;
                    
                } catch (error) {
                    utils.log(`API attempt ${attempt} failed:`, error);
                    
                    if (attempt === config.retryAttempts) {
                        throw error;
                    }
                    
                    await utils.sleep(1000 * attempt); // Exponential backoff
                }
            }
        },
        
        async getTorrents() {
            const cached = cache.get('torrents_list');
            if (cached) return cached;
            
            const torrents = await this.request('/torrents/mylist?limit=100');
            cache.set('torrents_list', torrents);
            return torrents;
        },
        
        async createTorrent(magnet, name) {
            // Перевіряємо чи торрент вже існує
            const existing = await this.getTorrents();
            const found = existing.find(t => t.magnet === magnet);
            
            if (found) {
                utils.toast('Торрент знайдено в кеші TorBox');
                return found;
            }
            
            const formData = new FormData();
            formData.append('magnet', magnet);
            formData.append('name', name);
            formData.append('allow_zip', config.allowZip ? '1' : '0');
            formData.append('seed', '3'); // Не сідувати
            
            const result = await this.request('/torrents/createtorrent', {
                method: 'POST',
                body: formData,
                headers: {} // FormData встановить правильний Content-Type
            });
            
            cache.clear(); // Очищуємо кеш після додавання
            return result;
        },
        
        async getTorrentInfo(torrentId) {
            return await this.request(`/torrents/mylist?id=${torrentId}&bypass_cache=true`);
        },
        
        async getDownloadLink(torrentId, fileId) {
            const params = new URLSearchParams({
                torrent_id: torrentId,
                file_id: fileId,
                redirect: 'false'
            });
            
            return await this.request(`/torrents/requestdl?${params}`);
        },
        
        async deleteTorrent(torrentId) {
            await this.request('/torrents/remove', {
                method: 'POST',
                body: JSON.stringify({ torrent_id: torrentId })
            });
            cache.clear();
        }
    };
    
    // Обробка файлів
    const fileHandler = {
        isVideoFile(filename) {
            const videoExtensions = /\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v|3gp|ts|m2ts)$/i;
            return videoExtensions.test(filename);
        },
        
        isSubtitleFile(filename) {
            const subtitleExtensions = /\.(srt|vtt|ass|ssa|sub|idx)$/i;
            return subtitleExtensions.test(filename);
        },
        
        extractQuality(filename) {
            const qualityMatch = filename.match(/(\d{3,4})p/i);
            return qualityMatch ? qualityMatch[1] + 'p' : null;
        },
        
        extractEpisode(filename) {
            const episodeMatch = filename.match(/s(\d{1,2})e(\d{1,2})/i);
            if (episodeMatch) {
                return {
                    season: parseInt(episodeMatch[1]),
                    episode: parseInt(episodeMatch[2])
                };
            }
            return null;
        },
        
        selectBestFile(files, metadata = {}) {
            const videoFiles = files.filter(f => this.isVideoFile(f.name));
            
            if (videoFiles.length === 0) {
                return files[0]; // Повертаємо перший файл якщо немає відео
            }
            
            // Фільтруємо по епізоду якщо це серіал
            if (metadata.season && metadata.episode) {
                const episodeFiles = videoFiles.filter(f => {
                    const ep = this.extractEpisode(f.name);
                    return ep && ep.season === metadata.season && ep.episode === metadata.episode;
                });
                
                if (episodeFiles.length > 0) {
                    return this.selectByQuality(episodeFiles);
                }
            }
            
            return this.selectByQuality(videoFiles);
        },
        
        selectByQuality(files) {
            const preferredQuality = config.preferredQuality.replace('p', '');
            
            // Спочатку шукаємо точну якість
            const exactMatch = files.find(f => {
                const quality = this.extractQuality(f.name);
                return quality && quality.replace('p', '') === preferredQuality;
            });
            
            if (exactMatch) return exactMatch;
            
            // Сортуємо по розміру (більший = краща якість)
            files.sort((a, b) => b.size - a.size);
            return files[0];
        },
        
        findSubtitles(files, videoFile) {
            if (!config.subtitlesEnabled) return [];
            
            const subtitles = files.filter(f => this.isSubtitleFile(f.name));
            const videoBaseName = videoFile.name.replace(/\.[^.]+$/, '');
            
            // Шукаємо субтитри з схожою назвою
            return subtitles.filter(sub => {
                const subBaseName = sub.name.replace(/\.[^.]+$/, '');
                return subBaseName.includes(videoBaseName) || videoBaseName.includes(subBaseName);
            });
        }
    };
    
    // Прогрес трекер
    const progressTracker = {
        current: null,
        
        start(torrentId, name) {
            this.current = {
                torrentId,
                name,
                startTime: Date.now(),
                lastProgress: 0
            };
        },
        
        update(progress) {
            if (this.current && progress !== this.current.lastProgress) {
                this.current.lastProgress = progress;
                const elapsed = (Date.now() - this.current.startTime) / 1000;
                const eta = progress > 0 ? (elapsed / progress * (100 - progress)) : 0;
                
                utils.toast(`TorBox: ${progress}% (ETA: ${utils.formatTime(Math.round(eta))})`);
            }
        },
        
        stop() {
            this.current = null;
        }
    };
    
    // Основна логіка стрімінгу
    const streaming = {
        async waitForReady(torrentId) {
            const maxWaitTime = config.timeoutMinutes * 60 * 1000;
            const startTime = Date.now();
            
            while (Date.now() - startTime < maxWaitTime) {
                const torrentInfo = await api.getTorrentInfo(torrentId);
                
                if (torrentInfo.percent !== undefined) {
                    progressTracker.update(torrentInfo.percent);
                }
                
                const readyStates = ['cached', 'completed', 'downloading'];
                if (readyStates.includes(torrentInfo.status) && torrentInfo.files?.length > 0) {
                    return torrentInfo;
                }
                
                if (torrentInfo.status === 'error') {
                    throw new Error('Торрент завершився з помилкою');
                }
                
                await utils.sleep(3000);
            }
            
            throw new Error('Timeout: торрент не готовий до відтворення');
        },
        
        async play(item) {
            try {
                if (!config.apiKey) {
                    await this.showSettings(true);
                    if (!config.apiKey) return;
                }
                
                utils.toast('TorBox: Додаємо торрент...');
                
                const torrent = await api.createTorrent(item.file, item.title || item.name || 'Unknown');
                progressTracker.start(torrent.torrent_id, item.title);
                
                utils.toast('TorBox: Очікуємо готовності...');
                
                const readyTorrent = await this.waitForReady(torrent.torrent_id);
                
                let selectedFile = fileHandler.selectBestFile(readyTorrent.files, {
                    season: item.season,
                    episode: item.episode
                });
                
                // Якщо автоплей вимкнено, показуємо вибір файлів
                if (!config.autoPlay && readyTorrent.files.length > 1) {
                    selectedFile = await this.showFileSelector(readyTorrent.files);
                }
                
                utils.toast('TorBox: Отримуємо посилання на стрім...');
                
                const streamUrl = await api.getDownloadLink(torrent.torrent_id, selectedFile.id);
                
                // Знаходимо субтитри
                const subtitles = fileHandler.findSubtitles(readyTorrent.files, selectedFile);
                
                progressTracker.stop();
                utils.toast('TorBox: Запускаємо відтворення!', 'success');
                
                // Запускаємо плеєр
                const playerOptions = {
                    url: streamUrl,
                    title: item.title || selectedFile.name,
                    subtitles: subtitles.map(sub => ({
                        label: sub.name,
                        url: api.getDownloadLink(torrent.torrent_id, sub.id)
                    }))
                };
                
                Lampa.Player.play(playerOptions);
                
                // Автоматичне видалення після завершення
                if (config.autoDelete) {
                    Lampa.Player.listener.follow('destroy', () => {
                        api.deleteTorrent(torrent.torrent_id).catch(e => {
                            utils.log('Auto-delete failed:', e);
                        });
                    });
                }
                
            } catch (error) {
                progressTracker.stop();
                utils.toast(`TorBox помилка: ${error.message}`, 'error');
                utils.log('Streaming error:', error);
            }
        },
        
        showFileSelector(files) {
            return new Promise((resolve) => {
                const videoFiles = files.filter(f => fileHandler.isVideoFile(f.name));
                const filesToShow = videoFiles.length > 0 ? videoFiles : files;
                
                if (filesToShow.length === 1) {
                    resolve(filesToShow[0]);
                    return;
                }
                
                let html = '<div style="max-height: 70vh; overflow-y: auto; padding: 10px;">';
                
                filesToShow.forEach((file, index) => {
                    const quality = fileHandler.extractQuality(file.name) || '';
                    const episode = fileHandler.extractEpisode(file.name);
                    const episodeText = episode ? ` S${episode.season}E${episode.episode}` : '';
                    
                    html += `
                        <div class="torbox-file-item" data-index="${index}" style="
                            padding: 12px;
                            margin: 5px 0;
                            border: 1px solid #444;
                            border-radius: 6px;
                            cursor: pointer;
                            transition: all 0.2s;
                        ">
                            <div style="font-weight: bold; margin-bottom: 4px;">
                                ${file.name.replace(/\.[^.]+$/, '')}
                            </div>
                            <div style="font-size: 12px; opacity: 0.7;">
                                ${utils.formatSize(file.size)} ${quality} ${episodeText}
                            </div>
                        </div>
                    `;
                });
                
                html += '</div>';
                
                Lampa.Modal.open({
                    title: 'TorBox: Виберіть файл для відтворення',
                    html: html,
                    size: 'medium',
                    onSelect() {},
                    onBack() {
                        Lampa.Modal.close();
                    }
                });
                
                // Додаємо обробники подій
                const modal = utils.$('#modal .modal__content');
                if (modal) {
                    modal.innerHTML = html;
                    
                    modal.querySelectorAll('.torbox-file-item').forEach(item => {
                        item.addEventListener('mouseenter', () => {
                            item.style.backgroundColor = '#333';
                            item.style.borderColor = '#666';
                        });
                        
                        item.addEventListener('mouseleave', () => {
                            item.style.backgroundColor = 'transparent';
                            item.style.borderColor = '#444';
                        });
                        
                        item.addEventListener('click', () => {
                            const index = parseInt(item.dataset.index);
                            const selectedFile = filesToShow[index];
                            Lampa.Modal.close();
                            resolve(selectedFile);
                        });
                    });
                }
            });
        },
        
        showSettings(required = false) {
            return new Promise((resolve) => {
                if (!required && config.apiKey) {
                    resolve();
                    return;
                }
                
                const html = `
                    <div style="padding: 20px;">
                        <div style="margin-bottom: 15px;">
                            <label style="display: block; margin-bottom: 5px; font-weight: bold;">API Ключ TorBox:</label>
                            <input type="text" id="torbox-api-key" value="${config.apiKey}" 
                                   placeholder="Вставте ваш API ключ TorBox"
                                   style="width: 100%; padding: 8px; border: 1px solid #444; border-radius: 4px; background: #222; color: #fff;">
                        </div>
                        
                        <div style="margin-bottom: 15px;">
                            <label style="display: block; margin-bottom: 5px; font-weight: bold;">Налаштування відтворення:</label>
                            <label style="display: block; margin: 8px 0;">
                                <input type="checkbox" id="torbox-autoplay" ${config.autoPlay ? 'checked' : ''}>
                                Автоматично відтворювати перший файл
                            </label>
                            <label style="display: block; margin: 8px 0;">
                                <input type="checkbox" id="torbox-autodelete" ${config.autoDelete ? 'checked' : ''}>
                                Видаляти торрент після завершення перегляду
                            </label>
                            <label style="display: block; margin: 8px 0;">
                                <input type="checkbox" id="torbox-subtitles" ${config.subtitlesEnabled ? 'checked' : ''}>
                                Автоматично завантажувати субтитри
                            </label>
                        </div>
                        
                        <div style="margin-bottom: 15px;">
                            <label style="display: block; margin-bottom: 5px; font-weight: bold;">Бажана якість:</label>
                            <select id="torbox-quality" style="width: 100%; padding: 8px; border: 1px solid #444; border-radius: 4px; background: #222; color: #fff;">
                                <option value="480p" ${config.preferredQuality === '480p' ? 'selected' : ''}>480p</option>
                                <option value="720p" ${config.preferredQuality === '720p' ? 'selected' : ''}>720p</option>
                                <option value="1080p" ${config.preferredQuality === '1080p' ? 'selected' : ''}>1080p</option>
                                <option value="1440p" ${config.preferredQuality === '1440p' ? 'selected' : ''}>1440p</option>
                                <option value="2160p" ${config.preferredQuality === '2160p' ? 'selected' : ''}>4K (2160p)</option>
                            </select>
                        </div>
                        
                        <div style="margin-bottom: 15px;">
                            <label style="display: block; margin-bottom: 5px; font-weight: bold;">Додатково:</label>
                            <label style="display: block; margin: 8px 0;">
                                <input type="checkbox" id="torbox-allowzip" ${config.allowZip ? 'checked' : ''}>
                                Дозволити ZIP торренти
                            </label>
                            <label style="display: block; margin: 8px 0;">
                                <input type="checkbox" id="torbox-cache" ${config.cacheEnabled ? 'checked' : ''}>
                                Увімкнути кешування
                            </label>
                            <label style="display: block; margin: 8px 0;">
                                <input type="checkbox" id="torbox-debug" ${config.debugMode ? 'checked' : ''}>
                                Режим налагодження
                            </label>
                        </div>
                        
                        <div style="margin-top: 20px; text-align: center;">
                            <button id="torbox-clear-cache" style="
                                padding: 8px 16px;
                                margin-right: 10px;
                                border: 1px solid #666;
                                border-radius: 4px;
                                background: #444;
                                color: #fff;
                                cursor: pointer;
                            ">Очистити кеш</button>
                        </div>
                    </div>
                `;
                
                Lampa.Modal.open({
                    title: 'TorBox - Налаштування',
                    html: html,
                    size: 'medium',
                    onSelect() {
                        // Зберігаємо налаштування
                        config.apiKey = utils.$('#torbox-api-key').value.trim();
                        config.autoPlay = utils.$('#torbox-autoplay').checked;
                        config.autoDelete = utils.$('#torbox-autodelete').checked;
                        config.subtitlesEnabled = utils.$('#torbox-subtitles').checked;
                        config.preferredQuality = utils.$('#torbox-quality').value;
                        config.allowZip = utils.$('#torbox-allowzip').checked;
                        config.cacheEnabled = utils.$('#torbox-cache').checked;
                        config.debugMode = utils.$('#torbox-debug').checked;
                        
                        saveConfig();
                        Lampa.Modal.close();
                        utils.toast('Налаштування збережено!', 'success');
                        resolve();
                    },
                    onBack() {
                        Lampa.Modal.close();
                        resolve();
                    }
                });
                
                // Додаємо обробник для кнопки очищення кешу
                setTimeout(() => {
                    const clearBtn = utils.$('#torbox-clear-cache');
                    if (clearBtn) {
                        clearBtn.addEventListener('click', () => {
                            cache.clear();
                            utils.toast('Кеш очищено!', 'success');
                        });
                    }
                }, 100);
            });
        }
    };
    
    // Ініціалізація плагіна
    function initializePlugin() {
        loadConfig();
        
        // Реєструємо джерело відео
        Lampa.Source.add(PLUGIN_ID, {
            name: 'TorBox Enhanced',
            type: 'video',
            play: streaming.play.bind(streaming)
        });
        
        // Додаємо контролер для навігації
        Lampa.Controller.add(PLUGIN_ID, {
            toggle: () => {},
            back: () => {
                Lampa.Controller.toggle('content', true);
            }
        });
        
        // Додаємо пункт в меню налаштувань
        if (Lampa.Settings) {
            Lampa.Settings.listener.follow('open', (event) => {
                if (event.name === 'plugins') {
                    const settingsButton = document.createElement('div');
                    settingsButton.className = 'settings__item';
                    settingsButton.innerHTML = `
                        <div class="settings__item-text">
                            <div>TorBox Enhanced</div>
                            <div style="font-size: 12px; opacity: 0.7;">Налаштування онлайн стрімінгу</div>
                        </div>
                    `;
                    
                    settingsButton.addEventListener('click', () => {
                        streaming.showSettings(true);
                    });
                    
                    const settingsBody = utils.$('.settings__body');
                    if (settingsBody) {
                        settingsBody.appendChild(settingsButton);
                    }
                }
            });
        }
        
        utils.log('TorBox Enhanced plugin initialized');
        console.log('%cTorBox Enhanced Plugin Loaded Successfully!', 'color: #4CAF50; font-weight: bold; font-size: 14px;');
        utils.toast('TorBox Enhanced готовий до роботи!', 'success');
    }
    
    // Запуск плагіна
    if (window.Lampa && window.Lampa.Source) {
        initializePlugin();
    } else {
        // Чекаємо поки Lampa завантажиться
        const checkInterval = setInterval(() => {
            if (window.Lampa && window.Lampa.Source) {
                clearInterval(checkInterval);
                initializePlugin();
            }
        }, 500);
        
        // Таймаут на випадок якщо Lampa не завантажиться
        setTimeout(() => {
            clearInterval(checkInterval);
            console.error('TorBox Enhanced: Lampa not found after timeout');
        }, 30000);
    }
    
})();