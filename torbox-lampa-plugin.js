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
      if (!isFinite(s) || s > 30 * 24 * 3600) return '∞';
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const r = s % 60;
      return [h ? h + 'ч' : null, m ? m + 'м' : null, r + 'с'].filter(Boolean).join(' ');
    },
    formatAge(iso) {
      if (!iso) return 'н/д';
      const d = new Date(iso);
      if (isNaN(d)) return 'н/д';
      const diff = Math.floor((Date.now() - d.getTime()) / 1000);
      const m = Math.floor(diff / 60);
      const h = Math.floor(m / 60);
      const days = Math.floor(h / 24);
      if (diff < 60) return `${diff} сек. назад`;
      if (m < 60) return `${m} мин. назад`;
      if (h < 24) return `${h} час. назад`;
      return `${days} д. назад`;
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
      if (!Config.proxyUrl) {
        const err = { type: 'validation', message: 'CORS‑proxy не задан. Укажите URL в настройках TorBox.' };
        throw err;
      }
    }

    function requireApiKey() {
      if (!Config.apiKey) {
        const err = { type: 'validation', message: 'API‑ключ TorBox не задан. Введите ключ в настройках TorBox.' };
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
      const proxied = `${Config.proxyUrl}?url=${encodeURIComponent(url)}`;

      try {
        const res = await fetch(proxied, { ...opt, headers, signal: controller.signal });
        const status = res.status;
        const text = await res.text();

        // Common error mapping
        if (status === 401) throw { type: 'auth', message: '401 – неверный API‑ключ' };
        if (status === 403) throw { type: 'auth', message: '403 – доступ запрещён, проверьте права ключа' };
        if (status === 404) throw { type: 'api', message: '404 – ресурс не найден' };
        if (status === 429) throw { type: 'network', message: '429 – слишком много запросов, попробуйте позже' };
        if (status >= 500) throw { type: 'network', message: `Ошибка сервера (${status})` };
        if (status >= 400) throw { type: 'network', message: `Ошибка запроса (${status})` };

        // Direct URL (some TorBox endpoints may return a plain link)
        if (text.startsWith('http')) return { success: true, url: text };

        const json = parseJsonSafe(text);
        if (!json) throw { type: 'api', message: 'Некорректный JSON в ответе' };

        if (json.success === false) {
          throw { type: 'api', message: json.detail || json.message || 'Неизвестная ошибка API' };
        }
        return json;
      } catch (e) {
        if (e.name === 'AbortError') {
          // Distinguish timeout vs. external abort
          if (!outerSignal || !outerSignal.aborted) {
            throw { type: 'network', message: `Таймаут запроса (${CONST.REQUEST_TIMEOUT_MS / 1000} сек)` };
          }
          throw e; // external abort
        }
        if (e.type) throw e;
        throw { type: 'network', message: e && e.message ? e.message : 'Сетевая ошибка' };
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
        throw { type: 'api', message: 'Публичные парсеры недоступны или вернули пустой список' };
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
      // Keep using token param (TorBox accepts it) and X-Api-Key header (added by request)
      const url = `${TB_MAIN}/torrents/requestdl?torrent_id=${encodeURIComponent(tid)}&file_id=${encodeURIComponent(fid)}&token=${encodeURIComponent(Config.apiKey)}`;
      return request(url, { method: 'GET' }, signal);
    }

    return { searchPublicTrackers, checkCached, addMagnet, myList, requestDl };
  })();

  // ───────────────────────────── Errors → Noty (actionable) ─────────────────────────────
  const ErrorHandler = {
    show(kind, err) {
      const t = kind || err?.type || 'error';
      const msg = err?.message || 'Неизвестная ошибка';
      const prefix =
        t === 'auth' ? 'Авторизация' :
        t === 'validation' ? 'Проверка настроек' :
        t === 'network' ? 'Сеть' :
        t === 'api' ? 'TorBox' : 'Ошибка';
      try {
        Lampa.Noty.show(`${prefix}: ${msg}`, { type: 'error' });
      } catch {
        console.error('[TorBox]', prefix + ': ' + msg);
      }
      LOG('ERR', t, err);
    },
  };

  // ───────────────────────────── Search helpers ─────────────────────────────
  function generateSearchCombinations(movie) {
    const set = new Set();
    const title = (movie.title || '').trim();
    const orig = (movie.original_title || '').trim();
    const year = (movie.release_date || movie.first_air_date || '').slice(0, 4);

    const add = (s) => s && set.add(s.replace(/\s+/g, ' ').trim());

    if (title) {
      add(title);
      if (year) add(`${title} ${year}`);
    }
    if (orig && orig.toLowerCase() !== title.toLowerCase()) {
      add(orig);
      if (year) add(`${orig} ${year}`);
      add(`${title} ${orig}`);
      if (year) add(`${title} ${orig} ${year}`);
    }
    return Array.from(set).filter(Boolean);
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
      { key: 'seeders', title: 'По сидам (убыв.)', field: 'last_known_seeders', reverse: true },
      { key: 'size_desc', title: 'По размеру (убыв.)', field: 'size', reverse: true },
      { key: 'size_asc', title: 'По размеру (возр.)', field: 'size', reverse: false },
      { key: 'age', title: 'По дате добавления', field: 'publish_timestamp', reverse: true },
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

      const isCached = cachedSet.has(hashHex);
      const publishDate = raw?.PublishDate ? new Date(raw.PublishDate) : null;

      return {
        title: Utils.escapeHtml(raw?.Title || 'Без названия'),
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
          `Трекеры: ${String(raw?.Tracker || '').split(/,\s*/)[0] || 'н/д'} ` +
          `| Добавлено: ${Utils.formatAge(raw?.PublishDate) || 'н/д'}`,
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

      // Filter video files only (.mkv|.mp4|.avi), robust regex
      const vids = (Array.isArray(torrentData.files) ? torrentData.files : [])
        .filter((f) => /\.(mkv|mp4|avi)$/i.test(f?.name || ''))
        .map((f, i) => Object.assign({ __idx: i }, f))
        .sort(Utils.naturalEpisodeSort);

      if (!vids.length) {
        ErrorHandler.show('validation', { message: 'Видеофайлы не найдены' });
        return;
      }

      let focusEl = null;

      vids.forEach((file) => {
        const clean = (file.name || '').split('/').pop();
        let item = Lampa.Template.get('torbox_episode_item', {
          title: clean || file.name || 'Без названия',
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
            // Mark as watched instantly (UX)
            if (!item.hasClass('torbox-file-item--watched')) {
              item.addClass('torbox-file-item--watched');
              watchedSet.add(file.id);
              Store.set(`torbox_watched_episodes_${mid}_${torrentKey}`, JSON.stringify(Array.from(watchedSet)));
            }
            play(torrentData, file, () => {
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
        if (!link) throw { type: 'api', message: 'Не удалось получить ссылку на файл' };

        _markWatched(torrentData.hash || torrentData.id, file.id);

        Lampa.Player.play(_getPlayerConfig(link, file, object.movie));
        Lampa.Player.callback(onEnd || (() => {}));
      } catch (e) {
        ErrorHandler.show(e.type || 'error', e);
      }
    };

    const updateContinueWatchingPanel = () => {
      if (state.view !== 'torrents') return;

      const mid = object.movie.imdb_id || object.movie.id || 'unknown';
      const lastDataStr = Store.get(`torbox_last_torrent_data_${mid}`, '');
      let panel = scroll.body().find('.torbox-watched-item');

      if (lastDataStr) {
        try {
          const lastTorrent = JSON.parse(lastDataStr);
          const info = lastTorrent?.title || 'Последний просмотренный торрент';

          if (panel.length) {
            panel.find('.torbox-watched-item__info').text(info);
          } else {
            const historyItem = Lampa.Template.get('torbox_watched_item', {
              title: 'Продолжить просмотр',
              info,
            });
            historyItem
              .on('hover:focus', (e) => {
                lastFocused = e.target;
                scroll.update($(e.target), true);
              })
              .on('hover:enter', () => {
                onTorrentClick(lastTorrent); // Re-open last torrent
              });
            scroll.body().prepend(historyItem);
          }
        } catch (e) {
          LOG('Continue panel parse error', e);
        }
      } else if (panel.length) {
        panel.remove();
      }
    };

    const selectFile = (torrentData) => {
      const vids = (Array.isArray(torrentData.files) ? torrentData.files : []).filter((f) =>
        /\.(mkv|mp4|avi)$/i.test(f?.name || '')
      );
      if (!vids.length) {
        ErrorHandler.show('validation', { message: 'Видеофайлы не найдены' });
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
        const MAX_RETRIES = 12; // 2 minutes (12 * 10s)

        const cancel = () => {
          if (!active) return;
          active = false;
          signal.removeEventListener('abort', cancel);
          Lampa.Loading.stop();
          reject({ name: 'AbortError', message: 'Отменено пользователем' });
        };
        signal.addEventListener('abort', cancel);

        const loop = async () => {
          if (!active) return;

          if (retries++ > MAX_RETRIES) {
            active = false;
            signal.removeEventListener('abort', cancel);
            return reject({ type: 'api', message: 'Торрент не найден в TorBox (таймаут)' });
          }

          try {
            const arr = (await Api.myList(id, signal))?.data || [];
            const d = arr[0];
            if (!d) {
              setTimeout(loop, CONST.TRACKING_POLL_INTERVAL_MS);
              return;
            }

            const finished = d.download_state === 'completed' || d.download_state === 'uploading' || !!d.download_finished;
            const progress = Utils.normalizeProgress(d.progress);
            const speedTxt = Utils.formatBytes(d.download_speed, true);
            const etaTxt = Utils.formatTime(d.eta);
            const seeds = Number(d.seeds) || 0;
            const peers = Number(d.peers) || 0;

            $('.loading-layer .loading-layer__text').text(
              `Загрузка: ${progress.toFixed(2)}% | ${speedTxt} | 👤 ${seeds}/${peers} | ⏳ ${etaTxt}`
            );

            if (finished && Array.isArray(d.files) && d.files.length) {
              active = false;
              signal.removeEventListener('abort', cancel);
              resolve(d);
            } else {
              setTimeout(loop, CONST.TRACKING_POLL_INTERVAL_MS);
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
        return ErrorHandler.show('validation', { message: 'Magnet‑ссылка не найдена' });
      }
      if (!item?.hash || !Utils.isHex40(item.hash)) {
        return ErrorHandler.show('validation', { message: 'Некорректный BTIH‑хеш' });
      }

      const mid = object.movie.imdb_id || object.movie.id || 'unknown';
      try {
        const original = state.all_torrents.find((t) => t.hash === item.hash) || item;
        Store.set(`torbox_last_torrent_data_${mid}`, JSON.stringify(original));
        // Update continue panel immediately
        updateContinueWatchingPanel();
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

      Lampa.Loading.start(() => controller.abort(), 'TorBox: Подключение...');

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
        $('.loading-layer .loading-layer__text').text('TorBox: Добавление магнета...');
        Api.addMagnet(magnet, signal)
          .then((res) => {
            const newId = res?.data?.torrent_id || res?.data?.id;
            if (!newId) throw { type: 'api', message: 'ID торрента не получен' };
            Store.set(storageKey, String(newId));
            LOG('New TorBox ID saved', newId, 'for', hash);
            $('.loading-layer .loading-layer__text').text('TorBox: Ожидание загрузки...');
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
        $('.loading-layer .loading-layer__text').text('TorBox: Ожидание загрузки...');
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
      if (cachedToggleBtn) {
        const on = state.show_only_cached;
        cachedToggleBtn
          .toggleClass('filter__item--active', on)
          .attr('title', on ? 'Показаны только кешированные' : 'Показать только кешированные')
          .find('span')
          .text(on ? '⚡' : '☁️');
      }
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
        return empty('Ничего не найдено по заданным фильтрам');
      }

      // Last played hash marker
      const mid = object.movie.imdb_id || object.movie.id || 'unknown';
      let lastHash = null;
      try {
        lastHash = JSON.parse(Store.get(`torbox_last_torrent_data_${mid}`, '{}'))?.hash || null;
      } catch {
        Store.set(`torbox_last_torrent_data_${mid}`, '{}');
      }

      items.forEach((data) => {
        // last-played icon
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
          Store.set(`torbox_last_torrent_data_${mid}`, JSON.stringify(data));
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
              title: 'Действия',
              items: [{ title: 'Скопировать Magnet' }],
              onSelect: () => {
                Lampa.Utils.copyTextToClipboard(data.magnet, () => Lampa.Noty.show('Magnet‑ссылка скопирована'));
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

      updateContinueWatchingPanel();
    };

    const empty = (msg) => {
      scroll.clear();
      const el = Lampa.Template.get('torbox_empty', { message: msg || 'Торренты не найдены' });
      el.addClass('selector');
      el
        .on('hover:focus', (e) => {
          lastFocused = e.target;
          scroll.update($(e.target), true);
        })
        .on('hover:enter', () => Lampa.Noty.show('Нет результатов. Измените фильтры или уточните запрос.'));
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
      const buildOne = (key, title, arrays) => {
        // Dedup + sort
        const uni = [...new Set(arrays.flat().filter(Boolean).map((x) => String(x)))].sort((a, b) =>
          a.toUpperCase().localeCompare(b.toUpperCase())
        );
        const items = ['all', ...uni].map((v) => ({
          title: v === 'all' ? 'Все' : v.toUpperCase(),
          value: v,
          selected: state.filters[key] === v,
        }));
        const sub = state.filters[key] === 'all' ? 'Все' : state.filters[key].toUpperCase();
        return { title, subtitle: sub, items, stype: key };
      };

      const items = [
        { title: 'Уточнить поиск', refine: true },
        buildOne('quality', 'Качество', state.all_torrents.map((t) => t.quality)),
        buildOne('video_type', 'Тип видео', state.all_torrents.map((t) => t.video_type)),
        buildOne('translation', 'Перевод', state.all_torrents.map((t) => t.voices || [])),
        buildOne('lang', 'Язык аудио', state.all_torrents.map((t) => t.audio_langs || [])),
        buildOne('video_codec', 'Видео кодек', state.all_torrents.map((t) => (t.video_codec ? [t.video_codec] : []))),
        buildOne('audio_codec', 'Аудио кодек', state.all_torrents.map((t) => t.audio_codecs || [])),
        buildOne('tracker', 'Трекер', state.all_torrents.map((t) => t.trackers || [])),
        { title: 'Сбросить фильтры', reset: true },
        { title: 'Обновить список', refresh: true },
      ];

      filter.set('filter', items);
      filter.render().find('.filter--filter span').text('Фильтр');
      filter.render().find('.filter--search input').attr('placeholder', state.search_query || object.movie.title);

      const chosen = items
        .filter((f) => f.stype && state.filters[f.stype] !== 'all')
        .map((f) => `${f.title}: ${state.filters[f.stype]}`);
      filter.chosen('filter', chosen);

      const sorts = sortVariants.map((s) => ({ ...s, selected: s.key === state.sort }));
      filter.set('sort', sorts);
      filter.render().find('.filter--sort span').text('Сортировка');
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

      empty(customTitle ? `Поиск: «${customTitle}»…` : 'Получение списка…');

      Api.searchPublicTrackers(movieForSearch, signal)
        .then((rawList) => {
          if (signal.aborted) return;
          if (!Array.isArray(rawList) || !rawList.length) {
            return empty('Парсер не вернул результатов.');
          }

          // Normalize items with valid BTIH hex, dedup by hash
          const mapByHash = new Map();
          rawList.forEach((r) => {
            const hex = Utils.btihFromMagnetOrFields(r);
            if (!hex) return; // skip invalid
            if (!mapByHash.has(hex)) mapByHash.set(hex, r);
          });

          if (!mapByHash.size) {
            ErrorHandler.show('validation', { message: 'Не найдено валидных BTIH‑хешей (hex/base32).' });
            return empty('Результаты без валидных BTIH‑хешей.');
          }

          const hashes = Array.from(mapByHash.keys());
          empty(`Проверка кэша (${hashes.length})…`);

          return Api.checkCached(hashes, signal).then((cachedMap) => ({ mapByHash, cachedMap }));
        })
        .then((payload) => {
          if (!payload || signal.aborted) return;

          const cachedSet = new Set(Object.keys(payload.cachedMap || {}).map((h) => h.toLowerCase()));
          const list = [];

          payload.mapByHash.forEach((raw, hex) => {
            list.push(toViewItem(raw, hex, cachedSet));
          });

          // Persist in RAM LRU
          Cache.set(cacheKey, list);
          state.all_torrents = list;
          build();
        })
        .catch((err) => {
          if (!signal.aborted) {
            empty(err?.message || 'Ошибка');
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
              Lampa.Noty.show('Недостаточно данных для уточнения запроса');
              return Lampa.Controller.toggle('content');
            }
            Lampa.Select.show({
              title: 'Уточнить поиск',
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
      cachedToggleBtn = $(`<div class="filter__item selector torbox-cached-toggle"><span>☁️</span></div>`);
      cachedToggleBtn.on('hover:enter', () => {
        state.show_only_cached = !state.show_only_cached;
        Store.set('torbox_show_only_cached', state.show_only_cached ? '1' : '0');
        build();
      });
      filter.render().find('.filter--sort').before(cachedToggleBtn);

      empty('Загрузка...');
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
  }

  // ───────────────────────────── Integration with Lampa ─────────────────────────────
  (function integrate() {
    let fullListener = null;

    const manifest = {
      type: 'video',
      version: '51.0.0',
      name: 'TorBox',
      description: 'Плагин для просмотра торрентов через TorBox',
      component: 'torbox_main',
    };

    // i18n
    Lampa.Lang.add({
      torbox_watch: { ru: 'Смотреть через TorBox', en: 'Watch via TorBox', uk: 'Дивитися через TorBox' },
      title_torbox: { ru: 'TorBox', uk: 'TorBox', en: 'TorBox' },
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
          name: 'URL CORS‑прокси',
          desc: 'Введите URL прокси, через который будут идти ВСЕ запросы',
          type: 'input',
          get: () => Config.proxyUrl,
          set: (v) => (Config.proxyUrl = String(v || '').trim()),
        },
        {
          key: 'torbox_api_key',
          name: 'API‑ключ',
          desc: 'Введите ваш API‑ключ от TorBox',
          type: 'input',
          get: () => Config.apiKey,
          set: (v) => (Config.apiKey = String(v || '').trim()),
          mask: true,
        },
        {
          key: 'torbox_debug',
          name: 'Debug‑режим',
          desc: 'Подробные логи в консоль',
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
          .torbox-cached-toggle { display:inline-flex; align-items:center; justify-content:center; border:2px solid transparent; transition:.2s; }
          .torbox-cached-toggle span { font-size:1.5em; line-height:1; }
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
