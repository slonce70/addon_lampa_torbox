/*
 * TorBox Enhanced – Universal Lampa Plugin v3.5.1 (2025-06-26)
 * -------------------------------------------------------------
 * • Виправлено подію "complete" замість "complite"
 * • Надійніші CORS-проксі з правильним кодуванням URL
 * • Уніфікація формату відповіді API.search
 * • Виправлені методи files() і dl() відповідно до TorBox API
 * • Автооновлення списку після кешування
 * • Покращена обробка помилок та детальне логування
 */

(function () {
  'use strict';

  const PLUGIN_ID = 'torbox_enhanced_v3_5_1';
  if (window[PLUGIN_ID]) return;
  window[PLUGIN_ID] = true;

  const ICON = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 7L12 2L21 7V17L12 22L3 17V7Z" stroke="currentColor" stroke-width="2"/><path d="M12 22V12" stroke="currentColor" stroke-width="2"/><path d="M21 7L12 12L3 7" stroke="currentColor" stroke-width="2"/></svg>`;

  const Store = {
    get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, String(v)); } catch {} }
  };

  const CFG = {
    get debug()      { return Store.get('torbox_debug','0') === '1'; },
    set debug(v)     { Store.set('torbox_debug', v ? '1' : '0'); },
    get cachedOnly() { return Store.get('torbox_cached_only','0') === '1'; },
    set cachedOnly(v){ Store.set('torbox_cached_only', v ? '1' : '0'); }
  };

  const LOG = (...args) => { if (CFG.debug) console.log('[TorBox]', ...args); };
  const CORS1 = u => `https://corsproxy.io/?url=${encodeURIComponent(u)}`;
  const CORS2 = u => `https://thingproxy.freeboard.io/fetch/${encodeURIComponent(u)}`;
  const ok = async r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };

  // Уніфікований формат торренту
  function normalize(t) {
    return {
      id      : t.id || t.torrent_id || null,
      name    : t.name || t.title || '',
      magnet  : t.magnet || t.hash || '',
      seeders : Number(t.seeders) || 0,
      size    : Number(t.size) || 0,
      cached  : Boolean(t.cached)
    };
  }

  const API = {
    MAIN: 'https://api.torbox.app/v1/api',

    async search(term) {
      const safe = encodeURIComponent(term).replace(/%3A/gi, ':');
      // 1. btm.tools через corsproxy.io
      try {
        const res = await ok(await fetch(CORS1(`https://btm.tools/api/torrents/search/${safe}?metadata=true&search_user_engines=true`)));
        return (res.torrents || []).map(normalize);
      } catch (e) { LOG('btm corsproxy error', e); }
      // 2. btm.tools через thingproxy
      try {
        const res = await ok(await fetch(CORS2(`https://btm.tools/api/torrents/search/${safe}?metadata=true&search_user_engines=true`)));
        return (res.torrents || []).map(normalize);
      } catch (e) { LOG('btm thingproxy error', e); }
      // 3. sumanjay.cf
      try {
        const res = await ok(await fetch(CORS1(`https://api.sumanjay.cf/torrent/?query=${safe}`)));
        return (res || []).map(t => normalize({ ...t, size: parseFloat(t.size)*1024*1024*1024 }));
      } catch (e) { LOG('sumanjay error', e); }
      // 4. TorBox native
      const key = Store.get('torbox_api_key','');
      if (!key) throw new Error('TorBox: API-Key не вказано');
      try {
        const r = await fetch(`${this.MAIN}/torrents/search/${safe}`, {
          headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }
        });
        const json = await ok(r);
        return (json.data?.torrents || []).map(normalize);
      } catch (e) { LOG('TorBox native error', e); }
      throw new Error('TorBox: усі джерела пошуку недоступні');
    },

    async files(id) {
      const key = Store.get('torbox_api_key','');
      if (!key) throw new Error('TorBox: API-Key не вказано');
      const path = `/torrents/${id}/files`;
      const r = await fetch(this.MAIN + path + `?cached=true`, { headers: { Authorization: `Bearer ${key}` } });
      const json = await ok(r);
      return (json.data?.files || json.files || []).map(f => ({ id: f.file_id || f.id, name: f.name, size: f.size }));
    },

    async dl(tid, fid) {
      const key = Store.get('torbox_api_key','');
      if (!key) throw new Error('TorBox: API-Key не вказано');
      const path = `/torrents/${tid}/stream/${fid}`;
      const r = await fetch(this.MAIN + path, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } });
      const json = await ok(r);
      return json.data?.stream_url || json.url;
    }
  };

  // Показ списку торрентів
  async function searchAndShow(movie) {
    Lampa.Loading.start('TorBox: пошук…');
    try {
      const term = movie?.imdb_id ? `imdb:${movie.imdb_id}` : movie.title;
      const list = await API.search(term);
      if (!list.length) return Lampa.Noty.show('TorBox: нічого не знайдено');
      const show = CFG.cachedOnly ? list.filter(t=>t.cached) : list;
      if (!show.length) return Lampa.Noty.show('Немає кешованих');
      show.sort((a,b)=>b.seeders - a.seeders);
      const items = show.map(t => ({ title: `${t.cached?'⚡':'☁️'} ${t.name}`, subtitle: `${(t.size/2**30).toFixed(2)} GB | 🟢${t.seeders}`, torrent: t }));
      Lampa.Select.show({ title:'TorBox', items, onSelect:i=>handleTorrent(i.torrent,movie), onBack:()=>Lampa.Controller.toggle('content') });
    } catch (e) { Lampa.Noty.show(e.message, { type:'error' }); }
    finally { Lampa.Loading.stop(); }
  }

  // Обробка вибору торренту / кешування
  async function handleTorrent(t, movie) {
    Lampa.Loading.start('TorBox…');
    try {
      if (!t.id) throw new Error('TorBox: невідомий ID торренту');
      if (t.cached) {
        const files = await API.files(t.id);
        const vids = files.filter(f=>/\.(mkv|mp4|avi)$/i.test(f.name));
        if (!vids.length) return Lampa.Noty.show('Відео не знайдено');
        if (vids.length===1) return play(t.id, vids[0], movie);
        vids.sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
        const items = vids.map(f=>({ title:f.name, subtitle:`${(f.size/2**30).toFixed(2)} GB`, file:f }));
        return Lampa.Select.show({ title:'TorBox: файли', items, onSelect:i=>play(t.id,i.file,movie), onBack:()=>searchAndShow(movie) });
      }
      // якщо не кешовано, додаємо та чекаємо авто-оновлення
      await API.addMagnet(t.magnet);
      Lampa.Noty.show('Відправлено в TorBox, очікуйте кешування…');
      // після 10 сек оновимо список автоматично
      setTimeout(()=>searchAndShow(movie),10000);
    } catch (e) { Lampa.Noty.show(e.message,{type:'error'}); }
    finally { Lampa.Loading.stop(); }
  }

  async function play(tid,file,movie) {
    Lampa.Loading.start('TorBox: отримуємо лінк…');
    try {
      const url = await API.dl(tid, file.id);
      if (!url) throw new Error('Порожній URL');
      Lampa.Player.play({ url, title:file.name||movie.title, poster:movie.img });
      Lampa.Player.callback(Lampa.Activity.backward);
    } catch (e) { Lampa.Noty.show(e.message,{type:'error'}); }
    finally { Lampa.Loading.stop(); }
  }

  // Налаштування
  function addSettings() {
    if (!Lampa.SettingsApi) return;
    const comp = 'torbox_enh';
    Lampa.SettingsApi.addComponent({ component:comp, name:'TorBox Enhanced', icon:ICON });
    [
      {key:'torbox_cached_only', name:'Тільки кеш', default:CFG.cachedOnly},
      {key:'torbox_debug',       name:'Debug',      default:CFG.debug      },
      {key:'torbox_api_key',     name:'API-Key',    default:Store.get('torbox_api_key','')} 
    ].forEach(p=>{
      Lampa.SettingsApi.addParam({
        component:comp,
        param:{ name:p.key, type:p.key==='torbox_api_key'?'input':'trigger', default:p.default },
        field:{ name:p.name },
        onChange:v=>{ if(p.key==='torbox_api_key')Store.set(p.key,v.trim()); else CFG[p.key==='torbox_cached_only'?'cachedOnly':'debug']=v; }
      });
    });
  }

  // Хук події
  function hook() {
    Lampa.Listener.follow('full', e => {
      if (e.type!=='complete') return;
      const root = e.object.activity.render();
      if (root.find('.view--torbox').length) return;
      const btn = $(`
        <div class="full-start__button selector view--torbox" data-subtitle="TorBox">${ICON}<span>TorBox</span></div>
      `);
      btn.on('hover:enter', ()=>searchAndShow(e.data.movie));
      root.find('.view--torrent').after(btn);
    });
  }

  (function init() {
    const STEP=500, MAX=60000;
    let waited=0;
    const loop = ()=>{
      if(window.Lampa && window.Lampa.Settings) {
        addSettings(); hook(); LOG('TorBox v3.5.1 ready');
      } else if((waited+=STEP)<MAX) setTimeout(loop,STEP);
      else console.warn('[TorBox] Lampa не знайдено');
    };
    loop();
  })();
})();
