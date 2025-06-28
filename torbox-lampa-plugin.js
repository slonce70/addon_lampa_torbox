/* TorBox Enhanced – Universal Lampa Plugin  v30.5.0 (List View Restoration)
 * =======================================================================
 * ▸ Восстановлено классическое отображение торрентов в виде списка (один элемент на строку).
 * ▸ Изменены CSS-стили для контейнера с `display: grid` на `display: block`.
 * ▸ Скорректированы отступы и анимация для нового вида.
 * ======================================================================= */
(function () {
    'use strict';

    // ───────────────────────────── guard ──────────────────────────────
    const PLUGIN_ID = 'torbox_enhanced_v30_5_0_fixed';
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

        const _process = (txt, status) => {
            if (status === 401) throw { type: 'auth', message: '401 – проверьте API-ключ' };
            if (status >= 400) throw { type: 'network', message: `HTTP ${status}` };
            if (!txt) throw { type: 'api', message: 'Пустой ответ' };
            try {
                if (typeof txt === 'string' && txt.startsWith('http')) return { success: true, url: txt };
                const j = typeof txt === 'object' ? txt : JSON.parse(txt);
                if (j?.success === false) throw { type: 'api', message: j.detail || j.message || 'API error' };
                return j;
            } catch {
                throw { type: 'api', message: 'Некорректный JSON' };
            }
        };

        const request = async (url, opt = {}, signal) => {
            if (!CFG.proxyUrl) throw { type: 'validation', message: 'CORS-proxy не задан в настройках' };
            const proxy = `${CFG.proxyUrl}?url=${encodeURIComponent(url)}`;
            opt.headers = opt.headers || {};
            if (opt.is_torbox_api !== false) opt.headers['X-Api-Key'] = CFG.apiKey;
            delete opt.headers['Authorization'];
            try {
                const res = await fetch(proxy, { ...opt, signal });
                return _process(await res.text(), res.status);
            } catch (e) {
                if (e.name === 'AbortError' || e.type) throw e;
                throw { type: 'network', message: e.message };
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

        const stopTorrent = (id, signal) => request(`${MAIN}/torrents/controltorrent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ torrent_id: id, operation: 'pause' })
        }, signal);

        const myList = (id, s) => request(`${MAIN}/torrents/mylist?id=${id}&bypass_cache=true`, { method: 'GET' }, s);
        const requestDl = (tid, fid, s) => request(`${MAIN}/torrents/requestdl?torrent_id=${tid}&file_id=${fid}&token=${CFG.apiKey}`, { method: 'GET' }, s);

        return { searchPublicTrackers, checkCached, addMagnet, stopTorrent, myList, requestDl };
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
    function TorBoxComponent(obj) {
        Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach(k => {
            if (k !== 'constructor' && typeof this[k] === 'function') this[k] = this[k].bind(this);
        });
        this.activity = obj.activity;
        this.movie = obj.movie;
        this.params = obj;
        this.abortController = new AbortController();
        this.sort_types = [
            { key: 'seeders', title: 'По сидам (убыв.)', field: 'last_known_seeders', reverse: true },
            { key: 'size_desc', title: 'По размеру (убыв.)', field: 'size', reverse: true },
            { key: 'size_asc', title: 'По размеру (возр.)', field: 'size', reverse: false },
            { key: 'age', title: 'По дате добавления', field: 'publish_date', reverse: true }
        ];
        this.defaultFilters = { quality: 'all', tracker: 'all', video_type: 'all', translation: 'all', lang: 'all', video_codec: 'all', audio_codec: 'all' };
        this.state = {
            scroll: null,
            files: null,
            filter: null,
            last: null,
            initialized: false,
            all_torrents: [],
            sort: Store.get('torbox_sort_method', 'seeders'),
            filters: JSON.parse(Store.get('torbox_filters_v2', JSON.stringify(this.defaultFilters)))
        };
    }

    // — жизненный цикл —
    TorBoxComponent.prototype.create = function () { this.initialize(); return this.render(); };
    TorBoxComponent.prototype.render = function () { return this.state.files.render(); };
    TorBoxComponent.prototype.start = function () {
        this.activity.loader(false);
        Lampa.Controller.add('head', {
            toggle: () => {
                Lampa.Controller.collectionSet(this.state.filter.render());
                Lampa.Controller.collectionFocus(false, this.state.filter.render());
            },
            right: () => window.Navigator.move('right'),
            left: () => window.Navigator.move('left'),
            down: () => Lampa.Controller.toggle('content'),
            back: () => Lampa.Controller.toggle('content')
        });
        Lampa.Controller.add('content', {
            toggle: () => {
                Lampa.Controller.collectionSet(this.state.scroll.render());
                Lampa.Controller.collectionFocus(this.state.last || false, this.state.scroll.render());
            },
            up: () => (this.state.scroll.is_first() ? Lampa.Controller.toggle('head') : window.Navigator.move('up')),
            down: () => window.Navigator.move('down'),
            left: () => Lampa.Controller.toggle('menu'),
            back: () => {
                if ($('body').find('.select').length) return Lampa.Select.close();
                if ($('body').find('.filter').length) { Lampa.Filter.hide(); return Lampa.Controller.toggle('content'); }
                Lampa.Activity.backward();
            }
        });
        Lampa.Controller.toggle('content');
    };
    TorBoxComponent.prototype.pause = function () { Lampa.Controller.add('content', null); Lampa.Controller.add('head', null); };
    TorBoxComponent.prototype.stop = function () { Lampa.Controller.add('content', null); Lampa.Controller.add('head', null); };
    TorBoxComponent.prototype.destroy = function () {
        this.abortController.abort();
        Lampa.Controller.add('content', null);
        Lampa.Controller.add('head', null);
        this.state.scroll?.destroy();
        this.state.files?.destroy();
        this.state.filter?.destroy();
        Object.keys(this.state).forEach(k => this.state[k] = null);
    };

    // ────────── initialization ──────────
    TorBoxComponent.prototype.initialize = function () {
        if (this.state.initialized) return;
        this.state.scroll = new Lampa.Scroll({ mask: true, over: true });
        this.state.files = new Lampa.Explorer(this.params);
        this.state.filter = new Lampa.Filter(this.params);

        this._initFilterHandlers();
        if (this.state.filter.addButtonBack) this.state.filter.addButtonBack();
        
        this.state.scroll.body().addClass('torbox-list-container');
        this.state.files.appendFiles(this.state.scroll.render());
        this.state.files.appendHead(this.state.filter.render());
        this.state.scroll.minus(this.state.files.render().find('.explorer__files-head'));

        this._loadAndDisplay();
        this.state.initialized = true;
    };


    // ──── filter handlers ────
    TorBoxComponent.prototype._initFilterHandlers = function () {
        this.state.filter.onSelect = (type, a, b) => {
            Lampa.Select.close();
            if (type === 'sort') {
                this.state.sort = a.key;
                Store.set('torbox_sort_method', a.key);
            } else if (type === 'filter') {
                if (a.refresh) return this._loadAndDisplay(true);
                if (a.reset) this.state.filters = JSON.parse(JSON.stringify(this.defaultFilters));
                else if (a.stype) this.state.filters[a.stype] = b.value;
                Store.set('torbox_filters_v2', JSON.stringify(this.state.filters));
            }
            this._display();
            Lampa.Controller.toggle('content');
        };
        this.state.filter.onBack = () => Lampa.Controller.toggle('content');
    };

    // ──── filter UI update ────
    TorBoxComponent.prototype._updateFilterUI = function () {
        const { filter, sort, filters, all_torrents } = this.state;
        const sort_items = this.sort_types.map(i => ({ ...i, selected: i.key === sort }));
        filter.set('sort', sort_items);
        filter.render().find('.filter--sort span').text('Сортировка');
        filter.chosen('sort', [(this.sort_types.find(s => s.key === sort) || { title: '' }).title]);

        const build = (key, title, arr) => {
            const uni = [...new Set(arr.flat().filter(Boolean))].sort();
            const items = ['all', ...uni].map(v => ({
                title: v === 'all' ? 'Все' : v.toUpperCase(),
                value: v,
                selected: filters[key] === v
            }));
            const sub = filters[key] === 'all' ? 'Все' : filters[key].toUpperCase();
            return { title, subtitle: sub, items, stype: key };
        };

        const f_items = [
            build('quality', 'Качество', all_torrents.map(t => t.quality)),
            build('video_type', 'Тип видео', all_torrents.map(t => t.video_type)),
            build('translation', 'Перевод', all_torrents.map(t => t.voices)),
            build('lang', 'Язык аудио', all_torrents.map(t => t.audio_langs)),
            build('video_codec', 'Видео кодек', all_torrents.map(t => t.video_codec)),
            build('audio_codec', 'Аудио кодек', all_torrents.map(t => t.audio_codecs)),
            build('tracker', 'Трекер', all_torrents.map(t => t.trackers)),
            { title: 'Сбросить фильтры', reset: true },
            { title: 'Обновить список', refresh: true }
        ];
        filter.set('filter', f_items);
        filter.render().find('.filter--filter span').text('Фильтр');
        const subTitles = f_items.filter(f => f.stype && filters[f.stype] !== 'all').map(f => `${f.title}: ${filters[f.stype]}`);
        filter.chosen('filter', subTitles);
    };

    // ──── filters + sort apply ────
    TorBoxComponent.prototype._applyFiltersSort = function () {
        const { all_torrents, filters, sort } = this.state;
        let list = all_torrents.filter(t => {
            if (filters.quality !== 'all' && t.quality !== filters.quality) return false;
            if (filters.video_type !== 'all' && t.video_type !== filters.video_type) return false;
            if (filters.translation !== 'all' && !(t.voices || []).includes(filters.translation)) return false;
            if (filters.lang !== 'all' && !(t.audio_langs || []).includes(filters.lang)) return false;
            if (filters.video_codec !== 'all' && t.video_codec !== filters.video_codec) return false;
            if (filters.audio_codec !== 'all' && !(t.audio_codecs || []).includes(filters.audio_codec)) return false;
            if (filters.tracker !== 'all' && !(t.trackers || []).includes(filters.tracker)) return false;
            return true;
        });
        const s = this.sort_types.find(s => s.key === sort);
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

    // ──── rendering helpers ────
    TorBoxComponent.prototype._renderEmpty = function (msg) {
        const scroll_body = this.state.scroll.body();
        scroll_body.empty();
        const empty_msg_element = $('<div class="empty"><div class="empty__text"></div></div>');
        empty_msg_element.find('.empty__text').text(msg || 'Торренты не найдены');
        scroll_body.append(empty_msg_element);
        this.activity.loader(false);
    };

    TorBoxComponent.prototype._createItem = function (t, lastHash) {
        const it = document.createElement('div');
        it.className = 'torbox-item selector';
        if (lastHash && t.hash === lastHash) it.classList.add('torbox-item--last-played');

        const title = document.createElement('div');
        title.className = 'torbox-item__title';
        title.textContent = `${t.cached ? '⚡ ' : '☁️ '}${t.raw_title || t.title}`;

        const info = document.createElement('div');
        info.className = 'torbox-item__main-info';
        info.innerHTML = `[${t.quality}] ${Utils.formatBytes(t.size)} | 🟢 <span style="color:var(--color-good);">${t.last_known_seeders || 0}</span> / 🔴 <span style="color:var(--color-bad);">${t.last_known_peers || 0}</span>`;

        const meta = document.createElement('div');
        meta.className = 'torbox-item__meta';
        meta.textContent = `Трекеры: ${t.trackers?.join(', ') || 'н/д'} | Добавлено: ${t.age || 'н/д'}`;

        it.append(title, info, meta);
        if (t.video_resolution) it.appendChild(this._createTechBar(t));
        return it;
    };
    
    TorBoxComponent.prototype._createTechBar = function (t) {
        const bar = document.createElement('div');
        bar.className = 'torbox-item__tech-bar';
        const tag = (txt, cls) => {
            const d = document.createElement('div');
            d.className = `torbox-item__tech-item torbox-item__tech-item--${cls}`;
            d.textContent = txt;
            return d;
        };
    
        bar.appendChild(tag(t.video_resolution, 'res'));
        if (t.video_codec) bar.appendChild(tag(t.video_codec.toUpperCase(), 'codec'));
        if (t.has_hdr) bar.appendChild(tag('HDR', 'hdr'));
        if (t.has_dv) bar.appendChild(tag('Dolby Vision', 'dv'));
    
        const audioStreams = t.raw_data.ffprobe?.filter(s => s.codec_type === 'audio') || [];
        let voiceIndex = 0;
    
        audioStreams.forEach(s => {
            let lang_or_voice = s.tags?.language?.toUpperCase() || s.tags?.LANGUAGE?.toUpperCase();
    
            if (!lang_or_voice || lang_or_voice === 'UND') {
                if (t.voices && t.voices[voiceIndex]) {
                    lang_or_voice = t.voices[voiceIndex];
                    voiceIndex++;
                } else {
                    lang_or_voice = null; 
                }
            }
    
            const codec = s.codec_name?.toUpperCase() || '';
            const layout = s.channel_layout || '';
    
            const displayText = [lang_or_voice, codec, layout].filter(Boolean).join(' ').trim();
    
            if (displayText) {
                bar.appendChild(tag(displayText, 'audio'));
            }
        });
    
        return bar;
    };


    // ──── draw list ────
    TorBoxComponent.prototype._draw = function (list) {
        this.state.last = null;
        const scroll_body = this.state.scroll.body();
        scroll_body.empty();
    
        if (!list.length) {
            return this._renderEmpty('Ничего не найдено по заданным фильтрам');
        }
        
        const lastKey = `torbox_last_torrent_${this.movie.imdb_id || this.movie.id}`;
        const lastHash = Store.get(lastKey, null);
        
        const frag = document.createDocumentFragment();
        list.forEach(t => {
            const item_element = this._createItem(t, lastHash);
            $(item_element).on('hover:focus', () => { this.state.last = item_element; this.state.scroll.update($(item_element), true); });
            $(item_element).on('hover:enter', () => this._onTorrentClick(t));
            frag.appendChild(item_element);
        });
        
        scroll_body.append(frag);
    
        const first_item = scroll_body.find('.selector').first()[0];
        if (first_item) {
            this.state.last = first_item;
        }
    };


    // ──── load & display ────
    TorBoxComponent.prototype._loadAndDisplay = async function (force = false) {
        this.activity.loader(true);
        this._renderEmpty('Загрузка...');
        try {
            const key = `torbox_hybrid_${this.movie.id || this.movie.imdb_id}`;
            if (!force && Cache.get(key)) {
                this.state.all_torrents = Cache.get(key);
            } else {
                this._renderEmpty('Получение списка…');
                const raw = await Api.searchPublicTrackers(this.movie, this.abortController.signal);
                if (!raw.length) return this._renderEmpty('Парсер не вернул результатов.');
                const withHash = raw.map(r => {
                    const m = r.MagnetUri.match(/urn:btih:([a-fA-F0-9]{40})/i);
                    return m ? { raw: r, hash: m[1] } : null;
                }).filter(Boolean);
                if (!withHash.length) return this._renderEmpty('Не найдено валидных торрентов.');
                this._renderEmpty(`Проверка кэша (${withHash.length})…`);
                const cached = await Api.checkCached(withHash.map(x => x.hash), this.abortController.signal);
                const cachedSet = new Set(Object.keys(cached).map(h => h.toLowerCase()));
                this.state.all_torrents = withHash.map(({ raw, hash }) => this._procRaw(raw, hash, cachedSet));
                Cache.set(key, this.state.all_torrents);
            }
            this._display();
        } catch (e) {
            this._renderEmpty(e.message || 'Ошибка');
            ErrorHandler.show(e.type || 'unknown', e);
        } finally {
            this.activity.loader(false);
        }
    };

    TorBoxComponent.prototype._procRaw = function (raw, hash, cachedSet) {
        const v = raw.ffprobe?.find(s => s.codec_type === 'video');
        const a = raw.ffprobe?.filter(s => s.codec_type === 'audio') || [];
        return {
            raw_title: raw.Title,
            size: raw.Size,
            magnet: raw.MagnetUri,
            hash,
            last_known_seeders: raw.Seeders,
            last_known_peers: raw.Peers || raw.Leechers,
            trackers: (raw.Tracker || '').split(/, ?/).filter(Boolean),
            cached: cachedSet.has(hash.toLowerCase()),
            publish_date: raw.PublishDate,
            age: Utils.formatAge(raw.PublishDate),
            quality: Utils.getQualityLabel(raw.Title, raw),
            video_type: raw.info?.videotype?.toLowerCase(),
            voices: raw.info?.voices,
            video_codec: v?.codec_name,
            video_resolution: v ? `${v.width}x${v.height}` : null,
            audio_langs: [...new Set(a.map(s => s.tags?.language).filter(Boolean))],
            audio_codecs: [...new Set(a.map(s => s.codec_name).filter(Boolean))],
            has_hdr: /hdr/i.test(raw.Title) || raw.info?.videotype?.toLowerCase() === 'hdr',
            has_dv: /dv|dolby vision/i.test(raw.Title) || raw.info?.videotype?.toLowerCase() === 'dovi',
            raw_data: raw
        };
    };

    // ──── display wrapper ────
    TorBoxComponent.prototype._display = function () {
        this._updateFilterUI();
        this._draw(this._applyFiltersSort());
    };

    // ──── torrent click handler ────
    TorBoxComponent.prototype._onTorrentClick = async function (t) {
        try {
            if (!t.magnet) throw { type: 'validation', message: 'Magnet-ссылка не найдена' };
            UI.showStatus('Добавление торрента…');
            const res = await Api.addMagnet(t.magnet, this.abortController.signal);
            const tid = res.data.torrent_id || res.data.id;
            if (!tid) throw { type: 'api', message: 'ID торрента не получен' };
            const data = await this._track(tid);
            data.hash = t.hash;
            Lampa.Modal.close();
            this._selectFile(data);
        } catch (e) {
            if (e.type !== 'user' && e.name !== 'AbortError') ErrorHandler.show(e.type || 'unknown', e);
            Lampa.Modal.close();
        }
    };

    // ──── track download ────
    TorBoxComponent.prototype._track = function (id) {
        return new Promise((ok, fail) => {
            let active = true;
            const poll = async () => {
                if (!active) return;
                try {
                    const torrentResult = await Api.myList(id, this.abortController.signal);
                    
                    const torrentList = Array.isArray(torrentResult.data) ? torrentResult.data : [torrentResult.data];
                    const d = torrentList[0];

                    if (!d || typeof d !== 'object') {
                        LOG(`Торрент ${id} еще не появился в списке или имеет неверный формат, повторная попытка...`);
                        if (active) setTimeout(poll, 5000);
                        return;
                    }
                    
                    const statusMap = {
                        'queued': 'В очереди',
                        'downloading': 'Загрузка',
                        'uploading': 'Раздача',
                        'completed': 'Завершено',
                        'stalled': 'Остановлено',
                        'error': 'Ошибка',
                        'metadl': 'Получение метаданных',
                        'paused': 'На паузе',
                        'failed': 'Ошибка загрузки',
                        'checking': 'Проверка',
                        'processing': 'Обработка'
                    };
                    const apiStatus = (d.download_state || d.status || 'unknown').toLowerCase().split(' ')[0];
                    const statusText = statusMap[apiStatus] || (d.download_state || d.status);
    
                    const prog = parseFloat(d.progress);
                    const perc = isNaN(prog) ? 0 : (prog > 1 ? prog : prog * 100);
                    
                    UI.updateStatusModal({
                        status: statusText,
                        progress: perc,
                        progressText: d.size ? `${perc.toFixed(2)}% из ${Utils.formatBytes(d.size)}` : `${perc.toFixed(2)}%`,
                        speed: `Скорость: ${Utils.formatBytes(d.download_speed, true)}`,
                        eta: `Осталось: ${Utils.formatTime(d.eta)}`,
                        peers: `Сиды: ${d.seeds || 0} / Пиры: ${d.peers || 0}`
                    });

                    const isDownloadFinished = apiStatus === 'completed' || d.download_finished || perc >= 100;
                    const filesAreReady = d.files && d.files.length > 0;

                    if (isDownloadFinished && filesAreReady) {
                        active = false;
                        return ok(d);
                    }
                    if (active) setTimeout(poll, 5000);
                } catch (e) { 
                    if (e.name !== 'AbortError') {
                        LOG('Polling error:', e);
                        active = false; 
                        fail(e);
                    }
                }
            };
            const cancel = () => { if (active) { active = false; fail({ type: 'user', message: 'Отменено пользователем' }); } };
            UI.showStatus('Отслеживание статуса…', cancel);
            this.abortController.signal.addEventListener('abort', cancel);
            poll();
        });
    };

    // ──── select/play file ────
    /**
     * [ИЗМЕНЕНО] Эта функция теперь вызывает _play, передавая весь объект данных торрента.
     * @param {object} torrent_data - Полные данные о торренте, включая список файлов.
     */
    TorBoxComponent.prototype._selectFile = function (torrent_data) {
        const vids = torrent_data.files.filter(f => /\.(mkv|mp4|avi)$/i.test(f.name));
        if (!vids.length) { ErrorHandler.show('validation', { message: 'Видеофайлы не найдены в торренте' }); return; }
        
        vids.sort(Utils.naturalSort);
        
        const play = selected_file => this._play(torrent_data, selected_file);

        if (vids.length === 1) {
            return play(vids[0]);
        }
        
        const lastId = Store.get(`torbox_last_played_${this.movie.imdb_id || this.movie.id}`, null);
        const items = vids.map(f => {
            const last = lastId && String(f.id) === String(lastId);
            return { 
                title: last ? `▶️ ${f.name}` : f.name, 
                subtitle: Utils.formatBytes(f.size), 
                file: f, 
                cls: last ? 'select__item--last-played' : undefined 
            };
        });
        
        Lampa.Select.show({ 
            title: 'Выберите файл для воспроизведения', 
            items, 
            onSelect: i => play(i.file), 
            onBack: () => Lampa.Controller.toggle('content') 
        });
    };

    /**
     * [ИЗМЕНЕНО] Основная логика для возврата к списку серий после просмотра.
     * @param {object} torrent_data - Полные данные о торренте.
     * @param {object} file - Выбранный файл для воспроизведения.
     */
    TorBoxComponent.prototype._play = async function (torrent_data, file) {
        UI.showStatus('Получение ссылки…');
        try {
            const { data, url } = await Api.requestDl(torrent_data.id, file.id, this.abortController.signal);
            const link = data || url;
            const mid = this.movie.imdb_id || this.movie.id;
            
            Store.set(`torbox_last_torrent_${mid}`, torrent_data.hash);
            Store.set(`torbox_last_played_${mid}`, String(file.id));
            
            Lampa.Modal.close();

            const onComplete = () => {
                // Отписываемся от события, чтобы избежать утечек памяти и многократных вызовов
                Lampa.Player.listener.remove('complite', onComplete);

                // Проверяем, является ли это сериалом (более одного видеофайла)
                const video_files_count = torrent_data.files.filter(f => /\.(mkv|mp4|avi)$/i.test(f.name)).length;
                
                if (video_files_count > 1) {
                    // Если это сериал, возвращаемся к выбору файла этого же торрента
                    this._selectFile(torrent_data);
                } else {
                    // Если это фильм (один файл), обновляем список торрентов
                    this._display();
                }
            };

            Lampa.Player.play({ url: link, title: file.name || this.movie.title, poster: this.movie.img });
            Lampa.Player.listener.follow('complite', onComplete);

        } catch (e) { 
            ErrorHandler.show(e.type || 'unknown', e); 
            Lampa.Modal.close(); 
        }
    };


    // ───────────────────── plugin ▸ main integration ───────────────
    const Plugin = (() => {
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
                btn.on('hover:enter', () => Lampa.Activity.push({ component: 'torbox_component', title: 'TorBox - ' + (e.data.movie.title || e.data.movie.name), movie: e.data.movie }));
                const torrentBtn = root.find('.view--torrent');
                torrentBtn.length ? torrentBtn.after(btn) : root.find('.full-start__play').after(btn);
            });
        };

        const setupGlobalActivityListener = () => {
            let lastActivityName = null;
            let wasInTorbox = false;
        
            setInterval(() => {
                const currentActivity = Lampa.Activity.active();
                if (!currentActivity) return;
        
                const currentActivityName = currentActivity.component;
        
                if (lastActivityName === 'torbox_component' && currentActivityName !== 'torbox_component') {
                    wasInTorbox = true;
                    LOG('Left TorBox component, possibly for an external player.');
                }
        
                if (wasInTorbox && currentActivityName === 'torbox_component') {
                    LOG('Returned to TorBox component.');
                    wasInTorbox = false;
                    
                    setTimeout(() => {
                        try {
                            const torboxActivity = Lampa.Activity.active();
                            if (torboxActivity && torboxActivity.component === 'torbox_component') {
                                Lampa.Controller.toggle('content');
                                torboxActivity.activity.component.display(); 
                                LOG('Navigation and display restored after returning to TorBox.');
                            }
                        } catch (error) {
                            LOG('Error while restoring navigation after return:', error);
                        }
                    }, 250); 
                }
                lastActivityName = currentActivityName;
            }, 1000);
        };
        

        const init = () => {
            const css = document.createElement('style');
            css.id = 'torbox-enhanced-styles';
            const styles = `
                /* --- [ИЗМЕНЕНО] Контейнер для списка --- */
                .torbox-list-container {
                    display: block; /* Отображение в виде списка, а не сетки */
                    padding: 1em;
                }

                /* --- Элемент списка торрентов --- */
                .torbox-item {
                    padding: 1em 1.2em;
                    margin: 0 0 1em 0; /* Отступ снизу для разделения */
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
                .torbox-item--last-played {
                    border-left: 4px solid var(--color-second);
                    background: rgba(var(--color-second-rgb), .1);
                }
                .torbox-item:hover,
                .torbox-item.focus {
                    background: var(--color-primary);
                    color: var(--color-background);
                    transform: scale(1.01); /* Изменена анимация для вида списка */
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
            setupGlobalActivityListener();
            LOG('TorBox v30.5.0 ready');
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
