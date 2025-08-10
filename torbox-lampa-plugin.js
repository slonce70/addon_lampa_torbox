/*
 * TorBox Lampa Plugin (Stable Refactored)
 * Version: 51.0.7
 *
 * Changelog v51.0.7:
 * - REFACTOR: Улучшена структура кода и именование переменных
 * - OPTIMIZE: Оптимизированы функции для лучшей производительности
 * - CLEANUP: Приведен код в соответствие с современными стандартами JavaScript
 * - DOCS: Улучшена документация и комментарии
 *
 * Changelog v51.0.6:
 * - FIX (Navigation): Исправлена логика навигации с пульта. Теперь фокус корректно переходит с верхней панели на "Продолжить просмотр" и список торрентов, решая проблему "залипания" на кнопке "Кешированные".
 * - FIX (UI): Убрана черная полоса под технической информацией о файле. Теперь теги отображаются на прозрачном фоне.
 *
 * Changelog v51.0.5:
 * - FIX (UX): Добавлен статус "Обработка торрента..."
 *
 * Changelog v51.0.4:
 * - FIX (CRITICAL): Исправлена логика отмены загрузки.
 *
 * Changelog v51.0.3:
 * - FIX (CRITICAL): Восстановлена логика вставки кнопки "TorBox".
 */
