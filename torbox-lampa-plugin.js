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
            return str.replace(/[&<>"']/g, (match) => {
                switch (match) {
                    case '&': return '&amp;';
                    case '<': return '&lt;';
                    case '>': return '&gt;';
                    case '"': return '&quot;';
                    case "'": return '&#39;';
                    default: return match;
                }
            });
        },
        formatBytes(bytes = 0, speed = false) {
            if (bytes <= 0) return speed ? '0 KB/s' : '0 B';
            const k = 1024;
            const sizes = speed ? ['B/s', 'KB/s', 'MB/s', 'GB/s'] : ['B', 'KB', 'MB', 'GB', 'TB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
        },
        formatTime(sec = 0) {
            if (isNaN(sec) || sec < 0) return 'н/д';
            if (sec === Infinity || sec > 2592000) return '∞';
            const h = Math.floor(sec / 3600);
            const m = Math.floor((sec % 3600) / 60);
            const s = Math.floor(sec % 60);
            return [
                h > 0 ? `${h}ч` : null,
                m > 0 ? `${m}м` : null,
                s > 0 ? `${s}с` : null,
            ].filter(Boolean).join(' ') || '0с';
        },
        formatAge(iso) {
            if (!iso) return 'н/д';
            const date = new Date(iso);
            if (isNaN(date)) return 'н/д';
            const diff = (Date.now() - date.getTime()) / 1000;
            if (diff < 60) return `${Math.floor(diff)} сек. назад`;
            if (diff < 3600) return `${Math.floor(diff / 60)} мин. назад`;
            if (diff < 86400) return `${Math.floor(diff / 3600)} год. назад`;
            return `${Math.floor(diff / 86400)} д. назад`;
        },
        getQualityLabel(title = '', raw) {
            if (raw?.info?.quality) return `${raw.info.quality}p`;
            if (/2160p|4K|UHD/i.test(title)) return '4K';
            if (/1080p|FHD/i.test(title)) return 'FHD';
            if (/720p|HD/i.test(title)) return 'HD';
            return 'SD';
        },
        naturalSort(a, b) {
            return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
        }
    };

    // ───────────────────── core ▸ STORAGE (safeStorage + Store) ─────────────
    const safeStorage = (() => {
        try {
            const storage = window.localStorage;
            storage.setItem('__torbox_test', '1');
            storage.removeItem('__torbox_test');
            return storage;
        } catch {
            const mem = new Map();
            return {
                getItem: k => mem.get(k) ?? null,
                setItem: (k, v) => mem.set(k, String(v)),
                removeItem: k => mem.delete(k),
                clear: () => mem.clear(),
            };
        }
    })();

    const Store = {
        get(key, def = null) {
            const v = safeStorage.getItem(key);
            try {
                return v ? JSON.parse(v) : def;
            } catch {
                return v ?? def;
            }
        },
        set(key, val) {
            safeStorage.setItem(key, JSON.stringify(val));
        }
    };

    // ───────────────────── core ▸ CACHE (simple LRU) ───────────────────
    const Cache = (() => {
        const map = new Map();
        const LIMIT = 128;
        const TTL_MS = 600000; // 10-минутный кэш

        return {
            get(k) {
                const o = map.get(k);
                if (!o) return null;
                if (Date.now() - o.ts > TTL_MS) {
                    map.delete(k);
                    return null;
                }
                map.delete(k);
                map.set(k, o); // move to top
                return o.val;
            },
            set(k, v) {
                if (map.size >= LIMIT) {
                    map.delete(map.keys().next().value); // evict oldest
                }
                map.set(k, { ts: Date.now(), val: v });
            },
            has: k => map.has(k),
            clear: () => map.clear(),
        };
    })();

    // ───────────────────── core ▸ CONFIG ───────────────────────────────
    class ConfigManager {
    constructor() {
        this.DEF = {
            proxyUrl: '',
            apiKey: '',
            debug: false,
        };
        this.PUBLIC_PARSERS = [
            { name: 'Viewbox', url: 'jacred.viewbox.dev', key: 'viewbox' },
            { name: 'Jacred', url: 'jacred.xyz', key: '' },
        ];
        this.ICON = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 7L12 2L21 7V17L12 22L3 17V7Z" stroke="currentColor" stroke-width="2"/><path d="M12 22V12" stroke="currentColor" stroke-width="2"/><path d="M21 7L12 12L3 7" stroke="currentColor" stroke-width="2"/></svg>`;
        this.LOG = (...args) => {
            if (this.debug) console.log('[TorBox]', ...args);
        };
    }

    get debug() { return Store.get('torbox_debug', this.DEF.debug); }
    set debug(v) { Store.set('torbox_debug', !!v); }

    get proxyUrl() { return Store.get('torbox_proxy_url', this.DEF.proxyUrl); }
    set proxyUrl(v) { Store.set('torbox_proxy_url', v); }

    get apiKey() {
        const b64 = Store.get('torbox_api_key_b64', '');
        if (!b64) return this.DEF.apiKey;
        try {
            return atob(b64);
        } catch {
            Store.set('torbox_api_key_b64', '');
            return this.DEF.apiKey;
        }
    }
    set apiKey(v) {
        Store.set('torbox_api_key_b64', v ? btoa(v) : '');
    }
}
const Config = new ConfigManager();
const { LOG, PUBLIC_PARSERS, ICON } = Config;
const CFG = Config;

