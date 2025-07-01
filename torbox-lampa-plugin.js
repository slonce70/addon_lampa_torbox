/* TorBox Lampa Plugin - Rewritten for Stability */
(function () {
    'use strict';

    // ───────────────────────────── guard ──────────────────────────────
    const PLUGIN_ID = 'torbox_lampa_plugin_integrated';
    if (window[PLUGIN_ID]) return;
    window[PLUGIN_ID] = true;

    // ───────────────────── core ▸ UTILS ───────────────────────────────
    const Utils = {
        escapeHtml(str = '') {
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        },
        formatBytes(bytes = 0, speed = false) {
            const B = Number(bytes);
            if (isNaN(B) || B === 0) return speed ? '0 KB/s' : '0 B';
            const k = 1024;
            const sizes = speed
                ? ['B/s', 'KB/s', 'MB/s', 'GB/s']
                : ['B', 'KB', 'MB', 'GB', 'TB'];
            const i = Math.floor(Math.log(B) / Math.log(k));
            return (B / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
        },
        formatTime(sec = 0) {
            const s = parseInt(sec, 10);
            if (isNaN(s) || s < 0) return 'н/д';
            if (s === Infinity || s > 2592000) return '∞';
            const h = Math.floor(s / 3600);
            const m = Math.floor((s % 3600) / 60);
            const r = Math.floor(s % 60);
            return [h ? h + 'ч' : null, m ? m + 'м' : null, r + 'с']
                .filter(Boolean)
                .join(' ');
        },
        formatAge(iso) {
            if (!iso) return 'н/д';
            const d = new Date(iso);
            if (isNaN(d)) return 'н/д';
            const diff = Math.floor((Date.now() - d) / 1000); // sec
            const m = Math.floor(diff / 60);
            const h = Math.floor(m / 60);
            const days = Math.floor(h / 24);
            if (diff < 60) return diff + ' сек. назад';
            if (m < 60) return m + ' хв. назад';
            if (h < 24) return h + ' год. назад';
            return days + ' д. назад';
        },
        getQualityLabel(title = '', raw) {
            if (raw?.info?.quality) return raw.info.quality + 'p';
            if (/2160p|4K|UHD/i.test(title)) return '4K';
            if (/1080p|FHD/i.test(title)) return 'FHD';
            if (/720p|HD/i.test(title)) return 'HD';
            return 'SD';
        },
        naturalSort(a, b) {
            const re = /(\d+)/g;
            const aParts = a.name.split(re);
            const bParts = b.name.split(re);
            for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
                if (i % 2) {
                    const diff =
                        parseInt(aParts[i], 10) - parseInt(bParts[i], 10);
                    if (diff) return diff;
                } else if (aParts[i] !== bParts[i]) {
                    return aParts[i].localeCompare(bParts[i]);
                }
            }
            return a.name.length - b.name.length;
        }
    };

    // ───────────────────── core ▸ STORAGE (safeStorage + Store) ─────────────
    const safeStorage = (() => {
        try {
            localStorage.setItem('__torbox_test', '1');
            localStorage.removeItem('__torbox_test');
            return localStorage;
        } catch {
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
        get(key, def = null) {
            const v = safeStorage.getItem(key);
            return v !== null ? v : def;
        },
        set(key, val) {
            safeStorage.setItem(key, String(val));
        }
    };

    // ───────────────────── core ▸ CACHE (simple LRU) ───────────────────
    const Cache = (() => {
        const map = new Map();
        const LIMIT = 128;
        const TTL_MS = 600000; // 10-минутный кэш
        return {
            get(k) {
                if (!map.has(k)) return null;
                const o = map.get(k);
                if (Date.now() - o.ts > TTL_MS) {
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
                if (map.size > LIMIT) map.delete(map.keys().next().value); // evict oldest
            },
            clear() {
                map.clear();
            }
        };
    })();

    // ───────────────────── core ▸ CONFIG ───────────────────────────────
    const Config = (() => {
        const DEF = {
            proxyUrl: 'https://my-torbox-proxy.slonce70.workers.dev/',
            apiKey: ''
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
    const { CFG, LOG, PUBLIC_PARSERS, ICON } = Config;

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
                     const error = { type: 'api', message: errorMsg, data: j.data };
                     throw error;
                }
                return j;
            } catch (e) {
                if (e.type) throw e;
                throw { type: 'api', message: 'Некорректный JSON в ответе' };
            }
        };

        const request = async (url, opt = {}, signal) => {
            if (!CFG.proxyUrl) throw { type: 'validation', message: 'CORS-proxy не задан в настройках' };

            const TIMEOUT_MS = 20000;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
            if (signal) signal.addEventListener('abort', () => controller.abort());

            const proxy = `${CFG.proxyUrl}?url=${encodeURIComponent(url)}`;
            opt.headers = opt.headers || {};
            if (opt.is_torbox_api !== false) opt.headers['X-Api-Key'] = CFG.apiKey;
            delete opt.headers['Authorization'];
            try {
                const res = await fetch(proxy, { ...opt, signal: controller.signal });
                return _process(await res.text(), res.status);
            } catch (e) {
                if (e.name === 'AbortError') {
                    if (!signal || !signal.aborted) throw { type: 'network', message: `Таймаут запроса (${TIMEOUT_MS / 1000} сек)` };
                    throw e;
                }
                throw { type: 'network', message: e.message };
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
                LOG('Parser', p.name, u);
                try {
                    const j = await request(u, { method: 'GET', is_torbox_api: false }, signal);
                    if (j && Array.isArray(j.Results) && j.Results.length) {
                        LOG('Parser success', p.name, j.Results.length);
                        return j.Results;
                    }
                    LOG('Parser empty', p.name);
                } catch (err) {
                    LOG('Parser fail', p.name, err.message);
                }
            }
            throw { type: 'api', message: 'Все публичные парсеры недоступны или без результатов' };
        };

        const checkCached = async (hashes, signal) => {
            if (!hashes.length) return {};
            const data = {};
            for (let i = 0; i < hashes.length; i += 100) {
                const chunk = hashes.slice(i, i + 100);
                const qs = new URLSearchParams();
                chunk.forEach(h => qs.append('hash', h));
                qs.append('format', 'object');
                qs.append('list_files', 'false');
                try {
                    const r = await request(`${MAIN}/torrents/checkcached?${qs}`, { method: 'GET' }, signal);
                    if (r?.data) Object.assign(data, r.data);
                } catch (e) {
                    LOG('checkCached chunk error', e.message);
                }
            }
            return data;
        };

        const addMagnet = (magnet, signal) => request(`${MAIN}/torrents/createtorrent`, (() => {
            const fd = new FormData();
            fd.append('magnet', magnet);
            fd.append('seed', '3');
            return { method: 'POST', body: fd };
        })(), signal);

        const myList = async (id, s) => {
            const json = await request(`${MAIN}/torrents/mylist?id=${id}&bypass_cache=true`, { method: 'GET' }, s);
            if (json && json.data && !Array.isArray(json.data)) {
                json.data = [json.data];
            }
            return json;
        };
        const requestDl = (tid, fid, s) => request(`${MAIN}/torrents/requestdl?torrent_id=${tid}&file_id=${fid}&token=${CFG.apiKey}`, { method: 'GET' }, s);

        const getQueued = (signal) => request(`${MAIN}/queued/getqueued?bypass_cache=true&offset=0&limit=1000&type=torrent`, { method: 'GET' }, signal);

        const startQueued = (queued_id, signal) => request(`${MAIN}/queued/controlqueued`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ queued_id: Number(queued_id), operation: 'start', all: false })
        }, signal);

        return { searchPublicTrackers, checkCached, addMagnet, myList, requestDl, getQueued, startQueued };
    })();

    const ErrorHandler = {
        show(t, e) {
            const msg = e.message || 'Ошибка';
            Lampa.Noty.show(`${t === 'network' ? 'Сетевая ошибка' : 'Ошибка'}: ${msg}`, { type: 'error' });
            LOG('ERR', t, e);
        }
    };

    // ───────────────────── component ▸ Main List Component ───�����───────────
    function MainComponent(object) {
        let scroll = new Lampa.Scroll({mask: true, over: true, step: 250});
        let files = new Lampa.Explorer(object);
        let filter = new Lampa.Filter(object);
        let last;
        let abort = new AbortController();
        let initialized = false;
        
        this.activity = object.activity;

        let sort_types = [
            { key: 'seeders', title: 'По сидам (убыв.)', field: 'last_known_seeders', reverse: true },
            { key: 'size_desc', title: 'По размеру (убыв.)', field: 'size', reverse: true },
            { key: 'size_asc', title: 'По размеру (возр.)', field: 'size', reverse: false },
            { key: 'age', title: 'По дате добавления', field: 'publish_date', reverse: true }
        ];
        let defaultFilters = { quality: 'all', tracker: 'all', video_type: 'all', translation: 'all', lang: 'all', video_codec: 'all', audio_codec: 'all' };
        
        let state = {
            all_torrents: [],
            sort: Store.get('torbox_sort_method', 'seeders'),
            filters: JSON.parse(Store.get('torbox_filters_v2', JSON.stringify(defaultFilters))),
            last_hash: null,
            view: 'torrents', // 'torrents' or 'episodes'
            current_torrent_data: null,
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
            
            return {
                title: Utils.escapeHtml(raw.Title),
                raw_title: raw.Title,
                size: raw.Size,
                magnet: raw.MagnetUri,
                hash,
                last_known_seeders: raw.Seeders,
                last_known_peers: raw.Peers || raw.Leechers,
                trackers: (raw.Tracker || '').split(/, ?/).filter(Boolean),
                icon: is_cached ? '⚡' : '☁️',
                cached: is_cached,
                publish_date: raw.PublishDate,
                age: Utils.formatAge(raw.PublishDate),
                quality: Utils.getQualityLabel(raw.Title, raw),
                video_type: raw.info?.videotype?.toLowerCase(),
                voices: raw.info?.voices,
                ...tech_info,
                raw_data: raw,
                info_formated: `[${Utils.getQualityLabel(raw.Title, raw)}] ${Utils.formatBytes(raw.Size)} | 🟢<span style="color:var(--color-good);">` + (raw.Seeders || 0) + `</span> / 🔴<span style="color:var(--color-bad);">` + (raw.Peers || 0) + `</span>`,
                meta_formated: `Трекеры: ` + ((raw.Tracker || '').split(/, ?/)[0] || 'н/д') + ` | Добавлено: ` + (Utils.formatAge(raw.PublishDate) || 'н/д'),
                tech_bar_html: this.buildTechBar(tech_info, raw)
            };
        };

        this.buildTechBar = function(t, raw) {
            const tag = (txt, cls) => `<div class="torbox-item__tech-item torbox-item__tech-item--${cls}">${txt}</div>`;
            let inner_html = '';

            if (t.video_resolution) inner_html += tag(t.video_resolution, 'res');
            if (t.video_codec) inner_html += tag(t.video_codec.toUpperCase(), 'codec');
            if (t.has_hdr) inner_html += tag('HDR', 'hdr');
            if (t.has_dv) inner_html += tag('Dolby Vision', 'dv');
        
            const audioStreams = raw.ffprobe?.filter(s => s.codec_type === 'audio') || [];
            let voiceIndex = 0;
        
            audioStreams.forEach(s => {
                let lang_or_voice = s.tags?.language?.toUpperCase() || s.tags?.LANGUAGE?.toUpperCase();
                if (!lang_or_voice || lang_or_voice === 'UND') {
                    if (raw.info?.voices && raw.info.voices[voiceIndex]) {
                        lang_or_voice = raw.info.voices[voiceIndex];
                        voiceIndex++;
                    } else {
                        lang_or_voice = null; 
                    }
                }
                const codec = s.codec_name?.toUpperCase() || '';
                const layout = s.channel_layout || '';
                const displayText = [lang_or_voice, codec, layout].filter(Boolean).join(' ').trim();
                if (displayText) inner_html += tag(displayText, 'audio');
            });
            return inner_html ? `<div class="torbox-item__tech-bar">${inner_html}</div>` : '';
        }

        const search = (force = false) => {
            abort.abort();
            abort = new AbortController();
            const signal = abort.signal;
            
            this.activity.loader(true);
            this.reset();
            
            const key = `torbox_hybrid_${object.movie.id || object.movie.imdb_id}`;
            if (!force && Cache.get(key)) {
                state.all_torrents = Cache.get(key);
                LOG('Loaded torrents from cache.');
                this.build();
                this.activity.loader(false);
                return;
            }

            this.empty('Получение списка…');

            Api.searchPublicTrackers(object.movie, signal)
                .then(raw => {
                    if (signal.aborted) return;
                    if (!raw.length) return this.empty('Парсер не вернул результатов.');
                    const withHash = raw.map(r => {
                        const m = r.MagnetUri.match(/urn:btih:([a-fA-F0-9]{40})/i);
                        return m ? { raw: r, hash: m[1] } : null;
                    }).filter(Boolean);
                    if (!withHash.length) return this.empty('Не найдено валидных торрентов.');
                    this.empty(`Проверка кэша (${withHash.length})…`);
                    return Api.checkCached(withHash.map(x => x.hash), signal)
                        .then(cached => ({ withHash, cached }));
                })
                .then(({withHash, cached}) => {
                    if (signal.aborted) return;
                    const cachedSet = new Set(Object.keys(cached).map(h => h.toLowerCase()));
                    state.all_torrents = withHash.map(({ raw, hash }) => procRaw(raw, hash, cachedSet));
                    Cache.set(key, state.all_torrents);
                    this.build();
                })
                .catch(err => {
                    if (signal.aborted) return;
                    this.empty(err.message || 'Ошибка');
                    ErrorHandler.show(err.type || 'unknown', err);
                })
                .finally(() => {
                    this.activity.loader(false);
                });
        };

        const play = async (torrent_data, file, on_end) => {
            try {
                const dlResponse = await Api.requestDl(torrent_data.id, file.id);
                const link = dlResponse.url || dlResponse.data;
                if (!link) throw { type: 'api', message: 'Не удалось получить ссылку на файл' };
                
                const mid = object.movie.imdb_id || object.movie.id;
                const torrent_id = torrent_data.hash || torrent_data.id;
                const key = `torbox_watched_episodes_${mid}_${torrent_id}`;
                
                let watched_episodes = JSON.parse(Store.get(key, '[]'));
                if (!watched_episodes.includes(file.id)) {
                    watched_episodes.push(file.id);
                }
                Store.set(key, JSON.stringify(watched_episodes));
                Store.set(`torbox_last_played_file_${mid}`, file.id);

                const cleanName = file.name.split('/').pop();
                const playerConfig = { 
                    url: link, 
                    title: cleanName || object.movie.title, 
                    poster: Lampa.Utils.cardImgBackgroundBlur(object.movie) 
                };
                
                Lampa.Player.play(playerConfig);
                Lampa.Player.callback(on_end || (() => {
                    Lampa.Activity.machine.back();
                }));

            } catch (e) {
                ErrorHandler.show(e.type || 'unknown', e);
            }
        };

        const onTorrentClick = async (torrent) => {
            if (!torrent.magnet) {
                return ErrorHandler.show('validation', { message: 'Magnet-ссылка не найдена' });
            }
        
            abort = new AbortController();
            const signal = abort.signal;

            Lampa.Loading.start(() => {
                abort.abort();
            }, 'TorBox: Добавление торрента...');
        
            try {
                const res = await Api.addMagnet(torrent.magnet, signal);
                const tid = res.data.torrent_id || res.data.id;
                if (!tid) throw { type: 'api', message: 'ID торрента не получен' };
        
                const data = await track(tid, signal);
                data.hash = torrent.hash;
                
                // Сохраняем полные данные торрента для истории
                const mid = object.movie.imdb_id || object.movie.id;
                const torrentForHistory = state.all_torrents.find(t => t.hash === torrent.hash) || torrent;
                if (torrentForHistory) {
                     try {
                        Store.set(`torbox_last_torrent_data_${mid}`, JSON.stringify(torrentForHistory));
                    } catch (e) {
                        LOG('Failed to save full torrent data to localStorage', e);
                    }
                }
                
                Lampa.Loading.stop();
                selectFile(data);
        
            } catch (e) {
                if (e.type === 'api' && e.message && e.message.includes('ACTIVE_LIMIT')) {
                    LOG('Active limit reached, attempting to start from queue...');
                    (async () => {
                        try {
                            // New: Check if the error response contains the ID
                            if (e.data && e.data.id) {
                                LOG('Found torrent ID in error response:', e.data.id);
                                await Api.startQueued(e.data.id, signal);
                                const data = await track(torrent.hash, signal);
                                data.hash = torrent.hash;
                                Lampa.Loading.stop();
                                selectFile(data);
                                return;
                            }

                            // Fallback to searching the queue
                            LOG('No ID in error, searching queue...');
                            const queuedResponse = await Api.getQueued(signal);
                            const queuedItems = queuedResponse.data || [];
                            const magnetHash = torrent.magnet.match(/urn:btih:([a-fA-F0-9]{40})/i)[1].toLowerCase();
                            const queuedTorrent = queuedItems.find(item => item.hash.toLowerCase() === magnetHash);

                            if (queuedTorrent) {
                                LOG('Found torrent in queue, ID:', queuedTorrent.id);
                                await Api.startQueued(queuedTorrent.id, signal);
                                const data = await track(torrent.hash, signal);
                                data.hash = torrent.hash;
                                Lampa.Loading.stop();
                                selectFile(data);
                            } else {
                                throw { type: 'api', message: 'Торрент не найден в очереди после ошибки лимита.' };
                            }
                        } catch (queueError) {
                            if (queueError.name !== 'AbortError') {
                                ErrorHandler.show(queueError.type || 'unknown', queueError);
                            }
                            Lampa.Loading.stop();
                        }
                    })();
                } else if (e.name !== 'AbortError') {
                    ErrorHandler.show(e.type || 'unknown', e);
                    Lampa.Loading.stop();
                } else {
                    Lampa.Loading.stop();
                }
            }
        };
        
        const track = (id, signal) => {
            return new Promise((resolve, reject) => {
                let active = true;
                const cancel = () => {
                    if (active) {
                        active = false;
                        signal.removeEventListener('abort', cancel);
                        Lampa.Loading.stop();
                        reject({ name: 'AbortError', message: 'Отменено пользователем' });
                    }
                };
                signal.addEventListener('abort', cancel);
        
                const poll = async () => {
                    if (!active) return;
                    try {
                        const listId = String(id).length === 40 ? `hash:${id}` : id;
                        const d = (await Api.myList(listId, signal)).data[0];
                        if (!d) {
                            if (active) setTimeout(poll, 10000);
                            return;
                        }
                        
                        const is_finished = d.download_state === 'completed' || d.download_state === 'uploading' || d.download_finished;
                        
                        if (is_finished && d.files?.length) {
                            active = false;
                            signal.removeEventListener('abort', cancel);
                            resolve(d);
                        } else {
                            const perc = (parseFloat(d.progress) * 100);
                            const speed = Utils.formatBytes(d.download_speed, true);
                            const eta = Utils.formatTime(d.eta);
                            const status_text = `Загрузка: ${perc.toFixed(2)}% | ${speed} | 👤 ${d.seeds || 0}/${d.peers || 0} | ⏳ ${eta}`;
                            
                            $('.loading-layer .loading-layer__text').text(status_text);
                            
                            if (active) setTimeout(poll, 10000);
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
            if (!vids.length) return ErrorHandler.show('validation', { message: 'Видеофайлы не найдены' });
            
            if (vids.length === 1) {
                play(torrent_data, vids[0]);
            } else {
                state.view = 'episodes';
                state.current_torrent_data = torrent_data;
                drawEpisodes(torrent_data);
            }
        };

        const drawEpisodes = (torrent_data) => {
            scroll.clear();
            filter.render().hide();

            const mid = object.movie.imdb_id || object.movie.id;
            const lastPlayedId = Store.get(`torbox_last_played_file_${mid}`, null);
            const torrent_id = torrent_data.hash || torrent_data.id;
            const watched_episodes = JSON.parse(Store.get(`torbox_watched_episodes_${mid}_${torrent_id}`, '[]'));
            
            const vids = torrent_data.files.filter(f => /\.mkv|mp4|avi$/i.test(f.name)).sort(Utils.naturalSort);

            let last_focused_element = null;

            vids.forEach(file => {
                const isWatched = watched_episodes.includes(file.id);
                const cleanName = file.name.split('/').pop();
                let item = Lampa.Template.get('torbox_episode_item', {
                    title: cleanName,
                    size: Utils.formatBytes(file.size),
                    file_id: file.id
                });

                item.on('hover:focus', (e) => {
                    last = e.target;
                    scroll.update($(e.target), true);
                }).on('hover:enter', () => {
                    play(torrent_data, file, () => {
                        drawEpisodes(torrent_data);
                        Lampa.Controller.toggle('content');
                    });
                });

                if (isWatched) {
                    item.addClass('file-item--watched');
                }
                if (String(file.id) === lastPlayedId) {
                    item.addClass('file-item--last-played');
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
            this.activity.loader(false);
            scroll.body().addClass('torbox-list-container');
            files.appendFiles(scroll.render());
            files.appendHead(filter.render());
            scroll.minus(files.render().find('.explorer__files-head'));
            return this.render();
        };

        this.render = function(){
            return files.render();
        };

        this.empty = function(msg) {
            scroll.clear();
            scroll.append(Lampa.Template.get('torbox_empty', { message: msg || 'Торренты не найдены' }));
            Lampa.Controller.enable('content');
        };
        
        this.reset = function() {
            last = false;
            scroll.clear();
            scroll.reset();
        };

        this.build = function() {
            this.buildFilter();
            this.draw(this.applyFiltersSort());
        };

        this.buildFilter = function () {
            const build = (key, title, arr) => {
                const uni = [...new Set(arr.flat().filter(Boolean))].sort();
                const items = ['all', ...uni].map(v => ({ title: v === 'all' ? 'Все' : v.toUpperCase(), value: v, selected: state.filters[key] === v }));
                const sub = state.filters[key] === 'all' ? 'Все' : state.filters[key].toUpperCase();
                return { title, subtitle: sub, items, stype: key };
            };
    
            const f_items = [
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
            const subTitles = f_items.filter(f => f.stype && state.filters[f.stype] !== 'all').map(f => `${f.title}: ${state.filters[f.stype]}`);
            filter.chosen('filter', subTitles);

            const sort_items = sort_types.map(i => ({ ...i, selected: i.key === state.sort }));
            filter.set('sort', sort_items);
            filter.render().find('.filter--sort span').text('Сортировка');
            filter.chosen('sort', [(sort_types.find(s => s.key === state.sort) || {}).title]);
        };

        this.applyFiltersSort = function () {
            let list = state.all_torrents.filter(t => {
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
                    if (s.field === 'publish_date') { va = va ? new Date(va).getTime() : 0; vb = vb ? new Date(vb).getTime() : 0; }
                    return va < vb ? -1 : va > vb ? 1 : 0;
                });
                if (s.reverse) list.reverse();
            }
            return list;
        };
        
        this.draw = function (items) {
            last = false;
            scroll.clear();

            const mid = object.movie.imdb_id || object.movie.id;
            const lastWatchedData = Store.get(`torbox_last_torrent_data_${mid}`);

            if (lastWatchedData) {
                try {
                    const lastTorrent = JSON.parse(lastWatchedData);
                    const historyItem = Lampa.Template.get('torbox_watched_item', {
                        title: 'Продолжить просмотр',
                        info: lastTorrent.title
                    });
                    historyItem.on('hover:focus', (e) => {
                        last = e.target;
                        scroll.update($(e.target), true);
                    }).on('hover:enter', () => {
                        onTorrentClick(lastTorrent);
                    });
                    scroll.append(historyItem);
                } catch (e) {
                    LOG('Failed to parse last watched torrent data', e);
                }
            }

            if (!items.length) {
                if (!lastWatchedData) {
                    return this.empty('Ничего не найдено по заданным фильтрам');
                }
                Lampa.Controller.enable('content');
                return;
            }
        
            const lastHash = JSON.parse(Store.get(`torbox_last_torrent_data_${mid}`, '{}')).hash;

            items.forEach(item_data => {
                let item = Lampa.Template.get('torbox_item', item_data);

                if (lastHash && item_data.hash === lastHash) {
                    item.addClass('torbox-item--last-played');
                }

                item.on('hover:focus', (e) => {
                    last = e.target;
                    state.last_hash = item_data.hash;
                    scroll.update($(e.target), true);
                }).on('hover:enter', () => {
                    onTorrentClick(item_data);
                }).on('hover:long', () => {
                    Lampa.Select.show({
                        title: 'Действия',
                        items: [{ title: 'Скопировать Magnet' }],
                        onSelect: () => {
                            Lampa.Utils.copyTextToClipboard(item_data.magnet, () => Lampa.Noty.show('Magnet-ссылка скопирована'));
                            Lampa.Controller.toggle('content');
                        },
                        onBack: () => Lampa.Controller.toggle('content')
                    });
                });
                
                scroll.append(item);
            });

            let focus_element = scroll.render().find('.selector').first();
            if (state.last_hash) {
                const focused = scroll.render().find(`[data-hash="${state.last_hash}"]`);
                if (focused.length) focus_element = focused;
            }
            
            if (focus_element.length) {
                last = focus_element[0];
            }
            Lampa.Controller.enable('content');
        };

        this.initialize = function () {
            Lampa.Controller.add('content', {
                toggle: () => {
                    Lampa.Controller.collectionSet(filter.render(), scroll.render());
                    Lampa.Controller.collectionFocus(last || false, scroll.render());
                },
                up: () => {
                    if (Navigator.canmove('up')) Navigator.move('up');
                    else Lampa.Controller.toggle('head');
                },
                down: () => {
                    if (Navigator.canmove('down')) Navigator.move('down');
                },
                left: () => {
                    if (Navigator.canmove('left')) Navigator.move('left');
                    else Lampa.Controller.toggle('menu');
                },
                right: () => {
                    if (Navigator.canmove('right')) Navigator.move('right');
                    else filter.show(Lampa.Lang.translate('title_filter'), 'filter');
                },
                back: this.back.bind(this)
            });
            Lampa.Controller.toggle('content');

            filter.onSelect = (type, a, b) => {
                Lampa.Select.close();
                if (type === 'sort') {
                    state.sort = a.key;
                    Store.set('torbox_sort_method', a.key);
                } else if (type === 'filter') {
                    if (a.refresh) return search(true);
                    if (a.reset) state.filters = JSON.parse(JSON.stringify(defaultFilters));
                    else if (a.stype) state.filters[a.stype] = b.value;
                    Store.set('torbox_filters_v2', JSON.stringify(state.filters));
                }
                state.last_hash = null;
                this.build();
                Lampa.Controller.toggle('content');
            };
            filter.onBack = () => {
                this.start();
            };

            if (filter.addButtonBack) filter.addButtonBack();
            
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
        
        this.back = function() {
            if (state.view === 'episodes') {
                state.view = 'torrents';
                filter.render().show();
                this.build();
            } else {
                abort.abort();
                Lampa.Activity.backward();
            }
        };
        
        this.destroy = function () {
            abort.abort();
            Lampa.Controller.clear('content');
            if (scroll) scroll.destroy();
            if (files) files.destroy();
            if (filter) filter.destroy();
            scroll = files = filter = last = null;
        };

        this.pause = function() {};
        this.stop = function() {};
    }

    // ───────────────────── plugin ▸ main integration ──────────────────
    (function () {
        const manifest = {
            type: 'video',
            version: '49.0.0', // Fixed episode component rendering
            name: 'TorBox (Stable)',
            description: 'Плагин для просмотра торрентов через TorBox',
            component: 'torbox_main',
        };

        Lampa.Lang.add({
            torbox_watch: { ru: 'Смотреть через TorBox', en: 'Watch via TorBox', uk: 'Дивитися через TorBox' },
            title_torbox: { ru: 'TorBox', uk: 'TorBox', en: 'TorBox' },
        });

        function addTemplates() {
            Lampa.Template.add('torbox_item', '<div class="torbox-item selector" data-hash="{hash}"><div class="torbox-item__title">{icon} {title}</div><div class="torbox-item__main-info">{info_formated}</div><div class="torbox-item__meta">{meta_formated}</div>{tech_bar_html}</div>');
            Lampa.Template.add('torbox_empty', '<div class="empty"><div class="empty__text">{message}</div></div>');
            Lampa.Template.add('torbox_watched_item', '<div class="torbox-watched-item selector"><div class="torbox-watched-item__icon"><svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5V7.5l5.25 3.5L11 16.5z" fill="currentColor"></path></svg></div><div class="torbox-watched-item__body"><div class="torbox-watched-item__title">{title}</div><div class="torbox-watched-item__info">{info}</div></div></div>');
            Lampa.Template.add('torbox_episode_item', '<div class="file-item selector" data-file-id="{file_id}"><div class="file-item__title">{title}</div><div class="file-item__subtitle">{size}</div></div>');
        }

        function addSettings() {
            if (!Lampa.SettingsApi) return;
            Lampa.SettingsApi.addComponent({ component: 'torbox_enh', name: 'TorBox (Stable)', icon: ICON });
            [
                { k: 'torbox_proxy_url', n: 'URL CORS-прокси', d: `Default: ${Config.DEF.proxyUrl}`, t: 'input', v: CFG.proxyUrl },
                { k: 'torbox_api_key', n: 'API-Key', d: 'Если есть собственный ключ', t: 'input', v: CFG.apiKey },
                { k: 'torbox_debug', n: 'Debug-режим', d: 'Выводить лог в кон��оль', t: 'trigger', v: CFG.debug }
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
            // Register all components with Lampa
            Lampa.Component.add('torbox_main', MainComponent);
            addTemplates();
            addSettings();

            // Add button to movie card
            Lampa.Listener.follow('full', e => {
                if (e.type !== 'complite' || !e.data.movie) return;
                const root = e.object.activity.render();
                if (!root?.length || root.find('.view--torbox').length) return;
                const btn = $(`<div class="full-start__button selector view--torbox" data-subtitle="TorBox">${ICON}<span>TorBox</span></div>`);
                btn.on('hover:enter', () => {
                    Lampa.Activity.push({ 
                        component: 'torbox_main', 
                        title: Lampa.Lang.translate('title_torbox') + ' - ' + (e.data.movie.title || e.data.movie.name), 
                        movie: e.data.movie 
                    });
                });
                const torrentBtn = root.find('.view--torrent');
                torrentBtn.length ? torrentBtn.after(btn) : root.find('.full-start__play').after(btn);
            });

            // Add CSS styles
            const css = document.createElement('style');
            css.id = 'torbox-stable-styles';
            css.textContent = `
                .torbox-list-container { display: block; padding: 1em; }
                .torbox-item { padding: 1em 1.2em; margin: 0 0 1em 0; border-radius: .8em; background: var(--color-background-light); cursor: pointer; transition: all .3s; border: 2px solid transparent; overflow: hidden; }
                .torbox-item:last-child { margin-bottom: 0; }
                .torbox-item--last-played { border-left: 4px solid var(--color-second); background: rgba(var(--color-second-rgb), .1); }
                .torbox-item:hover, .torbox-item.focus, .torbox-watched-item:hover, .torbox-watched-item.focus, .file-item:hover, .file-item.focus { background: var(--color-primary); color: var(--color-background); transform: scale(1.01); border-color: rgba(255, 255, 255, .3); box-shadow: 0 4px 20px rgba(0, 0, 0, .2); }
                .torbox-item:hover .torbox-item__tech-bar, .torbox-item.focus .torbox-item__tech-bar { background: rgba(0, 0, 0, .2); }
                .torbox-item__title { font-weight: 600; margin-bottom: .3em; font-size: 1.1em; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .torbox-item__main-info { font-size: .95em; opacity: .9; line-height: 1.4; margin-bottom: .3em; }
                .torbox-item__meta { font-size: .9em; opacity: .7; line-height: 1.4; margin-bottom: .8em; }
                .torbox-item__tech-bar { display: flex; flex-wrap: wrap; gap: .6em; margin: 0 -1.2em -1em -1.2em; padding: .6em 1.2em; background: rgba(0, 0, 0, .1); font-size: .85em; font-weight: 500; transition: background .3s; }
                .torbox-item__tech-item { padding: .2em .5em; border-radius: .4em; color: #fff; }
                .torbox-item__tech-item--res { background: #3b82f6; }
                .torbox-item__tech-item--codec { background: #16a34a; }
                .torbox-item__tech-item--audio { background: #f97316; }
                .torbox-item__tech-item--hdr { background: linear-gradient(45deg, #ff8c00, #ffa500); }
                .torbox-item__tech-item--dv { background: linear-gradient(45deg, #4b0082, #8a2be2); }
                .torbox-status { padding: 1.5em 2em; text-align: center; min-height: 200px; display: flex; flex-direction: column; justify-content: center; }
                .torbox-status__title { font-size: 1.4em; margin-bottom: 1em; font-weight: 600; }
                .torbox-status__info { font-size: 1.1em; margin-bottom: .8em; }
                .torbox-status__progress-container { margin: 1.5em 0; background: rgba(255, 255, 255, .2) !important; border-radius: 8px; overflow: hidden; height: 12px; }
                .torbox-status__progress-bar { height: 100%; width: 0; background: linear-gradient(90deg, #4CAF50, #66BB6A) !important; transition: width .5s; border-radius: 8px; }
                .file-item { display: flex; justify-content: space-between; align-items: center; padding: 1em 1.2em; margin-bottom: 1em; border-radius: .8em; background: var(--color-background-light); transition: all .3s; border: 2px solid transparent; }
                .file-item__title { font-weight: 600; }
                .file-item__subtitle { font-size: .9em; opacity: .7; }
                .file-item--last-played { border-left: 4px solid var(--color-second); }
                .file-item--watched { color: #888; }
                .torbox-watched-item { display: flex; align-items: center; padding: 1em; margin-bottom: 1em; border-radius: .8em; background: var(--color-background-light); border-left: 4px solid var(--color-second); transition: all .3s; border: 2px solid transparent; }
                .torbox-watched-item__icon { flex-shrink: 0; margin-right: 1em; }
                .torbox-watched-item__icon svg { width: 2em; height: 2em; }
                .torbox-watched-item__body { flex-grow: 1; }
                .torbox-watched-item__title { font-weight: 600; }
                .torbox-watched-item__info { font-size: .9em; opacity: .7; }
            `;
            document.head.appendChild(css);

            Lampa.Manifest.plugins[manifest.name] = manifest;
            LOG('TorBox Stable v48.0.0 ready');
        }

        if (window.Lampa?.Activity) {
            boot();
        } else {
            const LampaBoot = Lampa.Listener.follow('app', (e) => {
                if (e.type == 'ready') {
                    boot();
                    Lampa.Listener.remove('app', LampaBoot);
                }
            });
        }
    })();
})();
