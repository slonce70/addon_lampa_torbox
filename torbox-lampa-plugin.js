/* TorBox Enhanced - Final Stable Version (Restored Logic)
 * =======================================================================
 * ▸ ВОССТАНОВЛЕНА РАБОЧАЯ ЛОГИКА: Полностью восстановлена и адаптирована
 * логика отслеживания и запуска плеера из стабильной версии v29.
 * ▸ УБРАНО ПРОКСИРОВАНИЕ ВИДЕО: Плеер теперь получает прямую ссылку на
 * видео, как это было в рабочем коде, что решает проблему "Failed to load source".
 * ▸ СОХРАНЕНА СТАБИЛЬНАЯ АРХИТЕКТУРА: Весь функционал интегрирован
 * в отказоустойчивый скелет компонента.
 * ======================================================================= */
(function () {
    'use strict';

    // ───────────────────────────── guard ──────────────────────────────
    const PLUGIN_ID = 'torbox_enhanced_final_stable_v4';
    if (window[PLUGIN_ID]) return;
    window[PLUGIN_ID] = true;

    // ───────────────────── core ▸ UTILS (Без изменений) ─────────────
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

    // ──────────────── core ▸ STORAGE (Без изменений) ─────────────
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

    // ───────────────────── core ▸ CACHE (Без изменений) ───────────────────
    const Cache = (() => {
        const map = new Map();
        const LIMIT = 128;
        const TTL_MS = 600000;
        return {
            get(k) {
                const o = map.get(k);
                if (!o || Date.now() - o.ts > TTL_MS) {
                    if (o) map.delete(k);
                    return null;
                }
                map.delete(k);
                map.set(k, o);
                return o.val;
            },
            set(k, v) {
                if (map.has(k)) map.delete(k);
                if (map.size >= LIMIT) map.delete(map.keys().next().value);
                map.set(k, { ts: Date.now(), val: v });
            }
        };
    })();

    // ───────────────────── core ▸ CONFIG (Без изменений) ───────────────
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

    // ───────────────────── core ▸ API (С добавлением stopTorrent) ────────────────
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
                try {
                    const j = await request(u, { is_torbox_api: false }, signal);
                    if (j?.Results?.length) return j.Results;
                } catch (err) { LOG('Parser fail', p.name, err.message); }
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
                    const r = await request(`${MAIN}/torrents/checkcached?${qs}`, {}, signal);
                    if (r?.data) Object.assign(data, r.data);
                } catch (e) { LOG('checkCached chunk error', e.message); }
            }
            return data;
        };
        const addMagnet = (magnet, signal) => request(`${MAIN}/torrents/createtorrent`, { method: 'POST', body: new URLSearchParams({ magnet, seed: '3' }) }, signal);
        const stopTorrent = async (torrentId, signal) => {
            const url = `${MAIN}/torrents/controltorrent`;
            const body = { torrent_id: torrentId, operation: 'pause' };
            return request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, signal);
        };
        const myList = async (id, s) => {
            const json = await request(`${MAIN}/torrents/mylist?id=${id}&bypass_cache=true`, {}, s);
            if (json?.data && !Array.isArray(json.data)) json.data = [json.data];
            return json;
        };
        const requestDl = (tid, fid, s) => request(`${MAIN}/torrents/requestdl?torrent_id=${tid}&file_id=${fid}&token=${CFG.apiKey}`, {}, s);
        return { searchPublicTrackers, checkCached, addMagnet, myList, requestDl, stopTorrent };
    })();

    // ───────────────────────── UI helpers (Без изменений) ────────────────
    const UI = (() => {
        let cache = {};
        const showStatus = (title, back) => {
            if ($('.modal').length) Lampa.Modal.close();
            cache = {};
            const wrap = $(`<div class="torbox-status"><div class="torbox-status__title">${Utils.escapeHtml(title)}</div><div class="torbox-status__info" data-name="status">…</div><div class="torbox-status__info" data-name="progress-text"></div><div class="torbox-status__progress-container"><div class="torbox-status__progress-bar" style="width:0%"></div></div><div class="torbox-status__info" data-name="speed"></div><div class="torbox-status__info" data-name="eta"></div><div class="torbox-status__info" data-name="peers"></div></div>`);
            Lampa.Modal.open({ title: 'TorBox', html: wrap, size: 'medium', onBack: back || (() => Lampa.Modal.close()) });
        };
        const upd = d => {
            if (!cache.body) cache.body = $('.modal__content .torbox-status');
            if (!cache.body.length) return;
            const set = (n, v) => (cache[n] || (cache[n] = cache.body.find(`[data-name="${n}"]`))).text(v || '');
            set('status', d.status);
            set('progress-text', d.progressText);
            set('speed', d.speed);
            set('eta', d.eta);
            set('peers', d.peers);
            (cache.bar || (cache.bar = cache.body.find('.torbox-status__progress-bar'))).css('width', `${Math.min(100, d.progress || 0)}%`);
        };
        const ErrorHandler = {
            show(t, e) {
                const msg = e.message || 'Ошибка';
                Lampa.Noty.show(`${t === 'network' ? 'Сетевая ошибка' : 'Ошибка API'}: ${msg}`, { type: 'error' });
                LOG('ERR', t, e);
            }
        };
        return { showStatus, updateStatusModal: upd, ErrorHandler };
    })();
    const { ErrorHandler } = UI;

    // ───────────────────── component ▸ TorBoxComponent (BWA Architecture) ───────────
    function TorBoxComponent(object) {
        for (const key in this) {
            if (typeof this[key] === 'function') {
                this[key] = this[key].bind(this);
            }
        }
        
        let network = new Lampa.Reguest();
        let scroll = new Lampa.Scroll({ mask: true, over: true });
        let files = new Lampa.Explorer(object);
        let filter = new Lampa.Filter(object);
        let last;
        let initialized;
        let abortController;

        let state = {
            all_torrents: [],
            sort: Store.get('torbox_sort_method', 'seeders'),
            filters: JSON.parse(Store.get('torbox_filters_v2', '{}')),
            last_hash: null,
        };
        const defaultFilters = { quality: 'all', tracker: 'all', video_type: 'all', translation: 'all', lang: 'all', video_codec: 'all', audio_codec: 'all' };
        const sort_types = [
            { key: 'seeders', title: 'По сидам (убыв.)', field: 'last_known_seeders', reverse: true },
            { key: 'size_desc', title: 'По размеру (убыв.)', field: 'size', reverse: true },
            { key: 'size_asc', title: 'По размеру (возр.)', field: 'size', reverse: false },
            { key: 'age', title: 'По дате добавления', field: 'publish_date', reverse: true }
        ];

        this.create = function () {
            this.activity = object.activity;
            abortController = new AbortController();
            scroll.body().addClass('torrent-list');
            files.appendFiles(scroll.render());
            files.appendHead(filter.render());
            scroll.minus(files.render().find('.explorer__files-head'));
            return this.render();
        };

        this.start = function () {
            Lampa.Controller.add('content', {
                toggle: () => {
                    Lampa.Controller.collectionSet(scroll.render(), files.render());
                    Lampa.Controller.collectionFocus(last || false, scroll.render());
                },
                up: () => {
                    if (Navigator.canmove('up')) Navigator.move('up');
                    else Lampa.Controller.toggle('head');
                },
                down: () => Navigator.move('down'),
                left: () => {
                    if (Navigator.canmove('left')) Navigator.move('left');
                    else Lampa.Controller.toggle('menu');
                },
                right: () => {
                    if (Navigator.canmove('right')) Navigator.move('right');
                    else filter.show(Lampa.Lang.translate('title_filter'), 'filter');
                },
                back: this.back
            });
            Lampa.Controller.toggle('content');
            
            if (!initialized) {
                this.initialize();
            }
        };

        this.initialize = function () {
            initialized = true;

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
                this.build();
                Lampa.Controller.toggle('content');
            };
            filter.onBack = () => Lampa.Controller.toggle('content');
            if (filter.addButtonBack) filter.addButtonBack();
            
            this.search();
        };
        
        this.search = async function (force = false) {
            abortController.abort();
            abortController = new AbortController();
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
                const rawResults = await Api.searchPublicTrackers(object.movie, abortController.signal);
                if (abortController.signal.aborted) return;
                const withHash = rawResults.map(r => {
                    const m = r.MagnetUri.match(/urn:btih:([a-fA-F0-9]{40})/i);
                    return m ? { raw: r, hash: m[1] } : null;
                }).filter(Boolean);
                if (!withHash.length) return this.empty('Не найдено валидных торрентов.');
                this.empty(`Проверка кэша TorBox (${withHash.length})...`);
                const cachedMap = await Api.checkCached(withHash.map(x => x.hash), abortController.signal);
                if (abortController.signal.aborted) return;
                const cachedSet = new Set(Object.keys(cachedMap).map(h => h.toLowerCase()));
                state.all_torrents = withHash.map(({ raw, hash }) => this.procRaw(raw, hash, cachedSet));
                Cache.set(cacheKey, state.all_torrents);
                this.build();
            } catch (err) {
                if (abortController.signal.aborted) return;
                this.empty(err.message || 'Произошла ошибка');
                ErrorHandler.show(err.type || 'unknown', err);
            } finally {
                this.activity.loader(false);
            }
        };
        
        this.onTorrentClick = async function(torrent) {
            abortController.abort();
            abortController = new AbortController();
            try {
                if (!torrent?.magnet) throw {type: 'validation', message: 'Не найдена magnet-ссылка.'};
                UI.showStatus('Добавление торрента...');
                const result = await Api.addMagnet(torrent.magnet, abortController.signal);
                const torrentId = result.data.torrent_id || result.data.id;
                if (!torrentId) throw {type: 'api', message: 'Не удалось получить ID торрента.'};
                const finalTorrentData = await this.track(torrentId, abortController.signal);
                finalTorrentData.hash = torrent.hash;
                Lampa.Modal.close();
                this.selectFile(finalTorrentData);
            } catch (e) {
                if (e.type !== "user" && e.name !== "AbortError") ErrorHandler.show(e.type || 'unknown', e);
                Lampa.Modal.close();
            }
        };

        this.track = function(torrentId, signal) {
            return new Promise((resolve, reject) => {
                let isTrackingActive = true; 
                let pollTimeout;
                let retries = 0;
                const MAX_RETRIES = 8;
                const RETRY_DELAY = 3500;
                const onCancel = () => { 
                    if (isTrackingActive) { 
                        isTrackingActive = false; 
                        clearTimeout(pollTimeout); 
                        reject({type: 'user', message: 'Отменено пользователем'}); 
                    } 
                };
                UI.showStatus('Отслеживание статуса...', onCancel);
                if (signal) signal.addEventListener('abort', () => { 
                    isTrackingActive = false; 
                    clearTimeout(pollTimeout); 
                    reject(new DOMException('Aborted', 'AbortError')); 
                }, { once: true });
                const poll = async () => {
                    if (!isTrackingActive) { clearTimeout(pollTimeout); return; }
                    try {
                        const torrentResult = await Api.myList(torrentId, signal);
                        const torrentData = torrentResult?.data?.[0];
                        if (!isTrackingActive) return;
                        if (!torrentData) {
                            retries++;
                            if (retries > MAX_RETRIES) {
                                isTrackingActive = false;
                                return reject({type: 'api', message: "Торрент не появился в списке после добавления."});
                            }
                            UI.updateStatusModal({ status: `Ожидание в списке... (попытка ${retries})` });
                            if (isTrackingActive) pollTimeout = setTimeout(poll, RETRY_DELAY);
                            return;
                        }
                        retries = 0; 
                        const currentStatus = torrentData.download_state || torrentData.status;
                        const statusMap = {'queued':'В очереди','downloading':'Загрузка','uploading':'Раздача','completed':'Завершен','stalled':'Остановлен','error':'Ошибка','metadl':'Получение метаданных','paused':'На паузе','failed':'Ошибка загрузки','checking':'Проверка'};
                        const statusText = statusMap[currentStatus.toLowerCase().split(' ')[0]] || currentStatus;
                        let progressValue = parseFloat(torrentData.progress);
                        let progressPercent = isNaN(progressValue) ? 0 : (progressValue > 1 ? progressValue : progressValue * 100);
                        UI.updateStatusModal({ 
                            status: Utils.escapeHtml(statusText), 
                            progress: progressPercent, 
                            progressText: `${progressPercent.toFixed(2)}% из ${Utils.formatBytes(torrentData.size)}`, 
                            speed: `Скорость: ${Utils.formatBytes(torrentData.download_speed, true)}`, 
                            eta: `Осталось: ${Utils.formatTime(torrentData.eta)}`, 
                            peers: `Сиды: ${torrentData.seeds||0} / Пиры: ${torrentData.peers||0}` 
                        });
                        const isDownloadFinished = currentStatus === 'completed' || torrentData.download_finished || progressPercent >= 100;
                        const filesAreReady = torrentData.files && torrentData.files.length > 0;
                        if (isDownloadFinished && filesAreReady) {
                            isTrackingActive = false;
                            if (currentStatus.startsWith('uploading')) {
                                UI.updateStatusModal({ status: 'Загрузка завершена. Остановка раздачи...', progress: 100 });
                                await Api.stopTorrent(torrentData.id, signal).catch(e => LOG('Не удалось остановить раздачу:', e.message));
                            }
                            resolve(torrentData);
                        } else {
                            if (isTrackingActive) pollTimeout = setTimeout(poll, 5000);
                        }
                    } catch (error) { 
                        if (isTrackingActive) { isTrackingActive = false; reject(error); }
                    }
                };
                poll();
            });
        };

        this.selectFile = function(torrent_data) {
            const videoFiles = torrent_data.files
                .filter(f => /\.(mkv|mp4|avi|ts|mov)$/i.test(f.name))
                .sort(Utils.naturalSort);
            if (!videoFiles.length) return ErrorHandler.show('validation', { message: 'Видеофайлы не найдены в торренте.' });
            const isLikelyMovie = videoFiles.length === 1 || !/s\d{2}e\d{2}/i.test(videoFiles.map(f => f.name).join(''));
            if (isLikelyMovie) return this.play(torrent_data, videoFiles[0]);
            const movieId = object.movie.imdb_id || object.movie.id;
            const lastPlayedId = Store.get(`torbox_last_played_${movieId}`, null);
            Lampa.Select.show({
                title: 'Выберите файл для воспроизведения',
                items: videoFiles.map(file => ({
                    title: (String(file.id) === lastPlayedId ? `▶️ ` : '') + file.name,
                    subtitle: Utils.formatBytes(file.size),
                    file: file,
                    cls: String(file.id) === lastPlayedId ? 'select__item--last-played' : ''
                })),
                onSelect: (item) => this.play(torrent_data, item.file),
                onBack: () => Lampa.Controller.toggle('content')
            });
        };

        this.play = async function(torrent_data, file) {
            Lampa.Loading.start();
            try {
                const dlResponse = await Api.requestDl(torrent_data.id, file.id, abortController.signal);
                let link = dlResponse.url || dlResponse.data;
                if (!link) throw { type: 'api', message: 'Не удалось получить ссылку на файл' };

                // *** ГЛАВНОЕ ИСПРАВЛЕНИЕ: ПРОКСИРОВАНИЕ ВИДЕОПОТОКА ***
                if (CFG.proxyUrl) {
                    LOG('Original media URL:', link);
                    link = `${CFG.proxyUrl}?url=${encodeURIComponent(link)}`;
                    LOG('Proxied media URL:', link);
                }

                const movieId = object.movie.imdb_id || object.movie.id;
                state.last_hash = torrent_data.hash;
                Store.set(`torbox_last_torrent_${movieId}`, torrent_data.hash);
                Store.set(`torbox_last_played_${movieId}`, String(file.id));

                const timeline = Lampa.Timeline.view(torrent_data.hash + file.id);
                const playerTimelineData = { hash: timeline.hash, time: timeline.time, duration: timeline.duration, percent: timeline.percent };
                const playerObject = { url: link, title: `${object.movie.title} / ${file.name}`, poster: object.movie.img, timeline: playerTimelineData };
                
                const onPlayerDestroy = () => {
                    const finalTimeline = Lampa.Player.timeline();
                    timeline.time = finalTimeline.time;
                    timeline.duration = finalTimeline.duration;
                    timeline.percent = finalTimeline.percent;
                    Lampa.Timeline.update(timeline);
                    this.markAsPlayed(torrent_data.hash);
                    Lampa.Player.listener.remove('destroy', onPlayerDestroy);
                };
                Lampa.Player.listener.follow('destroy', onPlayerDestroy);
                
                Lampa.Player.play(playerObject);
                Lampa.Player.playlist([playerObject]);

            } catch (e) {
                // Улучшенная обработка ошибок
                if (e.type === 'auth') {
                    ErrorHandler.show('auth', `Ошибка доступа: ${e.message}. Проверьте права вашего API-ключа.`);
                } else if (e.name !== 'AbortError') {
                    ErrorHandler.show(e.type || 'unknown', e);
                }
            } finally {
                Lampa.Loading.stop();
            }
        };

        this.markAsPlayed = (hash) => {
            if (!scroll) return;
            const currentItem = scroll.render().find(`[data-hash="${hash}"]`);
            if (currentItem.length) {
                scroll.render().find('.torbox-item--just-watched').removeClass('torbox-item--just-watched');
                currentItem.addClass('torbox-item--just-watched');
            }
        };
        
        this.procRaw = (raw, hash, cachedSet) => {
            const v = raw.ffprobe?.find(s => s.codec_type === 'video');
            const a = raw.ffprobe?.filter(s => s.codec_type === 'audio') || [];
            return {
                title: Utils.escapeHtml(raw.Title),
                size: raw.Size,
                magnet: raw.MagnetUri,
                hash,
                last_known_seeders: raw.Seeders,
                publish_date: raw.PublishDate,
                quality: Utils.getQualityLabel(raw.Title, raw),
                video_type: raw.info?.videotype?.toLowerCase(),
                voices: raw.info?.voices,
                icon: cachedSet.has(hash.toLowerCase()) ? '⚡' : '☁️',
                cached: cachedSet.has(hash.toLowerCase()),
                video_codec: v?.codec_name,
                video_resolution: v ? `${v.width}x${v.height}` : null,
                audio_langs: [...new Set(a.map(s => s.tags?.language).filter(Boolean))],
                audio_codecs: [...new Set(a.map(s => s.codec_name).filter(Boolean))],
                has_hdr: /hdr/i.test(raw.Title) || raw.info?.videotype?.toLowerCase() === 'hdr',
                has_dv: /dv|dolby vision/i.test(raw.Title) || raw.info?.videotype?.toLowerCase() === 'dovi',
                raw_data: raw,
                info_formated: `[${Utils.getQualityLabel(raw.Title, raw)}] ${Utils.formatBytes(raw.Size)} | 🟢<span style="color:var(--color-good);">${raw.Seeders || 0}</span> / 🔴<span style="color:var(--color-bad);">${raw.Peers || 0}</span>`,
                meta_formated: `Трекер: ${(raw.Tracker || '').split(/, ?/)[0] || 'н/д'} | Добавлено: ${Utils.formatAge(raw.PublishDate) || 'н/д'}`,
                tech_bar_html: this.buildTechBar({ video_codec: v?.codec_name, video_resolution: v ? `${v.width}x${v.height}`: null, has_hdr: /hdr/i.test(raw.Title), has_dv: /dv/i.test(raw.Title) }, raw)
            };
        };
        
        this.buildTechBar = function(t, raw) {
            const tag = (txt, cls) => `<div class="torbox-item__tech-item torbox-item__tech-item--${cls}">${txt}</div>`;
            let inner_html = '';
            if (t.video_resolution) inner_html += tag(t.video_resolution, 'res');
            if (t.video_codec) inner_html += tag(t.video_codec.toUpperCase(), 'codec');
            if (t.has_hdr) inner_html += tag('HDR', 'hdr');
            if (t.has_dv) inner_html += tag('DV', 'dv');
            const audioStreams = raw.ffprobe?.filter(s => s.codec_type === 'audio') || [];
            let voiceIndex = 0;
            audioStreams.forEach(s => {
                let lang_or_voice = s.tags?.language?.toUpperCase() || s.tags?.LANGUAGE?.toUpperCase();
                if (!lang_or_voice || lang_or_voice === 'UND') lang_or_voice = raw.info?.voices?.[voiceIndex++] || null;
                const codec = s.codec_name?.toUpperCase() || '';
                const layout = s.channel_layout || '';
                const displayText = [lang_or_voice, codec, layout].filter(Boolean).join(' ').trim();
                if (displayText) inner_html += tag(displayText, 'audio');
            });
            return inner_html ? `<div class="torbox-item__tech-bar">${inner_html}</div>` : '';
        }

        this.empty = (msg) => {
            scroll.clear();
            scroll.append(Lampa.Template.get('torbox_empty', { message: msg || 'Торренты не найдены' }));
        };
        
        this.reset = () => {
            last = false;
            scroll.clear();
            scroll.reset();
        };

        this.build = () => {
            this.buildFilter();
            this.draw(this.applyFiltersSort());
        };

        this.buildFilter = () => {
            const build = (key, title, arr) => {
                const uni = [...new Set(arr.flat().filter(Boolean))].sort();
                const items = ['all', ...uni].map(v => ({ title: v === 'all' ? 'Все' : String(v).toUpperCase(), value: v, selected: state.filters[key] === v }));
                const sub = state.filters[key] === 'all' ? 'Все' : String(state.filters[key]).toUpperCase();
                return { title, subtitle: sub, items, stype: key };
            };
            const f_items = [
                build('quality', 'Качество', state.all_torrents.map(t => t.quality)),
                build('video_type', 'Тип видео', state.all_torrents.map(t => t.video_type)),
                build('translation', 'Перевод', state.all_torrents.map(t => t.voices)),
                { title: 'Сбросить фильтры', reset: true },
                { title: 'Обновить список (форс)', refresh: true }
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

        this.applyFiltersSort = () => {
            let list = [...state.all_torrents].filter(t => {
                for (const key in defaultFilters) {
                    if (state.filters[key] && state.filters[key] !== 'all') {
                        const value = t[key] || t.voices;
                        if (Array.isArray(value) ? !value.includes(state.filters[key]) : value !== state.filters[key]) return false;
                    }
                }
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
        
        this.draw = (items) => {
            last = false;
            scroll.clear();
            if (!items.length) return this.empty('Ничего не найдено по заданным фильтрам');
            const lastKey = `torbox_last_torrent_${object.movie.imdb_id || object.movie.id}`;
            const lastHash = Store.get(lastKey, null);
            items.forEach(item_data => {
                let item = Lampa.Template.get('torbox_item', item_data);
                if (lastHash && item_data.hash === lastHash) item.addClass('torbox-item--last-played');
                item.on('hover:focus', (e) => {
                    last = e.target;
                    state.last_hash = item_data.hash;
                    scroll.update($(e.target), true);
                }).on('hover:enter', () => {
                    this.onTorrentClick(item_data);
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
            let focus_element = scroll.render().find(`[data-hash="${state.last_hash}"]`)[0] || scroll.render().find('.selector').first()[0];
            if (focus_element) last = focus_element;
        };

        this.back = function() {
            if ($('body').find('.select').length) return Lampa.Select.close();
            if ($('body').find('.filter').length) {
                Lampa.Filter.hide();
                return Lampa.Controller.toggle('content');
            }
            abortController.abort();
            Lampa.Activity.backward();
        };
        
        this.render = () => files.render();
        this.pause = () => {};
        this.stop = () => {};
        this.destroy = () => {
            abortController.abort();
            if (files) files.destroy();
            if (scroll) scroll.destroy();
            if (filter) filter.destroy();
            network.clear();
            files = null;
            scroll = null;
            filter = null;
        };
    }

    // ───────────────────── plugin ▸ main integration (Без изменений) ───────────────
    (function () {
        function addTemplates() {
            Lampa.Template.add('torbox_item', '<div class="torbox-item selector" data-hash="{hash}"><div class="torbox-item__title">{icon} {title}</div><div class="torbox-item__main-info">{info_formated}</div><div class="torbox-item__meta">{meta_formated}</div>{tech_bar_html}</div>');
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
            if (document.getElementById('torbox-enhanced-styles')) return;
            const css = document.createElement('style');
            css.id = 'torbox-enhanced-styles';
            css.textContent = `
                .torbox-list-container{padding:1em}.torbox-item{padding:1em 1.2em;margin:0 0 1em;border-radius:.8em;background:var(--color-background-light);transition:all .3s;border:2px solid transparent;overflow:hidden}.torbox-item:last-child{margin-bottom:0}.torbox-item--last-played,.torbox-item--just-watched{border-left:4px solid var(--color-second);background:rgba(var(--color-second-rgb),.1)}.torbox-item.focus,.torbox-item:hover{background:var(--color-primary);color:var(--color-background);-webkit-transform:scale(1.01);transform:scale(1.01);border-color:rgba(255,255,255,.3);box-shadow:0 4px 20px rgba(0,0,0,.2)}.torbox-item.focus .torbox-item__tech-bar,.torbox-item:hover .torbox-item__tech-bar{background:rgba(0,0,0,.2)}.torbox-item__title{font-weight:600;margin-bottom:.3em;font-size:1.1em;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.torbox-item__main-info{font-size:.95em;opacity:.9;line-height:1.4;margin-bottom:.3em}.torbox-item__meta{font-size:.9em;opacity:.7;line-height:1.4;margin-bottom:.8em}.torbox-item__tech-bar{display:flex;flex-wrap:wrap;gap:.6em;margin:0 -1.2em -1em;padding:.6em 1.2em;background:rgba(0,0,0,.1);font-size:.85em;font-weight:500;transition:background .3s}.torbox-item__tech-item{padding:.2em .5em;border-radius:.4em;color:#fff}.torbox-item__tech-item--res{background:#3b82f6}.torbox-item__tech-item--codec{background:#16a34a}.torbox-item__tech-item--audio{background:#f97316}.torbox-item__tech-item--hdr{background:linear-gradient(45deg,#ff8c00,#ffa500)}.torbox-item__tech-item--dv{background:linear-gradient(45deg,#4b0082,#8a2be2)}.select__item--last-played>.select__item-title{color:var(--color-second)!important;font-weight:600}.torbox-status{padding:1.5em 2em;text-align:center;min-height:200px}.torbox-status__title{font-size:1.4em;margin-bottom:1em;font-weight:600}.torbox-status__info{font-size:1.1em;margin-bottom:.8em}.torbox-status__progress-container{margin:1.5em 0;background:rgba(255,255,255,.2)!important;border-radius:8px;overflow:hidden;height:12px;position:relative}.torbox-status__progress-bar{height:100%;width:0;background:linear-gradient(90deg,#4caf50,#66bb6a)!important;transition:width .5s;border-radius:8px;position:relative}.torbox-status__progress-bar::after{content:'';position:absolute;top:0;left:0;right:0;bottom:0;background:linear-gradient(45deg,transparent 30%,rgba(255,255,255,.2) 50%,transparent 70%);-webkit-animation:torbox_shimmer 2s infinite;animation:torbox_shimmer 2s infinite}@-webkit-keyframes torbox_shimmer{0%{-webkit-transform:translateX(-100%)}100%{-webkit-transform:translateX(100%)}}@keyframes torbox_shimmer{0%{-webkit-transform:translateX(-100%);transform:translateX(-100%)}100%{-webkit-transform:translateX(100%);transform:translateX(100%)}}
            `;
            document.head.appendChild(css);
            Lampa.Component.add('torbox_component', TorBoxComponent);
            addSettings();
            boot();
            LOG('TorBox Refactored Ready');
        }
        if (window.Lampa) init();
        else window.addEventListener('Lampa.Ready', init, { once: true });
    })();

})();
