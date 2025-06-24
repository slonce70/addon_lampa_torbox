(function () {
  "use strict";

  /**
   * TorBox ↔ Lampa integration plugin – rebuilt 2025‑06‑24‑b
   * Полная перезапись без лишних хвостов, исправляет синтаксические ошибки.
   */

  const FLAG = "torbox_lampa_plugin_ready";
  if (window[FLAG]) return; window[FLAG] = true;

  /* ========= constants ========= */
  const S = {
    API_KEY: "torbox_api_key",
    PROXY: "torbox_proxy_url",
    CACHED_ONLY: "torbox_show_cached_only",
  };
  const EP = {
    SEARCH: "https://search-api.torbox.app",
    MAIN: "https://api.torbox.app",
  };

  /* ========= helpers ========= */
  class HTTP {
    constructor(token, proxy = "") {
      this.token = token; this.proxy = proxy.replace(/\/$/, "");
    }
    _hdr(add = {}) { return Object.assign({ Authorization: `Bearer ${this.token}` }, add); }
    _url(u) { return this.proxy ? `${this.proxy}/${u.replace(/^https?:\/\//, "")}` : u; }
    async json(url, opt = {}) {
      const res = await fetch(this._url(url), Object.assign({ headers: this._hdr(opt.headers || {}) }, opt));
      if (!res.ok) throw `${res.status} ${res.statusText}`;
      const js = await res.json();
      if (js.success === false) throw js.error || js.detail || "Unknown error";
      return js;
    }
    get(u, h = {}) { return this.json(u, { headers: h }); }
    post(u, body) { return this.json(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
  }

  class API {
    constructor(token, proxy) { this.http = new HTTP(token, proxy); }
    search(q) { return this.http.get(`${EP.SEARCH}/torrents/search/${encodeURIComponent(q)}?metadata=1&check_cache=1&check_owned=1`).then(d => d.data.torrents || d.data); }
    add(m) { return this.http.post(`${EP.MAIN}/torrents/createtorrent`, { magnet: m }).then(d => d.data.id); }
    info(id) { return this.http.get(`${EP.MAIN}/torrents/mylist?id=${id}`).then(d => d.data); }
    link(id, fid) { return this.http.get(`${EP.MAIN}/torrents/requestdl?id=${id}` + (fid ? `&file_id=${fid}` : "")).then(d => d.data); }
  }

  /* ---- 24 h cache ---- */
  const Cache = (() => {
    const TTL = 86400, mem = new Map();
    const now = () => Math.floor(Date.now() / 1000);
    const key = q => `torbox_cache_${q}`;
    return {
      get(q) {
        if (mem.has(q)) return mem.get(q);
        const raw = Lampa.Storage.get(key(q));
        if (!raw || now() - raw.ts > TTL) return null;
        mem.set(q, raw.data); return raw.data;
      },
      set(q, data) { mem.set(q, data); Lampa.Storage.set(key(q), { ts: now(), data }); },
    };
  })();

  const fmt = t => `${t.cached ? "⚡ " : ""}${(t.size / 2 ** 30).toFixed(2)} GB • S:${t.seeders ?? "?"}`;

  /* ========= settings ========= */
  function settingsPage() {
    if (settingsPage.done) return; settingsPage.done = true;

    const mk = (label, ph, key, type = "text") => {
      const wrap = $(`<div class="settings-param"></div>`);
      wrap.append(`<div class="settings-param__name">${label}</div>`);
      let inp;
      if (type === "checkbox") {
        inp = $("<input type=checkbox>").prop("checked", !!Lampa.Storage.get(key, false));
        inp.on("change", () => Lampa.Storage.set(key, inp.is(":checked")));
      } else {
        inp = $(`<input type=text placeholder='${ph}'>`).val(Lampa.Storage.get(key, ""));
        inp.on("input", () => Lampa.Storage.set(key, inp.val().trim()));
      }
      wrap.append(inp); return wrap;
    };

    const onOpen = ({ name }) => {
      if (name !== "torbox") return;
      const body = $(".settings-body").empty();
      body.append("<div class='settings-param__title'>TorBox</div>")
        .append(mk("API‑ключ", "ey…", S.API_KEY))
        .append(mk("Прокси‑URL", "https://proxy.example.com", S.PROXY))
        .append(mk("Только ⚡кэш", "", S.CACHED_ONLY, "checkbox"));
    };

    if (Lampa.Settings?.listener?.follow) Lampa.Settings.listener.follow("open", onOpen);
    else if (Lampa.Settings?.on) Lampa.Settings.on("open", onOpen);
    else if (Lampa.Listener?.follow) Lampa.Listener.follow("settings", onOpen);

    if (Lampa.Settings?.add) Lampa.Settings.add({ name: "torbox", title: "TorBox", icon: "fa-cloud-bolt" });
    else if (Lampa.Settings?.menu) Lampa.Settings.menu().push({ name: "torbox", title: "TorBox", icon: "fa-cloud-bolt" });
  }

  /* ========= source ========= */
  function registerSource() {
    const getAPI = () => {
      const token = Lampa.Storage.get(S.API_KEY, ""); if (!token) return null;
      const proxy = Lampa.Storage.get(S.PROXY, "");
      if (!registerSource.cache || registerSource.cache.t !== token || registerSource.cache.p !== proxy)
        registerSource.cache = { api: new API(token, proxy), t: token, p: proxy };
      return registerSource.cache.api;
    };

    const addSrc = Lampa.Source?.add || Lampa.Sources?.add || Lampa.source?.add;
    if (!addSrc) { console.warn("TorBox plugin: Source.add not found"); return; }

    const src = {
      name: "TorBox",
      types: ["movie", "tv"],
      icon: "fa-cloud-bolt",

      async search(item, ret) {
        const api = getAPI();
        if (!api) { Lampa.Noty.show("TorBox: укажите API‑ключ"); ret([], true); return; }
        const q = item.imdb_id ? `imdb:${item.imdb_id}` : `${item.title} ${item.year || ""}`.trim();
        const cached = Cache.get(q); if (cached) { ret(cached, true); return; }
        try {
          let res = await api.search(q);
          if (Lampa.Storage.get(S.CACHED_ONLY, false)) res = res.filter(t => t.cached);
          const out = res.map(t => ({ title: t.raw_title || t.name, quality: t.resolution || t.quality || "—", info: fmt(t), id: t.id, magnet: t.magnet, cached: !!t.cached, owned: !!t.owned, size: t.size }));
          Cache.set(q, out); ret(out, true);
        } catch (e) { Lampa.Noty.show("TorBox: " + e); ret([], true); }
      },

      async play(torrent, fileId) {
        const api = getAPI(); if (!api) { Lampa.Noty.show("TorBox: нет API‑ключа"); return; }
        let tid = torrent.owned ? torrent.id : null;
        try { if (!tid) tid = await api.add(torrent.magnet); }
        catch (e) { Lampa.Noty.show("TorBox: " + e); return; }

        const startPlay = async fid => {
          try { const url = await api.link(tid, fid); Lampa.Player.play({ url }); }
          catch (e) { Lampa.Noty.show("TorBox: " + e); }
        };

        const wait = async () => {
          try {
            const info = await api.info(tid);
            if (info.progress < 100) { Lampa.Noty.show(`TorBox: кешируется ${info.progress}%…`); setTimeout(wait, 5000); return; }
            if (fileId) { startPlay(fileId); return; }
            if (info.files.length === 1) { startPlay(info.files[0].id); return; }
            const vids = info.files.filter(f => /\.(mkv|mp4|avi)$/i.test(f.name)).sort((a, b) => b.size - a.size);
            const list = (vids.length ? vids : info.files).map(f => ({ title: f.name, id: f.id, info: `${(f.size / 2 ** 30).toFixed(2)} GB` }));
            Lampa.Select.show({ title: "Выберите файл", items: list, onSelect: sel => src.play(torrent, sel.id), onBack: () => Lampa.Controller.toggle("content") });
          } catch (e) { Lampa.Noty.show("TorBox: " + e); }
        };
        wait();
      },
    };

    addSrc.call(Lampa.Source || Lampa.Sources || Lampa.source, "torbox", src);
  }

  /* ========= bootstrap ========= */
  const boot = () => { settingsPage(); registerSource(); };
  if (window.appready) boot();
  else Lampa.Listener.follow("app", e => { if (e.type === "ready") boot(); });
})();