// ───────────────────── core ▸ API ────────────────────────────────
const Api = (() => {
    const MAIN = 'https://api.torbox.app/v1/api';

    const _process = (txt, status) => {
        switch (status) {
            case 401: throw { type: 'auth', message: '401 – неверный API-ключ' };
            case 403: throw { type: 'auth', message: '403 – доступ запрещен, проверьте права ключа' };
            case 429: throw { type: 'network', message: '429 – слишком много запросов, попробуйте позже' };
        }
        if (status >= 500) throw { type: 'network', message: `Ошибка сервера TorBox (${status})` };
        if (status >= 400) throw { type: 'network', message: `Ошибка клиента (${status})` };
        if (!txt) throw { type: 'api', message: 'Пустой ответ от сервера' };

        try {
            if (typeof txt === 'string' && txt.startsWith('http')) return { success: true, url: txt };
            const j = typeof txt === 'object' ? txt : JSON.parse(txt);
            if (j?.success === false) {
                throw { type: 'api', message: j.detail || j.message || 'Неизвестная ошибка API' };
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
        const timeoutId = setTimeout(() => controller.abort(), 20000);
        if (signal) signal.addEventListener('abort', () => controller.abort());

        const proxy = `${CFG.proxyUrl}?url=${encodeURIComponent(url)}`;
        const headers = { ...opt.headers };
        if (opt.is_torbox_api !== false) headers['X-Api-Key'] = CFG.apiKey;
        delete headers['Authorization'];

        try {
            const res = await fetch(proxy, { ...opt, headers, signal: controller.signal });
            return _process(await res.text(), res.status);
        } catch (e) {
            if (e.name === 'AbortError' && (!signal || !signal.aborted)) {
                throw { type: 'network', message: 'Таймаут запроса (20 сек)' };
            }
            throw e;
        } finally {
            clearTimeout(timeoutId);
        }
    };

    const searchPublicTrackers = async (movie, signal) => {
        const promises = PUBLIC_PARSERS.map(async (p) => {
            const qs = new URLSearchParams({
                apikey: p.key,
                Query: `${movie.title} ${movie.year || ''}`.trim(),
                title: movie.title,
                title_original: movie.original_title,
                Category: '2000,5000',
            });
            if (movie.year) qs.append('year', movie.year);
            const url = `https://${p.url}/api/v2.0/indexers/all/results?${qs}`;
            LOG('Parser', p.name, url);
            try {
                const j = await request(url, { method: 'GET', is_torbox_api: false }, signal);
                if (j?.Results?.length) {
                    LOG('Parser success', p.name, j.Results.length);
                    return j.Results;
                }
                LOG('Parser empty', p.name);
            } catch (err) {
                LOG('Parser fail', p.name, err.message);
            }
            return [];
        });

        const results = await Promise.allSettled(promises);
        const allTorrents = results.flatMap(r => (r.status === 'fulfilled' ? r.value : []));

        if (allTorrents.length === 0) {
            throw { type: 'api', message: 'Все публичные парсеры недоступны или без результатов' };
        }
        return allTorrents;
    };

    const checkCached = async (hashes, signal) => {
        if (!hashes.length) return {};
        const data = {};
        const chunks = [];
        for (let i = 0; i < hashes.length; i += 100) {
            chunks.push(hashes.slice(i, i + 100));
        }

        await Promise.all(chunks.map(async (chunk) => {
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
        }));
        return data;
    };

    const addMagnet = (magnet, signal) => {
        const fd = new FormData();
        fd.append('magnet', magnet);
        fd.append('seed', '3');
        return request(`${MAIN}/torrents/createtorrent`, { method: 'POST', body: fd }, signal);
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
    show(type = 'unknown', e) {
        const msg = e?.message || 'Неизвестная ошибка';
        const errorType = type === 'network' ? 'Сетевая ошибка' : 'Ошибка';
        Lampa.Noty.show(`${errorType}: ${msg}`, { type: 'error' });
        LOG('ERR', type, e);
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
        add(`${title} ${orig_title}`);
        if (year) add(`${title} ${orig_title} ${year}`);
    }

    return Array.from(combinations);
}

// ───────────────────── component ▸ Main List Component ────────────────
function MainComponent(object) {
    let scroll = new Lampa.Scroll({ mask: true, over: true, step: 250 });
    let files = new Lampa.Explorer(object);
    let filter = new Lampa.Filter(object);
    let last;
    let abort = new AbortController();
    let initialized = false;
    let cached_toggle_button;

    this.activity = object.activity;

    const sort_types = [
        { key: 'seeders', title: 'По сидам (убыв.)', field: 'last_known_seeders', reverse: true },
        { key: 'size_desc', title: 'По размеру (убыв.)', field: 'size', reverse: true },
        { key: 'size_asc', title: 'По размеру (возр.)', field: 'size', reverse: false },
        { key: 'age', title: 'По дате добавления', field: 'publish_timestamp', reverse: true },
    ];
    const defaultFilters = { quality: 'all', tracker: 'all', video_type: 'all', translation: 'all', lang: 'all', video_codec: 'all', audio_codec: 'all' };

    let state = {
        all_torrents: [],
        sort: Store.get('torbox_sort_method', 'seeders'),
        filters: { ...defaultFilters, ...Store.get('torbox_filters_v2', {}) },
        last_hash: null,
        view: 'torrents',
        current_torrent_data: null,
        search_query: null,
        show_only_cached: Store.get('torbox_show_only_cached', false),
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
            publish_timestamp: publishDate ? publishDate.getTime() : 0,
            age: Utils.formatAge(raw.PublishDate),
            quality: Utils.getQualityLabel(raw.Title, raw),
            video_type: raw.info?.videotype?.toLowerCase(),
            voices: raw.info?.voices,
            ...tech_info,
            raw_data: raw,
            info_formated: `[${Utils.getQualityLabel(raw.Title, raw)}] ${Utils.formatBytes(raw.Size)} | 🟢<span style="color:var(--color-good);">${raw.Seeders || 0}</span> / 🔴<span style="color:var(--color-bad);">${raw.Peers || 0}</span>`,
            meta_formated: `Трекеры: ${((raw.Tracker || '').split(/, ?/)[0] || 'н/д')} | Добавлено: ${Utils.formatAge(raw.PublishDate) || 'н/д'}`,
            tech_bar_html: this.buildTechBar(tech_info, raw),
        };
    };

    this.buildTechBar = function (t, raw) {
        const tags = [];
        const tag = (txt, cls) => `<div class="torbox-item__tech-item torbox-item__tech-item--${cls}">${txt}</div>`;

        if (t.video_resolution) tags.push(tag(Utils.escapeHtml(t.video_resolution), 'res'));
        if (t.video_codec) tags.push(tag(Utils.escapeHtml(t.video_codec.toUpperCase()), 'codec'));
        if (t.has_hdr) tags.push(tag('HDR', 'hdr'));
        if (t.has_dv) tags.push(tag('Dolby Vision', 'dv'));

        const audioStreams = raw.ffprobe?.filter(s => s.codec_type === 'audio') || [];
        let voiceIndex = 0;

        audioStreams.forEach(s => {
            let lang_or_voice = s.tags?.language?.toUpperCase() || s.tags?.LANGUAGE?.toUpperCase();
            if (!lang_or_voice || lang_or_voice === 'UND') {
                lang_or_voice = raw.info?.voices?.[voiceIndex++] ?? null;
            }
            const codec = s.codec_name?.toUpperCase() || '';
            const layout = s.channel_layout || '';
            const displayText = [lang_or_voice, codec, layout].filter(Boolean).join(' ').trim();
            if (displayText) tags.push(tag(Utils.escapeHtml(displayText), 'audio'));
        });

        return tags.length ? `<div class="torbox-item__tech-bar">${tags.join('')}</div>` : '';
    };

    const search = async (force = false, customTitle = null) => {
        abort.abort();
        abort = new AbortController();
        const { signal } = abort;

        this.activity.loader(true);
        this.reset();

        state.search_query = customTitle;
        const movieForSearch = customTitle ? { ...object.movie, title: customTitle, original_title: customTitle, year: '' } : object.movie;
        const key = customTitle ? `torbox_custom_search_${customTitle}` : `torbox_hybrid_${object.movie.id || object.movie.imdb_id}`;

        if (!force && Cache.has(key)) {
            state.all_torrents = Cache.get(key);
            LOG('Loaded torrents from cache.');
            this.build();
            this.activity.loader(false);
            return;
        }

        this.empty(customTitle ? `Поиск по запросу: "${customTitle}"...` : 'Получение списка…');

        try {
            const raw = await Api.searchPublicTrackers(movieForSearch, signal);
            if (signal.aborted) return;
            if (!raw.length) return this.empty('Парсер не вернул результатов.');

            const withHash = raw.map(r => ({ raw: r, hash: r.MagnetUri.match(/urn:btih:([a-fA-F0-9]{40})/i)?.[1] })).filter(r => r.hash);
            if (!withHash.length) return this.empty('Не найдено валидных торрентов.');

            this.empty(`Проверка кэша (${withHash.length})…`);
            const cached = await Api.checkCached(withHash.map(x => x.hash), signal);
            if (signal.aborted) return;

            const cachedSet = new Set(Object.keys(cached).map(h => h.toLowerCase()));
            state.all_torrents = withHash.map(({ raw, hash }) => procRaw(raw, hash, cachedSet));
            Cache.set(key, state.all_torrents);
            this.build();
        } catch (err) {
            if (signal.aborted) return;
            this.empty(err.message || 'Ошибка');
            ErrorHandler.show(err.type, err);
        } finally {
            this.activity.loader(false);
        }
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

            const watched_episodes = Store.get(key, []);
            if (!watched_episodes.includes(file.id)) {
                watched_episodes.push(file.id);
                Store.set(key, watched_episodes);
            }
            Store.set(`torbox_last_played_file_${mid}`, file.id);

            const cleanName = file.name.split('/').pop();
            const playerConfig = {
                url: link,
                title: cleanName || object.movie.title,
                poster: Lampa.Utils.cardImgBackgroundBlur(object.movie),
                id: object.movie.id,
                movie: object.movie,
                season: cleanName.match(/[Ss](\d{1,2})/)?.[1],
                episode: cleanName.match(/[Ee](\d{1,3})/)?.[1],
            };

            Lampa.Player.play(playerConfig);
            Lampa.Player.callback(on_end || (() => {}));
        } catch (e) {
            ErrorHandler.show(e.type, e);
        }
    };

    const onTorrentClick = async (torrent) => {
        if (!torrent.magnet || !torrent.hash) {
            return ErrorHandler.show('validation', { message: 'Magnet-ссылка или хеш не найдены' });
        }

        const mid = object.movie.imdb_id || object.movie.id;
        const torrentForHistory = state.all_torrents.find(t => t.hash === torrent.hash) || torrent;
        Store.set(`torbox_last_torrent_data_${mid}`, torrentForHistory);
        if (torrent.markAsLastPlayed) setTimeout(() => torrent.markAsLastPlayed(), 100);
        updateContinueWatchingPanel();

        const abort = new AbortController();
        const { signal } = abort;
        const storage_key = `torbox_id_for_hash_${torrent.hash}`;
        let saved_torbox_id = Store.get(storage_key);

        Lampa.Loading.start(() => abort.abort(), 'TorBox: Обработка...');

        const trackTorrent = async (id) => {
            try {
                const data = await track(id, signal);
                data.hash = torrent.hash;
                Lampa.Loading.stop();
                selectFile(data);
            } catch (err) {
                if (err.name !== 'AbortError') {
                    if (err.type === 'api' || err.message.includes('not found')) {
                        LOG(`[TorBox] Stale TorBox ID ${id}. Removing and re-adding.`);
                        Store.set(storage_key, '');
                        await addAndTrack();
                    } else {
                        Lampa.Loading.stop();
                        ErrorHandler.show(err.type, err);
                    }
                } else {
                    Lampa.Loading.stop();
                }
            }
        };

        const addAndTrack = async () => {
            try {
                const res = await Api.addMagnet(torrent.magnet, signal);
                const new_torbox_id = res.data?.torrent_id || res.data?.id;
                if (!new_torbox_id) throw { type: 'api', message: 'ID торрента не получен' };

                Store.set(storage_key, new_torbox_id);
                LOG(`[TorBox] Saved new TorBox ID: ${new_torbox_id} for hash ${torrent.hash}`);
                await trackTorrent(new_torbox_id);
            } catch (err) {
                if (err.name !== 'AbortError') {
                    Lampa.Loading.stop();
                    ErrorHandler.show(err.type, err);
                }
            }
        };

        if (saved_torbox_id) {
            LOG(`[TorBox] Found saved TorBox ID: ${saved_torbox_id}`);
            await trackTorrent(saved_torbox_id);
        } else {
            LOG(`[TorBox] No saved TorBox ID. Adding new magnet.`);
            await addAndTrack();
        }
    };

    const track = (id, signal) => {
        return new Promise((resolve, reject) => {
            let active = true;
            const cancel = () => {
                active = false;
                signal.removeEventListener('abort', cancel);
                reject({ name: 'AbortError', message: 'Отменено пользователем' });
            };
            signal.addEventListener('abort', cancel);

            const poll = async () => {
                if (!active) return;
                try {
                    const d = (await Api.myList(id, signal))?.data?.[0];
                    if (!d) {
                        if (active) setTimeout(poll, 10000);
                        return;
                    }

                    if ((d.download_state === 'completed' || d.download_state === 'uploading' || d.download_finished) && d.files?.length) {
                        active = false;
                        signal.removeEventListener('abort', cancel);
                        resolve(d);
                    } else {
                        const perc = (parseFloat(d.progress) * 100).toFixed(2);
                        const speed = Utils.formatBytes(d.download_speed, true);
                        const eta = Utils.formatTime(d.eta);
                        const status_text = `Загрузка: ${perc}% | ${speed} | 👤 ${d.seeds || 0}/${d.peers || 0} | ⏳ ${eta}`;
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
        const vids = torrent_data.files.filter(f => /\.(mkv|mp4|avi)$/i.test(f.name)).sort(Utils.naturalSort);
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
        const lastPlayedId = Store.get(`torbox_last_played_file_${mid}`);
        const torrent_id = torrent_data.hash || torrent_data.id;
        const watched_episodes = Store.get(`torbox_watched_episodes_${mid}_${torrent_id}`, []);
        const vids = torrent_data.files.filter(f => /\.(mkv|mp4|avi)$/i.test(f.name)).sort(Utils.naturalSort);
        const fragment = document.createDocumentFragment();
        let last_focused_element = null;

        vids.forEach(file => {
            const isWatched = watched_episodes.includes(file.id);
            const cleanName = file.name.split('/').pop();
            const item = $(Lampa.Template.get('torbox_episode_item', {
                title: cleanName,
                size: Utils.formatBytes(file.size),
                file_id: file.id,
            }));

            item.on('hover:focus', (e) => {
                last = e.target;
                scroll.update($(e.target), true);
            }).on('hover:enter', () => {
                if (!item.hasClass('torbox-file-item--watched')) {
                    item.addClass('torbox-file-item--watched');
                    const watched = Store.get(`torbox_watched_episodes_${mid}_${torrent_id}`, []);
                    if (!watched.includes(file.id)) {
                        watched.push(file.id);
                        Store.set(`torbox_watched_episodes_${mid}_${torrent_id}`, watched);
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
            fragment.appendChild(item[0]);
        });

        scroll.append(fragment);
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

    this.render = function () {
        return files.render();
    };

    this.empty = function (msg) {
        scroll.clear();
        const emptyElem = $(Lampa.Template.get('torbox_empty', { message: msg || 'Торренты не найдены' }));
        emptyElem.addClass('selector').on('hover:focus', (e) => {
            last = e.target;
            scroll.update($(e.target), true);
        }).on('hover:enter', () => {
            Lampa.Noty.show('Нет доступных торрентов. Попробуйте изменить фильтры или уточнить поиск.');
        });
        scroll.append(emptyElem);
        Lampa.Controller.enable('content');
    };

    this.reset = function () {
        last = false;
        scroll.clear();
        scroll.reset();
    };

    this.build = function () {
        this.buildFilter();
        if (cached_toggle_button) {
            const is_cached_only = state.show_only_cached;
            cached_toggle_button.toggleClass('filter__item--active', is_cached_only)
                .find('span').text(is_cached_only ? '⚡' : '☁️')
                .attr('title', is_cached_only ? 'Показаны только кешированные' : 'Показать только кешированные');
        }
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
            { title: 'Уточнить поиск', refine: true },
            build('quality', 'Качество', state.all_torrents.map(t => t.quality)),
            build('video_type', 'Тип видео', state.all_torrents.map(t => t.video_type)),
            build('translation', 'Перевод', state.all_torrents.map(t => t.voices)),
            build('lang', 'Язык аудио', state.all_torrents.map(t => t.audio_langs)),
            build('video_codec', 'Видео кодек', state.all_torrents.map(t => t.video_codec)),
            build('audio_codec', 'Аудио кодек', state.all_torrents.map(t => t.audio_codecs)),
            build('tracker', 'Трекер', state.all_torrents.map(t => t.trackers)),
            { title: 'Сбросить фильтры', reset: true },
            { title: 'Обновить список', refresh: true },
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
        const { quality, video_type, translation, lang, video_codec, audio_codec, tracker } = state.filters;
        const list = state.all_torrents.filter(t =>
            (!state.show_only_cached || t.cached) &&
            (quality === 'all' || t.quality === quality) &&
            (video_type === 'all' || t.video_type === video_type) &&
            (translation === 'all' || t.voices?.includes(translation)) &&
            (lang === 'all' || t.audio_langs?.includes(lang)) &&
            (video_codec === 'all' || t.video_codec === video_codec) &&
            (audio_codec === 'all' || t.audio_codecs?.includes(audio_codec)) &&
            (tracker === 'all' || t.trackers?.includes(tracker))
        );

        const s = sort_types.find(s => s.key === state.sort);
        if (s) {
            list.sort((a, b) => {
                const va = a[s.field] || 0;
                const vb = b[s.field] || 0;
                return s.reverse ? vb - va : va - vb;
            });
        }
        return list;
    };

    this.draw = function (items) {
        last = false;
        scroll.clear();

        const mid = object.movie.imdb_id || object.movie.id;
        const view_info = Lampa.Storage.get('view', '{}');
        const view_data = view_info[object.movie.id];

        if (!items.length) {
            return this.empty('Ничего не найдено по заданным фильтрам');
        }

        const lastHash = Store.get(`torbox_last_torrent_data_${mid}`, {})?.hash;
        const fragment = document.createDocumentFragment();

        items.forEach(item_data => {
            item_data.last_played_icon = (lastHash && item_data.hash === lastHash)
                ? `<span class="torbox-item__last-played-icon"><svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5V7.5l5.25 3.5L11 16.5z" fill="currentColor"></path></svg></span>`
                : '';

            const item = $(Lampa.Template.get('torbox_item', item_data));

            if (view_data?.total > 0) {
                const percent = Math.round((view_data.time / view_data.total) * 100);
                item.append(`<div class="torbox-item__progress"><div style="width: ${percent}%"></div></div>`);
                const time_info = Lampa.Template.get('player_time', {
                    time: Lampa.Utils.secondsToTime(view_data.time),
                    left: Lampa.Utils.secondsToTime(view_data.total - view_data.time),
                });
                item.find('.torbox-item__main-info').after(time_info);
            }

            item_data.markAsLastPlayed = () => {
                scroll.render().find('.torbox-item__last-played-icon').remove();
                const icon_html = `<span class="torbox-item__last-played-icon"><svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5V7.5l5.25 3.5L11 16.5z" fill="currentColor"></path></svg></span>`;
                const titleElement = item.find('.torbox-item__title');
                if (titleElement.length && !titleElement.find('.torbox-item__last-played-icon').length) {
                    titleElement.prepend(icon_html);
                }
                Store.set(`torbox_last_torrent_data_${mid}`, item_data);
            };

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
                    onBack: () => Lampa.Controller.toggle('content'),
                });
            });

            fragment.appendChild(item[0]);
        });

        scroll.append(fragment);

        let focus_element = scroll.render().find('.selector').first();
        if (state.last_hash) {
            const focused = scroll.render().find(`[data-hash="${state.last_hash}"]`);
            if (focused.length) focus_element = focused;
        }

        if (focus_element.length) last = focus_element[0];
        Lampa.Controller.enable('content');
        updateContinueWatchingPanel();
    };

    const updateContinueWatchingPanel = () => {
        if (state.view !== 'torrents') return;

        const mid = object.movie.imdb_id || object.movie.id;
        const lastWatchedData = Store.get(`torbox_last_torrent_data_${mid}`);
        let panel = scroll.body().find('.torbox-watched-item');

        if (lastWatchedData) {
            const info_text = lastWatchedData.title;
            if (panel.length) {
                panel.find('.torbox-watched-item__info').text(info_text);
            } else {
                const historyItem = $(Lampa.Template.get('torbox_watched_item', {
                    title: 'Продолжить просмотр',
                    info: info_text,
                }));
                historyItem.addClass('selector');
                historyItem.on('hover:focus', (e) => {
                    last = e.target;
                    scroll.update($(e.target), true);
                }).on('hover:enter', () => {
                    onTorrentClick(lastWatchedData);
                });
                scroll.body().prepend(historyItem);
            }
        } else if (panel.length) {
            panel.remove();
        }
    };

    this.initialize = function () {
        Lampa.Controller.add('content', {
            toggle: () => {
                Lampa.Controller.collectionSet(filter.render(), scroll.render());
                Lampa.Controller.collectionFocus(last || false, scroll.render());
            },
            up: () => (Navigator.canmove('up') ? Navigator.move('up') : Lampa.Controller.toggle('head')),
            down: () => Navigator.canmove('down') && Navigator.move('down'),
            left: () => (Navigator.canmove('left') ? Navigator.move('left') : Lampa.Controller.toggle('menu')),
            right: () => (Navigator.canmove('right') ? Navigator.move('right') : filter.show(Lampa.Lang.translate('title_filter'), 'filter')),
            back: this.back.bind(this),
        });
        Lampa.Controller.toggle('content');

        filter.onSelect = (type, a, b) => {
            Lampa.Select.close();
            if (type === 'sort') {
                state.sort = a.key;
                Store.set('torbox_sort_method', a.key);
            } else if (type === 'filter') {
                if (a.refine) {
                    const combinations = generateSearchCombinations(object.movie);
                    if (!combinations.length) {
                        Lampa.Noty.show('Недостаточно данных для создания комбинаций поиска.');
                        return Lampa.Controller.toggle('content');
                    }
                    Lampa.Select.show({
                        title: 'Уточнить поиск',
                        items: combinations.map(c => ({ title: c, search_query: c })),
                        onSelect: (selected) => {
                            search(true, selected.search_query);
                            Lampa.Controller.toggle('content');
                        },
                        onBack: () => Lampa.Controller.toggle('content'),
                    });
                    return;
                }
                if (a.refresh) return search(true);
                if (a.reset) state.filters = { ...defaultFilters };
                else if (a.stype) state.filters[a.stype] = b.value;
                Store.set('torbox_filters_v2', state.filters);
            }
            if (last?.getAttribute) state.last_hash = last.getAttribute('data-hash');
            this.build();
            Lampa.Controller.toggle('content');
        };
        filter.onBack = () => this.start();
        filter.onSearch = (value) => search(true, value);

        if (filter.addButtonBack) filter.addButtonBack();

        cached_toggle_button = $(`<div class="filter__item selector torbox-cached-toggle"><span></span></div>`);
        cached_toggle_button.on('hover:enter', () => {
            state.show_only_cached = !state.show_only_cached;
            Store.set('torbox_show_only_cached', state.show_only_cached);
            this.build();
        });
        filter.render().find('.filter--sort').before(cached_toggle_button);

        this.empty('Загрузка...');
        search();
    };

    this.start = function () {
        if (Lampa.Activity.active()?.activity !== this.activity) return;
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
            abort.abort();
            Lampa.Activity.backward();
        }
    };

    this.destroy = function () {
        abort.abort();
        Lampa.Controller.clear('content');
        scroll?.destroy();
        files?.destroy();
        filter?.destroy();
        scroll = files = filter = last = null;
    };

    this.pause = () => {};
    this.stop = () => {};
}

// ───────────────────── plugin ▸ main integration ──────────────────
(function () {
    const manifest = {
        type: 'video',
        version: '50.2.3', // Fixed remote control focus on "Continue Watching"
        name: 'TorBox',
        description: 'Плагин для просмотра торрентов через TorBox',
        component: 'torbox_main',
    };

    Lampa.Lang.add({
        torbox_watch: { ru: 'Смотрет�� через TorBox', en: 'Watch via TorBox', uk: 'Дивитися через TorBox' },
        title_torbox: { ru: 'TorBox', uk: 'TorBox', en: 'TorBox' },
    });

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
            { k: 'torbox_debug', n: 'Debug-режим', d: 'Выводить лог в консоль', t: 'trigger', v: CFG.debug },
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
                onRender: f => { if (p.k === 'torbox_api_key') f.find('input').attr('type', 'password'); },
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
                Lampa.Activity.push({
                    component: 'torbox_main',
                    title: `${Lampa.Lang.translate('title_torbox')} - ${e.data.movie.title || e.data.movie.name}`,
                    movie: e.data.movie,
                });
            });
            const torrentBtn = root.find('.view--torrent');
            torrentBtn.length ? torrentBtn.after(btn) : root.find('.full-start__play').after(btn);
        });

        const css = document.createElement('style');
        css.id = 'torbox-stable-styles';
        css.textContent = `
            .torbox-list-container { display: block; padding: 1em; }
            .torbox-item { position: relative; padding: 1em 1.2em; margin: 0 0 1em 0; border-radius: .8em; background: var(--color-background-light); cursor: pointer; transition: all .3s; border: 2px solid transparent; overflow: hidden; }
            .torbox-item:last-child { margin-bottom: 0; }
            .torbox-item__last-played-icon { display: inline-flex; align-items: center; justify-content: center; width: 1.2em; height: 1.2em; margin-right: .5em; color: var(--color-second); flex-shrink: 0; }
            .torbox-item__last-played-icon svg { width: 100%; height: 100%; }
            .torbox-item:hover, .torbox-item.focus, .torbox-watched-item:hover, .torbox-watched-item.focus, .file-item:hover, .file-item.focus { background: var(--color-primary); color: var(--color-background); transform: scale(1.01); border-color: rgba(255, 255, 255, .3); box-shadow: 0 4px 20px rgba(0, 0, 0, .2); }
            .torbox-item:hover .torbox-item__tech-bar, .torbox-item.focus .torbox-item__tech-bar { background: rgba(0, 0, 0, .2); }
            .torbox-item__title { font-weight: 600; margin-bottom: .3em; font-size: 1.1em; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; }
            .torbox-item__main-info { font-size: .95em; opacity: .9; line-height: 1.4; margin-bottom: .3em; }
            .torbox-item__meta { font-size: .9em; opacity: .7; line-height: 1.4; margin-bottom: .8em; }
            .torbox-item__progress { position: absolute; bottom: 0; left: 0; right: 0; height: 3px; background: rgba(255,255,255,0.2); }
            .torbox-item__progress div { height: 100%; background: var(--color-primary); }
            .torbox-item__tech-bar { display: flex; flex-wrap: wrap; gap: .6em; margin: 0 -1.2em -1em -1.2em; padding: .6em 1.2em; background: rgba(0, 0, 0, .1); font-size: .85em; font-weight: 500; transition: background .3s; }
            .torbox-item__tech-item { padding: .2em .5em; border-radius: .4em; color: #fff; }
            .torbox-item__tech-item--res { background: #3b82f6; }
            .torbox-item__tech-item--codec { background: #16a34a; }
            .torbox-item__tech-item--audio { background: #f97316; }
            .torbox-item__tech-item--hdr { background: linear-gradient(45deg, #ff8c00, #ffa500); }
            .torbox-item__tech-item--dv { background: linear-gradient(45deg, #4b0082, #8a2be2); }
            .torbox-cached-toggle { display: inline-flex; align-items: center; justify-content: center; border: 2px solid transparent; transition: all .3s; }
            .torbox-cached-toggle span { font-size: 1.5em; line-height: 1; }
            .torbox-cached-toggle.filter__item--active,
            .torbox-cached-toggle.focus,
            .torbox-cached-toggle:hover {
                background: var(--color-primary);
                color: var(--color-background);
            }
            .torbox-cached-toggle.focus,
            .torbox-cached-toggle:hover {
                border-color: rgba(255, 255, 255, .3);
            }
            .torbox-status { padding: 1.5em 2em; text-align: center; min-height: 200px; display: flex; flex-direction: column; justify-content: center; }
            .torbox-status__title { font-size: 1.4em; margin-bottom: 1em; font-weight: 600; }
            .torbox-status__info { font-size: 1.1em; margin-bottom: .8em; }
            .torbox-status__progress-container { margin: 1.5em 0; background: rgba(255, 255, 255, .2) !important; border-radius: 8px; overflow: hidden; height: 12px; }
            .torbox-status__progress-bar { height: 100%; width: 0; background: linear-gradient(90deg, #4CAF50, #66BB6A) !important; transition: width .5s; border-radius: 8px; }
            .torbox-file-item { display: flex; justify-content: space-between; align-items: center; padding: 1em 1.2em; margin-bottom: 1em; border-radius: .8em; background: var(--color-background-light); transition: all .3s; border: 2px solid transparent; }
            .torbox-file-item:hover, .torbox-file-item.focus { background: var(--color-primary); color: var(--color-background); transform: scale(1.01); border-color: rgba(255, 255, 255, .3); box-shadow: 0 4px 20px rgba(0, 0, 0, .2); }
            .torbox-file-item__title { font-weight: 600; }
            .torbox-file-item__subtitle { font-size: .9em; opacity: .7; }
            .torbox-file-item--last-played { border-left: 4px solid var(--color-second); }
            .torbox-file-item--watched { color: #888; }
            .torbox-watched-item { display: flex; align-items: center; padding: 1em; margin-bottom: 1em; border-radius: .8em; background: var(--color-background-light); border-left: 4px solid var(--color-second); transition: all .3s; border: 2px solid transparent; }
            .torbox-watched-item__icon { flex-shrink: 0; margin-right: 1em; }
            .torbox-watched-item__icon svg { width: 2em; height: 2em; }
            .torbox-watched-item__body { flex-grow: 1; }
            .torbox-watched-item__title { font-weight: 600; }
            .torbox-watched-item__info { font-size: .9em; opacity: .7; }
        `;
        document.head.appendChild(css);

        Lampa.Manifest.plugins[manifest.name] = manifest;
        LOG('TorBox Stable v50.2.1 ready');
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