(function () {
    'use strict';

    // ───────────────────────────── GUARD ──────────────────────────────
    const PLUGIN_ID = 'torbox_lampa_plugin_integrated_refactored';
    if (window[PLUGIN_ID]) return;
    window[PLUGIN_ID] = true;

    // ───────────────────── CORE ▸ UTILS ───────────────────────────────
    const Utils = {
        /**
         * Безопасно экранирует HTML-строку
         * @param {string} str - строка для экранирования
         * @returns {string} экранированная строка
         */
        escapeHtml(str = '') {
            if (typeof str !== 'string') return '';
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        },

        /**
         * Форматирует байты в читаемый вид
         * @param {number} bytes - количество байт
         * @param {boolean} speed - флаг для отображения скорости
         * @returns {string} отформатированная строка
         */
        formatBytes(bytes = 0, speed = false) {
            const bytesNum = Number(bytes);
            if (isNaN(bytesNum) || bytesNum === 0) {
                return speed ? '0 KB/s' : '0 B';
            }
            
            const k = 1024;
            const sizes = speed 
                ? ['B/s', 'KB/s', 'MB/s', 'GB/s'] 
                : ['B', 'KB', 'MB', 'GB', 'TB'];
            
            const i = Math.floor(Math.log(bytesNum) / Math.log(k));
            return `${(bytesNum / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
        },

        /**
         * Форматирует секунды в читаемый вид времени
         * @param {number} seconds - количество секунд
         * @returns {string} отформатированное время
         */
        formatTime(seconds = 0) {
            const sec = parseInt(seconds, 10);
            if (isNaN(sec) || sec < 0) return 'н/д';
            if (sec === Infinity || sec > 2592000) return '∞';
            
            const hours = Math.floor(sec / 3600);
            const minutes = Math.floor((sec % 3600) / 60);
            const remainingSeconds = Math.floor(sec % 60);
            
            const parts = [
                hours ? `${hours}ч` : null,
                minutes ? `${minutes}м` : null,
                `${remainingSeconds}с`
            ].filter(Boolean);
            
            return parts.join(' ');
        },

        /**
         * Форматирует возраст от ISO даты
         * @param {string} isoDate - ISO строка даты
         * @returns {string} относительное время
         */
        formatAge(isoDate) {
            if (!isoDate) return 'н/д';
            
            try {
                const date = new Date(isoDate);
                if (isNaN(date.getTime())) return 'н/д';
                
                const diffSeconds = Math.floor((Date.now() - date.getTime()) / 1000);
                const minutes = Math.floor(diffSeconds / 60);
                const hours = Math.floor(minutes / 60);
                const days = Math.floor(hours / 24);
                
                if (diffSeconds < 60) return `${diffSeconds} сек. назад`;
                if (minutes < 60) return `${minutes} мин. назад`;
                if (hours < 24) return `${hours} ч. назад`;
                return `${days} д. назад`;
            } catch (error) {
                console.warn('[TorBox] Ошибка форматирования даты:', error);
                return 'н/д';
            }
        },

        /**
         * Получает метку качества из заголовка или данных
         * @param {string} title - заголовок
         * @param {Object} raw - сырые данные
         * @returns {string} метка качества
         */
        getQualityLabel(title = '', raw) {
            if (raw?.info?.quality) return `${raw.info.quality}p`;
            if (/2160p|4K|UHD/i.test(title)) return '4K';
            if (/1080p|FHD/i.test(title)) return 'FHD';
            if (/720p|HD/i.test(title)) return 'HD';
            return 'SD';
        },

        /**
         * Естественная сортировка для имен файлов
         * @param {Object} a - первый элемент
         * @param {Object} b - второй элемент
         * @returns {number} результат сравнения
         */
        naturalSort(a, b) {
            const re = /(\d+)/g;
            const aParts = String(a.name || '').split(re);
            const bParts = String(b.name || '').split(re);
            
            for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
                if (i % 2) {
                    const diff = parseInt(aParts[i], 10) - parseInt(bParts[i], 10);
                    if (diff !== 0) return diff;
                } else if (aParts[i] !== bParts[i]) {
                    return aParts[i].localeCompare(bParts[i]);
                }
            }
            
            return aParts.length - bParts.length;
        },

        /**
         * Безопасный парсер JSON из localStorage
         * @param {string} jsonString - JSON строка
         * @param {*} defaultValue - значение по умолчанию
         * @returns {*} распарсенный объект или значение по умолчанию
         */
        parseJSON(jsonString, defaultValue) {
            if (typeof jsonString !== 'string') return defaultValue;
            
            try {
                return JSON.parse(jsonString);
            } catch (error) {
                console.error('[TorBox] Ошибка парсинга JSON:', error);
                return defaultValue;
            }
        }
    };

    // ───────────────────── core ▸ STORAGE (safeStorage + Store) ─────────────
    const safeStorage = (() => {
        try {
            localStorage.setItem('__torbox_test', '1');
            localStorage.removeItem('__torbox_test');
            return localStorage;
        } catch {
            console.warn('[TorBox] localStorage недоступен, используется временное хранилище.');
            const mem = {};
            return {
                getItem: k => (k in mem ? mem[k] : null),
                setItem: (k, v) => { mem[k] = String(v); },
                removeItem: k => { delete mem[k]; },
                clear: () => { Object.keys(mem).forEach(k => delete mem[k]); }
            };
        }
    })();

    const Store = {
        get: (key, def = null) => safeStorage.getItem(key) ?? def,
        set: (key, val) => safeStorage.setItem(key, String(val)),
    };

    // ───────────────────── core ▸ CONFIG ───────────────────────────────
    const Config = (() => {
        const DEF = {
            proxyUrl: '',
            apiKey: '',
            debug: false,
            // Сетевые настройки
            API_TIMEOUT_MS: 20000, // 20 секунд
            TRACK_INTERVAL_MS: 10000, // 10 секунд
            // Настройки кэша
            CACHE_LIMIT: 128,
            CACHE_TTL_MS: 600000, // 10 минут
        };
        const CFG = {
            get debug() { return Store.get('torbox_debug', '0') === '1'; },
            set debug(v) { Store.set('torbox_debug', v ? '1' : '0'); },
            get proxyUrl() { return Store.get('torbox_proxy_url') || DEF.proxyUrl; },
            set proxyUrl(v) { Store.set('torbox_proxy_url', v); },
            get apiKey() {
                const b64 = Store.get('torbox_api_key_b64', '');
                if (!b64) return DEF.apiKey;
                try { return atob(b64); }
                catch { Store.set('torbox_api_key_b64', ''); return DEF.apiKey; }
            },
            set apiKey(v) {
                if (!v) return Store.set('torbox_api_key_b64', '');
                Store.set('torbox_api_key_b64', btoa(v));
            }
        };
        const LOG = (...a) => CFG.debug && console.log('[TorBox]', ...a);
        const PUBLIC_PARSERS = [
            { name: 'Viewbox', url: 'jacred.viewbox.dev', key: 'viewbox' },
            { name: 'Jacred', url: 'jacred.xyz', key: '' }
        ];
        const ICON = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 7L12 2L21 7V17L12 22L3 17V7Z" stroke="currentColor" stroke-width="2"/><path d="M12 22V12" stroke="currentColor" stroke-width="2"/><path d="M21 7L12 12L3 7" stroke="currentColor" stroke-width="2"/></svg>`;
        return { CFG, LOG, PUBLIC_PARSERS, ICON, DEF };
    })();
    const { CFG, LOG, PUBLIC_PARSERS, ICON, DEF } = Config;

    // ───────────────────── core ▸ CACHE (simple LRU) ───────────────────
    const Cache = (() => {
        const map = new Map();
        return {
            get(k) {
                if (!map.has(k)) return null;
                const o = map.get(k);
                if (Date.now() - o.ts > DEF.CACHE_TTL_MS) {
                    map.delete(k);
                    return null;
                }
                map.delete(k);
                map.set(k, o); // move to top
                return o.val;
            },
            set(k, v) {
                if (map.has(k)) map.delete(k);
                map.set(k, { ts: Date.now(), val: v });
                if (map.size > DEF.CACHE_LIMIT) map.delete(map.keys().next().value); // evict oldest
            },
            clear: () => map.clear(),
        };
    })();

    // ───────────────────── core ▸ API ────────────────────────────────
    const Api = (() => {
        const MAIN = 'https://api.torbox.app/v1/api';

        const _process = (txt, status) => {
            if (status === 401) throw { type: 'auth', message: '401 – неверный API-ключ' };
            if (status === 403) throw { type: 'auth', message: '403 – доступ запрещен, проверьте права ключа' };
            if (status === 429) throw { type: 'network', message: '429 – слишком много запросов, попробуйте позже' };
            if (status >= 500) throw { type: 'network', message: `Ошибка сервера TorBox (${status})` };
            if (status >= 400) throw { type: 'network', message: `Ошибка клиента (${status})` };
            if (!txt) throw { type: 'api', message: 'Пустой ответ от сервера' };
            try {
                if (typeof txt === 'string' && txt.startsWith('http')) return { success: true, url: txt };
                const j = typeof txt === 'object' ? txt : JSON.parse(txt);
                if (j?.success === false) {
                    const errorMsg = j.detail || j.message || 'Неизвестная ошибка API';
                    throw { type: 'api', message: errorMsg };
                }
                return j;
            } catch (e) {
                if (e.type) throw e;
                throw { type: 'api', message: 'Некорректный JSON в ответе' };
            }
        };

        const request = async (url, opt = {}, signal) => {
            if (!CFG.proxyUrl) throw { type: 'validation', message: 'CORS-proxy не задан в настройках' };

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), DEF.API_TIMEOUT_MS);
            if (signal) signal.addEventListener('abort', () => controller.abort());

            const proxy = `${CFG.proxyUrl}?url=${encodeURIComponent(url)}`;

            opt.headers = opt.headers || {};
            if (opt.is_torbox_api !== false) opt.headers['X-Api-Key'] = CFG.apiKey;
            delete opt.headers['Authorization']; // Lampa может добавлять свой заголовок
            try {
                const res = await fetch(proxy, { ...opt, signal: controller.signal });
                const text = await res.text();
                return _process(text, res.status);
            } catch (e) {
                if (e.name === 'AbortError') {
                    if (!signal || !signal.aborted) throw { type: 'network', message: `Таймаут запроса (${DEF.API_TIMEOUT_MS / 1000} сек)` };
                    throw e; // Повторно выбрасываем ошибку отмены
                }
                throw { type: 'network', message: e.message || 'Неизвестная сетевая ошибка' };
            } finally {
                clearTimeout(timeoutId);
            }
        };

        const searchPublicTrackers = async (movie, signal) => {
            for (const p of PUBLIC_PARSERS) {
                const qs = new URLSearchParams({
                    apikey: p.key,
                    Query: `${movie.title} ${movie.year || ''}`.trim(),
                    title: movie.title,
                    title_original: movie.original_title,
                    Category: '2000,5000'
                });
                if (movie.year) qs.append('year', movie.year);
                const u = `https://${p.url}/api/v2.0/indexers/all/results?${qs}`;
                LOG('Запрос к парсеру:', p.name, u);
                try {
                    const j = await request(u, { method: 'GET', is_torbox_api: false }, signal);
                    if (j && Array.isArray(j.Results) && j.Results.length) {
                        LOG('Парсер успешно ответил:', p.name, j.Results.length);
                        return j.Results;
                    }
                    LOG('Парсер вернул пустой результат:', p.name);
                } catch (err) {
                    LOG('Ошибка парсера:', p.name, err.message);
                }
            }
            throw { type: 'api', message: 'Все публичные парсеры недоступны или без результатов' };
        };

        const checkCached = async (hashes, signal) => {
            if (!hashes.length) return {};
            const data = {};
            for (let i = 0; i < hashes.length; i += 100) {
                const chunk = hashes.slice(i, i + 100);
                const qs = new URLSearchParams({ format: 'object', list_files: 'false' });
                chunk.forEach(h => qs.append('hash', h));
                try {
                    const r = await request(`${MAIN}/torrents/checkcached?${qs}`, { method: 'GET' }, signal);
                    if (r?.data) Object.assign(data, r.data);
                } catch (e) {
                    LOG('Ошибка проверки кэша для чанка:', e.message);
                }
            }
            return data;
        };

        const addMagnet = (magnet, signal) => {
            const fd = new FormData();
            fd.append('magnet', magnet);
            fd.append('seed', '3');
            return request(`${MAIN}/torrents/createtorrent`, {
                method: 'POST',
                body: fd
            }, signal);
        };

        const myList = async (id, s) => {
            const json = await request(`${MAIN}/torrents/mylist?id=${id}&bypass_cache=true`, { method: 'GET' }, s);
            if (json?.data && !Array.isArray(json.data)) {
                json.data = [json.data];
            }
            return json;
        };
        const requestDl = (tid, fid, s) => request(`${MAIN}/torrents/requestdl?torrent_id=${tid}&file_id=${fid}&token=${CFG.apiKey}`, { method: 'GET' }, s);

        return { searchPublicTrackers, checkCached, addMagnet, myList, requestDl };
    })();

    const ErrorHandler = {
        show(err) {
            const type = err.type || 'unknown';
            const msg = err.message || 'Произошла неизвестная ошибка';
            Lampa.Noty.show(`${type === 'network' ? 'Сетевая ошибка' : 'Ошибка'}: ${msg}`, { type: 'error' });
            LOG('Обработана ошибка:', type, msg, err);
        }
    };

    function generateSearchCombinations(movie) {
        const combinations = new Set();
        const title = movie.title?.trim();
        const orig_title = movie.original_title?.trim();
        const year = (movie.release_date || movie.first_air_date || '').slice(0, 4);

        const add = (val) => val && combinations.add(val.trim().replace(/\s+/g, ' '));

        if (title) {
            add(title);
            if (year) add(`${title} ${year}`);
        }

        if (orig_title && orig_title.toLowerCase() !== title.toLowerCase()) {
            add(orig_title);
            if (year) add(`${orig_title} ${year}`);
            add(`${title} / ${orig_title}`);
        }

        return Array.from(combinations).filter(Boolean);
    }

    // ───────────────────── component ▸ Main List Component ────────────────
    function MainComponent(object) {
        let scroll, files, filter, last, abort, cached_toggle_button;
        let initialized = false;
        let isRendering = false; // Флаг для предотвращения гонки состояний

        this.activity = object.activity;

        const sort_types = [
            { key: 'seeders', title: 'По сидам', field: 'last_known_seeders', reverse: true },
            { key: 'size_desc', title: 'По размеру (убыв.)', field: 'size', reverse: true },
            { key: 'size_asc', title: 'По размеру (возр.)', field: 'size', reverse: false },
            { key: 'age', title: 'По дате', field: 'publish_timestamp', reverse: true }
        ];
        const defaultFilters = { quality: 'all', tracker: 'all', video_type: 'all', translation: 'all', lang: 'all', video_codec: 'all', audio_codec: 'all' };

        let state = {
            all_torrents: [],
            sort: Store.get('torbox_sort_method', 'seeders'),
            filters: Utils.parseJSON(Store.get('torbox_filters_v2'), defaultFilters),
            last_focused_hash: null,
            view: 'torrents',
            current_torrent_data: null,
            search_query: null,
            show_only_cached: Store.get('torbox_show_only_cached', '0') === '1',
        };

        const procRaw = (raw, hash, cachedSet) => {
            const v = raw.ffprobe?.find(s => s.codec_type === 'video');
            const a = raw.ffprobe?.filter(s => s.codec_type === 'audio') || [];
            const tech_info = {
                video_codec: v?.codec_name,
                video_resolution: v ? `${v.width}x${v.height}` : null,
                audio_langs: [...new Set(a.map(s => s.tags?.language).filter(Boolean))],
                audio_codecs: [...new Set(a.map(s => s.codec_name).filter(Boolean))],
                has_hdr: /hdr/i.test(raw.Title) || raw.info?.videotype?.toLowerCase() === 'hdr',
                has_dv: /dv|dolby vision/i.test(raw.Title) || raw.info?.videotype?.toLowerCase() === 'dovi',
            };
            const is_cached = cachedSet.has(hash.toLowerCase());
            const publishDate = raw.PublishDate ? new Date(raw.PublishDate) : null;

            return {
                title: Utils.escapeHtml(raw.Title),
                size: raw.Size,
                magnet: raw.MagnetUri,
                hash,
                last_known_seeders: raw.Seeders,
                last_known_peers: raw.Peers || raw.Leechers,
                trackers: (raw.Tracker || '').split(/, ?/).filter(Boolean),
                icon: is_cached ? '⚡' : '☁️',
                cached: is_cached,
                publish_timestamp: publishDate ? publishDate.getTime() : 0,
                quality: Utils.getQualityLabel(raw.Title, raw),
                video_type: raw.info?.videotype?.toLowerCase(),
                voices: raw.info?.voices,
                ...tech_info,
                info_formated: `[${Utils.getQualityLabel(raw.Title, raw)}] ${Utils.formatBytes(raw.Size)} | 🟢<span style="color:var(--color-good);">${raw.Seeders || 0}</span> / 🔴<span style="color:var(--color-bad);">${raw.Peers || 0}</span>`,
                meta_formated: `Трекер: ` + ((raw.Tracker || '').split(/, ?/)[0] || 'н/д') + ` | Добавлено: ` + (Utils.formatAge(raw.PublishDate) || 'н/д'),
                tech_bar_html: this.buildTechBar(tech_info, raw)
            };
        };

        this.buildTechBar = function (t, raw) {
            const tag = (txt, cls) => `<div class="torbox-item__tech-item torbox-item__tech-item--${cls}">${txt}</div>`;
            let inner_html = '';
            if (t.video_resolution) inner_html += tag(Utils.escapeHtml(t.video_resolution), 'res');
            if (t.video_codec) inner_html += tag(Utils.escapeHtml(t.video_codec.toUpperCase()), 'codec');
            if (t.has_hdr) inner_html += tag('HDR', 'hdr');
            if (t.has_dv) inner_html += tag('DV', 'dv');

            const audioStreams = raw.ffprobe?.filter(s => s.codec_type === 'audio') || [];
            let voiceIndex = 0;
            audioStreams.forEach(s => {
                let lang_or_voice = s.tags?.language?.toUpperCase() || s.tags?.LANGUAGE?.toUpperCase();
                if (!lang_or_voice || lang_or_voice === 'UND') {
                    lang_or_voice = raw.info?.voices?.[voiceIndex++] || null;
                }
                const codec = s.codec_name?.toUpperCase() || '';
                const layout = s.channel_layout || '';
                const displayText = [lang_or_voice, codec, layout].filter(Boolean).join(' ').trim();
                if (displayText) inner_html += tag(Utils.escapeHtml(displayText), 'audio');
            });
            return inner_html ? `<div class="torbox-item__tech-bar">${inner_html}</div>` : '';
        }

        const search = (force = false, customTitle = null) => {
            if (abort) abort.abort();
            abort = new AbortController();
            const signal = abort.signal;

            this.activity.loader(true);
            this.reset();

            state.search_query = customTitle;
            const movieForSearch = customTitle ? { ...object.movie, title: customTitle, original_title: customTitle, year: '' } : object.movie;
            const key = customTitle ? `torbox_custom_search_${customTitle}` : `torbox_hybrid_${object.movie.id || object.movie.imdb_id}`;

            const cachedData = Cache.get(key);
            if (!force && cachedData) {
                state.all_torrents = cachedData;
                LOG('Загрузка торрентов из кэша.');
                this.build();
                this.activity.loader(false);
                return;
            }

            this.empty(customTitle ? `Поиск по запросу: "${customTitle}"...` : 'Получение списка…');

            Api.searchPublicTrackers(movieForSearch, signal)
                .then(raw => {
                    if (signal.aborted) return;
                    if (!raw.length) throw { type: 'api', message: 'Парсер не вернул результатов' };
                    const withHash = raw.map(r => ({ raw: r, hash: r.MagnetUri?.match(/urn:btih:([a-fA-F0-9]{40})/i)?.[1] })).filter(item => item.hash);
                    if (!withHash.length) throw { type: 'api', message: 'Не найдено валидных торрентов' };
                    this.empty(`Проверка кэша (${withHash.length})...`);
                    return Api.checkCached(withHash.map(x => x.hash), signal).then(cached => ({ withHash, cached }));
                })
                .then(({ withHash, cached }) => {
                    if (signal.aborted) return;
                    const cachedSet = new Set(Object.keys(cached).map(h => h.toLowerCase()));
                    state.all_torrents = withHash.map(({ raw, hash }) => procRaw(raw, hash, cachedSet));
                    Cache.set(key, state.all_torrents);
                    this.build();
                })
                .catch(err => {
                    if (signal.aborted) return;
                    this.empty(err.message || 'Ошибка');
                    ErrorHandler.show(err);
                })
                .finally(() => {
                    if (!signal.aborted) this.activity.loader(false);
                });
        };

        const play = async (torrent_data, file, on_end) => {
            try {
                if (object.movie.id) Lampa.Favorite.add('history', object.movie);
                const dlResponse = await Api.requestDl(torrent_data.id, file.id);
                const link = dlResponse.url || dlResponse.data;
                if (!link) throw { type: 'api', message: 'Не удалось получить ссылку на файл' };

                const mid = object.movie.imdb_id || object.movie.id;
                const torrent_id = torrent_data.hash || torrent_data.id;
                const key = `torbox_watched_episodes_${mid}_${torrent_id}`;
                let watched_episodes = Utils.parseJSON(Store.get(key), []);
                if (!watched_episodes.includes(file.id)) watched_episodes.push(file.id);
                Store.set(key, JSON.stringify(watched_episodes));
                Store.set(`torbox_last_played_file_${mid}`, file.id);

                const cleanName = file.name.split('/').pop();
                const playerConfig = {
                    url: link,
                    title: cleanName || object.movie.title,
                    poster: Lampa.Utils.cardImgBackgroundBlur(object.movie),
                    id: object.movie.id,
                    movie: object.movie
                };
                const seasonMatch = cleanName.match(/[Ss](\d{1,2})/);
                const episodeMatch = cleanName.match(/[Ee](\d{1,3})/);
                if (seasonMatch) playerConfig.season = parseInt(seasonMatch[1], 10);
                if (episodeMatch) playerConfig.episode = parseInt(episodeMatch[1], 10);

                Lampa.Player.play(playerConfig);
                Lampa.Player.callback(on_end || (() => {}));
            } catch (e) {
                ErrorHandler.show(e);
            }
        };

        const onTorrentClick = (torrent) => {
            if (!torrent.magnet || !torrent.hash) return ErrorHandler.show({ type: 'validation', message: 'Magnet-ссылка или хеш не найдены' });

            const mid = object.movie.imdb_id || object.movie.id;
            try {
                Store.set(`torbox_last_torrent_data_${mid}`, JSON.stringify(torrent));
                if (torrent.markAsLastPlayed) setTimeout(() => torrent.markAsLastPlayed(), 100);
                updateContinueWatchingPanel();
            } catch (e) {
                LOG('Не удалось обновить данные о последнем торренте', e);
            }

            const abort = new AbortController();
            const signal = abort.signal;
            const storage_key = `torbox_id_for_hash_${torrent.hash}`;
            const saved_torbox_id = Store.get(storage_key);

            Lampa.Loading.start(() => abort.abort(), 'TorBox: Обработка...');

            const addAndTrack = (magnet, hash) => {
                Api.addMagnet(magnet, signal)
                    .then(res => {
                        const new_torbox_id = res.data?.torrent_id || res.data?.id;
                        if (!new_torbox_id) throw { type: 'api', message: 'ID торрента не получен после добавления' };
                        Store.set(storage_key, new_torbox_id);
                        LOG(`Сохранен новый ID TorBox: ${new_torbox_id} для хеша ${hash}`);
                        return track(new_torbox_id, signal);
                    })
                    .then(data => processTrackedData(data, hash))
                    .catch(handleTrackingError);
            };

            const processTrackedData = (data, hash) => {
                data.hash = hash;
                Lampa.Loading.stop();
                selectFile(data);
            };

            const handleTrackingError = (err) => {
                // Всегда останавливаем загрузку, независимо от типа ошибки.
                Lampa.Loading.stop();
            
                // Если это была отмена пользователем, просто выходим, не показывая ошибку.
                if (err.name === 'AbortError') {
                    LOG('Операция отменена пользователем.');
                    return;
                }
                
                // Для всех остальных ошибок показываем уведомление.
                ErrorHandler.show(err);
            };

            if (saved_torbox_id) {
                LOG(`Найден сохраненный ID TorBox: ${saved_torbox_id}`);
                track(saved_torbox_id, signal)
                    .then(data => processTrackedData(data, torrent.hash))
                    .catch(err => {
                        if ((err.type === 'api' || err.message?.includes('not found')) && err.name !== 'AbortError') {
                            LOG(`Устаревший ID TorBox ${saved_torbox_id}. Повторное добавление.`);
                            Store.set(storage_key, '');
                            addAndTrack(torrent.magnet, torrent.hash);
                        } else {
                            handleTrackingError(err);
                        }
                    });
            } else {
                LOG(`Сохраненный ID TorBox не найден. Добавление нового магнета.`);
                addAndTrack(torrent.magnet, torrent.hash);
            }
        };

        const track = (id, signal) => {
            return new Promise((resolve, reject) => {
                let active = true;
                const cancel = () => {
                    if (!active) return;
                    active = false;
                    signal.removeEventListener('abort', cancel);
                    reject({ name: 'AbortError', message: 'Отменено пользователем' });
                };
                signal.addEventListener('abort', cancel);

                const poll = async () => {
                    if (!active) return;
                    try {
                        const d = (await Api.myList(id, signal)).data[0];
                        if (!d) {
                            if (active) setTimeout(poll, DEF.TRACK_INTERVAL_MS);
                            return;
                        }
                        const is_finished_by_state = d.download_state === 'completed' || d.download_state === 'uploading' || d.download_finished;
                        
                        // Если торрент готов к просмотру (завершен и файлы доступны)
                        if (is_finished_by_state && d.files?.length) {
                            active = false;
                            signal.removeEventListener('abort', cancel);
                            resolve(d);
                        } else {
                            let status_text;
                            const progress = parseFloat(d.progress);

                            // FIX: Если загрузка завершена (по статусу или процентам), но файлы еще не готовы, показываем статус обработки
                            if (is_finished_by_state || progress >= 1) {
                                status_text = 'Обработка торрента... Ожидание файлов...';
                            } else {
                                // Иначе показываем обычный статус загрузки
                                const perc = progress * 100;
                                const speed = Utils.formatBytes(d.download_speed, true);
                                const eta = Utils.formatTime(d.eta);
                                status_text = `Загрузка: ${perc.toFixed(2)}% | ${speed} | 👤 ${d.seeds || 0}/${d.peers || 0} | ⏳ ${eta}`;
                            }
                            
                            $('.loading-layer .loading-layer__text').text(status_text);
                            
                            if (active) setTimeout(poll, DEF.TRACK_INTERVAL_MS);
                        }
                    } catch (e) {
                        if (active) {
                            active = false;
                            signal.removeEventListener('abort', cancel);
                            reject(e);
                        }
                    }
                };
                poll();
            });
        };

        const selectFile = (torrent_data) => {
            const vids = torrent_data.files.filter(f => /\.mkv|mp4|avi$/i.test(f.name)).sort(Utils.naturalSort);
            if (!vids.length) return ErrorHandler.show({ type: 'validation', message: 'Видеофайлы не найдены' });
            if (vids.length === 1) return play(torrent_data, vids[0]);
            
            state.view = 'episodes';
            state.current_torrent_data = torrent_data;
            drawEpisodes(torrent_data);
        };

        const drawEpisodes = (torrent_data) => {
            scroll.clear();
            filter.render().hide();

            const mid = object.movie.imdb_id || object.movie.id;
            const lastPlayedId = Store.get(`torbox_last_played_file_${mid}`, null);
            const torrent_id = torrent_data.hash || torrent_data.id;
            const watched_episodes = Utils.parseJSON(Store.get(`torbox_watched_episodes_${mid}_${torrent_id}`), []);
            const vids = torrent_data.files.filter(f => /\.mkv|mp4|avi$/i.test(f.name)).sort(Utils.naturalSort);
            let last_focused_element = null;

            vids.forEach(file => {
                const isWatched = watched_episodes.includes(file.id);
                const cleanName = file.name.split('/').pop();
                let item = Lampa.Template.get('torbox_episode_item', { title: cleanName, size: Utils.formatBytes(file.size), file_id: file.id });
                item.on('hover:focus', (e) => { last = e.target; scroll.update($(e.target), true); })
                    .on('hover:enter', () => {
                        if (!item.hasClass('torbox-file-item--watched')) {
                            item.addClass('torbox-file-item--watched');
                            let watched = Utils.parseJSON(Store.get(`torbox_watched_episodes_${mid}_${torrent_id}`), []);
                            if (!watched.includes(file.id)) {
                                watched.push(file.id);
                                Store.set(`torbox_watched_episodes_${mid}_${torrent_id}`, JSON.stringify(watched));
                            }
                        }
                        play(torrent_data, file, () => {
                            drawEpisodes(torrent_data);
                            Lampa.Controller.toggle('content');
                        });
                    });
                if (isWatched) item.addClass('torbox-file-item--watched');
                if (String(file.id) === lastPlayedId) {
                    item.addClass('torbox-file-item--last-played');
                    last_focused_element = item;
                }
                scroll.append(item);
            });

            if (last_focused_element) {
                last = last_focused_element[0];
                scroll.update(last_focused_element, true);
            }
            Lampa.Controller.enable('content');
        };

        this.create = function () {
            scroll = new Lampa.Scroll({ mask: true, over: true, step: 250 });
            files = new Lampa.Explorer(object);
            filter = new Lampa.Filter(object);
            this.activity.loader(false);
            scroll.body().addClass('torbox-list-container');
            files.appendFiles(scroll.render());
            files.appendHead(filter.render());
            scroll.minus(files.render().find('.explorer__files-head'));
            return this.render();
        };

        this.render = () => files.render();

        this.empty = function (msg) {
            scroll.clear();
            let emptyElem = Lampa.Template.get('torbox_empty', { message: msg || 'Торренты не найдены' });
            emptyElem.addClass('selector');
            emptyElem.on('hover:focus', (e) => { last = e.target; scroll.update($(e.target), true); });
            scroll.append(emptyElem);
            Lampa.Controller.enable('content');
        };

        this.reset = function () {
            last = false;
            if (scroll) {
                scroll.clear();
                scroll.reset();
            }
        };

        this.build = function () {
            if (isRendering) return;
            isRendering = true;
            this.buildFilter();
            if (cached_toggle_button) {
                const is_cached_only = state.show_only_cached;
                cached_toggle_button.toggleClass('filter__item--active', is_cached_only);
                cached_toggle_button.find('span').text(is_cached_only ? '⚡' : '☁️');
                cached_toggle_button.attr('title', is_cached_only ? 'Показаны только кэшированные' : 'Показать все');
            }
            this.draw(this.applyFiltersSort());
            isRendering = false;
        };

        this.buildFilter = function () {
            const build = (key, title, arr) => {
                const uni = [...new Set(arr.flat().filter(Boolean))].sort();
                const items = ['all', ...uni].map(v => ({ title: v === 'all' ? 'Все' : v.toUpperCase(), value: v, selected: state.filters[key] === v }));
                const sub = state.filters[key] === 'all' ? 'Все' : state.filters[key].toUpperCase();
                return { title, subtitle: sub, items, stype: key };
            };
            const f_items = [
                { title: 'Уточнить поиск', refine: true },
                build('quality', 'Качество', state.all_torrents.map(t => t.quality)),
                build('video_type', 'Тип видео', state.all_torrents.map(t => t.video_type)),
                build('translation', 'Перевод', state.all_torrents.map(t => t.voices)),
                build('lang', 'Язык аудио', state.all_torrents.map(t => t.audio_langs)),
                build('video_codec', 'Видео кодек', state.all_torrents.map(t => t.video_codec)),
                build('audio_codec', 'Аудио кодек', state.all_torrents.map(t => t.audio_codecs)),
                build('tracker', 'Трекер', state.all_torrents.map(t => t.trackers)),
                { title: 'Сбросить фильтры', reset: true },
                { title: 'Обновить список', refresh: true }
            ];
            filter.set('filter', f_items);
            filter.render().find('.filter--filter span').text('Фильтр');
            filter.render().find('.filter--search input').attr('placeholder', state.search_query || object.movie.title);
            const subTitles = f_items.filter(f => f.stype && state.filters[f.stype] !== 'all').map(f => `${f.title}: ${state.filters[f.stype]}`);
            filter.chosen('filter', subTitles);

            const sort_items = sort_types.map(i => ({ ...i, selected: i.key === state.sort }));
            filter.set('sort', sort_items);
            filter.render().find('.filter--sort span').text('Сортировка');
        };

        this.applyFiltersSort = function () {
            let list = state.all_torrents.filter(t => {
                if (state.show_only_cached && !t.cached) return false;
                if (state.filters.quality !== 'all' && t.quality !== state.filters.quality) return false;
                if (state.filters.video_type !== 'all' && t.video_type !== state.filters.video_type) return false;
                if (state.filters.translation !== 'all' && !(t.voices || []).includes(state.filters.translation)) return false;
                if (state.filters.lang !== 'all' && !(t.audio_langs || []).includes(state.filters.lang)) return false;
                if (state.filters.video_codec !== 'all' && t.video_codec !== state.filters.video_codec) return false;
                if (state.filters.audio_codec !== 'all' && !(t.audio_codecs || []).includes(state.filters.audio_codec)) return false;
                if (state.filters.tracker !== 'all' && !(t.trackers || []).includes(state.filters.tracker)) return false;
                return true;
            });
            const s = sort_types.find(s => s.key === state.sort);
            if (s) {
                list.sort((a, b) => {
                    let va = a[s.field] || 0, vb = b[s.field] || 0;
                    if (va < vb) return -1;
                    if (va > vb) return 1;
                    return 0;
                });
                if (s.reverse) list.reverse();
            }
            return list;
        };

        this.draw = function (items) {
            last = false;
            scroll.clear();

            if (!items.length) return this.empty('Ничего не найдено по заданным фильтрам');

            const mid = object.movie.imdb_id || object.movie.id;
            const lastWatched = Utils.parseJSON(Store.get(`torbox_last_torrent_data_${mid}`), {});
            const lastHash = lastWatched.hash;

            items.forEach(item_data => {
                try {
                    item_data.last_played_icon = (lastHash && item_data.hash === lastHash) ? `<span class="torbox-item__last-played-icon"><svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5V7.5l5.25 3.5L11 16.5z" fill="currentColor"></path></svg></span>` : '';
                    let item = Lampa.Template.get('torbox_item', item_data);
                    item_data.markAsLastPlayed = () => {
                        scroll.render().find('.torbox-item__last-played-icon').remove();
                        const icon_html = `<span class="torbox-item__last-played-icon"><svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5V7.5l5.25 3.5L11 16.5z" fill="currentColor"></path></svg></span>`;
                        const titleElement = item.find('.torbox-item__title');
                        if (titleElement.length && !titleElement.find('.torbox-item__last-played-icon').length) {
                            titleElement.prepend(icon_html);
                        }
                        Store.set(`torbox_last_torrent_data_${mid}`, JSON.stringify(item_data));
                    };
                    item.on('hover:focus', (e) => { last = e.target; state.last_focused_hash = item_data.hash; scroll.update($(e.target), true); })
                        .on('hover:enter', () => onTorrentClick(item_data))
                        .on('hover:long', () => {
                            Lampa.Select.show({
                                title: 'Действия',
                                items: [{ title: 'Скопировать Magnet' }],
                                onSelect: () => { Lampa.Utils.copyTextToClipboard(item_data.magnet, () => Lampa.Noty.show('Magnet-ссылка скопирована')); Lampa.Controller.toggle('content'); },
                                onBack: () => Lampa.Controller.toggle('content')
                            });
                        });
                    scroll.append(item);
                } catch (e) {
                    LOG(`Ошибка рендеринга элемента: [${item_data.title}]`, e);
                }
            });

            let focus_element = scroll.render().find(`[data-hash="${state.last_focused_hash}"]`);
            if (!focus_element.length) focus_element = scroll.render().find('.selector').first();
            if (focus_element.length) {
                last = focus_element[0];
                scroll.update(focus_element, true);
            }
            Lampa.Controller.enable('content');
            updateContinueWatchingPanel();
        };

        const updateContinueWatchingPanel = () => {
            if (state.view !== 'torrents') return;
            const mid = object.movie.imdb_id || object.movie.id;
            const lastWatchedData = Store.get(`torbox_last_torrent_data_${mid}`);
            let panel = scroll.body().find('.torbox-watched-item');
            if (lastWatchedData) {
                const lastTorrent = Utils.parseJSON(lastWatchedData, {});
                const info_text = lastTorrent.title;
                if (panel.length) {
                    panel.find('.torbox-watched-item__info').text(info_text);
                } else {
                    const historyItem = Lampa.Template.get('torbox_watched_item', { title: 'Продолжить просмотр', info: info_text });
                    historyItem.on('hover:focus', (e) => { last = e.target; scroll.update($(e.target), true); })
                               .on('hover:enter', () => onTorrentClick(lastTorrent));
                    scroll.body().prepend(historyItem);
                }
            } else if (panel.length) {
                panel.remove();
            }
        };

        this.initialize = function () {
            Lampa.Controller.add('content', {
                toggle: () => { Lampa.Controller.collectionSet(filter.render(), scroll.render()); Lampa.Controller.collectionFocus(last || false, scroll.render()); },
                up: () => { 
                    // FIX: Улучшенная логика навигации вверх
                    if (!Navigator.canmove('up')) {
                        Lampa.Controller.toggle('head');
                    } else {
                        Navigator.move('up');
                    }
                },
                down: () => { Navigator.move('down'); }, // Lampa сама справится с переходом с head
                left: () => { Navigator.canmove('left') ? Navigator.move('left') : Lampa.Controller.toggle('menu'); },
                right: () => { Navigator.canmove('right') ? Navigator.move('right') : filter.show(Lampa.Lang.translate('title_filter'), 'filter'); },
                back: this.back.bind(this)
            });
            Lampa.Controller.toggle('content');

            filter.onSelect = (type, a, b) => {
                Lampa.Select.close();
                if (last && last.getAttribute) state.last_focused_hash = last.getAttribute('data-hash'); // Сохраняем фокус
                if (type === 'sort') { state.sort = a.key; Store.set('torbox_sort_method', a.key); } 
                else if (type === 'filter') {
                    if (a.refine) {
                        const combinations = generateSearchCombinations(object.movie);
                        if (!combinations.length) return Lampa.Noty.show('Недостаточно данных для создания комбинаций поиска.');
                        Lampa.Select.show({
                            title: 'Уточнить поиск',
                            items: combinations.map(c => ({ title: c, search_query: c })),
                            onSelect: (selected) => { search(true, selected.search_query); Lampa.Controller.toggle('content'); },
                            onBack: () => Lampa.Controller.toggle('content')
                        });
                        return;
                    }
                    if (a.refresh) return search(true, state.search_query);
                    if (a.reset) state.filters = { ...defaultFilters };
                    else if (a.stype) state.filters[a.stype] = b.value;
                    Store.set('torbox_filters_v2', JSON.stringify(state.filters));
                }
                this.build();
                Lampa.Controller.toggle('content');
            };

            // FIX: Явный переход фокуса с панели фильтров вниз на список
            filter.onDown = () => {
                const first_item = scroll.body().find('.selector').first();
                if (first_item.length) {
                    Lampa.Controller.focus(first_item[0]);
                }
            };
            
            filter.onBack = () => this.start();
            filter.onSearch = (value) => search(true, value);
            if (filter.addButtonBack) filter.addButtonBack();

            cached_toggle_button = $(`<div class="filter__item selector torbox-cached-toggle"><span></span></div>`);
            cached_toggle_button.on('hover:enter', () => {
                state.show_only_cached = !state.show_only_cached;
                Store.set('torbox_show_only_cached', state.show_only_cached ? '1' : '0');
                if (last && last.getAttribute) state.last_focused_hash = last.getAttribute('data-hash');
                this.build();
            });
            filter.render().find('.filter--sort').before(cached_toggle_button);

            this.empty('Загрузка...');
            search();
        };

        this.start = function () {
            if (Lampa.Activity.active().activity !== this.activity) return;
            Lampa.Background.immediately(Lampa.Utils.cardImgBackgroundBlur(object.movie));
            if (!initialized) {
                initialized = true;
                this.initialize();
            } else {
                this.build();
                Lampa.Controller.toggle('content');
            }
        };

        this.back = function () {
            if (state.view === 'episodes') {
                state.view = 'torrents';
                filter.render().show();
                this.build();
            } else {
                if (abort) abort.abort();
                Lampa.Activity.backward();
            }
        };

        this.destroy = function () {
            if (abort) abort.abort();
            Lampa.Controller.clear('content');
            // Явная очистка ресурсов и обработчиков для предотвращения утечек памяти
            if (cached_toggle_button) cached_toggle_button.off();
            if (scroll) scroll.destroy();
            if (files) files.destroy();
            if (filter) filter.destroy();
            scroll = files = filter = last = abort = cached_toggle_button = null;
        };
        this.pause = this.stop = () => {};
    }

    // ───────────────────── plugin ▸ main integration ──────────────────
    (function () {
        const manifest = {
            type: 'video',
            version: '51.0.6',
            name: 'TorBox',
            description: 'Плагин для просмотра торрентов через TorBox (Refactored)',
            component: 'torbox_main',
        };

        function addTemplates() {
            Lampa.Template.add('torbox_item', '<div class="torbox-item selector" data-hash="{hash}"><div class="torbox-item__title">{last_played_icon}{icon} {title}</div><div class="torbox-item__main-info">{info_formated}</div><div class="torbox-item__meta">{meta_formated}</div>{tech_bar_html}</div>');
            Lampa.Template.add('torbox_empty', '<div class="empty"><div class="empty__text">{message}</div></div>');
            Lampa.Template.add('torbox_watched_item', '<div class="torbox-watched-item selector"><div class="torbox-watched-item__icon"><svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5V7.5l5.25 3.5L11 16.5z" fill="currentColor"></path></svg></div><div class="torbox-watched-item__body"><div class="torbox-watched-item__title">{title}</div><div class="torbox-watched-item__info">{info}</div></div></div>');
            Lampa.Template.add('torbox_episode_item', '<div class="torbox-file-item selector" data-file-id="{file_id}"><div class="torbox-file-item__title">{title}</div><div class="torbox-file-item__subtitle">{size}</div></div>');
        }

        function addSettings() {
            if (!Lampa.SettingsApi) return;
            Lampa.SettingsApi.addComponent({ component: 'torbox_enh', name: 'TorBox', icon: ICON });
            [
                { k: 'torbox_proxy_url', n: 'URL CORS-прокси', d: 'Введите URL для CORS-прокси', t: 'input', v: CFG.proxyUrl },
                { k: 'torbox_api_key', n: 'API-Key', d: 'Введите ваш API-ключ от TorBox', t: 'input', v: CFG.apiKey },
                { k: 'torbox_debug', n: 'Debug-режим', d: 'Выводить лог в консоль', t: 'trigger', v: CFG.debug }
            ].forEach(p => {
                Lampa.SettingsApi.addParam({
                    component: 'torbox_enh',
                    param: { name: p.k, type: p.t, values: '', default: p.v },
                    field: { name: p.n, description: p.d },
                    onChange: v => {
                        const val = typeof v === 'object' ? v.value : v;
                        if (p.k === 'torbox_proxy_url') CFG.proxyUrl = String(val).trim();
                        if (p.k === 'torbox_api_key') CFG.apiKey = String(val).trim();
                        if (p.k === 'torbox_debug') CFG.debug = Boolean(val);
                    },
                    onRender: f => { if (p.k === 'torbox_api_key') f.find('input').attr('type', 'password'); }
                });
            });
        }

        function boot() {
            Lampa.Component.add('torbox_main', MainComponent);
            addTemplates();
            addSettings();
            Lampa.Listener.follow('full', e => {
                if (e.type !== 'complite' || !e.data.movie) return;
                const root = e.object.activity.render();
                if (!root?.length || root.find('.view--torbox').length) return;
                const btn = $(`<div class="full-start__button selector view--torbox" data-subtitle="TorBox">${ICON}<span>TorBox</span></div>`);
                btn.on('hover:enter', () => {
                    Lampa.Activity.push({ component: 'torbox_main', title: 'TorBox - ' + (e.data.movie.title || e.data.movie.name), movie: e.data.movie });
                });
                // FIX: Возвращена оригинальная, проверенная временем логика вставки кнопки.
                const torrentBtn = root.find('.view--torrent');
                if (torrentBtn.length) {
                    torrentBtn.after(btn);
                } else {
                    root.find('.full-start__play').after(btn);
                }
            });
            const css = document.createElement('style');
            css.id = 'torbox-refactored-styles';
            css.textContent = `
                .torbox-list-container { display: block; padding: 1em; }
                .torbox-item { position: relative; padding: 1em 1.2em; margin: 0 0 1em 0; border-radius: .8em; background: var(--color-background-light); cursor: pointer; transition: all .2s; border: 2px solid transparent; overflow: hidden; }
                .torbox-item:last-child { margin-bottom: 0; }
                .torbox-item__last-played-icon { display: inline-flex; align-items: center; justify-content: center; width: 1.2em; height: 1.2em; margin-right: .5em; color: var(--color-second); flex-shrink: 0; }
                .torbox-item__last-played-icon svg { width: 100%; height: 100%; }
                .torbox-item.focus, .torbox-watched-item.focus, .torbox-file-item.focus { background: var(--color-primary); color: var(--color-background); transform: scale(1.01); border-color: rgba(255, 255, 255, .3); box-shadow: 0 4px 20px rgba(0, 0, 0, .2); }
                .torbox-item__title { font-weight: 600; margin-bottom: .3em; font-size: 1.1em; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; }
                .torbox-item__main-info, .torbox-item__meta { font-size: .95em; opacity: .9; line-height: 1.4; margin-bottom: .3em; }
                .torbox-item__meta { opacity: .7; margin-bottom: .8em; }
                /* FIX: Убран фон и лишние отступы у тех. панели */
                .torbox-item__tech-bar { display: flex; flex-wrap: wrap; gap: .6em; margin-top: .8em; }
                .torbox-item__tech-item { padding: .2em .5em; border-radius: .4em; color: #fff; font-size: .85em; font-weight: 500;}
                .torbox-item__tech-item--res { background: #3b82f6; } .torbox-item__tech-item--codec { background: #16a34a; } .torbox-item__tech-item--audio { background: #f97316; } .torbox-item__tech-item--hdr, .torbox-item__tech-item--dv { background: #8a2be2; }
                .torbox-cached-toggle { display: inline-flex; align-items: center; justify-content: center; border: 2px solid transparent; transition: all .3s; }
                .torbox-cached-toggle span { font-size: 1.5em; line-height: 1; }
                .torbox-cached-toggle.filter__item--active, .torbox-cached-toggle.focus { background: var(--color-primary); color: var(--color-background); border-color: rgba(255, 255, 255, .3); }
                .torbox-file-item { display: flex; justify-content: space-between; align-items: center; padding: 1em 1.2em; margin-bottom: 1em; border-radius: .8em; background: var(--color-background-light); transition: all .2s; border: 2px solid transparent; }
                .torbox-file-item__title { font-weight: 600; } .torbox-file-item__subtitle { font-size: .9em; opacity: .7; }
                .torbox-file-item--last-played { border-left: 4px solid var(--color-second); }
                .torbox-file-item--watched { color: #888; }
                .torbox-watched-item { display: flex; align-items: center; padding: 1em; margin-bottom: 1em; border-radius: .8em; background: var(--color-background-light); border-left: 4px solid var(--color-second); transition: all .2s; border: 2px solid transparent; }
                .torbox-watched-item__icon { flex-shrink: 0; margin-right: 1em; } .torbox-watched-item__icon svg { width: 2em; height: 2em; }
                .torbox-watched-item__body { flex-grow: 1; } .torbox-watched-item__title { font-weight: 600; } .torbox-watched-item__info { font-size: .9em; opacity: .7; }
            `;
            document.head.appendChild(css);
            Lampa.Manifest.plugins[manifest.name] = manifest;
            LOG(`TorBox Refactored v${manifest.version} готов к работе.`);
        }

        if (window.Lampa?.Activity) {
            boot();
        } else {
            Lampa.Listener.follow('app', function (e) {
                if (e.type === 'ready') {
                    boot();
                    this.destroy();
                }
            });
        }
    })();
})();
