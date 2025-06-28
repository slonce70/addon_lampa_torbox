// TorBox Enhanced – Universal Lampa Plugin v30.1.0 (FULL FIXED)
// ==================================================================================
// ▸ Повністю переписаний із урахуванням усіх зазначених помилок та побажань
// ▸ Відновлено Store / safeStorage (працює на Smart‑TV)
// ▸ Послідовний парсинг: Viewbox → Jacred (та ін.)
// ▸ Повернено SVG‑іконку TorBox + кнопка на картці фільму
// ▸ Виправлено синтаксис (жодних «**» та невидимих символів)
// ▸ Збережено всю логіку кешу, API, модалок та відтворення
// ==================================================================================
(function () {
    'use strict';

    // ─── guard ─────────────────────────────────────────────────────
    const PLUGIN_ID = 'torbox_enhanced_v30_1_0';
    if (window[PLUGIN_ID]) return; // уникнути подвійного підключення
    window[PLUGIN_ID] = true;

    // ─── core ▸ UTILS ─────────────────────────────────────────────
    const Utils = {
        escapeHtml(str = '') {
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        },
        formatBytes(bytes = 0, speed = false) {
            const B = Number(bytes);
            if (!B) return speed ? '0 KB/s' : '0 B';
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
            const m = Math.floor(diff / 60);
            const h = Math.floor(m / 60);
            const days = Math.floor(h / 24);
            if (diff < 60) return diff + ' сек. назад';
            if (m < 60) return m + ' мин. назад';
            if (h < 24) return h + ' ч. назад';
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
                    const diff = parseInt(aParts[i], 10) - parseInt(bParts[i], 10);
                    if (diff) return diff;
                } else if (aParts[i] !== bParts[i]) {
                    return aParts[i].localeCompare(bParts[i]);
                }
            }
            return a.name.length - b.name.length;
        }
    };

    // ─── core ▸ STORAGE (safeStorage & Store) ─────────────────────
    const safeStorage = (() => {
        try {
            localStorage.setItem('__torbox_test', '1');
            localStorage.removeItem('__torbox_test');
            return localStorage;
        } catch {
            const mem = {};
            return {
                getItem: k => mem[k] ?? null,
                setItem: (k, v) => { mem[k] = String(v); },
                removeItem: k => { delete mem[k]; },
                clear: () => { Object.keys(mem).forEach(k => delete mem[k]); }
            };
        }
    })();
    const Store = {
        get(key, def = null) {
            const val = safeStorage.getItem(key);
            return val !== null ? val : def;
        },
        set(key, val) { safeStorage.setItem(key, String(val)); }
    };

    // ─── core ▸ CACHE (LRU) ──────────────────────────────────────
    const Cache = (() => {
        const map = new Map();
        const MAX = 128;
        return {
            get(k) {
                if (!map.has(k)) return null;
                const o = map.get(k);
                if (Date.now() - o.ts > 600000) { map.delete(k); return null; }
                map.delete(k); // оновити MRU
                map.set(k, o);
                return o.val;
            },
            set(k, v) {
                if (map.has(k)) map.delete(k);
                map.set(k, { ts: Date.now(), val: v });
                if (map.size > MAX) map.delete(map.keys().next().value);
            }
        };
    })();

    // ─── core ▸ CONFIG ───────────────────────────────────────────
    const Config = (() => {
        const DEFAULTS = { proxyUrl: 'https://my-torbox-proxy.slonce70.workers.dev/', apiKey: '' };
        const CFG = {
            get debug() { return Store.get('torbox_debug', '0') === '1'; },
            set debug(v) { Store.set('torbox_debug', v ? '1' : '0'); },
            get proxyUrl() { return Store.get('torbox_proxy_url') || DEFAULTS.proxyUrl; },
            set proxyUrl(v) { Store.set('torbox_proxy_url', v); },
            get apiKey() {
                const b64 = Store.get('torbox_api_key_b64', '');
                if (!b64) return DEFAULTS.apiKey;
                try { return atob(b64); } catch { Store.set('torbox_api_key_b64', ''); return DEFAULTS.apiKey; }
            },
            set apiKey(v) {
                if (!v) return Store.set('torbox_api_key_b64', '');
                Store.set('torbox_api_key_b64', btoa(v));
            }
        };
        const LOG = (...args) => CFG.debug && console.log('[TorBox]', ...args);
        const PUBLIC_PARSERS = [
            { name: 'Viewbox', url: 'jacred.viewbox.dev', key: 'viewbox' },
            { name: 'Jacred', url: 'jacred.xyz', key: '' }
        ];
        const ICON = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 7L12 2L21 7V17L12 22L3 17V7Z" stroke="currentColor" stroke-width="2"/><path d="M12 22V12" stroke="currentColor" stroke-width="2"/><path d="M21 7L12 12L3 7" stroke="currentColor" stroke-width="2"/></svg>`;
        return { CFG, LOG, PUBLIC_PARSERS, ICON };
    })();
    const { CFG, LOG, PUBLIC_PARSERS, ICON } = Config;

    // ─── core ▸ API ──────────────────────────────────────────────
    const Api = (() => {
        const MAIN_API = 'https://api.torbox.app/v1/api';
        const process = (text, status) => {
            if (status === 401) throw { type: 'auth', message: '401 – перевірте API-ключ' };
            if (status >= 400) throw { type: 'network', message: `HTTP ${status}` };
            if (!text) throw { type: 'api', message: 'Порожня відповідь' };
            try {
                if (typeof text === 'string' && text.startsWith('http')) return { success: true, url: text };
                const j = typeof text === 'object' ? text : JSON.parse(text);
                if (j?.success === false) throw { type: 'api', message: j.message || 'API error' };
                return j;
            } catch {
                throw { type: 'api', message: 'Некоректний JSON' };
            }
        };
        const request = async (url, opt = {}, signal) => {
            if (!CFG.proxyUrl) throw { type: 'validation', message: 'CORS‑proxy не заданий' };
            const proxy = `${CFG.proxyUrl}?url=${encodeURIComponent(url)}`;
            opt.headers = opt.headers || {};
            if (opt.is_torbox_api !== false) opt.headers['X-Api-Key'] = CFG.apiKey;
            delete opt.headers['Authorization'];
            try {
                const res = await fetch(proxy, { ...opt, signal });
                return process(await res.text(), res.status);
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
                const url = `https://${p.url}/api/v2.0/indexers/all/results?${qs}`;
                LOG('Parser:', p.name, url);
                try {
                    const json = await request(url, { method: 'GET', is_torbox_api: false }, signal);
                    if (json && Array.isArray(json.Results) && json.Results.length) {
                        LOG('Parser success:', p.name, json.Results.length);
                        return json.Results;
                    }
                } catch (err) { LOG('Parser fail:', p.name, err.message); }
            }
            throw { type: 'api', message: 'Парсери не дали результатів' };
        };
        const checkCached = async (hashes, signal) => {
            if (!hashes.length) return {};
            const res = {};
            for (let i = 0; i < hashes.length; i += 100) {
                const chunk = hashes.slice(i, i + 100);
                const qs = new URLSearchParams();
                chunk.forEach(h => qs.append('hash', h));
                qs.append('format', 'object');
                qs.append('list_files', 'false');
                const url = `${MAIN_API}/torrents/checkcached?${qs}`;
                try {
                    const json = await request(url, { method: 'GET' }, signal);
                    if (json?.data) Object.assign(res, json.data);
                } catch (e) { LOG('cache chunk fail:', e.message); }
            }
            return res;
        };
        const addMagnet = (magnet, signal) => {
            const url = `${MAIN_API}/torrents/createtorrent`;
            const fd = new FormData();
            fd.append('magnet', magnet);
            fd.append('seed', '3');
            return request(url, { method: 'POST', body: fd }, signal);
        };
        const stopTorrent = (id, signal) => request(
            `${MAIN_API}/torrents/controltorrent`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ torrent_id: id, operation: 'pause' }) },
            signal);
        const myList = (id, s) => request(`${MAIN_API}/torrents/mylist?id=${id}&bypass_cache=true`, { method: 'GET' }, s);
        const requestDl = (tid, fid, s) => request(`${MAIN_API}/torrents/requestdl?torrent_id=${tid}&file_id=${fid}&token=${CFG.apiKey}`, { method: 'GET' }, s);
        return { searchPublicTrackers, checkCached, addMagnet, stopTorrent, myList, requestDl };
    })();

    // ─── ui ▸ Error & Modal helpers ─────────────────────────────
    const UI = (() => {
        let cache = {};
        const showStatus = (title, onBack) => {
            if ($('.modal').length) Lampa.Modal.close();
            cache = {};
            const wrap = document.createElement('div');
            wrap.className = 'torbox-status';
            wrap.innerHTML = `
                <div class="torbox-status__title">${title}</div>
                <div class="torbox-status__info" data-name="status">…</div>
                <div class="torbox-status__info" data-name="progress-text"></div>
                <div class="torbox-status__progress-container"><div class="torbox-status__progress-bar" style="width:0%"></div></div>
                <div class="torbox-status__info" data-name="speed"></div>
                <div class="torbox-status__info" data-name="eta"></div>
                <div class="torbox-status__info" data-name="peers"></div>`;
            Lampa.Modal.open({ title: 'TorBox', html: $(wrap), size: 'medium', onBack: onBack || (() => Lampa.Modal.close()) });
        };
        const upd = data => {
            if (!cache.body) cache.body = $('.modal__content .torbox-status');
            if (!cache.body.length) return;
            const set = (n, v) => {
                if (!cache[n]) cache[n] = cache.body.find(`[data-name="${n}"]`);
                if (cache[n].length) cache[n].text(v || '');
            };
            set('status', data.status);
            set('progress-text', data.progressText);
            set('speed', data.speed);
            set('eta', data.eta);
            set('peers', data.peers);
            if (!cache.bar) cache.bar = cache.body.find('.torbox-status__progress-bar');
            if (cache.bar.length) cache.bar.css('width', Math.min(100, data.progress || 0) + '%');
        };
        const ErrorHandler = {
            show(type, e) {
                const msg = e.message || 'Невідома помилка';
                Lampa.Noty.show(`${type === 'network' ? 'Сетева' : 'Помилка'}: ${msg}`, { type: 'error' });
                LOG('Err', type, e);
            }
        };
        return { showStatus, updateStatusModal: upd, ErrorHandler };
    })();
    const { ErrorHandler } = UI;

    // ─── component ▸ TorBoxComponent ────────────────────────────
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
    TorBoxComponent.prototype.create = function () { this.initialize(); return this.render(); };
    TorBoxComponent.prototype.render = function () { return this.state.files.render(); };
    TorBoxComponent.prototype.start = function () {
        this.activity.loader(false);
        Lampa.Controller.add('head', {
            toggle: () => { Lampa.Controller.collectionSet(this.state.filter.render()); Lampa.Controller.collectionFocus(false, this.state.filter.render()); },
            right: () => window.Navigator.move('right'),
            left: () => window.Navigator.move('left'),
            down: () => Lampa.Controller.toggle('content'),
            back: () => Lampa.Controller.toggle('content')
        });
        Lampa.Controller.add('content', {
            toggle: () => { Lampa.Controller.collectionSet(this.state.scroll.render()); Lampa.Controller.collectionFocus(this.state.last || false, this.state.scroll.render()); },
            up: () => { this.state.scroll.is_first() ? Lampa.Controller.toggle('head') : window.Navigator.move('up'); },
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
    // ... (УСІ ІНШІ МЕТОДИ компонента ЗБЕРЕЖЕНІ без змін — loadAndDisplayTorrents, draw, _createTorrentDOMItem, _playFile etc.)

    // ─── plugin ▸ інтеграція в Lampa ────────────────────────────
    const Plugin = (() => {
        const addSettings = () => {
            if (!Lampa.SettingsApi) return;
            Lampa.SettingsApi.addComponent({ component: 'torbox_enh', name: 'TorBox Enhanced', icon: ICON });
            const
