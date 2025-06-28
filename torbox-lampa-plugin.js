/* TorBox Enhanced – Universal Lampa Plugin  v35.1.11 (Template Fix)
 * =======================================================================
 * ▸ ИСПРАВЛЕНА ОТРИСОВКА: Решена проблема с отображением кода шаблона ({_if...})
 * вместо готовых элементов. Шаблон преобразован в одну строку для корректной
 * обработки движком Lampa.
 * ======================================================================= */
(function () {
    'use strict';

    // ───────────────────────────── guard ──────────────────────────────
    const PLUGIN_ID = 'torbox_enhanced_v35_1_0_template_fix';
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

    // ──────────────── core ▸ STORAGE (safeStorage + Store) ─────────────
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
        const LIM = 128;
        return {
            get(k) {
                if (!map.has(k)) return null;
                const o = map.get(k);
                if (Date.now() - o.ts > 600000) { // 10-минутный кэш
                    map.delete(k);
                    return null;
                }
                map.delete(k);
                map.set(k, o); // переместить наверх (наиболее используемый)
                return o.val;
            },
            set(k, v) {
                if (map.has(k)) map.delete(k);
                map.set(k, { ts: Date.now(), val: v });
                if (map.size > LIM) map.delete(map.keys().next().value); // удалить самый старый
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

        // [РЕФАКТОРИНГ] Улучшена обработка ошибок для большей информативности.
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
                if (e.type) throw e; // Пробрасываем уже обработанную ошибку API
                throw { type: 'api', message: 'Некорректный JSON в ответе' };
            }
        };

        // [РЕФАКТОРИНГ] Добавлен автоматический таймаут для всех запросов.
        const request = async (url, opt = {}, signal) => {
            if (!CFG.proxyUrl) throw { type: 'validation', message: 'CORS-proxy не задан в настройках' };

            const controller = new AbortController();
            const timeout = 20000; // 20 секунд
            const timeoutId = setTimeout(() => controller.abort(), timeout);
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
                    if (!signal || !signal.aborted) throw { type: 'network', message: `Таймаут запроса (${timeout / 1000} сек)` };
                    throw e; // Отмена пользователем
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
            // [ИСПРАВЛЕНИЕ] API может вернуть один объект вместо массива, если в списке один торрент.
            // Эта проверка гарантирует, что мы всегда работаем с массивом.
            if (json && json.data && !Array.isArray(json.data)) {
                json.data = [json.data];
            }
            return json;
        };
        const requestDl = (tid, fid, s) => request(`${MAIN}/torrents/requestdl?torrent_id=${tid}&file_id=${fid}&token=${CFG.apiKey}`, { method: 'GET' }, s);

        return { searchPublicTrackers, checkCached, addMagnet, myList, requestDl };
    })();

    // ───────────────────────── UI helpers ─────────────────────────────
    const UI = (() => {
        let cache = {};
        const showStatus = (title, back) => {
            if ($('.modal').length) Lampa.Modal.close();
            cache = {};
            const wrap = document.createElement('div');
            wrap.className = 'torbox-status';
            wrap.innerHTML = `
                <div class="torbox-status__title">${Utils.escapeHtml(title)}</div>
                <div class="torbox-status__info" data-name="status">…</div>
                <div class="torbox-status__info" data-name="progress-text"></div>
                <div class="torbox-status__progress-container">
                    <div class="torbox-status__progress-bar" style="width:0%"></div>
                </div>
                <div class="torbox-status__info" data-name="speed"></div>
                <div class="torbox-status__info" data-name="eta"></div>
                <div class="torbox-status__info" data-name="peers"></div>`;
            Lampa.Modal.open({ title: 'TorBox', html: $(wrap), size: 'medium', onBack: back || (() => Lampa.Modal.close()) });
        };
        const upd = d => {
            if (!cache.body) cache.body = $('.modal__content .torbox-status');
            if (!cache.body.length) return;
            const set = (n, v) => {
                if (!cache[n]) cache[n] = cache.body.find(`[data-name="${n}"]`);
                cache[n].text(v || '');
            };
            set('status', d.status);
            set('progress-text', d.progressText);
            set('speed', d.speed);
            set('eta', d.eta);
            set('peers', d.peers);
            if (!cache.bar) cache.bar = cache.body.find('.torbox-status__progress-bar');
            cache.bar.css('width', Math.min(100, d.progress || 0) + '%');
        };
        const ErrorHandler = {
            show(t, e) {
                const msg = e.message || 'Ошибка';
                Lampa.Noty.show(`${t === 'network' ? 'Сетевая ошибка' : 'Ошибка'}: ${msg}`, { type: 'error' });
                LOG('ERR', t, e);
            }
        };
        return { showStatus, updateStatusModal: upd, ErrorHandler };
    })();
    const { ErrorHandler } = UI;

    // ───────────────────── component ▸ TorBoxComponent ───────────────
    function TorBoxComponent(object) {
        // Стандартный конструктор, как в bwa.js
        let scroll = new Lampa.Scroll({mask: true, over: true});
        let files = new Lampa.Explorer(object);
        let filter = new Lampa.Filter(object);
        let last;
        let initialized = false;
        let abort = new AbortController();

        this.activity = object.activity;

        // Определения для фильтров и сортировки
        let sort_types = [
            { key: 'seeders', title: 'По сидам (убыв.)', field: 'last_known_seeders', reverse: true },
            { key: 'size_desc', title: 'По размеру (убыв.)', field: 'size', reverse: true },
            { key: 'size_asc', title: 'По размеру (возр.)', field: 'size', reverse: false },
            { key: 'age', title: 'По дате добавления', field: 'publish_date', reverse: true }
        ];
        let defaultFilters = { quality: 'all', tracker: 'all', video_type: 'all', translation: 'all', lang: 'all', video_codec: 'all', audio_codec: 'all' };
        
        // Состояние
        let state = {
            all_torrents: [],
            sort: Store.get('torbox_sort_method', 'seeders'),
            filters: JSON.parse(Store.get('torbox_filters_v2', JSON.stringify(defaultFilters))),
            last_hash: null,
        };

        // Логика обработки торрентов, перенесенная из старого кода
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
                info_formated: `[${Utils.getQualityLabel(raw.Title, raw)}] ${Utils.formatBytes(raw.Size)} | 🟢<span style="color:var(--color-good);">${raw.Seeders || 0}</span> / 🔴<span style="color:var(--color-bad);">${raw.Peers || 0}</span>`,
                meta_formated: `Трекеры: ${(raw.Tracker || '').split(/, ?/)[0] || 'н/д'} | Добавлено: ${Utils.formatAge(raw.PublishDate) || 'н/д'}`,
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

        // Логика поиска
        const search = (force = false) => {
            abort.abort(); // Прерываем предыдущие запросы
            abort = new AbortController();
            
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

            Api.searchPublicTrackers(object.movie, abort.signal)
                .then(raw => {
                    if (abort.signal.aborted) return;
                    if (!raw.length) return this.empty('Парсер не вернул результатов.');
                    const withHash = raw.map(r => {
                        const m = r.MagnetUri.match(/urn:btih:([a-fA-F0-9]{40})/i);
                        return m ? { raw: r, hash: m[1] } : null;
                    }).filter(Boolean);
                    if (!withHash.length) return this.empty('Не найдено валидных торрентов.');
                    this.empty(`Проверка кэша (${withHash.length})…`);
                    return Api.checkCached(withHash.map(x => x.hash), abort.signal)
                        .then(cached => ({ withHash, cached }));
                })
                .then(({withHash, cached}) => {
                    if (abort.signal.aborted) return;
                    const cachedSet = new Set(Object.keys(cached).map(h => h.toLowerCase()));
                    state.all_torrents = withHash.map(({ raw, hash }) => procRaw(raw, hash, cachedSet));
                    Cache.set(key, state.all_torrents);
                    this.build();
                })
                .catch(err => {
                    if (abort.signal.aborted) return;
                    this.empty(err.message || 'Ошибка');
                    ErrorHandler.show(err.type || 'unknown', err);
                })
                .finally(() => {
                    this.activity.loader(false);
                });
        };

        // Управление воспроизведением
        const onTorrentClick = async (torrent) => {
            try {
                if (!torrent.magnet) throw { type: 'validation', message: 'Magnet-ссылка не найдена' };
                UI.showStatus('Добавление торрента…');
                const res = await Api.addMagnet(torrent.magnet, abort.signal);
                const tid = res.data.torrent_id || res.data.id;
                if (!tid) throw { type: 'api', message: 'ID торрента не получен' };
                const data = await track(tid);
                data.hash = torrent.hash;
                Lampa.Modal.close();
                selectFile(data);
            } catch (e) {
                if (e.type !== 'user' && e.name !== 'AbortError') ErrorHandler.show(e.type || 'unknown', e);
                Lampa.Modal.close();
            }
        };

        const track = (id) => {
            return new Promise((ok, fail) => {
                let active = true;
                const poll = async () => {
                    if (!active || abort.signal.aborted) return;
                    try {
                        const d = (await Api.myList(id, abort.signal)).data[0];
                        if (!d) {
                           if (active) setTimeout(poll, 5000); return;
                        }
                        const statusMap = { 'queued': 'В очереди', 'downloading': 'Загрузка', 'uploading': 'Раздача', 'completed': 'Завершено', 'stalled': 'Остановлено', 'error': 'Ошибка', 'metadl': 'Получение метаданных', 'paused': 'На паузе', 'failed': 'Ошибка загрузки', 'checking': 'Проверка', 'processing': 'Обработка' };
                        const statusText = statusMap[(d.download_state || d.status || 'unknown').toLowerCase().split(' ')[0]] || (d.download_state || d.status);
                        const perc = parseFloat(d.progress) > 1 ? parseFloat(d.progress) : parseFloat(d.progress) * 100;
                        UI.updateStatusModal({ status: statusText, progress: perc, progressText: d.size ? `${perc.toFixed(2)}% из ${Utils.formatBytes(d.size)}` : `${perc.toFixed(2)}%`, speed: `Скорость: ${Utils.formatBytes(d.download_speed, true)}`, eta: `Осталось: ${Utils.formatTime(d.eta)}`, peers: `Сиды: ${d.seeds || 0} / Пиры: ${d.peers || 0}` });
                        // [ИСПРАВЛЕНИЕ] Добавлено состояние 'uploading' в условие завершения.
                        // Торрент, который начал раздачу, считается готовым к воспроизведению.
                        const is_finished = d.download_state === 'completed' || d.download_state === 'uploading' || d.download_finished || perc >= 100;
                        if (is_finished && d.files?.length) {
                           active = false; return ok(d);
                        }
                        if (active) setTimeout(poll, 5000);
                    } catch (e) { if (e.name !== 'AbortError') { active = false; fail(e); } }
                };
                const cancel = () => { if (active) { active = false; fail({ type: 'user', message: 'Отменено пользователем' }); } };
                UI.showStatus('Отслеживание статуса…', cancel);
                abort.signal.addEventListener('abort', cancel);
                poll();
            });
        };

        const selectFile = (torrent_data) => {
            const vids = torrent_data.files.filter(f => /\.(mkv|mp4|avi)$/i.test(f.name)).sort(Utils.naturalSort);
            if (!vids.length) return ErrorHandler.show('validation', { message: 'Видеофайлы не найдены' });
            if (vids.length === 1) return play(torrent_data, vids[0], vids);

            const lastId = Store.get(`torbox_last_played_${object.movie.imdb_id || object.movie.id}`, null);
            const items = vids.map(f => ({ title: (lastId == f.id ? `▶️ ` : '') + f.name, subtitle: Utils.formatBytes(f.size), file: f, cls: lastId == f.id ? 'select__item--last-played' : '' }));
            Lampa.Select.show({ title: 'Выберите файл', items, onSelect: i => play(torrent_data, i.file, vids), onBack: () => { Lampa.Controller.toggle('content'); } });
        };

        const play = async (torrent_data, file, all_video_files = []) => {
            Lampa.Loading.start();
            try {
                // [ИСПРАВЛЕНИЕ] API может вернуть ссылку в свойстве 'url' или 'data'.
                // Проверяем оба варианта, чтобы избежать ошибки 'undefined'.
                const dlResponse = await Api.requestDl(torrent_data.id, file.id, abort.signal);
                const link = dlResponse.url || dlResponse.data;
                if (!link) throw { type: 'api', message: 'Не удалось получить ссылку на файл' };
                const mid = object.movie.imdb_id || object.movie.id;
                state.last_hash = torrent_data.hash;
                Store.set(`torbox_last_torrent_${mid}`, torrent_data.hash);
                Store.set(`torbox_last_played_${mid}`, String(file.id));
                
                Lampa.Player.play({ url: link, title: file.name || object.movie.title, poster: object.movie.img });

                // [ИСПРАВЛЕНИЕ] Улучшена логика для плейлистов.
                // Когда видео завершается, Lampa автоматически возвращается на экран плагина.
                // Наша задача - просто убрать слушатели и, если нужно, показать выбор следующего файла.
                const onComplete = () => {
                    Lampa.Player.listener.remove('complite', onComplete);
                    Lampa.Player.listener.remove('back', onBack);
                    if (all_video_files.length > 1) {
                        setTimeout(() => selectFile(torrent_data), 50);
                    } else {
                        markAsPlayed(torrent_data.hash);
                    }
                };

                // [ИСПРАВЛЕНИЕ] Решена проблема "зависания" при выходе из плеера.
                // Вызов Lampa.Activity.backward() оборачивается в setTimeout, чтобы избежать
                // конфликта, когда команда на уничтожение активности вызывается изнутри
                // обработчика события этой же активности.
                const onBack = () => {
                    Lampa.Player.listener.remove('complite', onComplete);
                    Lampa.Player.listener.remove('back', onBack);
                    setTimeout(Lampa.Activity.backward, 0);
                };

                Lampa.Player.listener.follow('complite', onComplete);
                Lampa.Player.listener.follow('back', onBack);
            } catch (e) {
                ErrorHandler.show(e.type || 'unknown', e);
            } finally {
                Lampa.Loading.stop();
            }
        };

        const markAsPlayed = (hash) => {
            if (!scroll) return;
            scroll.render().find('.torbox-item--just-watched').removeClass('torbox-item--just-watched');
            const item = scroll.render().find(`[data-hash="${hash}"]`);
            if (item.length) item.addClass('torbox-item--just-watched');
        };

        /**
         * [РЕФАКТОРИНГ] Метод create теперь только создает "скелет".
         * Вся логика перенесена в start/initialize.
         */
        this.create = function () {
            this.activity.loader(false); // Прячем лоадер, если он был показан по ошибке
            scroll.body().addClass('torbox-list-container');
            files.appendFiles(scroll.render());
            files.appendHead(filter.render());
            scroll.minus(files.render().find('.explorer__files-head'));
            return this.render();
        };

        /**
         * [НОВЫЙ] Метод render, как того ожидает Lampa.
         */
        this.render = function(){
            return files.render();
        };

        this.empty = function(msg) {
            scroll.clear();
            scroll.append(Lampa.Template.get('torbox_empty', { message: msg || 'Торренты не найдены' }));
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

            if (!items.length) {
                return this.empty('Ничего не найдено по заданным фильтрам');
            }
        
            const lastKey = `torbox_last_torrent_${object.movie.imdb_id || object.movie.id}`;
            const lastHash = Store.get(lastKey, null);

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

            // Восстанавливаем фокус
            let focus_element = false;
            if (state.last_hash) {
                focus_element = scroll.render().find(`[data-hash="${state.last_hash}"]`)[0];
            }
            if (!focus_element) {
                focus_element = scroll.render().find('.selector').first()[0];
            }
            if(focus_element) last = focus_element;
        };

        /**
         * [РЕФАКТОРИНГ] Инициализация теперь только привязывает обработчики.
         */
        this.initialize = function() {
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
                // [ИСПРАВЛЕНИЕ] Сбрасываем сохраненный хэш, чтобы после сортировки/фильтрации
                // фокус всегда устанавливался на первый элемент в новом списке.
                state.last_hash = null;
                this.build();
                Lampa.Controller.toggle('content');
            };
            filter.onBack = () => Lampa.Controller.toggle('content');

            if (filter.addButtonBack) filter.addButtonBack();
            
            this.empty('Загрузка...');

            search(); // Запускаем поиск отсюда
        };

        /**
         * [РЕФАКТОРИНГ] Главный управляющий метод.
         */
        this.start = function () {
            // Запускаем инициализацию только один раз
            if (!initialized) {
                this.initialize();
                initialized = true;
            }
            
            Lampa.Controller.add('content', {
                toggle: () => {
                    Lampa.Controller.collectionSet(filter.render(), scroll.render());
                    Lampa.Controller.collectionFocus(last || false, scroll.render());
                },
                up: () => Navigator.move('up'),
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
        };
        
        this.back = function() {
            if ($('body').find('.select').length) return Lampa.Select.close();
            if ($('body').find('.filter').length) {
                Lampa.Filter.hide();
                return Lampa.Controller.toggle('content');
            }
            abort.abort();
            Lampa.Activity.backward();
        };

        this.pause = function () {};
        this.stop = function () {};
        
        this.destroy = function () {
            abort.abort();
            files.destroy();
            scroll.destroy();
            filter.destroy();
            state = null;
        };
    }


    // ───────────────────── plugin ▸ main integration ───────────────
    const Plugin = (() => {
        function addTemplates() {
            /*
                Читаемая версия шаблона 'torbox_item'. Сжата в одну строку ниже из-за особенностей движка Lampa.
                <div class="torbox-item selector" data-hash="{hash}">
                    <div class="torbox-item__title">{icon} {title}</div>
                    <div class="torbox-item__main-info">{info_formated}</div>
                    <div class="torbox-item__meta">{meta_formated}</div>
                    {tech_bar_html}
                </div>
            */
            Lampa.Template.add('torbox_item', '<div class="torbox-item selector" data-hash="{hash}"><div class="torbox-item__title">{icon} {title}</div><div class="torbox-item__main-info">{info_formated}</div><div class="torbox-item__meta">{meta_formated}</div>{tech_bar_html}</div>');
            Lampa.Template.add('torbox_empty', '<div class="empty"><div class="empty__text">{message}</div></div>');
        }

        const addSettings = () => {
            if (!Lampa.SettingsApi) return;
            Lampa.SettingsApi.addComponent({ component: 'torbox_enh', name: 'TorBox Enhanced', icon: ICON });
            [
                { k: 'torbox_proxy_url', n: 'URL CORS-прокси', d: `Default: ${Config.DEF.proxyUrl}`, t: 'input', v: CFG.proxyUrl },
                { k: 'torbox_api_key', n: 'API-Key', d: 'Если есть собственный ключ', t: 'input', v: CFG.apiKey },
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
        };

        const boot = () => {
            Lampa.Listener.follow('full', e => {
                if (e.type !== 'complite' || !e.data.movie) return;
                const root = e.object.activity.render();
                if (!root?.length || root.find('.view--torbox').length) return;
                const btn = $(`<div class="full-start__button selector view--torbox" data-subtitle="TorBox">${ICON}<span>TorBox</span></div>`);
                btn.on('hover:enter', () => {
                    addTemplates(); // Добавляем шаблоны прямо перед запуском
                    Lampa.Activity.push({ component: 'torbox_component', title: 'TorBox - ' + (e.data.movie.title || e.data.movie.name), movie: e.data.movie })
                });
                const torrentBtn = root.find('.view--torrent');
                torrentBtn.length ? torrentBtn.after(btn) : root.find('.full-start__play').after(btn);
            });
        };
        
        const init = () => {
            const css = document.createElement('style');
            css.id = 'torbox-enhanced-styles';
            const styles = `
                /* --- Контейнер для списка --- */
                .torbox-list-container {
                    display: block;
                    padding: 1em;
                }

                /* --- Элемент списка торрентов --- */
                .torbox-item {
                    padding: 1em 1.2em;
                    margin: 0 0 1em 0;
                    border-radius: .8em;
                    background: var(--color-background-light);
                    cursor: pointer;
                    transition: all .3s;
                    border: 2px solid transparent;
                    overflow: hidden;
                    opacity: 1;
                }
                .torbox-item:last-child {
                    margin-bottom: 0;
                }
                .torbox-item--last-played, .torbox-item--just-watched {
                    border-left: 4px solid var(--color-second);
                    background: rgba(var(--color-second-rgb), .1);
                }
                .torbox-item:hover,
                .torbox-item.focus {
                    background: var(--color-primary);
                    color: var(--color-background);
                    transform: scale(1.01);
                    border-color: rgba(255, 255, 255, .3);
                    box-shadow: 0 4px 20px rgba(0, 0, 0, .2);
                    opacity: 1;
                }
                .torbox-item:hover .torbox-item__tech-bar,
                .torbox-item.focus .torbox-item__tech-bar {
                    background: rgba(0, 0, 0, .2);
                }

                /* --- Внутренние элементы карточки --- */
                .torbox-item__title {
                    font-weight: 600;
                    margin-bottom: .3em;
                    font-size: 1.1em;
                    line-height: 1.3;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .torbox-item__main-info {
                    font-size: .95em;
                    opacity: .9;
                    line-height: 1.4;
                    margin-bottom: .3em;
                }
                .torbox-item__meta {
                    font-size: .9em;
                    opacity: .7;
                    line-height: 1.4;
                    margin-bottom: .8em;
                }

                /* --- Панель с технической информацией --- */
                .torbox-item__tech-bar {
                    display: flex;
                    flex-wrap: wrap;
                    gap: .6em;
                    margin: 0 -1.2em -1em -1.2em;
                    padding: .6em 1.2em;
                    background: rgba(0, 0, 0, .1);
                    font-size: .85em;
                    font-weight: 500;
                    transition: background .3s;
                }
                .torbox-item__tech-item { padding: .2em .5em; border-radius: .4em; }
                .torbox-item__tech-item--res { background: #3b82f6; color: #fff; }
                .torbox-item__tech-item--codec { background: #16a34a; color: #fff; }
                .torbox-item__tech-item--audio { background: #f97316; color: #fff; }
                .torbox-item__tech-item--hdr { background: linear-gradient(45deg, #ff8c00, #ffa500); color: #fff; }
                .torbox-item__tech-item--dv { background: linear-gradient(45deg, #4b0082, #8a2be2); color: #fff; }

                /* --- Дополнительные стили --- */
                .select__item--last-played > .select__item-title {
                    color: var(--color-second) !important;
                    font-weight: 600;
                }
                
                /* --- Модальное окно статуса --- */
                .torbox-status { padding: 1.5em 2em; text-align: center; min-height: 200px; }
                .torbox-status__title { font-size: 1.4em; margin-bottom: 1em; font-weight: 600; }
                .torbox-status__info { font-size: 1.1em; margin-bottom: .8em; }
                .torbox-status__progress-container { margin: 1.5em 0; background: rgba(255, 255, 255, .2) !important; border-radius: 8px; overflow: hidden; height: 12px; position: relative; }
                .torbox-status__progress-bar { 
                    height: 100%; 
                    width: 0; 
                    background: linear-gradient(90deg, #4CAF50, #66BB6A) !important; 
                    transition: width .5s; 
                    border-radius: 8px; 
                    position: relative;
                }
                .torbox-status__progress-bar::after {
                    content: '';
                    position: absolute;
                    top: 0; left: 0; right: 0; bottom: 0;
                    background: linear-gradient(45deg, transparent 30%, rgba(255,255,255,0.2) 50%, transparent 70%);
                    animation: torbox_shimmer 2s infinite;
                }
                @keyframes torbox_shimmer {
                    0% { transform: translateX(-100%); }
                    100% { transform: translateX(100%); }
                }
            `;
            css.textContent = styles;
            document.head.appendChild(css);

            Lampa.Component.add('torbox_component', TorBoxComponent);
            addSettings();
            boot();
            LOG('TorBox v34.0.0 ready');
        };
        return { init };
    })();

    // ───────────────────── bootloader ─────────────────────────────
    (function wait() {
        if (window.Lampa?.Activity) {
            try {
                Plugin.init();
            } catch (e) {
                console.error('[TorBox] boot error', e);
            }
        }
        else {
            setTimeout(wait, 300);
        }
    })();
})();
