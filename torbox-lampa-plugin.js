(function () {
  "use strict";

  /**
   * TorBox ↔ Lampa integration plugin – **2025‑06‑24**
   *  • waits until the Lampa core signals `appready`
   *  • registers a new source „TorBox“
   *  • adds settings page & 24 h search‑cache
   *  • streams cached torrents directly, неcached – докачивает и ждёт 100 %
   */

  const PLUGIN_NS = "torbox_lampa_plugin_ready";
  if (window[PLUGIN_NS]) return;            // protect from double‑load
  window[PLUGIN_NS] = true;

  /** ========== Storage keys / Const ========= */
  const S = {
    API_KEY: "torbox_api_key",
    PROXY: "torbox_proxy_url",
    CACHED_ONLY: "torbox_show_cached_only",
  };

  const EP = {
    SEARCH: "https://search-api.torbox.app",
    MAIN: "https://api.torbox.app",
  };

  /* ********** Helper classes ********** */
  class TorBoxHTTP {
    constructor(token, proxy = "") {
      this.token = token;
      this.proxy = proxy.replace(/\/$/, "");
    }
    _headers(extra = {}) {
      return Object.assign({ Authorization: `Bearer ${this.token}` }, extra);
    }
    _wrap(url) { return this.proxy ? `${this.proxy}/${url.replace(/^https?:\/\//, "")}` : url; }
    async json(url, opt = {}) {
      const res = await fetch(this._wrap(url), Object.assign({ headers: this._headers(opt.headers || {}) }, opt));
      if (!res.ok) throw `${res.status} ${res.statusText}`;
      const js = await res.json();
      if (js.success === false) throw js.error || js.detail || "Unknown error";
      return js;
    }
    get(u, h = {}) { return this.json(u, { headers: h }); }
    post(u, body) { return this.json(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
  }

  class TorBoxAPI {
    constructor(token, proxy) { this.http = new TorBoxHTTP(token, proxy); }
    search(q) {
      return this.http.get(`${EP.SEARCH}/torrents/search/${encodeURIComponent(q)}?metadata=1&check_cache=1&check_owned=1`).then(d => d.data.torrents || d.data);
    }
    add(m) { return this.http.post(`${EP.MAIN}/torrents/createtorrent`, { magnet: m }).then(d => d.data.id); }
    info(id) { return this.http.get(`${EP.MAIN}/torrents/mylist?id=${id}`).then(d => d.data); }
    link(id, fid) { return this.http.get(`${EP.MAIN}/torrents/requestdl?id=${id}` + (fid ? `&file_id=${fid}` : "")).then(d => d.data); }
  }

  /* --- 24 h cache --- */
  const SearchCache = (() => {
    const TTL = 86400, mem = new Map();
    const now = () => Math.floor(Date.now() / 1000);
    const key = q => `torbox_cache_${q}`;
    return {
      get(q) {
        if (mem.has(q)) return mem.get(q);
        const raw = Lampa.Storage.get(key(q));
        if (!raw || now() - raw.ts > TTL) return null;
        mem.set(q, raw.data);
        return raw.data;
      },
      set(q, data) { mem.set(q, data); Lampa.Storage.set(key(q), { ts: now(), data }); },
    };
  })();

  /* ********** UI helpers ********** */
  const fmtInfo = t => `${t.cached ? "⚡ " : ""}${(t.size / 2 ** 30).toFixed(2)} GB • S:${t.seeders ?? "?"}`;

  /* ********** Settings page ********** */
  function injectSettings() {
    if (injectSettings.done) return; injectSettings.done = true;
    const mk = (label, placeholder, key, type = "text") => {
      const wrap = $(`<div class="settings-param"></div>`);
      wrap.append(`<div class="settings-param__name">${label}</div>`);
      let inp;
      if (type === "checkbox") {
        inp = $("<input type=checkbox>").prop("checked", !!Lampa.Storage.get(key, false));
        inp.on("change", () => Lampa.Storage.set(key, inp.is(":checked")));
      } else {
        inp = $(`<input type=text placeholder='${placeholder}'>`).val(Lampa.Storage.get(key, ""));
        inp.on("input", () => Lampa.Storage.set(key, inp.val().trim()));
      }
      wrap.append(inp);
      return wrap;
    };

    /* надёжно подключаемся к событию открытия настроек */
    const onOpen = ({ name }) => {
      if (name !== "torbox") return;
      const body = $(".settings-body").empty();
      body.append("<div class=\"settings-param__title\">TorBox</div>")
        .append(mk("API‑ключ", "ey…", S.API_KEY))
        .append(mk("Прокси‑URL (optional)", "https://proxy.example.com", S.PROXY))
        .append(mk("Только ⚡кэшированные", "", S.CACHED_ONLY, "checkbox"));
    };

    if (Lampa.Settings && Lampa.Settings.listener && typeof Lampa.Settings.listener.follow === "function") {
      Lampa.Settings.listener.follow("open", onOpen);
    } else if (Lampa.Settings && typeof Lampa.Settings.on === "function") {
      /* некоторые сборки экспортируют .on() вместо .listener.follow */
      Lampa.Settings.on("open", onOpen);
    } else if (Lampa.Listener && typeof Lampa.Listener.follow === "function") {
      /* fallback на глобальный Listener */
      Lampa.Listener.follow("settings", onOpen);
    }

    /* Добавляем пункт в боковое меню настроек.
       В старых версиях Lampa есть Settings.add(), в новых — Settings.menu() */
    if (Lampa.Settings && typeof Lampa.Settings.add === "function") {
      Lampa.Settings.add({ name: "torbox", title: "TorBox", icon: "fa-cloud-bolt" });
    } else if (Lampa.Settings && typeof Lampa.Settings.menu === "function") {
      /* v2.4.4+ */
      Lampa.Settings.menu().push({ name: "torbox", title: "TorBox", icon: "fa-cloud-bolt" });
    }
  }

  /* ********** Source registration ********** */
  function registerSource() {
    function getAPI() {
      const token = Lampa.Storage.get(S.API_KEY, ""); if (!token) return null;
      const proxy = Lampa.Storage.get(S.PROXY, "");
      if (!registerSource._cache || registerSource._cache.token !== token || registerSource._cache.proxy !== proxy)
        registerSource._cache = { api: new TorBoxAPI(token, proxy), token, proxy };
      return registerSource._cache.api;
    }

    Lampa.Source.add("torbox", {
      name: "TorBox",
      types: ["movie", "tv"],
      icon: "fa-cloud-bolt",

      async search(item, ret) {
        const api = getAPI();
        if (!api) { Lampa.Noty.show("TorBox: укажите API‑ключ в настройках"); ret([], true); return; }
        const q = item.imdb_id ? `imdb:${item.imdb_id}` : `${item.title} ${item.year || ""}`.trim();
        const cached = SearchCache.get(q); if (cached) { ret(cached, true); return; }
        try {
          let res = await api.search(q);
          if (Lampa.Storage.get(S.CACHED_ONLY, false)) res = res.filter(t => t.cached);
          const out = res.map(t => ({
            title: t.raw_title || t.name,
            quality: t.resolution || t.quality || "—",
            info: fmtInfo(t),
            id: t.id, magnet: t.magnet, cached: !!t.cached, owned: !!t.owned, size: t.size,
          }));
          SearchCache.set(q, out); ret(out, true);
        } catch (e) { Lampa.Noty.show("TorBox: " + e); ret([], true); }
      },

      async play(torrent, pickId) {
        const api = getAPI(); if (!api) { Lampa.Noty.show("TorBox: нет API‑ключа"); return; }
        let tid = torrent.owned ? torrent.id : null;
        try { if (!tid) tid = await api.add(torrent.magnet); } catch (e) { Lampa.Noty.show("TorBox: " + e); return; }

        /* wait for cache */
        const poll = async () => {
          try {
            const info = await api.info(tid);
            if (info.progress < 100) { Lampa.Noty.show(`TorBox: кешируется ${info.progress}%…`); setTimeout(poll, 5000); return; }
            const choose = async fid => { try { Lampa.Player.play({ url: await api.link(tid, fid) }); } catch (e) { Lampa.Noty.show("TorBox: " + e); } };
            if (pickId) { choose(pickId); return; }
            if (info.files.length === 1) { choose(info.files[0].id); return; }
            const vids = info.files.filter(f => /\.(mkv|mp4|avi)$/i.test(f.name)).sort((a, b) => b.size - a.size);
            const list = (vids.length ? vids : info.files).map(f => ({ title: f.name, id: f.id, info: `${(f.size / 2 ** 30).toFixed(2)} GB` }));
            Lampa.Select.show({ title: "Выберите файл", items: list, onSelect: s => this.play(torrent, s.id), onBack: () => Lampa.Controller.toggle("content") });
          } catch (e) { Lampa.Noty.show("TorBox: " + e); }
        };
        poll();
      },
    });
  }

  /* ********** Bootstrap when Lampa is ready ********** */
  function init() { injectSettings(); registerSource(); }

  if (window.appready) init();
  else {
    Lampa.Listener.follow("app", e => { if (e.type === "ready") init(); });
  }
})();
