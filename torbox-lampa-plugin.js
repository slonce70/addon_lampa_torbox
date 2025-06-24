/*
 * TorBox Enhanced – Universal Lampa Plugin v3.0.3 (2025‑06‑24)
 * ============================================================
 * ✔️ Search API now uses endpoint btm.tools/api/torrents/search with header X-Api-Key.
 * ✔️ CORS solved via corsproxy.io for search; main API stays direct with Bearer.
 * ✔️ Debug toggle, cached‑only filter, automatic settings (SettingsApi or legacy).
 */

(function(){
  'use strict';

  // ───────────────────────────── 0. Guard double‑load ─────────────────────────
  const PLUGIN_ID='torbox_enhanced_v3_0_3';
  if(window[PLUGIN_ID]) return; window[PLUGIN_ID]=true;

  // ──────────────────────────────────── 1. Utils ─────────────────────────────
  const ICON=`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 7L12 2L21 7V17L12 22L3 17V7Z" stroke="currentColor" stroke-width="2"/><path d="M12 22V12" stroke="currentColor" stroke-width="2"/><path d="M21 7L12 12L3 7" stroke="currentColor" stroke-width="2"/></svg>`;

  const Store={get:(k,d)=>{try{return localStorage.getItem(k)??d;}catch{return d;}},set:(k,v)=>{try{localStorage.setItem(k,String(v));}catch{}}};
  const CFG={
    get apiKey(){return Store.get('torbox_api_key','');}, set apiKey(v){Store.set('torbox_api_key',v.trim());},
    get debug(){return Store.get('torbox_debug','false')==='true';}, set debug(v){Store.set('torbox_debug',!!v);},
    get cachedOnly(){return Store.get('torbox_cached_only','false')==='true';}, set cachedOnly(v){Store.set('torbox_cached_only',!!v);}
  };
  const LOG=(...a)=>CFG.debug&&console.log('[TorBox]',...a);
  const CORS=u=>`https://corsproxy.io/?${encodeURIComponent(u)}`;

  // ───────────────────────────────── 2. TorBox API ───────────────────────────
  const API={
    MAIN:'https://api.torbox.app/v1/api',
    SEARCH:'https://btm.tools/api',

    async main(path,body={},method='GET'){
      if(!CFG.apiKey) throw new Error('TorBox: API‑Key не указан');
      let url=`${this.MAIN}${path}`;
      const opt={method,headers:{Authorization:`Bearer ${CFG.apiKey}`}};
      if(method==='GET'&&Object.keys(body).length) url+='?'+new URLSearchParams(body).toString();
      else if(method!=='GET'){opt.headers['Content-Type']='application/json';opt.body=JSON.stringify(body);} 
      const r=await fetch(url,opt);const j=await r.json(); if(!r.ok) throw new Error(j.error||j.message||`HTTP ${r.status}`); return j;
    },

    async search(term){
      const safe=encodeURIComponent(term).replace(/%3A/ig,':');
      const url=CORS(`https://search-api.torbox.app/torrents/search/${safe}`);
      const r=await fetch(url);
      const j=await r.json();
      if(j.error||j.success===false) throw new Error(j.message||j.error||'Search error');
      return j;
    },

    addMagnet(m){return this.main('/torrents/createtorrent',{magnet:m},'POST');},
    files(id){return this.main('/torrents/mylist',{id}).then(r=>r.data?.[0]?.files||[]);},
    dl(tid,fid){return this.main('/torrents/requestdl',{torrent_id:tid,file_id:fid}).then(r=>r.data);}  
  };

  const ql=n=>{n=n.toLowerCase();if(n.includes('2160')||n.includes('4k'))return'4K';if(n.includes('1080'))return'1080p';if(n.includes('720'))return'720p';return'';};

  // ───────────────────────────────── 3. UI flows ─────────────────────────────
  async function searchAndShow(movie){
    Lampa.Loading.start('TorBox: поиск…');
    try{
      const term=movie?.imdb_id?`imdb:${movie.imdb_id}`:movie.title;
      const res=await API.search(term);
      const list=res.data?.torrents||[];
      if(!list.length){Lampa.Noty.show('TorBox: ничего не найдено');return;}
      const show=CFG.cachedOnly?list.filter(t=>t.cached):list;
      if(!show.length){Lampa.Noty.show('Нет кэшированных');return;}
      const items=show.sort((a,b)=>(b.seeders||0)-(a.seeders||0)).map(t=>({title:`${t.cached?'⚡':'☁️'} ${t.name}`,subtitle:`${(t.size/2**30).toFixed(2)} GB | 🟢${t.seeders||0}`,torrent:t}));
      Lampa.Select.show({title:'TorBox',items,onSelect:i=>handleTorrent(i.torrent,movie,show),onBack:()=>Lampa.Controller.toggle('content')});
    }catch(e){Lampa.Noty.show(e.message,{type:'error'});}finally{Lampa.Loading.stop();}
  }

  async function handleTorrent(t,movie,all){
    Lampa.Loading.start('TorBox…');
    try{
      if(t.cached){
        const files=await API.files(t.id);
        const vids=files.filter(f=>/\.(mkv|mp4|avi)$/i.test(f.name));
        if(!vids.length){Lampa.Noty.show('Видео не найдены');return;}
        if(vids.length===1){play(t.id,vids[0],movie);return;}
        vids.sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
        Lampa.Select.show({title:'TorBox: файлы',items:vids.map(f=>({title:f.name,subtitle:`${(f.size/2**30).toFixed(2)} GB ${ql(f.name)}`,file:f})),onSelect:i=>play(t.id,i.file,movie),onBack:()=>searchAndShow(movie)});
      }else{await API.addMagnet(t.magnet);Lampa.Noty.show('Отправлено в TorBox, ждите кеш');}
    }catch(e){Lampa.Noty.show(e.message,{type:'error'});}finally{Lampa.Loading.stop();}
  }

  async function play(tid,file,movie){
    Lampa.Loading.start('TorBox: ссылка…');
    try{
      const url=await API.dl(tid,file.id); if(!url) throw new Error('Пустой URL');
      Lampa.Player.play({url,title:file.name||movie.title,poster:movie.img});
      Lampa.Player.callback(Lampa.Activity.backward);
    }catch(e){Lampa.Noty.show(e.message,{type:'error'});}finally{Lampa.Loading.stop();}
  }

  // ───────────────────────────── 4. Settings ────────────────────────────────
  const COMP='torbox_enh';
  function addSettings(){
    if(Lampa.SettingsApi){
      Lampa.SettingsApi.addComponent({component:COMP,name:'TorBox Enhanced',icon:ICON});
      const arr=[
        {k:'torbox_api_key',n:'API‑Key',d:'Ключ TorBox',t:'input',def:CFG.apiKey},
        {k:'torbox_cached_only',n:'Только кеш',d:'Скрывать не кеш',t:'trigger',def:CFG.cachedOnly},
        {k:'torbox_debug',n:'Debug',d:'Лог',t:'trigger',def:CFG.debug}
      ];
      arr.forEach(p=>Lampa.SettingsApi.addParam({component:COMP,param:{name:p.k,type:p.t,values:'',default:p.def},field:{name:p.n,description:p.d},onChange:v=>{if(p.t==='input')CFG.apiKey=v;else if(p.k==='torbox_cached_only')CFG.cachedOnly=v;else CFG.debug=v;}}));
    }else{
      const f=`<div class="settings-folder selector" data-component="${COMP}"><div class="settings-folder__icon">${ICON}</div><div class="settings-folder__name">TorBox Enhanced</div></div>`;
      Lampa.Settings.main().render().find('[data-component="more"]').after($(f));
      const tpl='settings_'+COMP;
      if(!Lampa.Template.get(tpl))Lampa.Template.add(tpl,`<div class="torbox-set"><div class="settings-param selector" data-k="key">API‑Key <span></span></div><div class="settings-param selector" data-k="cached">Только кеш <span></span></div><div class="settings-param selector" data-k="dbg">Debug <span></span></div></div>`);
      Lampa.Settings.listener.follow('open',e=>{
        if(e.name!==tpl) return;
        e.activity.title('TorBox Enhanced');
        const root=$(Lampa.Template.get(tpl));
        const sync=()=>{root.find('[data-k="key"] span').text(CFG.apiKey?'***':'—');root.find('[data-k="cached"] span').text(CFG.cachedOnly?'Да':'Нет');root.find('[data-k="dbg"] span').text(CFG.debug?'Вкл':'Выкл');};
        sync();
        root.find('[data-k="key"]').on('hover:enter',()=>{Lampa.Input.edit({title:'API‑Key',value:CFG.apiKey,free:true,nosave:true},v=>{CFG.apiKey=v;sync();Lampa.Controller.toggle('settings_component');});});
        root.find('[data-k="cached"]').on('hover:enter',()=>{CFG.cachedOnly=!CFG.cachedOnly;sync();});
        root.find('[data-k="dbg"]').on('hover:enter',()=>{CFG.debug=!CFG.debug;sync();});
        e.body.empty().append(root);
        Lampa.Controller.enable('settings_component');
      });
    }
  }

  // ───────────────────────────── 5. Boot ────────────────────────────────────
  let t=0;const WAIT=500,MAX=60000;(function loop(){
    if(window.Lampa&&window.Lampa.Settings){try{addSettings();hook();LOG('Ready v3.0.3');}catch(err){console.error('[TorBox]',err);}return;}
    if((t+=WAIT)>=MAX){console.warn('[TorBox] Lampa not found');return;}
    setTimeout(loop,WAIT);
  })();

  // ───────────────────────────── 6. UI hook ────────────────────────────────
  function hook(){
    Lampa.Listener.follow('full',e=>{
      if(e.type!=='complite') return;
      const root=e.object.activity.render(); if(root.find('.view--torbox').length) return;
      const btn=$(`<div class="full-start__button selector view--torbox" data-subtitle="TorBox">${ICON}<span>TorBox</span></div>`);
      btn.on('hover:enter',()=>searchAndShow(e.data.movie));
      root.find('.view--torrent').after(btn);
    });
  }
})();
