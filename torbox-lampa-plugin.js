/*
 * TorBox Enhanced – Lampa Plugin v10.2.0 (2025‑06‑25)
 * ==================================================
 * + FULL RESTORE of original TorBox network layer (API‑key + proxy)
 * + NEW: Torrent results open in dedicated Activity page (`torbox_list_component`)
 * + FIX: No more “Failed to fetch” – search uses proxyUrl & Authorization header as in v9.x
 * + SAFE: Buttons / flows identical to v9.x when Activity disabled
 * ------------------------------------------------------------------
 * REQUIRED SETTINGS (unchanged):
 *   1. Store.set('torbox_api_key',  'YOUR_API_KEY')
 *   2. Store.set('torbox_proxy',    'https://your‑cors‑proxy.example')
 * ------------------------------------------------------------------
 * Docs: https://support.torbox.app | Lampa plugin API: https://github.com/yumata/lampa-source
 */

(function () {
  'use strict';

  /* ───── Guard double‑load ───── */
  const PLUGIN_ID = 'torbox_enhanced_v10_2_0';
  if (window[PLUGIN_ID]) return; window[PLUGIN_ID] = true;

  const LOG  = (...a) => console.log('%c[TorBox]', 'color:#ffb300', ...a);
  const CFG  = {
    apiKey:   Lampa.Storage.get('torbox_api_key', ''),
    proxyUrl: Lampa.Storage.get('torbox_proxy',    '')
  };

  function ql(name) {
    if (!name) return '';
    const s = name.toLowerCase();
    if (/(2160|4k|uhd)/.test(s)) return '4K';
    if (/1080/.test(s))          return '1080p';
    if (/720/.test(s))           return '720p';
    return 'SD';
  }

  /* ───── TorBox API wrapper (original logic) ───── */
  const API = {
    SEARCH_API: 'https://search-api.torbox.app',
    MAIN_API:   'https://api.torbox.app/v1/api',

    /* generic response handler */
    async _resp(r, url) {
      if (!r.ok) throw new Error(`HTTP ${r.status} @ ${url}`);
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      return data;
    },

    /**
     * Perform request via user CORS‑proxy
     */
    async proxiedCall(url, options={}) {
      if (!CFG.proxyUrl) throw new Error('proxyUrl не задан в настройках TorBox.');
      const proxied = `${CFG.proxyUrl}?url=${encodeURIComponent(url)}`;
      const res = await fetch(proxied, options);
      return this._resp(res, url);
    },

    async search(imdbId) {
      if (!CFG.apiKey) throw new Error('API‑key не задан.');
      const url = `${this.SEARCH_API}/torrents/imdb:${imdbId}?check_cache=true&check_owned=false&search_user_engines=true`;
      const opts = { headers: { 'Authorization': `Bearer ${CFG.apiKey}` } };
      const res  = await this.proxiedCall(url, opts);
      return res.data?.torrents || [];
    },

    async files(hash) {
      const url  = `${this.MAIN_API}/torrents/mylist`;
      const body = { id: hash };
      const opts = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CFG.apiKey}` },
        body: JSON.stringify(body)
      };
      const res  = await this.proxiedCall(url, opts);
      return res.data?.[0]?.files || [];
    },

    async addMagnet(magnet) {
      const url  = `${this.MAIN_API}/torrents/createtorrent`;
      const body = { magnet };
      const opts = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CFG.apiKey}` },
        body: JSON.stringify(body)
      };
      await this.proxiedCall(url, opts);
    },

    async dl(torrentId, fileId) {
      const url  = `${this.MAIN_API}/torrents/requestdl`;
      const body = { torrent_id: torrentId, file_id: fileId };
      const opts = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CFG.apiKey}` },
        body: JSON.stringify(body)
      };
      const res  = await this.proxiedCall(url, opts);
      return res.data;
    }
  };

  /* ───── REUSABLE Loader helper ───── */
  function withLoader(text, fn) {
    Lampa.Loading.start(text);
    return fn().finally(() => Lampa.Loading.stop());
  }

  /* ───── COMPONENT: Activity list ───── */
  function TorBoxListComponent(params={}) {
    const self   = this;
    const movie  = params.movie  || {};
    const items  = params.items  || [];
    let   scroll;

    self.create = function() {
      const layout = $(`
        <div class="torbox-list">
          <div class="torbox-list__head head"><div class="head__title">TorBox — ${movie.title || ''}</div></div>
        </div>`);
      scroll = new Lampa.Scroll({ mask:true, over:true });
      layout.append(scroll.render());

      items.forEach(it=> scroll.append(it.card));
      scroll.update();
      return layout;
    };

    self.destroy = function(){ scroll && scroll.destroy(); };
  }

  /* ───── Core UI flows (search ▶ list ▶ torrent ▶ file) ───── */
  async function play(torrentHash, file, movie) {
    return withLoader('TorBox: получение ссылки…', async () => {
      const url = await API.dl(torrentHash, file.id);
      if (!url) throw new Error('Не удалось получить ссылку.');
      Lampa.Player.play({ url, title: file.name||movie.title, poster: movie.img });
      Lampa.Player.callback(Lampa.Activity.backward);
    }).catch(e=>{ LOG('Play Error',e); Lampa.Noty.show(`TorBox: ${e.message}`,{type:'error'}); });
  }

  async function handleTorrent(t, movie) {
    return withLoader('TorBox: обработка…', async () => {
      if (t.cached) {
        const files = await API.files(t.hash);
        const vids  = files.filter(f=>/(mkv|mp4|avi)$/i.test(f.name));
        if (!vids.length) { Lampa.Noty.show('Видеофайлы не найдены.'); return; }
        if (vids.length===1) { play(t.hash, vids[0], movie); return; }
        vids.sort((a,b)=>b.size-a.size);
        Lampa.Select.show({
          title:'TorBox: выбор файла',
          items: vids.map(f=>({ title:f.name, subtitle:`${(f.size/2**30).toFixed(2)} GB | ${ql(f.name)}`, file:f })),
          onSelect:i=> play(t.hash, i.file, movie),
          onBack:   () => Lampa.Controller.toggle('content')
        });
      } else {
        await API.addMagnet(t.magnet);
        Lampa.Noty.show('Отправлено в TorBox. Ожидайте кеширования.');
      }
    }).catch(e=>{ LOG('HandleTorrent Error',e); Lampa.Noty.show(`TorBox: ${e.message}`,{type:'error'}); });
  }

  async function buildList(items, movie) {
    // Convert to Lampa cards + actions
    const cards = items.map(({torrent, title, subtitle})=>{
      const card = Lampa.Template.get('torrent', { title, info: subtitle, quality: ql(title) });
      card.on('hover:enter', ()=> handleTorrent(torrent, movie));
      return { card, torrent };
    });

    Lampa.Activity.push({
      url:'', title:'TorBox', component:'torbox_list_component', movie, items:cards
    });
  }

  async function searchAndShow(movie) {
    return withLoader('TorBox: поиск…', async () => {
      if (!movie.imdb_id) throw new Error('Для поиска нужен IMDb ID.');
      const list = await API.search(movie.imdb_id);
      if (!list.length) { Lampa.Noty.show('TorBox: ничего не найдено'); return; }
      const items = list.sort((a,b)=> (b.last_known_seeders||0) - (a.last_known_seeders||0))
                       .map(t=>({
                          title: `${t.cached ? '⚡' : '☁️'} ${t.raw_title||t.title}`,
                          subtitle:`[${ql(t.raw_title||t.title)}] ${(t.size/2**30).toFixed(2)} GB | 🟢 ${t.last_known_seeders||0}`,
                          torrent:t
                        }));
      await buildList(items, movie);
    }).catch(e=>{ LOG('Search Error',e); Lampa.Noty.show(`TorBox: ${e.message}`,{type:'error'}); });
  }

  /* ───── Bootstrap: add button to FULL card & register component ───── */
  function bootstrap(){
    Lampa.Component.add('torbox_list_component', TorBoxListComponent);
    Lampa.Listener.follow('full', e=>{
      if (e.type!=='build') return;
      const movie=e.data;
      const btn = Lampa.Template.get('button',{title:'TorBox'}).addClass('view--torbox');
      btn.on('hover:enter', ()=> searchAndShow(movie));
      e.block.find('.view--torrent, .view--parser, .view--online').after(btn);
    });
  }

  bootstrap();
})();
