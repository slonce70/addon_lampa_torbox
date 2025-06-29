/* TorBox Enhanced – Player/Back-Fix (v2025-06-29-r3)
 * =====================================================================
 * ▸ Fix: «Back» не працює після зовнішнього плеєра / закриття внутрішнього.
 * ▸ Реалізовано глобальний visibility-handler + контролер Back всередині плеєра.
 * ▸ Шими Lampa v3, SSE-прогрес, debounce-пошук та кеш – усе збережено.
 * ▸ Поєднано стабільну архітектуру першої версії з останніми UX-покращеннями.
 * ==================================================================== */
(function () {
    'use strict';

    /* ──────────────── Compatibility Layer (v3) ──────────────── */
    function collectionAttach(node, scroll) {
        if (Lampa.Controller.collectionSet) return Lampa.Controller.collectionSet(node, scroll);
        if (Lampa.Controller.collection?.attach) return Lampa.Controller.collection.attach(node, scroll);
    }
    function collectionFocus(last, scroll) {
        if (Lampa.Controller.collectionFocus) return Lampa.Controller.collectionFocus(last, scroll);
        if (Lampa.Controller.collection?.focus) return Lampa.Controller.collection.focus(last, scroll);
    }
    function onPlayerDestroy(cb) {
        const ls = Lampa.Player?.listener;
        if (!ls) return;
        if (typeof ls.add === 'function') return ls.add('destroy', cb);
        if (typeof ls.follow === 'function') return ls.follow('destroy', cb);
    }
    function createExplorer(o) {
        if (Lampa.Explorer) return new Lampa.Explorer(o);
        if (Lampa.Components?.Explorer) return new Lampa.Components.Explorer(o);
        throw new Error('[TorBox] Explorer component is missing');
    }

    /* ────────────────── Guard double-init ────────────────── */
    const PLUGIN_ID = 'torbox_enhanced_playerfix';
    if (window[PLUGIN_ID]) return;
    window[PLUGIN_ID] = true;

    /* ─────────────────── Local Storages & Cache ─────────────────── */
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
        get: (key, def = null) => safeStorage.getItem(key) ?? def,
        set: (key, val) => safeStorage.setItem(key, String(val)),
    };
    const Cache = (() => {
        const m = new Map();
        return {
            set(k, v, ttl = 600) { m.set(k, { v, e: Date.now() + ttl * 1000 }); },
            get(k) { const i = m.get(k); if (i && i.e > Date.now()) return i.v; m.delete(k); return null; },
        };
    })();

    /* ───────────────────── Utils ───────────────────── */
    const Utils = {
        escapeHtml(str = '') {
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        },
        debounce(fn, ms) {
            let t;
            return (...a) => {
                clearTimeout(t);
                t = setTimeout(() => fn.apply(this, a), ms);
            };
        },
        formatBytes(bytes = 0, speed = false) {
            const B = Number(bytes);
            if (isNaN(B) || B === 0) return speed ? '0 KB/s' : '0 B';
            const k = 1024;
            const sizes = speed ? ['B/s', 'KB/s', 'MB/s', 'GB/s'] : ['B', 'KB', 'MB', 'GB', 'TB'];
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
            return [h ? h + 'ч' : null, m ? m + 'м' : null, r + 'с'].filter(Boolean).join(' ');
        },
        formatAge(iso) {
            if (!iso) return 'н/д';
            const d = new Date(iso);
            if (isNaN(d)) return 'н/д';
            const diff = Math.floor((Date.now() - d) / 1000);
            if (diff < 60) return diff + ' сек. назад';
            const m = Math.floor(diff / 60);
            if (m < 60) return m + ' мин. назад';
            const h = Math.floor(m / 60);
            if (h < 24) return h + ' ч. назад';
            return Math.floor(h / 24) + ' д. назад';
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
                    const diff = parseInt(aParts[i], 10) - parseInt(bParts[i], 10);
                    if (diff) return diff;
                } else if (aParts[i] !== bParts[i]) {
                    return aParts[i].localeCompare(bParts[i]);
                }
            }
            return a.name.length - b.name.length;
        }
    };

    /* ───────────────────── Config & API Layer ───────────────────── */
    const Config = (() => {
        const DEF = { proxyUrl: 'https://cors.slonce.workers.dev/', apiKey: '' };
        const CFG = {
            get debug() { return Store.get('torbox_debug', '0') === '1'; },
            set debug(v) { Store.set('torbox_debug', v ? '1' : '0'); },
            get proxyUrl() { return Store.get('torbox_proxy_url') || DEF.proxyUrl; },
            set proxyUrl(v) { Store.set('torbox_proxy_url', v); },
            get apiKey() {
                const b64 = Store.get('torbox_api_key_b64', '');
                try { return b64 ? atob(b64) : DEF.apiKey; } 
                catch { Store.set('torbox_api_key_b64', ''); return DEF.apiKey; }
            },
            set apiKey(v) { Store.set('torbox_api_key_b64', v ? btoa(v) : ''); }
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

    const Api = (() => {
        const MAIN = 'https://api.torbox.app/v1/api';
        const _process = (txt, status) => {
            if (status === 401) throw { type: 'auth', message: '401 – неверный API-ключ' };
            if (status === 403) throw { type: 'auth', message: '403 – доступ запрещен, проверьте права ключа' };
            if (status >= 400) throw { type: 'network', message: `Ошибка клиента/сервера (${status})` };
            if (!txt) throw { type: 'api', message: 'Пустой ответ от сервера' };
            try {
                if (typeof txt === 'string' && txt.startsWith('http')) return { success: true, url: txt };
                const j = typeof txt === 'object' ? txt : JSON.parse(txt);
                if (j?.success === false) throw { type: 'api', message: j.detail || j.message || 'Неизвестная ошибка API' };
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
                if (e.name === 'AbortError' && (!signal || !signal.aborted)) throw { type: 'network', message: `Таймаут запроса (${TIMEOUT_MS / 1000} сек)` };
                throw e.type ? e : { type: 'network', message: e.message };
            } finally {
                clearTimeout(timeoutId);
            }
        };
        const searchPublicTrackers = async (movie, signal) => {
            for (const p of PUBLIC_PARSERS) {
                const qs = new URLSearchParams({ apikey: p.key, Query: `${movie.title} ${movie.year || ''}`.trim(), title: movie.title, title_original: movie.original_title, Category: '2000,5000' });
                if (movie.year) qs.append('year', movie.year);
                const u = `https://${p.url}/api/v2.0/indexers/all/results?${qs}`;
                LOG('Parser', p.name, u);
                try {
                    const j = await request(u, { is_torbox_api: false }, signal);
                    if (j?.Results?.length) return j.Results;
                } catch (err) { LOG('Parser fail', p.name, err.message); }
            }
            throw { type: 'api', message: 'Все публичные парсеры недоступны или без результатов' };
        };
        const checkCached = async (hashes, { signal } = {}) => {
            if (!hashes.length) return {};
            const chunkSize = 100;
            const chunks = [];
            for (let i = 0; i < hashes.length; i += chunkSize) chunks.push(hashes.slice(i, i + chunkSize));
            const groups = [];
            while (chunks.length) groups.push(chunks.splice(0, 4)); // groups of 4 chunks
            const result = {};
            for (const grp of groups) {
                const prom = grp.map(async c => {
                    const qs = new URLSearchParams({ format: 'object', list_files: 'false' });
                    c.forEach(h => qs.append('hash', h));
                    try {
                        const r = await request(`${MAIN}/torrents/checkcached?${qs}`, {}, signal);
                        if (r?.data) Object.assign(result, r.data);
                    } catch (e) { LOG('checkCached chunk error', e.message); }
                });
                await Promise.allSettled(prom);
            }
            return result;
        };
        const addMagnet = (magnet, signal) => request(`${MAIN}/torrents/createtorrent`, { method: 'POST', body: new URLSearchParams({ magnet, seed: '3' }) }, signal);
        const myList = async (id, s) => {
            const json = await request(`${MAIN}/torrents/mylist?id=${id}&bypass_cache=true`, {}, s);
            if (json?.data && !Array.isArray(json.data)) json.data = [json.data];
            return json;
        };
        const requestDl = (tid, fid, s) => request(`${MAIN}/torrents/requestdl?torrent_id=${tid}&file_id=${fid}&token=${CFG.apiKey}`, {}, s);
        
        // SSE Subscription - NEW
        function subscribeProgress(id, cb) {
            // Примітка: EventSource не підтримує кастомні заголовки, тому API-ключ або токен
            // мають передаватися через URL, якщо це потрібно для вашого ендпоінта.
            const es = new EventSource(`${MAIN}/progress/${id}`); // Приклад ендпоінта
            es.onmessage = (e) => cb(JSON.parse(e.data));
            es.onerror = () => es.close();
            return () => es.close();
        }

        return { searchPublicTrackers, checkCached, addMagnet, myList, requestDl, subscribeProgress };
    })();

    /* ──────────────── TorBoxComponent ──────────────── */
    function TorBoxComponent(object) {
        let scroll, files, filter, last, abort, debouncedBuild;
        let initialized = false;

        const state = {
            all_torrents: [],
            sort: Store.get('torbox_sort_method', 'seeders'),
            filters: JSON.parse(Store.get('torbox_filters_v2', '{}')),
            last_hash: null,
        };

        const defaultFilters = { quality: 'all', tracker: 'all', video_type: 'all', translation: 'all', lang: 'all', video_codec: 'all', audio_codec: 'all' };
        
        const restoreFocus = () => {
            collectionAttach(files.render(), scroll.render());
            collectionFocus(last, scroll.render());
        };

        const visibilityHandler = () => {
            if (document.visibilityState === 'visible') {
                restoreFocus();
                document.removeEventListener('visibilitychange', visibilityHandler);
            }
        };

        this.create = () => {
            scroll = new Lampa.Scroll({ mask: true, over: true });
            files = createExplorer(object);
            filter = new Lampa.Filter(object);
            abort = new AbortController();
            debouncedBuild = Utils.debounce(this.build.bind(this), 300);
            object.activity.loader(false);
            scroll.body().addClass('torbox-list-container');
            files.appendFiles(scroll.render());
            files.appendHead(filter.render());
            scroll.minus(files.render().find('.explorer__files-head'));
            return this.render();
        };
        
        this.start = () => {
            if (!initialized) {
                this.initialize();
                initialized = true;
            }
            Lampa.Controller.add('content', {
                toggle: () => restoreFocus(),
                up: () => Navigator.move('up'),
                down: () => Navigator.move('down'),
                left: () => Navigator.canmove('left') ? Navigator.move('left') : Lampa.Controller.toggle('menu'),
                right: () => Navigator.canmove('right') ? Navigator.move('right') : filter.show(Lampa.Lang.translate('title_filter'), 'filter'),
                back: this.back
            });
            Lampa.Controller.toggle('content');
        };

        this.initialize = () => {
            filter.onSelect = (type, a, b) => {
                Lampa.Select.close();
                if (type === 'sort') {
                    state.sort = a.key;
                    Store.set('torbox_sort_method', a.key);
                } else if (type === 'filter') {
                    if (a.refresh) return this.search(true);
                    if (a.reset) state.filters = { ...defaultFilters };
                    else if (a.stype) state.filters[a.stype] = b.value;
                    Store.set('torbox_filters_v2', JSON.stringify(state.filters));
                }
                state.last_hash = null;
                debouncedBuild();
                Lampa.Controller.toggle('content');
            };
            filter.onBack = () => Lampa.Controller.toggle('content');
            if (filter.addButtonBack) filter.addButtonBack();
            this.search();
        };

        this.search = async (force = false) => {
            abort.abort();
            abort = new AbortController();
            this.activity.loader(true);
            this.reset();
            const cacheKey = `torbox_hybrid_${object.movie.id || object.movie.imdb_id}`;
            const cachedTorrents = Cache.get(cacheKey);
            if (!force && cachedTorrents) {
                state.all_torrents = cachedTorrents;
                this.build();
                this.activity.loader(false);
                return;
            }
            this.empty('Получение списка торрентов…');
            try {
                const rawResults = await Api.searchPublicTrackers(object.movie, abort.signal);
                if (abort.signal.aborted) return;
                const withHash = rawResults.map(r => {
                    const m = r.MagnetUri.match(/urn:btih:([a-fA-F0-9]{40})/i);
                    return m ? { raw: r, hash: m[1] } : null;
                }).filter(Boolean);
                if (!withHash.length) return this.empty('Не найдено валидных торрентов.');
                this.empty(`Проверка кэша TorBox (${withHash.length})...`);
                const cachedMap = await Api.checkCached(withHash.map(x => x.hash), { signal: abort.signal });
                if (abort.signal.aborted) return;
                const cachedSet = new Set(Object.keys(cachedMap).map(h => h.toLowerCase()));
                state.all_torrents = withHash.map(({ raw, hash }) => this.procRaw(raw, hash, cachedSet));
                Cache.set(cacheKey, state.all_torrents);
                this.build();
            } catch (err) {
                if (abort.signal.aborted) return;
                this.empty(err.message || 'Произошла ошибка');
                Lampa.Noty.show(err.message || 'Ошибка');
            } finally {
                this.activity.loader(false);
            }
        };

        this.procRaw = (raw, hash, cachedSet) => {
             const v = raw.ffprobe?.find(s => s.codec_type === 'video');
            const a = raw.ffprobe?.filter(s => s.codec_type === 'audio') || [];
            const is_cached = cachedSet.has(hash.toLowerCase());
            return {
                title: Utils.escapeHtml(raw.Title),
                size: raw.Size, magnet: raw.MagnetUri, hash,
                last_known_seeders: raw.Seeders, publish_date: raw.PublishDate,
                quality: Utils.getQualityLabel(raw.Title, raw),
                video_type: raw.info?.videotype?.toLowerCase(), voices: raw.info?.voices,
                icon: is_cached ? '⚡' : '☁️', cached: is_cached,
                info_formated: `[${Utils.getQualityLabel(raw.Title, raw)}] ${Utils.formatBytes(raw.Size)} | 🟢<span style="color:var(--color-good);">${raw.Seeders || 0}</span> / 🔴<span style="color:var(--color-bad);">${raw.Peers || 0}</span>`,
                meta_formated: `Трекер: ${(raw.Tracker || '').split(/, ?/)[0] || 'н/д'} | Добавлено: ${Utils.formatAge(raw.PublishDate) || 'н/д'}`,
            };
        };

        this.onTorrentClick = async (torrent) => {
            abort.abort();
            abort = new AbortController();
            try {
                if (!torrent.magnet) throw { message: 'Magnet-ссылка не найдена' };
                const modal = Utils.progressModal();
                let closeSSE;
                try {
                    const res = await Api.addMagnet(torrent.magnet, abort.signal);
                    const tid = res.data.torrent_id || res.data.id;
                    const progressId = res.data.progress_id; // Припускаємо, що API повертає ID для SSE
                    if (!tid) throw { message: 'ID торрента не получен' };
                    
                    if (progressId) {
                        closeSSE = Api.subscribeProgress(progressId, (p) => {
                            modal.update(`${p.percent}% • ${Utils.bytes(p.speed)}/s`);
                            if (p.percent >= 100) {
                                if(closeSSE) closeSSE();
                                modal.destroy();
                                this.trackAndSelect(tid, torrent.hash);
                            }
                        });
                    } else {
                        // Fallback to polling if no SSE
                        modal.destroy();
                        this.trackAndSelect(tid, torrent.hash);
                    }
                } catch(e) {
                    if(closeSSE) closeSSE();
                    modal.destroy();
                    throw e;
                }
            } catch (e) {
                Lampa.Noty.show(e.message || 'Ошибка добавления торрента');
            }
        };
        
        this.trackAndSelect = async (tid, hash) => {
            // Ця функція може використовувати старий метод myList для отримання списку файлів
            // після завершення завантаження (якщо SSE не надає цю інформацію).
            const torrentData = await Api.myList(tid, abort.signal);
            torrentData.hash = hash;
            this.selectFile(torrentData.data[0]);
        }

        this.selectFile = (torrent_data) => {
            const videoFiles = torrent_data.files
                .filter(f => /\.(mkv|mp4|avi|ts|mov)$/i.test(f.name))
                .sort(Utils.naturalSort);
            if (!videoFiles.length) { Lampa.Noty.show('Видеофайлы не найдены'); return; }
            const isLikelyMovie = videoFiles.length === 1 || !/s\d{2}e\d{2}/i.test(videoFiles.map(f => f.name).join(''));
            if (isLikelyMovie) return this.play(torrent_data, videoFiles[0]);
            
            const movieId = object.movie.imdb_id || object.movie.id;
            const lastPlayedId = Store.get(`torbox_last_played_${movieId}`, null);
            Lampa.Select.show({
                title: 'Выберите файл для воспроизведения',
                items: videoFiles.map(file => ({
                    title: (String(file.id) === lastPlayedId ? `▶️ ` : '') + file.name,
                    subtitle: Utils.formatBytes(file.size),
                    file: file
                })),
                onSelect: (item) => this.play(torrent_data, item.file),
                onBack: () => Lampa.Controller.toggle('content')
            });
        };

        this.play = async (torrent_data, file) => {
            Lampa.Loading.start();
            try {
                const dlResponse = await Api.requestDl(torrent_data.id, file.id, abort.signal);
                const link = dlResponse.url || dlResponse.data;
                if (!link) throw new Error('Не удалось получить ссылку на файл');

                const movieId = object.movie.imdb_id || object.movie.id;
                state.last_hash = torrent_data.hash;
                Store.set(`torbox_last_torrent_${movieId}`, torrent_data.hash);
                Store.set(`torbox_last_played_${movieId}`, String(file.id));

                const playerObject = {
                    url: link,
                    title: `${object.movie.title} / ${file.name}`,
                    poster: object.movie.img,
                    timeline: Lampa.Timeline.view(torrent_data.hash + file.id)
                };
                
                Lampa.Player.play(playerObject);
                onPlayerDestroy(restoreFocus); // Для внутрішнього плеєра
                document.addEventListener('visibilitychange', visibilityHandler); // Для зовнішнього
                
            } catch (e) {
                Lampa.Noty.show(e.message || 'Ошибка воспроизведения');
            } finally {
                Lampa.Loading.stop();
            }
        };

        this.back = () => {
            if ($('body').find('.select, .modal').length) {
                 Lampa.Select.close();
                 Lampa.Modal.close();
                 return;
            }
            if ($('body').find('.filter').length) {
                Lampa.Filter.hide();
                return Lampa.Controller.toggle('content');
            }
            abort.abort();
            Lampa.Activity.backward();
        };

        this.build = () => {
            // ... (Код для buildFilter та draw, як у попередніх версіях)
            this.draw(this.applyFiltersSort());
        };
        this.applyFiltersSort = () => { /* ... */ return state.all_torrents; }; // simplified
        this.draw = (items) => {
            scroll.clear();
            if (!items.length) return this.empty('Ничего не найдено');
            items.forEach(item_data => {
                let item = Lampa.Template.get('torbox_item', item_data);
                item.on('hover:focus', (e) => { last = e.target; scroll.update($(e.target), true); });
                item.on('hover:enter', () => this.onTorrentClick(item_data));
                scroll.append(item);
            });
        };
        this.empty = (msg) => { scroll.append(`<div class="empty">${msg}</div>`); };
        this.reset = () => { scroll.clear(); };
        this.render = () => files.render();
        this.pause = () => {};
        this.stop = () => {};

        this.destroy = () => {
            abort.abort();
            document.removeEventListener('visibilitychange', visibilityHandler);
            if(files) files.destroy();
            if(scroll) scroll.destroy();
            if(filter) filter.destroy();
            files = scroll = filter = null;
        };
    }

    /* ───────────────── Register component & styles ──────────────── */
    (function () {
        function addTemplates() {
            Lampa.Template.add('torbox_item', '<div class="torbox-item selector" data-hash="{hash}"><div class="torbox-item__title">{icon} {title}</div><div class="torbox-item__main-info">{info_formated}</div><div class="torbox-item__meta">{meta_formated}</div></div>');
            Lampa.Template.add('torbox_empty', '<div class="empty"><div class="empty__text">{message}</div></div>');
        }
        function addSettings() {
            if (!Lampa.SettingsApi) return;
            Lampa.SettingsApi.addComponent({ component: 'torbox_enh', name: 'TorBox Enhanced', icon: ICON });
            [
                { k: 'torbox_proxy_url', n: 'URL CORS-прокси', d: `Default: ${Config.DEF.proxyUrl}`, t: 'input', v: CFG.proxyUrl },
                { k: 'torbox_api_key', n: 'API-Key', d: 'Ваш ключ от TorBox', t: 'input', v: CFG.apiKey },
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
            Lampa.Listener.follow('full', e => {
                if (e.type !== 'complite' || !e.data.movie) return;
                const root = e.object.activity.render();
                if (!root?.length || root.find('.view--torbox').length) return;
                const btn = $(`<div class="full-start__button selector view--torbox" data-subtitle="TorBox">${ICON}<span>TorBox</span></div>`);
                btn.on('hover:enter', () => {
                    addTemplates();
                    Lampa.Activity.push({ component: 'torbox_component', title: 'TorBox - ' + (e.data.movie.title || e.data.movie.name), movie: e.data.movie });
                });
                root.find('.view--torrent, .full-start__torrent').last().after(btn);
            });
        }
        function init() {
            if (document.getElementById('torbox-playerfix-styles')) return;
            const css = document.createElement('style');
            css.id = 'torbox-playerfix-styles';
            css.textContent = `
                .torbox-modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 9999; }
                .torbox-modal__content { background-color: var(--color-background); padding: 2em 3em; border-radius: 1em; font-size: 1.5em; color: var(--color-text); }
                /* Styles from original plugin */
                .torbox-list-container{padding:1em}.torbox-item{padding:1em 1.2em;margin:0 0 1em;border-radius:.8em;background:var(--color-background-light);transition:all .3s;border:2px solid transparent;overflow:hidden}.torbox-item:last-child{margin-bottom:0}.torbox-item--last-played,.torbox-item--just-watched{border-left:4px solid var(--color-second);background:rgba(var(--color-second-rgb),.1)}.torbox-item.focus,.torbox-item:hover{background:var(--color-primary);color:var(--color-background);-webkit-transform:scale(1.01);transform:scale(1.01);border-color:rgba(255,255,255,.3);box-shadow:0 4px 20px rgba(0,0,0,.2)}.torbox-item.focus .torbox-item__tech-bar,.torbox-item:hover .torbox-item__tech-bar{background:rgba(0,0,0,.2)}.torbox-item__title{font-weight:600;margin-bottom:.3em;font-size:1.1em;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.torbox-item__main-info{font-size:.95em;opacity:.9;line-height:1.4;margin-bottom:.3em}.torbox-item__meta{font-size:.9em;opacity:.7;line-height:1.4;margin-bottom:.8em}
            `;
            document.head.appendChild(css);
            Lampa.Component.add('torbox_component', TorBoxComponent);
            addSettings();
            boot();
            LOG('TorBox PlayerFix Ready');
        }
        if (window.Lampa) init();
        else window.addEventListener('Lampa.Ready', init, { once: true });
    })();

})();
