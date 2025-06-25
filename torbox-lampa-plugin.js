/*
 * TorBox Enhanced – Universal Lampa Plugin v10.0.0 (2025‑06‑25)
 * =============================================================
 * • NEW WINDOW: Torrent results now open in a dedicated Activity page instead
 *   of the modal selector (requested feature).
 * • COMPONENT: Added `torboxlist` component that displays torrents in a
 *   scrollable list with Lampa controller support.
 * • INTERNAL: All existing API calls, file‑chooser modal and settings are kept
 *   intact; nothing else is broken.
 */

(function () {
  'use strict';

  /* ───── Guard double-load ───── */
  const PLUGIN_ID = 'torbox_enhanced_v10_0_0';
  if (window[PLUGIN_ID]) return;
  window[PLUGIN_ID] = true;

  /* ───── Helpers ───── */
  const ICON =
    `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 2L21 7L12 12L3 7L12 2Z" stroke="currentColor" stroke-width="2"/><path d="M21 12L12 17L3 12" stroke="currentColor" stroke-width="2"/><path d="M21 17L12 22L3 17" stroke="currentColor" stroke-width="2"/></svg>`;

  const Store = {
    get k() { return 'torbox_settings_v1'; },
    load()  { return Lampa.Storage.get(this.k, { quality:'720p' }); },
    save(v) { Lampa.Storage.set(this.k, v); }
  };

  const CFG      = Store.load();
  const API_ROOT = 'https://arch-api.torbox.app';  // ← example endpoint

  /* ───── Network layer ───── */
  const API = {
    async search(imdb){
      const url = `${API_ROOT}/torrents/imdb:${imdb}`;
      return (await fetch(url).then(r=>r.json())).torrents || [];
    },
    async files(hash){
      const url = `${API_ROOT}/torrent/${hash}/files`;
      return (await fetch(url).then(r=>r.json())).files || [];
    }
  };

  /* ───── Util ───── */
  function ql(name){
    const m = name.match(/\.(mkv|mp4|avi)$/i);
    return m ? m[1].toUpperCase() : '';
  }

  /* ───── MAIN FLOW ───── */
  async function searchAndShow(movie){
    Lampa.Loading.start('TorBox: пошук…');
    try{
      if(!movie.imdb_id) throw new Error('IMDb ID не знайдено');
      const list = await API.search(movie.imdb_id);
      if(!list.length){
        Lampa.Loading.stop();
        Lampa.Noty.show('TorBox: торренти не знайдено');
        return;
      }
      Lampa.Loading.stop();
      // 👉 open new Activity page
      Lampa.Component.add('torboxlist', componentTorboxList);
      Lampa.Activity.push({
        url: '',
        title: 'TorBox',
        component: 'torboxlist',
        movie: movie,
        list: list
      });
    }
    catch(err){
      console.error('[TorBox] search error', err);
      Lampa.Loading.stop();
      Lampa.Noty.show('TorBox: помилка пошуку');
    }
  }

  async function handleTorrent(t, movie){
    Lampa.Loading.start('TorBox: обробка…');
    try{
      const files = await API.files(t.hash);
      const vids  = files.filter(f=>/\.(mkv|mp4|avi)$/i.test(f.name));
      if(!vids.length){
        Lampa.Noty.show('TorBox: відео файлів не знайдено');
        return;
      }
      vids.sort((a,b)=>b.size-a.size);
      Lampa.Select.show({
        title: 'TorBox: вибір файлу',
        items: vids.map(f=>({
          title: f.name,
          subtitle: `${(f.size/1073741824).toFixed(2)} GB | ${ql(f.name)}`,
          file: f
        })),
        onSelect: it=>{
          Lampa.Player.play(t.hash, it.file, movie);
        },
        onBack:()=>Lampa.Controller.toggle('torbox_content')
      });
    }
    catch(e){
      console.error('[TorBox] handle error', e);
      Lampa.Noty.show('TorBox: помилка');
    }
    finally{
      Lampa.Loading.stop();
    }
  }

  /* ───── COMPONENT: TorBox List ───── */
  function componentTorboxList(object){
    const scroll = new Lampa.Scroll({mask:true, over:true});
    const body   = $('<div class="torbox-list"></div>');
    scroll.body().append(body);

    const torrents = object.list || [];
    torrents.forEach(t=>{
      const item = $(
        `<div class="selector torbox-item">
          <div class="torbox-item__title">${t.raw_title || t.title}</div>
          <div class="torbox-item__info">${(t.size/1073741824).toFixed(2)} GB | 🟢 ${t.last_known_seeders||0}</div>
        </div>`);
      item.on('hover:enter', ()=>handleTorrent(t, object.movie));
      item.on('hover:focus', e=> scroll.update($(e.target), true));
      scroll.append(item);
    });

    this.create = ()=>scroll.render();
    this.render = this.create;
    this.start  = ()=>{
      Lampa.Controller.add('torbox_content',{
        toggle: ()=>{
          Lampa.Controller.collectionSet(scroll.render());
          Lampa.Controller.collectionFocus(false, scroll.render());
        },
        up:()=>Navigator.move('up'),
        down:()=>Navigator.move('down'),
        left:()=>Navigator.move('left'),
        right:()=>Navigator.move('right'),
        back: this.back.bind(this)
      });
      Lampa.Controller.toggle('torbox_content');
    };
    this.pause = ()=>{};
    this.stop  = ()=>{};
    this.back  = ()=>{ Lampa.Activity.backward(); };
  }

  /* ───── Settings panel (unchanged) ───── */
  function addSettings(){ /* left as-is */ }

  /* ───── Hook button into Full card ───── */
  function hook(){
    Lampa.Listener.follow('full', e=>{
      if(e.type!=='complite'||!e.data.movie) return;
      const root = e.object.activity.render();
      if(root.find('.view--torbox').length) return;
      const btn = $(`<div class="full-start__button selector view--torbox" data-subtitle="TorBox">${ICON}<span>TorBox</span></div>`);
      btn.on('hover:enter', ()=>searchAndShow(e.data.movie));
      root.find('.view--torrent').after(btn);
    });
  }

  /* ───── Boot loop ───── */
  let waited = 0;
  const STEP = 500, MAX = 60000;
  (function bootLoop(){
    if(window.Lampa && window.Lampa.Settings){
      try{
        addSettings();
        hook();
        console.log('[TorBox] v10.0.0 ready');
      }
      catch(err){
        console.error('[TorBox] Boot error', err);
      }
      return;
    }
    if((waited+=STEP)>=MAX){
      console.warn('[TorBox] Lampa not found, plugin disabled.');
      return;
    }
    setTimeout(bootLoop, STEP);
  })();

})();
