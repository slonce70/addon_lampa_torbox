(function () {
  "use strict";
  /**
   * TorBox ↔ Lampa integration plugin.
   *
   * Requirements (June 2025 Lampa nightly):
   *   - Lampa.Source API (add / search / play)
   *   - Lampa.Player.play({url})
   *   - jQuery ≥ 3 bundle in Lampa
   *   - Lampa.Settings and Lampa.Storage helpers
   *
   * Supported features
   *   ✔ Global search via search-api.torbox.app
   *   ✔ Add non‑cached torrents to personal list
   *   ✔ Polling until 100 % cached with progress notifier
   *   ✔ File picker when раздача содержит несколько видео‑файлов
   *   ✔ Direct HTTPS stream link into Lampa player
   *   ✔ Optional CORS‑proxy prefix
   *   ✔ Setting: “show only cached”
   *   ✔ Local caching of search results for 24 h (Lampa.Cache)
   */

  /** ========== Storage keys ========= */
  const S = {
    API_KEY: "torbox_api_key",
    PROXY: "torbox_proxy_url",
    CACHED_ONLY: "torbox_show_cached_only",
  };

  /** ========== TorBox endpoints (v2, 2025‑05) ========= */
  const EP = {
    SEARCH: "https://search-api.torbox.app", // public (no CORS)
    MAIN: "https://api.torbox.app",           // personal (Bearer)
  };

  /**
   * Wrap every request so we can optionally prepend user proxy.
   */
  class TorBoxHTTP {
    constructor(token, proxy = "") {
      this.token = token;
      this.proxy = proxy.replace(/\/$/, ""); // trim trailing '/'
    }

    _headers(extra = {}) {
      return Object.assign({
        Authorization: `Bearer ${this.token}`,
      }, extra);
    }

    _wrap(url) {
      if (!this.proxy) return url;
      // Съедаем https?:// и подставляем прокси‑хост
      return `${this.proxy}/${url.replace(/^https?:\/\//, "")}`;
    }

    async json(url, opt = {}) {
      const res = await fetch(this._wrap(url), Object.assign({
        headers: this._headers(opt.headers || {}),
      }, opt));
      if (!res.ok) throw `${res.status} ${res.statusText}`;
      const js = await res.json();
      if (js.success === false) throw js.error || js.detail || "Unknown error";
      return js;
    }

    get(url, hdr = {}) { return this.json(url, { headers: hdr }); }
    post(url, body) {
      return this.json(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }
  }

  /**
   * Thin TorBox v2 API wrapper.
   */
  class TorBoxAPI {
    constructor(token, proxy) { this.http = new TorBoxHTTP(token, proxy); }

    search(q) {
      const url = `${EP.SEARCH}/torrents/search/${encodeURIComponent(q)}?metadata=1&check_cache=1&check_owned=1`;
      return this.http.get(url).then((d) => d.data.torrents || d.data);
    }

    add(magnet) {
      return this.http.post(`${EP.MAIN}/torrents/createtorrent`, { magnet })
        .then((d) => d.data.id);
    }

    info(id) {
      return this.http.get(`${EP.MAIN}/torrents/mylist?id=${id}`)
        .then((d) => d.data);
    }

    link(id, fileId) {
      const url = `${EP.MAIN}/torrents/requestdl?id=${id}` + (fileId ? `&file_id=${fileId}` : "");
      return this.http.get(url).then((d) => d.data);
    }
  }

  /**
   * Simple 24 h memory+Storage cache for search results.
   */
  const SearchCache = (() => {
    const TTL = 86400; // seconds
    const mem = new Map();

    function now() { return Math.floor(Date.now() / 1000); }

    function key(q) { return `torbox_cache_${q}`; }

    return {
      get(query) {
        if (mem.has(query)) return mem.get(query);
        const raw = Lampa.Storage.get(key(query));
        if (!raw) return null;
        if (now() - raw.ts > TTL) return null;
        mem.set(query, raw.data);
        return raw.data;
      },
      set(query, data) {
        mem.set(query, data);
        Lampa.Storage.set(key(query), { ts: now(), data });
      },
    };
  })();

  /**
   * Build human‑readable label for a torrent row.
   */
  function buildInfo(t) {
    const sz = (t.size / (1024 ** 3)).toFixed(2) + " GB";
    return `${t.cached ? "⚡ " : ""}${sz} • S:${t.seeders ?? "?"}`;
  }

  /**
   * Entry point: register source + settings.
   */
  function TorBoxPlugin() {
    /* ========= Settings UI ========= */
    function settingsForm() {
      if (settingsForm.done) return; settingsForm.done = true;
      const mk = (label, key, type, placeholder = "") => {
        const wrap = $("<div class=\"settings-param\"></div>");
        wrap.append(`<div class=\"settings-param__name\">${label}</div>`);
        if (type === "checkbox") {
          const inp = $("<input type=checkbox>").prop("checked", !!Lampa.Storage.get(key, false));
          inp.on("change", () => Lampa.Storage.set(key, inp.is(":checked")));
          wrap.append(inp);
        } else {
          const inp = $(`<input type=text placeholder='${placeholder}'>`).val(Lampa.Storage.get(key, ""));
          inp.on("input", () => Lampa.Storage.set(key, inp.val().trim()));
          wrap.append(inp);
        }
        return wrap;
      };

      Lampa.Settings.listener.follow("open", ({ name }) => {
        if (name !== "torbox") return;
        const body = $(".settings-body").empty();
        body.append("<div class=\"settings-param__title\">TorBox</div>")
          .append(mk("API‑ключ", S.API_KEY, "text", "ey…"))
          .append(mk("Прокси‑URL (optional)", S.PROXY, "text", "https://proxy.example.com"))
          .append(mk("Показывать только ⚡кэшированные", S.CACHED_ONLY, "checkbox"));
      });

      Lampa.Settings.add({
        name: "torbox",
        title: "TorBox",
        icon: "fa-cloud-bolt",
      });
    }

    /* ========= Helper: current API instance ========= */
    let cachedInstance = null;
    function getAPI() {
      const token = Lampa.Storage.get(S.API_KEY, "");
      if (!token) return null;
      const proxy = Lampa.Storage.get(S.PROXY, "");
      if (!cachedInstance || cachedInstance._token !== token || cachedInstance._proxy !== proxy) {
        cachedInstance = new TorBoxAPI(token, proxy);
      }
      return cachedInstance;
    }

    /* ========= Source registration ========= */
    Lampa.Source.add("torbox", {
      name: "TorBox",
      types: ["movie", "tv"],
      icon: "fa-cloud-bolt",

      /**
       * item fields: {title, year, imdb_id, etc}
       */
      async search(item, ret) {
        const api = getAPI();
        if (!api) {
          Lampa.Noty.show("TorBox: Укажите API‑ключ в настройках");
          ret([], true); return;
        }

        const q = item.imdb_id ? `imdb:${item.imdb_id}` : `${item.title} ${item.year || ""}`.trim();

        // Cache 24 h
        const cached = SearchCache.get(q);
        if (cached) {
          ret(cached, true); return;
        }

        try {
          let list = await api.search(q);
          if (Lampa.Storage.get(S.CACHED_ONLY, false)) list = list.filter((t) => t.cached);
          const out = list.map((t) => ({
            title: t.raw_title || t.name,
            quality: t.resolution || t.quality || "—",
            info: buildInfo(t),
            id: t.id,
            magnet: t.magnet,
            cached: !!t.cached,
            owned: !!t.owned,
            size: t.size,
          }));
          SearchCache.set(q, out);
          ret(out, true);
        } catch (e) {
          Lampa.Noty.show("TorBox: " + e);
          ret([], true);
        }
      },

      /**
       * @param torrent  — объект из search()
       * @param pickedId — optional файл, если пользователь повторно выбрал
       */
      async play(torrent, pickedId) {
        const api = getAPI();
        if (!api) { Lampa.Noty.show("TorBox: нет API‑ключа"); return; }

        let tid = torrent.owned ? torrent.id : null;
        try {
          if (!tid) tid = await api.add(torrent.magnet);
        } catch (e) {
          Lampa.Noty.show("TorBox: " + e); return;
        }

        /* ── Wait for caching ── */
        const wait = async () => {
          try {
            const info = await api.info(tid);
            if (info.progress < 100) {
              Lampa.Noty.show(`TorBox: кешируется ${info.progress}%…`);
              setTimeout(wait, 5000); return;
            }

            /* ── File picker ── */
            const chooseAndPlay = async (fid) => {
              try {
                const url = await api.link(tid, fid);
                Lampa.Player.play({ url });
              } catch (e) { Lampa.Noty.show("TorBox: " + e); }
            };

            if (pickedId) {
              chooseAndPlay(pickedId); return;
            }

            if (info.files.length === 1) { // один файл
              chooseAndPlay(info.files[0].id); return;
            }

            // Иногда бывает десяток файлов; выберем largest video as default focus
            const vids = info.files.filter((f) => /\.(mkv|mp4|avi)$/i.test(f.name))
              .sort((a, b) => b.size - a.size);

            const list = (vids.length ? vids : info.files).map((f) => ({
              title: f.name,
              size: f.size,
              id: f.id,
              info: `${(f.size / (1024 ** 3)).toFixed(2)} GB`,
            }));

            // Lampa.Select UI
            Lampa.Select.show({
              title: "Выберите файл",
              items: list,
              onSelect(sel) { TorBox.play(torrent, sel.id); }, // recursion with pickedId
              onBack() { Lampa.Controller.toggle("content"); },
            });
          } catch (e) {
            Lampa.Noty.show("TorBox: " + e);
          }
        };
        wait();
      },
    });

    /* init settings */
    settingsForm();
  }

  TorBoxPlugin();
})();
