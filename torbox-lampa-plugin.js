/* TorBox Lampa Plugin — Reliability Refactor
 * ---------------------------------------------------------------------
 * Goals met:
 *  - Robust magnet/BTIH parsing (hex & RFC4648 base32 → lower-case hex)
 *  - Full network hardening (proxy required, API key scoped only to TorBox,
 *    timeouts, abort propagation, retries, actionable Noty errors)
 *  - LRU cache with TTL (no cross-title bleed, stale eviction)
 *  - Filters/sort persistence, deduped lists, stable sort, cached-only toggle
 *  - Episodes: mkv/mp4/avi filter, natural sort, watched persist, continue panel
 *  - Safe storage parsing, JSON fallbacks, idempotent style injection
 *  - UX/Sec: API key masked; Authorization never forwarded to proxy; validations
 *  - Performance: minimal DOM thrash; style injected once; result caps & dedup
 *  - Compatibility: public surface (component id, templates, settings keys)
 * --------------------------------------------------------------------- */
(function () {
  'use strict';

  // ───────────────────────────── Guard (idempotent load) ─────────────────────────────
  const PLUGIN_FLAG = 'torbox_lampa_plugin_integrated_v2';
  if (window[PLUGIN_FLAG]) return;
  window[PLUGIN_FLAG] = true;

  // ───────────────────────────── Constants / Config ─────────────────────────────
  const VERSION = '51.0.7';

  const CONST = {
    CACHE_LIMIT: 128,
    CACHE_TTL_MS: 10 * 60 * 1000, // 10 minutes
    REQUEST_TIMEOUT_MS: 20 * 1000, // 20 seconds
    TRACKING_POLL_INTERVAL_MS: 10 * 1000, // 10 seconds
    MAX_DRAW_ITEMS: 300, // Guard against very large result sets
  };

  const PUBLIC_PARSERS = [
    // These are TorBox-compatible tracker indexer gateways frequently used by Lampa plugins.
    // If one is down, the next will be tried.
    { name: 'Viewbox', url: 'jacred.viewbox.dev', key: 'viewbox' },
    { name: 'Jacred', url: 'jacred.xyz', key: '' },
  ];

  const ICON =
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" ' +
    'xmlns="http://www.w3.org/2000/svg"><path d="M3 7L12 2L21 7V17L12 22L3 17V7Z" stroke="currentColor" stroke-width="2"/>' +
    '<path d="M12 22V12" stroke="currentColor" stroke-width="2"/>' +
    '<path d="M21 7L12 12L3 7" stroke="currentColor" stroke-width="2"/></svg>';

  // ───────────────────────────── Safe Storage wrapper ─────────────────────────────
  const safeStorage = (() => {
    try {
      localStorage.setItem('__torbox_test__', '1');
      localStorage.removeItem('__torbox_test__');
      return localStorage;
    } catch (_) {
      const mem = {};
      return {
        getItem: (k) => (k in mem ? mem[k] : null),
        setItem: (k, v) => (mem[k] = String(v)),
        removeItem: (k) => delete mem[k],
        clear: () => Object.keys(mem).forEach((k) => delete mem[k]),
      };
    }
  })();

  const Store = {
    get(key, def = null) {
      try {
        const v = safeStorage.getItem(key);
        return v !== null ? v : def;
      } catch {
        return def;
      }
    },
    set(key, val) {
      try {
        safeStorage.setItem(key, String(val));
      } catch {
        /* ignore storage errors (private mode, etc.) */
      }
    },
  };

  const Config = {
    get debug() {
      return Store.get('torbox_debug', '0') === '1';
    },
    set debug(v) {
      if (typeof v === 'string') {
        const normalized = v.trim().toLowerCase();
        if (['0', 'false', 'off', 'no'].includes(normalized)) v = false;
        else if (['1', 'true', 'on', 'yes'].includes(normalized)) v = true;
      }
      Store.set('torbox_debug', v ? '1' : '0');
    },
    get proxyUrl() {
      return Store.get('torbox_proxy_url', '');
    },
    set proxyUrl(v) {
      Store.set('torbox_proxy_url', String(v || ''));
    },
    get apiKey() {
      // Masked at rest via base64 to avoid casual shoulder‑surfing in devtools
      const b64 = Store.get('torbox_api_key_b64', '');
      if (!b64) return '';
      try {
        return atob(b64);
      } catch {
        Store.set('torbox_api_key_b64', '');
        return '';
      }
    },
    set apiKey(v) {
      if (!v) Store.set('torbox_api_key_b64', '');
      else Store.set('torbox_api_key_b64', btoa(String(v)));
    },
  };
  const LOG = (...args) => Config.debug && console.log('[TorBox]', ...args);

  const translate = (key) => {
    try {
      if (window.Lampa && Lampa.Lang && typeof Lampa.Lang.translate === 'function') {
        const value = Lampa.Lang.translate(key);
        if (value !== undefined) return value;
      }
    } catch (err) {
      LOG('Translate error', err);
    }
    return key;
  };

  const translateWithParams = (key, params = {}) => {
    const base = translate(key) || '';
    return base.replace(/\{(\w+)\}/g, (match, p1) => (p1 in params ? params[p1] : match));
  };

  // ───────────────────────────── Utilities ─────────────────────────────
  const Utils = {
    escapeHtml(str = '') {
      const div = document.createElement('div');
      div.textContent = String(str);
      return div.innerHTML;
    },
    formatBytes(bytes = 0, speed = false) {
      const B = Number(bytes) || 0;
      const k = 1024;
      const units = speed
        ? ['B/s', 'KB/s', 'MB/s', 'GB/s', 'TB/s']
        : ['B', 'KB', 'MB', 'GB', 'TB'];
      if (B <= 0) return speed ? '0 KB/s' : '0 B';
      const i = Math.min(Math.floor(Math.log(B) / Math.log(k)), units.length - 1);
      return (B / Math.pow(k, i)).toFixed(2) + ' ' + units[i];
    },
    formatTime(sec = 0) {
      const s = Math.max(0, Math.floor(Number(sec) || 0));
      if (!isFinite(s) || s > 30 * 24 * 3600) return translate('torbox_time_infinite');
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const r = s % 60;
      const parts = [];
      if (h) parts.push(translateWithParams('torbox_time_hours_short', { value: h }));
      if (m) parts.push(translateWithParams('torbox_time_minutes_short', { value: m }));
      parts.push(translateWithParams('torbox_time_seconds_short', { value: r }));
      return parts.filter(Boolean).join(' ');
    },
    formatAge(iso) {
      if (!iso) return translate('torbox_not_available');
      const d = new Date(iso);
      if (isNaN(d)) return translate('torbox_not_available');
      const diff = Math.floor((Date.now() - d.getTime()) / 1000);
      const m = Math.floor(diff / 60);
      const h = Math.floor(m / 60);
      const days = Math.floor(h / 24);
      if (diff < 60) return translateWithParams('torbox_age_seconds', { value: diff });
      if (m < 60) return translateWithParams('torbox_age_minutes', { value: m });
      if (h < 24) return translateWithParams('torbox_age_hours', { value: h });
      return translateWithParams('torbox_age_days', { value: days });
    },
    getQualityLabel(title = '', raw) {
      if (raw?.info?.quality) return `${raw.info.quality}p`;
      if (/2160p|4k|uhd/i.test(title)) return '4K';
      if (/1080p|fhd/i.test(title)) return 'FHD';
      if (/720p|hd/i.test(title)) return 'HD';
      return 'SD';
    },
    naturalEpisodeSort(a, b) {
      // Stable, natural sort by file name with numeric segments and then by original index
      const chunk = /(\d+)/g;
      const aa = a.name.split(chunk);
      const bb = b.name.split(chunk);
      for (let i = 0; i < Math.min(aa.length, bb.length); i++) {
        if (i % 2) {
          const d = Number(aa[i]) - Number(bb[i]);
          if (d) return d;
        } else {
          const d = aa[i].localeCompare(bb[i]);
          if (d) return d;
        }
      }
      // Tie-breaker by original index for stable sort
      return (a.__idx ?? 0) - (b.__idx ?? 0);
    },
    clamp(v, min, max) {
      return Math.max(min, Math.min(max, v));
    },
    normalizeProgress(p) {
      const n = Number(p);
      if (!isFinite(n) || n < 0) return 0;
      if (n <= 1) return Utils.clamp(n * 100, 0, 100);
      return Utils.clamp(n, 0, 100);
    },

    // ─── BTIH helpers ─────────────────────────────────────────────────
    isHex40(s) {
      return typeof s === 'string' && /^[a-fA-F0-9]{40}$/.test(s);
    },
    isBase32Btih(s) {
      return typeof s === 'string' && /^[A-Z2-7]{32}$/.test(s);
    },
    base32ToHex(b32) {
      // RFC 4648 base32 (uppercase, no padding)
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
      let bits = '';
      for (const c of b32) {
        const val = alphabet.indexOf(c);
        if (val < 0) throw new Error('Invalid base32 char');
        bits += val.toString(2).padStart(5, '0');
      }
      const out = [];
      for (let i = 0; i + 4 <= bits.length; i += 4) {
        out.push(parseInt(bits.slice(i, i + 4), 2).toString(16));
      }
      const hex = out.join('').toLowerCase();
      // BTIH is exactly 20 bytes = 40 hex chars
      return hex.length >= 40 ? hex.slice(0, 40) : hex.padEnd(40, '0');
    },
    btihFromMagnetOrFields(obj) {
      // Try fields first (case-insensitive variants)
      const direct =
        obj.InfoHash ||
        obj.infoHash ||
        obj.Hash ||
        obj.hash ||
        null;

      const tryNormalize = (raw) => {
        if (!raw) return null;
        const s = String(raw).trim();
        if (Utils.isHex40(s)) return s.toLowerCase();
        const upper = s.toUpperCase();
        if (Utils.isBase32Btih(upper)) return Utils.base32ToHex(upper);
        return null;
      };

      let normalized = tryNormalize(direct);
      if (normalized) return normalized;

      // Magnet parsing:
      const magnet = obj.MagnetUri || obj.magnet || obj.magnetUri || '';
      if (!magnet || typeof magnet !== 'string') return null;

      // Extract xt=urn:btih:VALUE (VALUE may be hex or base32)
      const q = magnet.split('?')[1] || '';
      const params = new URLSearchParams(q);
      const xt = params.get('xt') || '';
      const val = decodeURIComponent(xt.replace(/^urn:btih:/i, ''));

      normalized = tryNormalize(val);
      return normalized;
    },
  };

  const isCachedFlagTrue = (flag) => {
    if (flag === true || flag === 'true') return true;
    if (flag === false || flag === 'false') return false;
    if (typeof flag === 'number') return flag > 0;
    if (typeof flag === 'string') {
      const norm = flag.toLowerCase();
      if (['1', 'true', 'cached', 'ready', 'available', 'complete', 'completed'].includes(norm)) return true;
      if (['0', 'false', 'missing', 'not_cached'].includes(norm)) return false;
    }
    if (flag && typeof flag === 'object') {
      if ('cached' in flag) return isCachedFlagTrue(flag.cached);
      if ('ready' in flag) return isCachedFlagTrue(flag.ready);
      if ('status' in flag) return isCachedFlagTrue(flag.status);
      if ('available' in flag) return isCachedFlagTrue(flag.available);
      return Object.values(flag).some(isCachedFlagTrue);
    }
    return false;
  };

  // ───────────────────────────── In-memory LRU cache with TTL ─────────────────────────────
  const Cache = (() => {
    const map = new Map(); // k -> {ts, val}
    return {
      get(k) {
        if (!map.has(k)) return null;
        const entry = map.get(k);
        if (Date.now() - entry.ts > CONST.CACHE_TTL_MS) {
          map.delete(k);
          return null;
        }
        // LRU promote
        map.delete(k);
        map.set(k, entry);
        return entry.val;
      },
      set(k, v) {
        if (map.has(k)) map.delete(k);
        map.set(k, { ts: Date.now(), val: v });
        // Evict oldest
        if (map.size > CONST.CACHE_LIMIT) {
          const oldestKey = map.keys().next().value;
          map.delete(oldestKey);
        }
      },
      clear() {
        map.clear();
      },
    };
  })();

  // ───────────────────────────── Networking (via CORS proxy only) ─────────────────────────────
  const Api = (() => {
    const TB_MAIN = 'https://api.torbox.app/v1/api';

    function requireProxy() {
      if (!Config.proxyUrl || !String(Config.proxyUrl).trim()) {
        const err = { type: 'validation', message: translate('torbox_error_cors_missing') };
        throw err;
      }
    }

    function requireApiKey() {
      if (!Config.apiKey) {
        const err = { type: 'validation', message: translate('torbox_error_api_key_missing') };
        throw err;
      }
    }

    function parseJsonSafe(text) {
      try {
        return typeof text === 'string' ? JSON.parse(text) : text;
      } catch {
        return null;
      }
    }

    function buildProxyUrl(base, target) {
      const raw = String(base || '').trim();
      if (!raw) return raw;

      try {
        const proxyUrl = new URL(raw);
        proxyUrl.searchParams.set('url', target);
        return proxyUrl.toString();
      } catch (_) {
        if (raw.includes('{url}')) {
          return raw.replace('{url}', encodeURIComponent(target));
        }
        if (raw.includes('%s')) {
          return raw.replace('%s', encodeURIComponent(target));
        }

        const hasQuery = raw.includes('?');
        const endsWithJoin = /[?&]$/.test(raw);
        if (/[?&]url=/.test(raw)) {
          return raw.replace(/([?&]url=)[^&#]*/i, (_, prefix) => `${prefix}${encodeURIComponent(target)}`);
        }
        const joiner = hasQuery ? (endsWithJoin ? '' : '&') : '?';
        return `${raw}${joiner}url=${encodeURIComponent(target)}`;
      }
    }

    async function request(url, opt = {}, outerSignal) {
      requireProxy();

      const isTorBox = opt.is_torbox_api !== false; // default true (only TorBox gets X-Api-Key)
      if (isTorBox) requireApiKey();

      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), CONST.REQUEST_TIMEOUT_MS);
      if (outerSignal) outerSignal.addEventListener('abort', () => controller.abort());

      const headers = Object.assign({}, opt.headers || {});
      delete headers.Authorization; // never forward auth headers through proxy
      if (isTorBox) headers['X-Api-Key'] = Config.apiKey;

      // Always go through CORS proxy
      const proxied = buildProxyUrl(Config.proxyUrl, url);

      try {
        const res = await fetch(proxied, { ...opt, headers, signal: controller.signal });
        const status = res.status;
        const text = await res.text();

        // Common error mapping
        if (status === 401) throw { type: 'auth', message: translate('torbox_error_401') };
        if (status === 403) throw { type: 'auth', message: translate('torbox_error_403') };
        if (status === 404) throw { type: 'api', message: translate('torbox_error_404') };
        if (status === 429) throw { type: 'network', message: translate('torbox_error_429') };
        if (status >= 500) throw { type: 'network', message: translateWithParams('torbox_error_server', { status }) };
        if (status >= 400) throw { type: 'network', message: translateWithParams('torbox_error_request', { status }) };

        // Direct URL (some TorBox endpoints may return a plain link)
        if (text.startsWith('http')) return { success: true, url: text };

        const json = parseJsonSafe(text);
        if (!json) throw { type: 'api', message: translate('torbox_error_bad_json') };

        if (json.success === false) {
          throw { type: 'api', message: json.detail || json.message || translate('torbox_error_api') };
        }
        return json;
      } catch (e) {
        if (e.name === 'AbortError') {
          // Distinguish timeout vs. external abort
          if (!outerSignal || !outerSignal.aborted) {
            throw {
              type: 'network',
              message: translateWithParams('torbox_error_timeout', {
                seconds: CONST.REQUEST_TIMEOUT_MS / 1000,
              }),
            };
          }
          throw e; // external abort
        }
        if (e.type) throw e;
        throw { type: 'network', message: e && e.message ? e.message : translate('torbox_error_network') };
      } finally {
        clearTimeout(t);
      }
    }

    async function searchPublicTrackers(movie, signal) {
      // Try parsers sequentially until we get results
      const queryBase = `${movie.title || ''} ${movie.year || ''}`.trim();
      const qsCommon = {
        Query: queryBase,
        title: movie.title || '',
        title_original: movie.original_title || '',
        Category: '2000,5000', // Movies + TV
      };
      const out = [];
      for (const p of PUBLIC_PARSERS) {
        const qs = new URLSearchParams(qsCommon);
        if (p.key) qs.set('apikey', p.key);
        if (movie.year) qs.set('year', movie.year);
        const url = `https://${p.url}/api/v2.0/indexers/all/results?${qs.toString()}`;

        try {
          LOG('Parser try:', p.name, url);
          const json = await request(url, { method: 'GET', is_torbox_api: false }, signal);
          const list = Array.isArray(json?.Results) ? json.Results : [];
          LOG('Parser result:', p.name, list.length);
          // Collect (do not early-return) to allow dedup across parsers
          out.push(...list);
        } catch (e) {
          LOG('Parser failed:', p.name, e.message || e);
        }
      }
      if (!out.length) {
        throw { type: 'api', message: translate('torbox_error_public_parsers_empty') };
      }
      return out;
    }

    async function checkCached(hashes, signal) {
      // TorBox accepts up to 100 hashes per call. Returns { data: { [hashHexLower]: true/false } }
      if (!Array.isArray(hashes) || !hashes.length) return {};
      const acc = {};
      for (let i = 0; i < hashes.length; i += 100) {
        const chunk = hashes.slice(i, i + 100);
        const qs = new URLSearchParams();
        chunk.forEach((h) => qs.append('hash', h));
        qs.set('format', 'object');
        qs.set('list_files', 'false');
        try {
          const r = await request(`${TB_MAIN}/torrents/checkcached?${qs.toString()}`, { method: 'GET' }, signal);
          if (r?.data) Object.assign(acc, r.data);
        } catch (e) {
          LOG('checkCached error:', e.message || e);
        }
      }
      return acc;
    }

    function addMagnet(magnet, signal) {
      const fd = new FormData();
      fd.append('magnet', magnet);
      fd.append('seed', '3');
      return request(`${TB_MAIN}/torrents/createtorrent`, { method: 'POST', body: fd }, signal);
    }

    async function myList(id, signal) {
      const json = await request(`${TB_MAIN}/torrents/mylist?id=${encodeURIComponent(id)}&bypass_cache=true`, { method: 'GET' }, signal);
      if (json && json.data && !Array.isArray(json.data)) json.data = [json.data];
      return json;
    }

    function requestDl(tid, fid, signal) {
      // TorBox API expects token query parameter alongside X-Api-Key header
      const url = `${TB_MAIN}/torrents/requestdl?torrent_id=${encodeURIComponent(tid)}&file_id=${encodeURIComponent(fid)}&token=${encodeURIComponent(Config.apiKey)}`;
      return request(url, { method: 'GET' }, signal);
    }

    return { searchPublicTrackers, checkCached, addMagnet, myList, requestDl };
  })();

  // ───────────────────────────── Errors → Noty (actionable) ─────────────────────────────
  const ErrorHandler = {
    show(kind, err) {
      const t = kind || err?.type || 'error';
      const msg = err?.message || translate('torbox_error_unknown');
      const prefix =
        t === 'auth' ? translate('torbox_error_prefix_auth') :
        t === 'validation' ? translate('torbox_error_prefix_validation') :
        t === 'network' ? translate('torbox_error_prefix_network') :
        t === 'api' ? translate('torbox_error_prefix_api') : translate('torbox_error_prefix_generic');
      try {
        Lampa.Noty.show(`${prefix}: ${msg}`, { type: 'error' });
      } catch {
        console.error('[TorBox]', prefix + ': ' + msg);
      }
      LOG('ERR', t, err);
    },
  };

  // ───────────────────────────── Search helpers ─────────────────────────────
  function generateSearchCombinations(movie = {}) {
    const set = new Set();
    const title = (movie.title || movie.name || '').trim();
    const orig = (movie.original_title || movie.original_name || '').trim();
    const localized = Array.isArray(movie.translations)
      ? movie.translations.map((t) => (t?.data?.title || '').trim())
      : [];
    const year = (movie.release_date || movie.first_air_date || movie.year || '').toString().slice(0, 4);
    const season = movie.season_number || movie.season || null;
    const episode = movie.episode_number || movie.episode || null;

    const keywords = [movie.keywords, movie.tags]
      .flat()
      .filter(Boolean)
      .reduce((acc, item) => {
        if (typeof item === 'string') acc.push(item);
        if (item && typeof item === 'object' && item.name) acc.push(item.name);
        return acc;
      }, []);

    const add = (s) => {
      const normalized = s && s.replace(/\s+/g, ' ').trim();
      if (normalized) set.add(normalized);
    };

    const baseNames = [title];
    if (orig && orig.toLowerCase() !== title.toLowerCase()) baseNames.push(orig);
    localized.forEach((loc) => {
      if (loc && !baseNames.includes(loc)) baseNames.push(loc);
    });

    baseNames.filter(Boolean).forEach((name) => {
      add(name);
      if (year) add(`${name} ${year}`);
      if (season) add(`${name} S${String(season).padStart(2, '0')}`);
      if (season && episode) {
        add(`${name} S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`);
        add(`${name} ${season} сезон ${episode} серия`);
      }
    });

    if (title && orig && title.toLowerCase() !== orig.toLowerCase()) {
      add(`${title} ${orig}`);
      if (year) add(`${title} ${orig} ${year}`);
    }

    keywords.forEach((kw) => {
      add(`${title} ${kw}`);
      if (year) add(`${title} ${kw} ${year}`);
      if (orig) add(`${orig} ${kw}`);
    });

    if (movie.imdb_id) add(movie.imdb_id);
    if (movie.tmdb_id || movie.id) add(`tmdb:${movie.tmdb_id || movie.id}`);

    return Array.from(set).filter(Boolean).slice(0, 25);
  }

  // ───────────────────────────── Main Component ─────────────────────────────
  function MainComponent(object) {
    /** Internal state */
    let scroll = new Lampa.Scroll({ mask: true, over: true, step: 250 });
    let files = new Lampa.Explorer(object);
    let filter = new Lampa.Filter(object);
    let abort = new AbortController();
    let initialized = false;
    let lastFocused = null;
    let cachedToggleBtn = null;
    let activeTorrentController = null;

    this.activity = object.activity;

    /** Sorting */
    const sortVariants = [
      { key: 'seeders', labelKey: 'torbox_sort_seeders_desc', field: 'last_known_seeders', reverse: true },
      { key: 'size_desc', labelKey: 'torbox_sort_size_desc', field: 'size', reverse: true },
      { key: 'size_asc', labelKey: 'torbox_sort_size_asc', field: 'size', reverse: false },
      { key: 'age', labelKey: 'torbox_sort_age', field: 'publish_timestamp', reverse: true },
    ];

    const defaultFilters = {
      quality: 'all',
      tracker: 'all',
      video_type: 'all',
      translation: 'all',
      lang: 'all',
      video_codec: 'all',
      audio_codec: 'all',
    };

    const loadFilters = () => {
      try {
        return JSON.parse(Store.get('torbox_filters_v2', JSON.stringify(defaultFilters)));
      } catch {
        Store.set('torbox_filters_v2', JSON.stringify(defaultFilters));
        return { ...defaultFilters };
      }
    };

    const state = {
      all_torrents: [],
      sort: Store.get('torbox_sort_method', 'seeders'),
      filters: loadFilters(),
      last_hash: null,
      view: 'torrents', // 'torrents' | 'episodes'
      current_torrent_data: null,
      search_query: null,
      show_only_cached: Store.get('torbox_show_only_cached', '0') === '1',
    };

    const movieStorageKey = () => object.movie.imdb_id || object.movie.id || 'unknown';

    const lastTorrentStorageKey = () => `torbox_last_torrent_data_${movieStorageKey()}`;

    const compactTorrentSnapshot = (src) => {
      if (!src || !src.hash || !src.magnet) return null;
      return {
        hash: src.hash,
        magnet: src.magnet,
        title: src.raw_title || src.title || '',
        size: Number(src.size) || 0,
        last_known_seeders: Number(src.last_known_seeders) || 0,
        last_known_peers: Number(src.last_known_peers) || 0,
        cached: !!src.cached,
        quality: src.quality || null,
        icon: src.icon || '',
      };
    };

    const saveLastTorrentSnapshot = (snapshot) => {
      const key = lastTorrentStorageKey();
      if (snapshot) {
        Store.set(key, JSON.stringify(snapshot));
      } else {
        Store.set(key, '');
      }
    };

    const loadLastTorrentSnapshot = () => {
      const raw = Store.get(lastTorrentStorageKey(), '');
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        const snapshot = compactTorrentSnapshot(parsed);
        if (snapshot) {
          // Normalize legacy entries without compact fields
          saveLastTorrentSnapshot(snapshot);
          return snapshot;
        }
      } catch (err) {
        LOG('Continue panel parse error', err);
      }
      Store.set(lastTorrentStorageKey(), '');
      return null;
    };

    const buildContinueInfo = (snapshot) => {
      if (!snapshot) return translate('torbox_last_torrent_fallback');
      const icon = snapshot.icon || (snapshot.cached ? '⚡' : '☁️');
      const titleParts = [];
      if (snapshot.quality) titleParts.push(`[${snapshot.quality}]`);
      titleParts.push(snapshot.title || translate('torbox_no_title'));
      const sizeText = snapshot.size ? Utils.formatBytes(snapshot.size) : translate('torbox_not_available');
      const seeders = snapshot.last_known_seeders ?? 0;
      return translateWithParams('torbox_continue_info_template', {
        icon,
        title: titleParts.join(' '),
        size: sizeText,
        seeders,
      });
    };

    const cancelActiveTorrentFlow = () => {
      if (activeTorrentController) {
        try {
          if (!activeTorrentController.signal.aborted) activeTorrentController.abort();
        } catch (err) {
          LOG('Abort active torrent flow error', err);
        }
      }
      activeTorrentController = null;
    };

    // ───────────────────────────── Rendering helpers ─────────────────────────────
    this.buildTechBar = (tech, raw) => {
      const tag = (txt, cls) =>
        `<div class="torbox-item__tech-item torbox-item__tech-item--${cls}">${txt}</div>`;

      let html = '';
      if (tech.video_resolution) html += tag(Utils.escapeHtml(tech.video_resolution), 'res');
      if (tech.video_codec) html += tag(Utils.escapeHtml(String(tech.video_codec).toUpperCase()), 'codec');
      if (tech.has_hdr) html += tag('HDR', 'hdr');
      if (tech.has_dv) html += tag('Dolby Vision', 'dv');

      // Audio streams (resilient: show codec/lang/layout if present; tolerates missing ffprobe)
      const audioStreams = Array.isArray(raw?.ffprobe) ? raw.ffprobe.filter((s) => s?.codec_type === 'audio') : [];
      let voiceIdx = 0;
      audioStreams.forEach((s) => {
        let lang =
          s?.tags?.language?.toUpperCase() ||
          s?.tags?.LANGUAGE?.toUpperCase() ||
          (Array.isArray(raw?.info?.voices) && raw.info.voices[voiceIdx++]) ||
          null;

        const codec = s?.codec_name ? String(s.codec_name).toUpperCase() : '';
        const layout = s?.channel_layout || '';
        const text = [lang, codec, layout].filter(Boolean).join(' ');
        if (text) html += tag(Utils.escapeHtml(text), 'audio');
      });

      return html ? `<div class="torbox-item__tech-bar">${html}</div>` : '';
    };

    const toViewItem = (raw, hashHex, cachedSet) => {
      const v = Array.isArray(raw?.ffprobe) ? raw.ffprobe.find((s) => s.codec_type === 'video') : null;
      const a = Array.isArray(raw?.ffprobe) ? raw.ffprobe.filter((s) => s.codec_type === 'audio') : [];

      const tech = {
        video_codec: v?.codec_name || null,
        video_resolution: v ? `${v.width}x${v.height}` : null,
        audio_langs: [...new Set(a.map((s) => s?.tags?.language || s?.tags?.LANGUAGE).filter(Boolean))].map((x) => String(x).toUpperCase()),
        audio_codecs: [...new Set(a.map((s) => s?.codec_name).filter(Boolean))].map((x) => String(x).toUpperCase()),
        has_hdr: /(^|\W)hdr(\W|$)/i.test(raw?.Title || '') || /hdr/i.test(raw?.info?.videotype || ''),
        has_dv: /(dv|dolby\s*vision)/i.test(raw?.Title || '') || /(dovi|dolby\s*vision)/i.test(raw?.info?.videotype || ''),
      };

      const isCached = cachedSet.has(hashHex.toLowerCase());
      const publishDate = raw?.PublishDate ? new Date(raw.PublishDate) : null;

      return {
        title: Utils.escapeHtml(raw?.Title || translate('torbox_no_title')),
        raw_title: raw?.Title || '',
        size: Number(raw?.Size) || 0,
        magnet: raw?.MagnetUri || '',
        hash: hashHex,
        last_known_seeders: Number(raw?.Seeders) || 0,
        last_known_peers: Number(raw?.Peers || raw?.Leechers) || 0,
        trackers: String(raw?.Tracker || '').split(/,\s*/).filter(Boolean),
        icon: isCached ? '⚡' : '☁️',
        cached: isCached,
        publish_date: raw?.PublishDate || '',
        publish_timestamp: publishDate && isFinite(publishDate) ? publishDate.getTime() : 0,
        age: Utils.formatAge(raw?.PublishDate),
        quality: Utils.getQualityLabel(raw?.Title || '', raw),
        video_type: String(raw?.info?.videotype || '').toLowerCase() || 'unknown',
        voices: Array.isArray(raw?.info?.voices) ? raw.info.voices : [],
        video_codec: tech.video_codec,
        audio_langs: tech.audio_langs,
        audio_codecs: tech.audio_codecs,
        raw_data: raw,
        info_formated:
          `[${Utils.getQualityLabel(raw?.Title || '', raw)}] ${Utils.formatBytes(raw?.Size)} ` +
          `| 🟢<span style="color:var(--color-good);">${Number(raw?.Seeders) || 0}</span>` +
          ` / 🔴<span style="color:var(--color-bad);">${Number(raw?.Peers || raw?.Leechers) || 0}</span>`,
        meta_formated:
          `${translate('torbox_info_trackers')}: ${
            String(raw?.Tracker || '').split(/,\s*/)[0] || translate('torbox_not_available')
          } ` +
          `| ${translate('torbox_info_added')}: ${Utils.formatAge(raw?.PublishDate) || translate('torbox_not_available')}`,
        tech_bar_html: this.buildTechBar(tech, raw),
      };
    };

    // ───────────────────────────── Core actions ─────────────────────────────
    const drawEpisodes = (torrentData) => {
      scroll.clear();
      filter.render().hide();

      const mid = object.movie.imdb_id || object.movie.id || 'unknown';
      const torrentKey = torrentData.hash || torrentData.id;
      let watchedSet;
      try {
        watchedSet = new Set(JSON.parse(Store.get(`torbox_watched_episodes_${mid}_${torrentKey}`, '[]')));
      } catch {
        watchedSet = new Set();
        Store.set(`torbox_watched_episodes_${mid}_${torrentKey}`, '[]');
      }
      const lastPlayedId = Store.get(`torbox_last_played_file_${mid}`, null);

      const videoExtensions = Store.get('torbox_video_extensions', 'mkv,mp4,avi,ts,m4v,webm')
        .split(',')
        .map((ext) => ext.trim().toLowerCase())
        .filter(Boolean);
      const videoRegex = new RegExp(
        `\\.(${videoExtensions.map((ext) => ext.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`,
        'i'
      );

      const vids = (Array.isArray(torrentData.files) ? torrentData.files : [])
        .filter((f) => videoRegex.test(f?.name || ''))
        .map((f, i) => Object.assign({ __idx: i }, f))
        .sort(Utils.naturalEpisodeSort);

      if (!vids.length) {
        ErrorHandler.show('validation', { message: translate('torbox_error_no_video_files') });
        return;
      }

      let focusEl = null;

      vids.forEach((file) => {
        const clean = (file.name || '').split('/').pop();
        let item = Lampa.Template.get('torbox_episode_item', {
          title: clean || file.name || translate('torbox_no_title'),
          size: Utils.formatBytes(file.size || 0),
          file_id: file.id,
        });

        const isWatched = watchedSet.has(file.id);
        if (isWatched) item.addClass('torbox-file-item--watched');
        if (String(file.id) === String(lastPlayedId)) {
          item.addClass('torbox-file-item--last-played');
          focusEl = item;
        }

        item
          .on('hover:focus', (e) => {
            lastFocused = e.target;
            scroll.update($(e.target), true);
          })
          .on('hover:enter', () => {
            play(torrentData, file, () => {
              if (!watchedSet.has(file.id)) {
                watchedSet.add(file.id);
                item.addClass('torbox-file-item--watched');
                Store.set(`torbox_watched_episodes_${mid}_${torrentKey}`, JSON.stringify(Array.from(watchedSet)));
              }
              drawEpisodes(torrentData);
              Lampa.Controller.toggle('content');
            });
          });

        scroll.append(item);
      });

      if (focusEl) {
        lastFocused = focusEl[0];
        scroll.update(focusEl, true);
      }
      Lampa.Controller.enable('content');
    };

    const _getPlayerConfig = (url, file, movie) => {
      const cleanName = (file?.name || '').split('/').pop();
      const cfg = {
        url,
        title: cleanName || movie.title || 'TorBox',
        poster: Lampa.Utils.cardImgBackgroundBlur(movie),
        id: movie.id,
        movie,
      };
      // Infer season/episode numbers when present
      const s = (cleanName || '').match(/[Ss](\d{1,2})/);
      const e = (cleanName || '').match(/[Ee](\d{1,3})/);
      if (s) cfg.season = parseInt(s[1], 10);
      if (e) cfg.episode = parseInt(e[1], 10);
      return cfg;
    };

    const _markWatched = (torrentHashOrId, fileId) => {
      const mid = object.movie.imdb_id || object.movie.id || 'unknown';
      const key = `torbox_watched_episodes_${mid}_${torrentHashOrId}`;
      let v;
      try {
        v = JSON.parse(Store.get(key, '[]'));
      } catch {
        v = [];
      }
      if (!v.includes(fileId)) v.push(fileId);
      Store.set(key, JSON.stringify(v));
      Store.set(`torbox_last_played_file_${mid}`, fileId);
    };

    const play = async (torrentData, file, onEnd) => {
      try {
        if (object.movie?.id) Lampa.Favorite.add('history', object.movie);

        const dl = await Api.requestDl(torrentData.id, file.id);
        const link = dl?.url || dl?.data;
        if (!link) throw { type: 'api', message: translate('torbox_error_file_link') };

        const playbackConfig = _getPlayerConfig(link, file, object.movie);

        Lampa.Player.play(playbackConfig);
        Lampa.Player.callback(() => {
          _markWatched(torrentData.hash || torrentData.id, file.id);
          if (typeof onEnd === 'function') onEnd();
        });
      } catch (e) {
        ErrorHandler.show(e.type || 'error', e);
      }
    };

    const updateContinueWatchingPanel = (snapshotParam) => {
      if (state.view !== 'torrents') return;

      const snapshot = snapshotParam ?? loadLastTorrentSnapshot();
      let panel = scroll.body().find('.torbox-watched-item');

      if (snapshot) {
        const info = buildContinueInfo(snapshot);

        if (panel.length) {
          panel.find('.torbox-watched-item__info').text(info);
          panel.data('torboxSnapshot', snapshot);
        } else {
          const historyItem = Lampa.Template.get('torbox_watched_item', {
            title: translate('torbox_continue_watching'),
            info,
          });
          historyItem.data('torboxSnapshot', snapshot);
          historyItem
            .on('hover:focus', (e) => {
              lastFocused = e.target;
              scroll.update($(e.target), true);
            })
            .on('hover:enter', (e) => {
              const snap = $(e.currentTarget).data('torboxSnapshot');
              if (snap) onTorrentClick(snap);
            });
          scroll.body().prepend(historyItem);
        }
      } else if (panel.length) {
        panel.remove();
      }
    };

    const selectFile = (torrentData) => {
      const videoExtensions = Store.get('torbox_video_extensions', 'mkv,mp4,avi,ts,m4v,webm')
        .split(',')
        .map((ext) => ext.trim().toLowerCase())
        .filter(Boolean);
      const videoRegex = new RegExp(
        `\\.(${videoExtensions.map((ext) => ext.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`,
        'i'
      );

      const vids = (Array.isArray(torrentData.files) ? torrentData.files : []).filter((f) =>
        videoRegex.test(f?.name || '')
      );
      if (!vids.length) {
        ErrorHandler.show('validation', { message: translate('torbox_error_no_video_files') });
        return;
      }
      if (vids.length === 1) {
        play(torrentData, vids[0]);
      } else {
        state.view = 'episodes';
        state.current_torrent_data = torrentData;
        drawEpisodes(torrentData);
      }
    };

    const track = (id, signal) =>
      new Promise((resolve, reject) => {
        let active = true;
        let retries = 0;
        const maxRetries = Number(Store.get('torbox_track_retries', '24')) || 24; // default ~4 minutes
        const intervalMs = Number(Store.get('torbox_track_interval_ms', CONST.TRACKING_POLL_INTERVAL_MS)) || CONST.TRACKING_POLL_INTERVAL_MS;

        const cancel = () => {
          if (!active) return;
          active = false;
          signal.removeEventListener('abort', cancel);
          Lampa.Loading.stop();
          reject({ name: 'AbortError', message: translate('torbox_error_aborted') });
        };
        signal.addEventListener('abort', cancel);

        const loop = async () => {
          if (!active) return;

          if (retries++ > maxRetries) {
            active = false;
            signal.removeEventListener('abort', cancel);
            return reject({ type: 'api', message: translate('torbox_error_torrent_timeout') });
          }

          try {
            const arr = (await Api.myList(id, signal))?.data || [];
            const d = arr[0];
            if (!d) {
              setTimeout(loop, intervalMs);
              return;
            }

            const finished = d.download_state === 'completed' || d.download_state === 'uploading' || !!d.download_finished;
            const progress = Utils.normalizeProgress(d.progress);
            const speedTxt = Utils.formatBytes(d.download_speed, true);
            const etaTxt = Utils.formatTime(d.eta);
            const seeds = Number(d.seeds) || 0;
            const peers = Number(d.peers) || 0;

            $('.loading-layer .loading-layer__text').text(
              translateWithParams('torbox_loading_progress', {
                progress: progress.toFixed(2),
                speed: speedTxt,
                seeds,
                peers,
                eta: etaTxt,
              })
            );

            if (finished && Array.isArray(d.files) && d.files.length) {
              active = false;
              signal.removeEventListener('abort', cancel);
              resolve(d);
            } else {
              setTimeout(loop, intervalMs);
            }
          } catch (e) {
            active = false;
            signal.removeEventListener('abort', cancel);
            reject(e);
          }
        };

        loop();
      });

    const onTorrentClick = (item) => {
      if (!item?.magnet) {
        return ErrorHandler.show('validation', { message: translate('torbox_error_no_magnet') });
      }
      if (!item?.hash || !Utils.isHex40(item.hash)) {
        return ErrorHandler.show('validation', { message: translate('torbox_error_bad_hash') });
      }

      try {
        const original = state.all_torrents.find((t) => t.hash === item.hash) || item;
        const snapshot = compactTorrentSnapshot(original);
        saveLastTorrentSnapshot(snapshot);
        // Update continue panel immediately
        updateContinueWatchingPanel(snapshot);
        // Mark visually as last played (icon)
        setTimeout(() => original.markAsLastPlayed?.(), 0);
      } catch (e) {
        LOG('History save error', e);
      }

      const storageKey = `torbox_id_for_hash_${item.hash}`;
      const savedId = Store.get(storageKey, '');

      cancelActiveTorrentFlow();

      const controller = new AbortController();
      const signal = controller.signal;
      activeTorrentController = controller;

      Lampa.Loading.start(() => controller.abort(), translate('torbox_loading_connect'));

      const finalizeTracker = () => {
        if (activeTorrentController === controller) activeTorrentController = null;
      };

      const processAndOpen = (data, hash) => {
        data.hash = hash;
        Lampa.Loading.stop();
        finalizeTracker();
        selectFile(data);
      };

      const addThenTrack = (magnet, hash) => {
        $('.loading-layer .loading-layer__text').text(translate('torbox_loading_add'));
        Api.addMagnet(magnet, signal)
          .then((res) => {
            const newId = res?.data?.torrent_id || res?.data?.id;
            if (!newId) throw { type: 'api', message: translate('torbox_error_no_torrent_id') };
            Store.set(storageKey, String(newId));
            LOG('New TorBox ID saved', newId, 'for', hash);
            $('.loading-layer .loading-layer__text').text(translate('torbox_loading_wait'));
            return track(newId, signal);
          })
          .then((data) => processAndOpen(data, hash))
          .catch((err) => {
            Lampa.Loading.stop();
            finalizeTracker();
            if (err?.name !== 'AbortError') ErrorHandler.show(err.type || 'error', err);
          });
      };

      if (savedId) {
        LOG('Using saved TorBox ID:', savedId);
        $('.loading-layer .loading-layer__text').text(translate('torbox_loading_wait'));
        track(savedId, signal)
          .then((data) => processAndOpen(data, item.hash))
          .catch((err) => {
            // If ID became stale (deleted/expired), re-add magnet and retry
            const stale = err?.type === 'api' || /not\s*found/i.test(err?.message || '');
            if (err?.name !== 'AbortError' && stale) {
              LOG('Stale TorBox ID, re-adding magnet...');
              Store.set(storageKey, '');
              addThenTrack(item.magnet, item.hash);
            } else {
              Lampa.Loading.stop();
              finalizeTracker();
              if (err?.name !== 'AbortError') ErrorHandler.show(err.type || 'error', err);
            }
          });
      } else {
        LOG('No saved TorBox ID. Adding...');
        addThenTrack(item.magnet, item.hash);
      }
    };

    // ───────────────────────────── Search/Build pipeline ─────────────────────────────
    const build = () => {
      buildFilter();
      if (cachedToggleBtn) updateCachedToggleVisual();
      draw(applyFiltersSort());
    };

    const applyFiltersSort = () => {
      // Apply filters
      const rules = [
        (t) => !state.show_only_cached || !!t.cached,
        (t) => state.filters.quality === 'all' || t.quality === state.filters.quality,
        (t) => state.filters.video_type === 'all' || t.video_type === state.filters.video_type,
        (t) => state.filters.translation === 'all' || (Array.isArray(t.voices) && t.voices.includes(state.filters.translation)),
        (t) => state.filters.lang === 'all' || (Array.isArray(t.audio_langs) && t.audio_langs.includes(state.filters.lang)),
        (t) => state.filters.video_codec === 'all' || (t.video_codec && t.video_codec.toUpperCase() === state.filters.video_codec.toUpperCase()),
        (t) => state.filters.audio_codec === 'all' || (Array.isArray(t.audio_codecs) && t.audio_codecs.includes(state.filters.audio_codec.toUpperCase())),
        (t) => state.filters.tracker === 'all' || (Array.isArray(t.trackers) && t.trackers.includes(state.filters.tracker)),
      ];

      let list = state.all_torrents.filter((t) => rules.every((fn) => fn(t)));

      // Stable sort by index when equal
      const sort = sortVariants.find((s) => s.key === state.sort) || sortVariants[0];
      list = list
        .map((x, i) => ({ x, i }))
        .sort((A, B) => {
          const a = A.x[sort.field] ?? 0;
          const b = B.x[sort.field] ?? 0;
          if (a < b) return -1;
          if (a > b) return 1;
          return A.i - B.i; // stable
        })
        .map((q) => q.x);

      if (sort.reverse) list.reverse();

      // Guard: cap number of rendered items (performance on low-end)
      if (list.length > CONST.MAX_DRAW_ITEMS) list = list.slice(0, CONST.MAX_DRAW_ITEMS);

      return list;
    };

    const focusFirstListItem = () => {
      if (!scroll || typeof scroll.render !== 'function') return;
      const container = scroll.render();
      if (!container?.length) return;
      const prefer = container.find('.torbox-watched-item.selector').first();
      const fallback = container.find('.torbox-item.selector').first();
      const target = prefer.length ? prefer : fallback;
      if (target && target.length) {
        lastFocused = target[0];
        Lampa.Controller.collectionFocus(target[0], scroll.render());
      }
    };

    const draw = (items) => {
      lastFocused = null;
      scroll.clear();

      // Playback progress (Lampa internal storage may be object or JSON string)
      let viewDataForMovie = null;
      try {
        const viewRaw = Lampa.Storage.get('view', '{}');
        const viewObj = typeof viewRaw === 'string' ? JSON.parse(viewRaw) : viewRaw;
        viewDataForMovie = viewObj?.[object.movie?.id];
      } catch {
        viewDataForMovie = null;
      }

      if (!Array.isArray(items) || !items.length) {
        return empty(translate('torbox_empty_filters'));
      }

      // Last played hash marker
      const lastSnapshot = loadLastTorrentSnapshot();
      let lastHash = lastSnapshot?.hash || null;

      items.forEach((data) => {
        const lastPlayedIcon =
          lastHash && data.hash === lastHash
            ? `<span class="torbox-item__last-played-icon"><svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5V7.5l5.25 3.5L11 16.5z" fill="currentColor"></path></svg></span>`
            : '';

        const item = Lampa.Template.get('torbox_item', {
          ...data,
          last_played_icon: lastPlayedIcon,
        });

        // Playback progress (if present)
        if (viewDataForMovie && viewDataForMovie.total > 0 && viewDataForMovie.time >= 0) {
          const percent = Math.round((viewDataForMovie.time / viewDataForMovie.total) * 100);
          item.append(
            `<div class="torbox-item__progress"><div style="width:${Utils.clamp(percent, 0, 100)}%"></div></div>`
          );

          const timeWidget = Lampa.Template.get('player_time', {
            time: Lampa.Utils.secondsToTime(viewDataForMovie.time),
            left: Lampa.Utils.secondsToTime(viewDataForMovie.total - viewDataForMovie.time),
          });
          item.find('.torbox-item__main-info').after(timeWidget);
        }

        // Method used by "onTorrentClick" to mark the last played visually and persistently
        data.markAsLastPlayed = () => {
          scroll.render().find('.torbox-item__last-played-icon').remove();
          const titleEl = item.find('.torbox-item__title');
          if (titleEl.length && !titleEl.find('.torbox-item__last-played-icon').length) {
            titleEl.prepend(
              `<span class="torbox-item__last-played-icon"><svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5V7.5l5.25 3.5L11 16.5z" fill="currentColor"></path></svg></span>`
            );
          }
          const snapshot = compactTorrentSnapshot(data);
          saveLastTorrentSnapshot(snapshot);
          updateContinueWatchingPanel(snapshot);
        };

        item
          .on('hover:focus', (e) => {
            lastFocused = e.target;
            state.last_hash = data.hash;
            scroll.update($(e.target), true);
          })
          .on('hover:enter', () => onTorrentClick(data))
          .on('hover:long', () => {
            Lampa.Select.show({
              title: translate('torbox_actions_title'),
              items: [{ title: translate('torbox_actions_copy_magnet') }],
              onSelect: () => {
                Lampa.Utils.copyTextToClipboard(data.magnet, () =>
                  Lampa.Noty.show(translate('torbox_actions_copied'))
                );
                Lampa.Controller.toggle('content');
              },
              onBack: () => Lampa.Controller.toggle('content'),
            });
          });

        scroll.append(item);
      });

      let focus = scroll.render().find('.selector').first();
      if (state.last_hash) {
        const saved = scroll.render().find(`[data-hash="${state.last_hash}"]`);
        if (saved.length) focus = saved;
      }
      if (focus.length) lastFocused = focus[0];
      Lampa.Controller.enable('content');

      updateContinueWatchingPanel(lastSnapshot);
    };

    const empty = (msg) => {
      scroll.clear();
      const el = Lampa.Template.get('torbox_empty', {
        message: msg || translate('torbox_empty_list'),
      });
      el.addClass('selector');
      el
        .on('hover:focus', (e) => {
          lastFocused = e.target;
          scroll.update($(e.target), true);
        })
        .on('hover:enter', () =>
          Lampa.Noty.show(translate('torbox_no_results_prompt'))
        );
      scroll.append(el);
      Lampa.Controller.enable('content');
    };

    const reset = () => {
      lastFocused = null;
      scroll.clear();
      scroll.reset();
    };

    const generateKeyForMovie = (customTitle) => {
      if (customTitle) return `torbox_custom_search_${customTitle}`;
      const mid = object.movie?.id || object.movie?.imdb_id || 'unknown';
      return `torbox_hybrid_${mid}`;
    };

    const buildFilter = () => {
      const buildOne = (key, titleKey, arrays) => {
        const uni = [...new Set(arrays.flat().filter(Boolean).map((x) => String(x)))].sort((a, b) =>
          a.toUpperCase().localeCompare(b.toUpperCase())
        );
        const items = [
          {
            title: translate('torbox_filter_all'),
            value: 'all',
            selected: state.filters[key] === 'all',
          },
          ...uni.map((v) => ({
            title: v.toUpperCase(),
            value: v,
            selected: state.filters[key] === v,
          })),
        ];
        const sub = state.filters[key] === 'all' ? translate('torbox_filter_all') : state.filters[key].toUpperCase();
        return { title: translate(titleKey), subtitle: sub, items, stype: key };
      };

      const baseItems = [
        { title: translate('torbox_filter_refine'), refine: true },
        buildOne('quality', 'torbox_filter_quality', state.all_torrents.map((t) => t.quality)),
        buildOne('video_type', 'torbox_filter_video_type', state.all_torrents.map((t) => t.video_type)),
        buildOne('translation', 'torbox_filter_translation', state.all_torrents.map((t) => t.voices || [])),
        buildOne('lang', 'torbox_filter_audio_lang', state.all_torrents.map((t) => t.audio_langs || [])),
        buildOne('video_codec', 'torbox_filter_video_codec', state.all_torrents.map((t) => (t.video_codec ? [t.video_codec] : []))),
        buildOne('audio_codec', 'torbox_filter_audio_codec', state.all_torrents.map((t) => t.audio_codecs || [])),
        buildOne('tracker', 'torbox_filter_tracker', state.all_torrents.map((t) => t.trackers || [])),
        { title: translate('torbox_filter_reset'), reset: true },
        { title: translate('torbox_filter_refresh'), refresh: true },
      ];

      filter.set('filter', baseItems);
      filter.render().find('.filter--filter span').text(translate('torbox_filter_title'));
      filter.render().find('.filter--search input').attr('placeholder', state.search_query || object.movie.title);

      const chosen = baseItems
        .filter((f) => f.stype && state.filters[f.stype] !== 'all')
        .map((f) => `${f.title}: ${state.filters[f.stype]}`);
      filter.chosen('filter', chosen);

      const sorts = sortVariants.map((s) => ({
        key: s.key,
        title: translate(s.labelKey),
        field: s.field,
        reverse: s.reverse,
        selected: s.key === state.sort,
      }));
      filter.set('sort', sorts);
      filter.render().find('.filter--sort span').text(translate('torbox_sort_title'));
    };

    const search = (force = false, customTitle = null) => {
      cancelActiveTorrentFlow();
      abort.abort();
      abort = new AbortController();
      const signal = abort.signal;

      this.activity.loader(true);
      reset();
      state.search_query = customTitle;

      const movieForSearch = customTitle
        ? { ...object.movie, title: customTitle, original_title: customTitle, year: '' }
        : object.movie;

      const cacheKey = generateKeyForMovie(customTitle);
      const cached = !force && Cache.get(cacheKey);
      if (cached) {
        state.all_torrents = cached;
        LOG('Loaded from RAM cache:', state.all_torrents.length);
        build();
        this.activity.loader(false);
        return;
      }

      empty(
        customTitle
          ? translateWithParams('torbox_search_custom', { query: customTitle })
          : translate('torbox_search_fetching')
      );

      Api.searchPublicTrackers(movieForSearch, signal)
        .then((rawList) => {
          if (signal.aborted) return;
          if (!Array.isArray(rawList) || !rawList.length) {
            return empty(translate('torbox_search_parser_empty'));
          }

          // Normalize items with valid BTIH hex, dedup by hash
          const mapByHash = new Map();
          rawList.forEach((r) => {
            const hex = Utils.btihFromMagnetOrFields(r);
            if (!hex) return; // skip invalid
            if (!mapByHash.has(hex)) mapByHash.set(hex, r);
          });

          if (!mapByHash.size) {
            ErrorHandler.show('validation', {
              message: translate('torbox_search_no_valid_hashes'),
            });
            return empty(translate('torbox_search_no_valid_results'));
          }

          const hashes = Array.from(mapByHash.keys());
          empty(translateWithParams('torbox_check_cache_progress', { count: hashes.length }));

          return Api.checkCached(hashes, signal).then((cachedMap) => ({ mapByHash, cachedMap }));
        })
        .then((payload) => {
          if (!payload || signal.aborted) return;

          const cachedEntries = Object.entries(payload.cachedMap || {});
          const cachedSet = new Set(
            cachedEntries
              .filter(([, flag]) => isCachedFlagTrue(flag))
              .map(([h]) => h.toLowerCase())
          );
          const list = [];

          payload.mapByHash.forEach((raw, hex) => {
            list.push(toViewItem(raw, hex, cachedSet));
          });

          Cache.set(cacheKey, list);
          state.all_torrents = list;
          build();
        })
        .catch((err) => {
          if (!signal.aborted) {
            empty(err?.message || translate('torbox_generic_error'));
            ErrorHandler.show(err?.type || 'error', err);
          }
        })
        .finally(() => {
          this.activity.loader(false);
        });
    };

    // ───────────────────────────── Lifecycle & Controller ─────────────────────────────
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

    this.initialize = function () {
      Lampa.Controller.add('content', {
        toggle: () => {
          Lampa.Controller.collectionSet(filter.render(), scroll.render());
          Lampa.Controller.collectionFocus(lastFocused || false, scroll.render());
        },
        up: () => {
          if (Navigator.canmove('up')) {
            Navigator.move('up');
          } else {
            const continueItem = scroll.render().find('.torbox-watched-item.selector').first();
            if (continueItem.length && !continueItem.hasClass('focus')) {
              lastFocused = continueItem[0];
              Lampa.Controller.collectionFocus(continueItem[0], scroll.render());
            } else {
              Lampa.Controller.toggle('head');
            }
          }
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
        back: this.back.bind(this),
      });

      Lampa.Controller.toggle('content');

      // Filter events
      filter.onSelect = (type, a, b) => {
        Lampa.Select.close();
        if (type === 'sort') {
          state.sort = a.key;
          Store.set('torbox_sort_method', a.key);
        } else if (type === 'filter') {
          if (a.refine) {
            const combos = generateSearchCombinations(object.movie);
            if (!combos.length) {
              Lampa.Noty.show(translate('torbox_refine_not_enough_data'));
              return Lampa.Controller.toggle('content');
            }
            Lampa.Select.show({
              title: translate('torbox_refine_title'),
              items: combos.map((c) => ({ title: c, search_query: c })),
              onSelect: (sel) => {
                search(true, sel.search_query);
                Lampa.Controller.toggle('content');
              },
              onBack: () => Lampa.Controller.toggle('content'),
            });
            return;
          }
          if (a.refresh) return search(true);
          if (a.reset) state.filters = JSON.parse(JSON.stringify(defaultFilters));
          else if (a.stype) state.filters[a.stype] = b.value;
          Store.set('torbox_filters_v2', JSON.stringify(state.filters));
        }
        state.last_hash = null; // reset focus
        build();
        Lampa.Controller.toggle('content');
      };
      filter.onBack = () => this.start();
      filter.onSearch = (v) => search(true, v);
      if (filter.addButtonBack) filter.addButtonBack();

      // Cached-only toggle button
      const toggleMarkup = `
        <span class="torbox-cached-toggle__icon">☁️</span>
        <span class="torbox-cached-toggle__label"></span>
      `;
      cachedToggleBtn = $(`<div class="filter__item selector torbox-cached-toggle" role="button" aria-pressed="false">${toggleMarkup}</div>`);
      cachedToggleBtn.on('hover:enter', () => {
        state.show_only_cached = !state.show_only_cached;
        Store.set('torbox_show_only_cached', state.show_only_cached ? '1' : '0');
        build();
        cachedToggleBtn.removeClass('focus');
        focusFirstListItem();
      });
      filter.render().find('.filter--sort').before(cachedToggleBtn);
      updateCachedToggleVisual();

      empty(translate('torbox_loading_initial'));
      search();
    };

    this.start = function () {
      if (Lampa.Activity.active().activity !== this.activity) return;
      Lampa.Background.immediately(Lampa.Utils.cardImgBackgroundBlur(object.movie));
      if (!initialized) {
        initialized = true;
        this.initialize();
      } else {
        build();
        Lampa.Controller.toggle('content');
      }
    };

    this.back = function () {
      if (state.view === 'episodes') {
        state.view = 'torrents';
        filter.render().show();
        build();
      } else {
        cancelActiveTorrentFlow();
        abort.abort();
        Lampa.Activity.backward();
      }
    };

    this.destroy = function () {
      cancelActiveTorrentFlow();
      abort.abort();
      Lampa.Controller.clear('content');
      try {
        if (scroll) scroll.destroy();
        if (files) files.destroy();
        if (filter) filter.destroy();
      } catch {}
      scroll = files = filter = lastFocused = null;
    };

    this.pause = function () {};
    this.stop = function () {};

    function updateCachedToggleVisual() {
      if (!cachedToggleBtn) return;
      const on = state.show_only_cached;
      const iconEl = cachedToggleBtn.find('.torbox-cached-toggle__icon');
      const labelEl = cachedToggleBtn.find('.torbox-cached-toggle__label');
      const icon = on ? '⚡' : '☁️';
      const labelKey = on ? 'torbox_cached_toggle_cached' : 'torbox_cached_toggle_all';
      const hintKey = on ? 'torbox_cached_toggle_hint_cached' : 'torbox_cached_toggle_hint_all';
      const labelText = translate(labelKey);
      const hintText = translate(hintKey);

      iconEl.text(icon);
      labelEl.text(labelText);
      cachedToggleBtn
        .toggleClass('filter__item--active', on)
        .attr('title', hintText)
        .attr('aria-label', hintText)
        .attr('aria-pressed', String(on));
    }
  }

  // ───────────────────────────── Integration with Lampa ─────────────────────────────
  (function integrate() {
    let fullListener = null;

    const manifest = {
      type: 'video',
      version: VERSION,
      name: 'TorBox',
      description: translate('torbox_manifest_description'),
      component: 'torbox_main',
    };

    // i18n
    Lampa.Lang.add({
      torbox_watch: { ru: 'Смотреть через TorBox', en: 'Watch via TorBox', uk: 'Дивитися через TorBox' },
      title_torbox: { ru: 'TorBox', uk: 'TorBox', en: 'TorBox' },
      torbox_cached_toggle_all: { ru: 'Все торренты', en: 'All torrents', uk: 'Усі торренти' },
      torbox_cached_toggle_cached: { ru: 'Только кешированные', en: 'Cached only', uk: 'Лише кешовані' },
      torbox_cached_toggle_hint_all: { ru: 'Показаны все торренты', en: 'Showing all torrents', uk: 'Показано всі торренти' },
      torbox_cached_toggle_hint_cached: { ru: 'Показаны только кешированные', en: 'Showing cached torrents only', uk: 'Показано лише кешовані торренти' },
      torbox_time_infinite: { ru: '∞', en: '∞', uk: '∞' },
      torbox_time_hours_short: { ru: '{value}ч', en: '{value}h', uk: '{value}год' },
      torbox_time_minutes_short: { ru: '{value}м', en: '{value}m', uk: '{value}хв' },
      torbox_time_seconds_short: { ru: '{value}с', en: '{value}s', uk: '{value}с' },
      torbox_not_available: { ru: 'н/д', en: 'n/a', uk: 'н/д' },
      torbox_error_cors_missing: {
        ru: 'CORS‑прокси не задан. Укажите URL в настройках TorBox.',
        en: 'CORS proxy is not set. Specify the URL in TorBox settings.',
        uk: 'CORS-проксі не задано. Вкажіть URL у налаштуваннях TorBox.',
      },
      torbox_error_api_key_missing: {
        ru: 'API‑ключ TorBox не задан. Введите ключ в настройках TorBox.',
        en: 'TorBox API key is missing. Enter it in TorBox settings.',
        uk: 'API-ключ TorBox не задано. Введіть його в налаштуваннях TorBox.',
      },
      torbox_error_401: {
        ru: '401 – неверный API‑ключ',
        en: '401 – invalid API key',
        uk: '401 – некоректний API-ключ',
      },
      torbox_error_403: {
        ru: '403 – доступ запрещён, проверьте права ключа',
        en: '403 – access denied, check key permissions',
        uk: '403 – доступ заборонено, перевірте права ключа',
      },
      torbox_error_404: {
        ru: '404 – ресурс не найден',
        en: '404 – resource not found',
        uk: '404 – ресурс не знайдено',
      },
      torbox_error_429: {
        ru: '429 – слишком много запросов, попробуйте позже',
        en: '429 – too many requests, try again later',
        uk: '429 – забагато запитів, спробуйте пізніше',
      },
      torbox_error_server: {
        ru: 'Ошибка сервера ({status})',
        en: 'Server error ({status})',
        uk: 'Помилка сервера ({status})',
      },
      torbox_error_request: {
        ru: 'Ошибка запроса ({status})',
        en: 'Request error ({status})',
        uk: 'Помилка запиту ({status})',
      },
      torbox_error_bad_json: {
        ru: 'Некорректный JSON в ответе',
        en: 'Invalid JSON in response',
        uk: 'Некоректний JSON у відповіді',
      },
      torbox_error_api: {
        ru: 'Неизвестная ошибка API',
        en: 'Unknown API error',
        uk: 'Невідома помилка API',
      },
      torbox_error_no_torrent_id: {
        ru: 'ID торрента не получен',
        en: 'Torrent ID was not received',
        uk: 'ID торренту не отримано',
      },
      torbox_error_timeout: {
        ru: 'Таймаут запроса ({seconds} сек)',
        en: 'Request timeout ({seconds} s)',
        uk: 'Тайм-аут запиту ({seconds} с)',
      },
      torbox_error_network: {
        ru: 'Сетевая ошибка',
        en: 'Network error',
        uk: 'Мережева помилка',
      },
      torbox_error_public_parsers_empty: {
        ru: 'Публичные парсеры недоступны или вернули пустой список',
        en: 'Public parsers unavailable or returned no results',
        uk: 'Публічні парсери недоступні або повернули порожній список',
      },
      torbox_error_unknown: {
        ru: 'Неизвестная ошибка',
        en: 'Unknown error',
        uk: 'Невідома помилка',
      },
      torbox_error_prefix_auth: { ru: 'Авторизация', en: 'Auth', uk: 'Авторизація' },
      torbox_error_prefix_validation: { ru: 'Проверка настроек', en: 'Validation', uk: 'Перевірка налаштувань' },
      torbox_error_prefix_network: { ru: 'Сеть', en: 'Network', uk: 'Мережа' },
      torbox_error_prefix_api: { ru: 'TorBox', en: 'TorBox', uk: 'TorBox' },
      torbox_error_prefix_generic: { ru: 'Ошибка', en: 'Error', uk: 'Помилка' },
      torbox_no_title: { ru: 'Без названия', en: 'Untitled', uk: 'Без назви' },
      torbox_info_trackers: { ru: 'Трекеры', en: 'Trackers', uk: 'Трекери' },
      torbox_info_added: { ru: 'Добавлено', en: 'Added', uk: 'Додано' },
      torbox_error_no_video_files: {
        ru: 'Видеофайлы не найдены',
        en: 'Video files not found',
        uk: 'Відеофайли не знайдені',
      },
      torbox_error_file_link: {
        ru: 'Не удалось получить ссылку на файл',
        en: 'Failed to obtain file link',
        uk: 'Не вдалося отримати посилання на файл',
      },
      torbox_last_torrent_fallback: {
        ru: 'Последний просмотренный торрент',
        en: 'Last viewed torrent',
        uk: 'Останній переглянутий торрент',
      },
      torbox_continue_watching: { ru: 'Продолжить просмотр', en: 'Continue watching', uk: 'Продовжити перегляд' },
      torbox_continue_info_template: {
        ru: '{icon} {title} • {size} • 🟢 {seeders}',
        en: '{icon} {title} • {size} • 🟢 {seeders}',
        uk: '{icon} {title} • {size} • 🟢 {seeders}',
      },
      torbox_error_aborted: {
        ru: 'Отменено пользователем',
        en: 'Cancelled by user',
        uk: 'Скасовано користувачем',
      },
      torbox_error_torrent_timeout: {
        ru: 'Торрент не найден в TorBox (таймаут)',
        en: 'Torrent not found in TorBox (timeout)',
        uk: 'Торрент не знайдено в TorBox (тайм-аут)',
      },
      torbox_loading_progress: {
        ru: 'Загрузка: {progress}% | {speed} | 👤 {seeds}/{peers} | ⏳ {eta}',
        en: 'Loading: {progress}% | {speed} | 👤 {seeds}/{peers} | ⏳ {eta}',
        uk: 'Завантаження: {progress}% | {speed} | 👤 {seeds}/{peers} | ⏳ {eta}',
      },
      torbox_error_no_magnet: {
        ru: 'Magnet‑ссылка не найдена',
        en: 'Magnet link not found',
        uk: 'Magnet-посилання не знайдено',
      },
      torbox_error_bad_hash: {
        ru: 'Некорректный BTIH‑хеш',
        en: 'Invalid BTIH hash',
        uk: 'Некоректний BTIH-хеш',
      },
      torbox_loading_connect: {
        ru: 'TorBox: Подключение...',
        en: 'TorBox: Connecting...',
        uk: 'TorBox: Підключення...',
      },
      torbox_loading_add: {
        ru: 'TorBox: Добавление магнета...',
        en: 'TorBox: Adding magnet...',
        uk: 'TorBox: Додавання магнету...',
      },
      torbox_loading_wait: {
        ru: 'TorBox: Ожидание загрузки...',
        en: 'TorBox: Waiting for download...',
        uk: 'TorBox: Очікування завантаження...',
      },
      torbox_empty_filters: {
        ru: 'Ничего не найдено по заданным фильтрам',
        en: 'No results for the selected filters',
        uk: 'Нічого не знайдено за вибраними фільтрами',
      },
      torbox_actions_title: { ru: 'Действия', en: 'Actions', uk: 'Дії' },
      torbox_actions_copy_magnet: { ru: 'Скопировать Magnet', en: 'Copy magnet link', uk: 'Скопіювати Magnet' },
      torbox_actions_copied: {
        ru: 'Magnet‑ссылка скопирована',
        en: 'Magnet link copied',
        uk: 'Magnet-посилання скопійовано',
      },
      torbox_empty_list: { ru: 'Торренты не найдены', en: 'No torrents found', uk: 'Торренти не знайдені' },
      torbox_no_results_prompt: {
        ru: 'Нет результатов. Измените фильтры или уточните запрос.',
        en: 'No results. Adjust filters or refine the search.',
        uk: 'Немає результатів. Змініть фільтри або уточніть запит.',
      },
      torbox_filter_all: { ru: 'Все', en: 'All', uk: 'Усі' },
      torbox_filter_refine: { ru: 'Уточнить поиск', en: 'Refine search', uk: 'Уточнити пошук' },
      torbox_filter_quality: { ru: 'Качество', en: 'Quality', uk: 'Якість' },
      torbox_filter_video_type: { ru: 'Тип видео', en: 'Video type', uk: 'Тип відео' },
      torbox_filter_translation: { ru: 'Перевод', en: 'Voiceover', uk: 'Озвучення' },
      torbox_filter_audio_lang: { ru: 'Язык аудио', en: 'Audio language', uk: 'Мова аудіо' },
      torbox_filter_video_codec: { ru: 'Видео кодек', en: 'Video codec', uk: 'Відеокодек' },
      torbox_filter_audio_codec: { ru: 'Аудио кодек', en: 'Audio codec', uk: 'Аудіокодек' },
      torbox_filter_tracker: { ru: 'Трекер', en: 'Tracker', uk: 'Трекер' },
      torbox_filter_reset: { ru: 'Сбросить фильтры', en: 'Reset filters', uk: 'Скинути фільтри' },
      torbox_filter_refresh: { ru: 'Обновить список', en: 'Refresh list', uk: 'Оновити список' },
      torbox_filter_title: { ru: 'Фильтр', en: 'Filter', uk: 'Фільтр' },
      torbox_sort_seeders_desc: { ru: 'По сидам (убыв.)', en: 'Seeders (desc)', uk: 'За сідами (спадання)' },
      torbox_sort_size_desc: { ru: 'По размеру (убыв.)', en: 'Size (desc)', uk: 'За розміром (спадання)' },
      torbox_sort_size_asc: { ru: 'По размеру (возр.)', en: 'Size (asc)', uk: 'За розміром (зростання)' },
      torbox_sort_age: { ru: 'По дате добавления', en: 'Recently added', uk: 'За датою додавання' },
      torbox_sort_title: { ru: 'Сортировка', en: 'Sorting', uk: 'Сортування' },
      torbox_search_custom: { ru: 'Поиск: «{query}»…', en: 'Searching for “{query}”…', uk: 'Пошук: «{query}»…' },
      torbox_search_fetching: { ru: 'Получение списка…', en: 'Fetching list…', uk: 'Отримання списку…' },
      torbox_search_parser_empty: {
        ru: 'Парсер не вернул результатов.',
        en: 'Parser returned no results.',
        uk: 'Парсер не повернув результатів.',
      },
      torbox_search_no_valid_hashes: {
        ru: 'Не найдено валидных BTIH‑хешей (hex/base32).',
        en: 'No valid BTIH hashes found (hex/base32).',
        uk: 'Не знайдено валідних BTIH-хешів (hex/base32).',
      },
      torbox_search_no_valid_results: {
        ru: 'Результаты без валидных BTIH‑хешей.',
        en: 'Results contain no valid BTIH hashes.',
        uk: 'Результати без валідних BTIH-хешів.',
      },
      torbox_check_cache_progress: {
        ru: 'Проверка кэша ({count})…',
        en: 'Checking cache ({count})…',
        uk: 'Перевірка кешу ({count})…',
      },
      torbox_generic_error: { ru: 'Ошибка', en: 'Error', uk: 'Помилка' },
      torbox_refine_not_enough_data: {
        ru: 'Недостаточно данных для уточнения запроса',
        en: 'Not enough data to refine the query',
        uk: 'Недостатньо даних для уточнення запиту',
      },
      torbox_refine_title: { ru: 'Уточнить поиск', en: 'Refine search', uk: 'Уточнити пошук' },
      torbox_loading_initial: { ru: 'Загрузка...', en: 'Loading...', uk: 'Завантаження...' },
      torbox_manifest_description: {
        ru: 'Плагин для просмотра торрентов через TorBox',
        en: 'TorBox plugin for streaming torrents',
        uk: 'Плагін для перегляду торрентів через TorBox',
      },
      torbox_settings_proxy_name: { ru: 'URL CORS‑прокси', en: 'CORS proxy URL', uk: 'URL CORS-проксі' },
      torbox_settings_proxy_desc: {
        ru: 'Введите URL прокси, через который будут идти ВСЕ запросы',
        en: 'Enter the proxy URL that will handle ALL requests',
        uk: 'Введіть URL проксі, через який підуть УСІ запити',
      },
      torbox_settings_api_name: { ru: 'API‑ключ', en: 'API key', uk: 'API-ключ' },
      torbox_settings_api_desc: {
        ru: 'Введите ваш API‑ключ от TorBox',
        en: 'Enter your TorBox API key',
        uk: 'Введіть свій API-ключ TorBox',
      },
      torbox_settings_debug_name: { ru: 'Debug‑режим', en: 'Debug mode', uk: 'Debug-режим' },
      torbox_settings_debug_desc: {
        ru: 'Подробные логи в консоль',
        en: 'Detailed logs in console',
        uk: 'Детальні логи у консолі',
      },
    });

    // Templates used by the component
    function addTemplates() {
      Lampa.Template.add(
        'torbox_item',
        '<div class="torbox-item selector" data-hash="{hash}">' +
          '<div class="torbox-item__title">{last_played_icon}{icon} {title}</div>' +
          '<div class="torbox-item__main-info">{info_formated}</div>' +
          '<div class="torbox-item__meta">{meta_formated}</div>' +
          '{tech_bar_html}' +
        '</div>'
      );
      Lampa.Template.add('torbox_empty', '<div class="empty"><div class="empty__text">{message}</div></div>');
      Lampa.Template.add(
        'torbox_watched_item',
        '<div class="torbox-watched-item selector">' +
          '<div class="torbox-watched-item__icon"><svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5V7.5l5.25 3.5L11 16.5z" fill="currentColor"></path></svg></div>' +
          '<div class="torbox-watched-item__body">' +
            '<div class="torbox-watched-item__title">{title}</div>' +
            '<div class="torbox-watched-item__info">{info}</div>' +
          '</div>' +
        '</div>'
      );
      Lampa.Template.add(
        'torbox_episode_item',
        '<div class="torbox-file-item selector" data-file-id="{file_id}">' +
          '<div class="torbox-file-item__title">{title}</div>' +
          '<div class="torbox-file-item__subtitle">{size}</div>' +
        '</div>'
      );
    }

    // Settings (keeps original keys and public surface)
    function addSettings() {
      if (!Lampa.SettingsApi) return;
      Lampa.SettingsApi.addComponent({ component: 'torbox_enh', name: 'TorBox', icon: ICON });

      const params = [
        {
          key: 'torbox_proxy_url',
          name: translate('torbox_settings_proxy_name'),
          desc: translate('torbox_settings_proxy_desc'),
          type: 'input',
          get: () => Config.proxyUrl,
          set: (v) => (Config.proxyUrl = String(v || '').trim()),
        },
        {
          key: 'torbox_api_key',
          name: translate('torbox_settings_api_name'),
          desc: translate('torbox_settings_api_desc'),
          type: 'input',
          get: () => Config.apiKey,
          set: (v) => (Config.apiKey = String(v || '').trim()),
          mask: true,
        },
        {
          key: 'torbox_debug',
          name: translate('torbox_settings_debug_name'),
          desc: translate('torbox_settings_debug_desc'),
          type: 'trigger',
          get: () => Config.debug,
          set: (v) => (Config.debug = !!v),
        },
      ];

      params.forEach((p) => {
        Lampa.SettingsApi.addParam({
          component: 'torbox_enh',
          param: { name: p.key, type: p.type, values: '', default: p.get() },
          field: { name: p.name, description: p.desc },
          onChange: (v) => p.set(typeof v === 'object' ? v.value : v),
          onRender: (field) => {
            if (p.mask) field.find('input').attr('type', 'password');
          },
        });
      });
    }

    function boot() {
      Lampa.Component.add('torbox_main', MainComponent);
      addTemplates();
      addSettings();

      if (fullListener) Lampa.Listener.remove('full', fullListener);
      fullListener = (e) => {
        if (e.type !== 'complite' || !e.data?.movie) return;
        const root = e.object?.activity?.render?.();
        if (!root?.length || root.find('.view--torbox').length) return;

        const btn = $(
          `<div class="full-start__button selector view--torbox" data-subtitle="TorBox">${ICON}<span>TorBox</span></div>`
        );
        btn.on('hover:enter', () =>
          Lampa.Activity.push({
            component: 'torbox_main',
            title: `${Lampa.Lang.translate('title_torbox')} - ${e.data.movie.title || e.data.movie.name || ''}`,
            movie: e.data.movie,
          })
        );

        const torrentBtn = root.find('.view--torrent');
        torrentBtn.length ? torrentBtn.after(btn) : root.find('.full-start__play').after(btn);
      };
      Lampa.Listener.follow('full', fullListener);

      // Scoped styles (inject once)
      if (!document.getElementById('torbox-stable-styles')) {
        const css = document.createElement('style');
        css.id = 'torbox-stable-styles';
        css.textContent = `
          .torbox-list-container { display:block; padding:1em; }
          .torbox-item { position:relative; padding:1em 1.2em; margin:0 0 1em 0; border-radius:.8em; background: var(--color-background-light); cursor:pointer; transition:.25s; border:2px solid transparent; overflow:hidden; }
          .torbox-item:last-child { margin-bottom:0; }
          .torbox-item:hover, .torbox-item.focus,
          .torbox-watched-item:hover, .torbox-watched-item.focus,
          .torbox-file-item:hover, .torbox-file-item.focus {
            background:var(--color-primary); color:var(--color-background); transform:translateY(-1px); border-color:rgba(255,255,255,.28);
            box-shadow:0 6px 24px rgba(0,0,0,.18);
          }
          .torbox-item__title { font-weight:600; margin-bottom:.35em; font-size:1.05em; line-height:1.35; display:flex; align-items:center; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
          .torbox-item__last-played-icon { display:inline-flex; width:1.1em; height:1.1em; margin-right:.5em; color:var(--color-second); }
          .torbox-item__last-played-icon svg{ width:100%; height:100%; }
          .torbox-item__main-info { font-size:.95em; opacity:.95; line-height:1.4; margin-bottom:.25em; }
          .torbox-item__meta { font-size:.88em; opacity:.75; line-height:1.4; margin-bottom:.7em; }
          .torbox-item__progress { position:absolute; left:0; right:0; bottom:0; height:3px; background:rgba(255,255,255,.22); }
          .torbox-item__progress > div { height:100%; background:var(--color-primary); }
          .torbox-item__tech-bar { display:flex; flex-wrap:wrap; gap:.55em; margin:0 -1.2em -1em; padding:.6em 1.2em; background:rgba(0,0,0,.08); font-size:.84em; font-weight:500; transition:background .2s; }
          .torbox-item__tech-item { padding:.22em .55em; border-radius:.4em; color:#fff; }
          .torbox-item__tech-item--res { background:#3b82f6; }
          .torbox-item__tech-item--codec { background:#16a34a; }
          .torbox-item__tech-item--audio { background:#f97316; }
          .torbox-item__tech-item--hdr { background:linear-gradient(45deg,#ff8c00,#ffa500); }
          .torbox-item__tech-item--dv  { background:linear-gradient(45deg,#4b0082,#8a2be2); }
          .torbox-cached-toggle { display:inline-flex; align-items:center; justify-content:center; border:2px solid transparent; transition:.2s; gap:.5em; padding:0 .8em; min-height:2.5em; }
          .torbox-cached-toggle__icon { font-size:1.5em; line-height:1; }
          .torbox-cached-toggle__label { font-size:.85em; font-weight:500; white-space:nowrap; }
          .torbox-cached-toggle.filter__item--active, .torbox-cached-toggle.focus, .torbox-cached-toggle:hover {
            background:var(--color-primary); color:var(--color-background); border-color:rgba(255,255,255,.28);
          }
          .torbox-file-item { display:flex; justify-content:space-between; align-items:center; padding:1em 1.2em; margin-bottom:1em; border-radius:.8em; background:var(--color-background-light); transition:.25s; border:2px solid transparent; }
          .torbox-file-item__title { font-weight:600; }
          .torbox-file-item__subtitle { font-size:.9em; opacity:.75; }
          .torbox-file-item--last-played { border-left:4px solid var(--color-second); }
          .torbox-file-item--watched { color:#8a8a8a; }
          .torbox-watched-item { display:flex; align-items:center; padding:1em; margin-bottom:1em; border-radius:.8em; background:var(--color-background-light); border-left:4px solid var(--color-second); transition:.25s; border:2px solid transparent; }
          .torbox-watched-item__icon { flex-shrink:0; margin-right:1em; }
          .torbox-watched-item__icon svg{ width:2em; height:2em; }
          .torbox-watched-item__title { font-weight:600; }
          .torbox-watched-item__info { font-size:.9em; opacity:.75; }
        `;
        document.head.appendChild(css);
      }

      Lampa.Manifest.plugins[manifest.name] = manifest;
      LOG('TorBox plugin ready', manifest.version);
    }

    if (window.Lampa?.Activity) {
      boot();
    } else {
      const bootOnce = Lampa.Listener.follow('app', (e) => {
        if (e.type === 'ready') {
          boot();
          Lampa.Listener.remove('app', bootOnce);
        }
      });
    }
  })();
})();
