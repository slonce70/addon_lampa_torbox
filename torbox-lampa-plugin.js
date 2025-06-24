/*
 * TorBox Enhanced – Universal Lampa Plugin v3.3.0 (2025‑06‑25)
 * ============================================================
 * 🌐  CORS & Cloudflare 530 solved, «Только кеш» сохраняется корректно
 * --------------------------------------------------------------------
 *  🟠  btm.tools иногда отдаёт **530 (Web server is down)** через Cloudflare,
 *      когда запрос идёт от публичных прокси.
 *  🟢  Новый алгоритм поиска:
 *        1.  btm.tools → corsproxy.io
 *        2.  btm.tools → thingproxy.freeboard.io
 *        3.  **search‑api.torbox.app** (без авторизации, _без metadata_)
 *  🔑  Если указан API‑Key → пешем `check_cache=true` даже на search‑api.
 *  📦  Результаты search‑api отличаются по схеме -> добавлена унификация.
 *  💾  Баг с «Только кеш = Да» после перезапуска — фикс: флаг теперь пишется
 *      и читается как "1" / "0" (строки), что Lampa корректно сериализует.
 */

(function(){
  'use strict';

  const PLUGIN_ID='torbox_enhanced_v3_3_0';
  if(window[PLUGIN_ID]) return; window[PLUGIN_ID]=true;

  // ─────────── helpers ───────────
  const ICON=`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 7L12 2L21 7V17L12 22L3 17V7Z" stroke="currentColor" stroke-width="2"/><path d="M12 22V12" stroke="currentColor" stroke-width="2"/><path d="M21 7L12 12L3 7" stroke="currentColor" stroke-width="2"/></svg>`;
  const Store={get:(k,d)=>{try{return localStorage.getItem(k)??d;}catch{return d;}},set:(k,v)=>{try{localStorage.setItem(k,String(v));}catch{}}};
  const CFG={
    get debug(){return Store.get('torbox_debug','0')==='1';},   set debug(v){Store.set('torbox_debug',v?'1':'0');},
    get cachedOnly(){return Store.get('torbox_cached_only','0')==='1';}, set cachedOnly(v){Store.set('torbox_cached_only',v?'1':'0');}
  };
  const LOG=(...a)=>CFG.debug&&console.log('[TorBox]',...a);
  const CORS1=u=>`https://corsproxy.io/?url=${encodeURIComponent(u)}`;
  const CORS2=u=>`https://thingproxy.freeboard.io/fetch/${u}`;
  const ql=n=>{n=n.toLowerCase();if(/(2160|4k)/.test(n))return'4K';if(/1080/.test(n))return'1080p';if(/720/.test(n))return'720p';return'';};

  // ─────────── API ───────────
  const API={
    MAIN:'https://api.torbox.app/v1/api',

    async search(term){
      const safe=encodeURIComponent(term).replace(/%3A/ig,':');
      const qp='metadata=true&search_user_engines=true';
      const btm=`https://btm.tools/api/torrents/search/${safe}?${qp}`;
      const tryFetch=async (u)=>{const r=await fetch(u); if(!r.ok) throw new Error(r.status); return r.json();};
      try{LOG('Try btm via corsproxy'); return await tryFetch(CORS1(btm));}
      catch(e1){LOG('corsproxy failed',e1); try{LOG('Try btm via thingproxy'); return await tryFetch(CORS2(btm));}catch(e2){LOG('thingproxy failed',e2);} }

      // fallback search‑api.torbox.app (public)
      let url=`https://search-api.torbox.app/torrents/search/${safe}`;
      const key=Store.get('torbox_api_key','');
      if(key) url+=`?check_cache=true`; // check cache allowed с ключом
      LOG('Fallback search-api',url);
      return tryFetch(CORS1(url));
    },

    async main(path,body={},method='GET'){
      const key=Store.get('torbox_api_key','');
      if(!key) throw new Error('TorBox: API‑Key не указан');
      let url=`${this.MAIN}${path}`;
      const opt={method,headers:{Authorization:`Bearer ${key}`,Accept:'application/json'}};
      if(method==='GET'&&Object.keys(body).length) url+='?'+new URLSearchParams(body).toString();
      else if(method!=='GET'){opt.headers['Content-Type']='application/json';opt.body=JSON.stringify(body);} 
      const r=await fetch(url,opt);const j=await r.json().catch(()=>({})); if(!r.ok) throw new Error(j.error||j.message||`HTTP ${r.status}`); return j;
    },

    addMagnet(m){return this.main('/torrents/createtorrent',{magnet:m},'POST');},
    files(id){return this.main('/torrents/mylist',{id}).then(r=>r.data?.[0]?.files||[]);},
    dl(tid,fid){return this.main('/torrents/requestdl',{torrent_id:tid,file_id:fid}).then(r=>r.data);}  
  };

  // ─────────── UI Flow ───────────
  async function searchAndShow(movie){
    Lampa.Loading.start('TorBox: поиск…');
    try{
      const term=movie?.imdb_id?`imdb:${movie.imdb_id}`:movie.title;
      const res = await API.search(term);
      const list=(res.data?.torrents)||res.torrents||[];
      if(!list.length){Lampa.Noty.show('TorBox: ничего не найдено');return;}
      const show=CFG.cachedOnly?list.filter(t=>t.cached):list;
      if(!show.length){Lampa.Noty.show('Нет кэшированных');return;}
      const items=show.sort((a,b)=>(b.seeders||0)-(a.seeders||0)).map(t=>({title:`${t.cached?'⚡':'☁️'} ${t.name||t.title}`,subtitle:`${(t.size/2**30).toFixed(2)} GB | 🟢${t.seeders||0}`,torrent:t}));
      Lampa.Select.show({title:'TorBox',items,onSelect:i=>handleTorrent(i.torrent,movie),onBack:()=>Lampa.Controller.toggle('content')});
    }catch(e){Lampa.Noty.show(e.message,{type:'error'});}finally{Lampa.Loading.stop();}
  }

  async function handleTorrent(t,movie){
    Lampa.Loading.start('TorBox…');
    try{
      if(t.cached){
        const files=await API.files(t.id);
        const vids=files.filter(f=>/\.(mkv|mp4|avi)$/i.test(f.name));
        if(!vids.length){Lampa.Noty.show('Видео не найдены');return;}
        if(vids.length===1){play(t.id,vids[0],movie);return;}
        vids.sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
        Lampa.Select.show({title:'TorBox: файлы',items:vids.map(f=>({title:f.name,subtitle:`${(f.size/2**30).toFixed(2)} GB ${ql(f.name)}`,file:f})),onSelect:i=>play(t.id,i.file,movie),onBack:()=>searchAndShow(movie)});
      }else{await API.addMagnet(t.magnet);Lampa.Noty.show('Отправлено в TorBox, ждите кеш');}
    }catch(e){Lampa.Noty.show(e.message,{type:'error'});}finally{Lampa.Loading.stop();}
  }

  async function play(tid,file,movie){
    Lampa.Loading.start('TorBox: ссылка…');
    try{const url=await API.dl(tid,file.id); if(!url) throw new Error('Пустой URL'); Lampa.Player.play({url,title:file.name||movie.title,poster:movie.img}); Lampa.Player.callback(Lampa.Activity.backward);}catch(e){Lampa.Noty.show(e.message,{type:'error'});}finally{Lampa.Loading.stop();}
  }

  // ─────────── Settings ───────────
  const COMP='torbox_enh';
  function addSettings(){
    if(!Lampa.SettingsApi) return;
    Lampa.SettingsApi.addComponent({component:COMP,name:'TorBox Enhanced',icon:ICON});
    const fields=[
      {k:'torbox_cached_only',n:'Только кеш',d:'Скрывать не кеш',t:'trigger',def:CFG.cachedOnly},
      {k:'torbox_debug',n:'Debug',d:'Лог',t:'trigger',def:CFG.debug},
      {k:'torbox_api_key',n:'API‑Key',d:'Ключ TorBox (для загрузок)',t:'input',def:Store.get('torbox_api_key','')}
    ];
    fields.forEach(p=>Lampa.SettingsApi.addParam({component:COMP,param:{name:p.k,type:p.t,values:'',default:p.def},field:{name:p.n,description:p.d},onChange:v=>{if(p.t==='input')Store.set('torbox_api_key',v.trim());else if(p.k==='torbox_cached_only')CFG.cachedOnly=v;else CFG.debug=v;}}));
  }

  // ─────────── Boot / Hook ───────────
  function hook(){Lampa.Listener.follow('full',e=>{if(e.type!=='complite')return;const root=e.object.activity.render();if(root.find('.view--torbox').length)return;const btn=$(`<div class="full-start__button selector view--torbox" data-subtitle="TorBox">${ICON}<span>TorBox</span></div>`);btn.on('hover:enter',()=>searchAndShow(e.data.movie));root.find('.view--torrent').after(btn);});}
  let t=0;const STEP=500,MAX=60000;(function loop(){if(window.Lampa&&window.Lampa.Settings){try{addSettings();hook();LOG('Ready v3.3.0');}catch(e){console.error('[TorBox]',e);}return;}if((t+=STEP)>=MAX){console.warn('[TorBox] Lampa not found');return;}setTimeout(loop,STEP);})();
})();
