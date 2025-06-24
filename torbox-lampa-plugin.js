/*
 * TorBox Enhanced – Universal Lampa Plugin v3.0.1 (2025‑06‑24)
 * ===========================================================
 * 🔹 Fix #CORS (400 preflight): запрос к search‑api идёт БЕЗ заголовка Authorization,
 *   поэтому префлайт не нужен и ошибка исчезает.
 * 🔹 Убрана дублирующая строка в API.search (syntax error).
 * 🔹 Версия и PLUGIN_ID обновлены, сообщение DBG показывает 3.0.1.
 */

(function(){
  'use strict';

  // ────────────────────────────── 0. Guard double‑load ─────────────────────────
  const PLUGIN_ID = 'torbox_enhanced_v3_0_1';
  if (window[PLUGIN_ID]) return;
  window[PLUGIN_ID] = true;

  // ───────────────────────────────────── 1. Utils ──────────────────────────────
  const ICON_SVG = `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 7L12 2L21 7V17L12 22L3 17V7Z" stroke="currentColor" stroke-width="2"/>
      <path d="M12 22V12" stroke="currentColor" stroke-width="2"/>
      <path d="M21 7L12 12L3 7" stroke="currentColor" stroke-width="2"/>
    </svg>`;

  const Storage = {
    get(k,d){try{return localStorage.getItem(k)??d;}catch{return d;}},
    set(k,v){try{localStorage.setItem(k,String(v));}catch{}}
  };
  const CFG = {
    get apiKey(){return Storage.get('torbox_api_key','');},
    set apiKey(v){Storage.set('torbox_api_key',v.trim());},
    get debug(){return Storage.get('torbox_debug','false')==='true';},
    set debug(v){Storage.set('torbox_debug',!!v);},
    get cachedOnly(){return Storage.get('torbox_cached_only','false')==='true';},
    set cachedOnly(v){Storage.set('torbox_cached_only',!!v);}
  };
  const DBG = (...a)=>CFG.debug&&console.log('[TorBox]',...a);

  // ───────────────────────────── 2. TorBox API ────────────────────────────────
  const API={
    BASE:'https://api.torbox.app/v1/api',
    SEARCH:'https://search-api.torbox.app',

    async _req(key,endpoint,qs={},method='GET',base=this.BASE){
      if(base===this.BASE&&!key) throw new Error('TorBox: API‑Key не указан');
      let url=`${base}${endpoint}`;
      const opt={method,headers:{}};
      if(key) opt.headers.Authorization=`Bearer ${key}`;
      if(method==='GET'){
        if(Object.keys(qs).length) url+='?'+new URLSearchParams(qs).toString();
      }else{
        opt.headers['Content-Type']='application/json';
        opt.body=JSON.stringify(qs);
      }
      const res=await fetch(url,opt);
      const json=await res.json();
      if(!res.ok) throw new Error(json.error||json.message||`HTTP ${res.status}`);
      return json;
    },

    search(meta){
      const term = meta?.imdb_id ? `imdb:${meta.imdb_id}` : meta.title;
      const safe = encodeURIComponent(term).replace(/%3A/gi, ':');
      return this._req(null, `/torrents/search/${safe}`, {metadata:'true',check_cache:'true'}, 'GET', this.SEARCH);
    },

    addMagnet(m){return this._req(CFG.apiKey,'/torrents/createtorrent',{magnet:m},'POST');},
    files(id){return this._req(CFG.apiKey,'/torrents/mylist',{id}).then(r=>r.data?.[0]?.files||[]);},
    dl(tid,fid){return this._req(CFG.apiKey,'/torrents/requestdl',{torrent_id:tid,file_id:fid}).then(r=>r.data);}  
  };

  function qualityLabel(n){n=n.toLowerCase();if(n.includes('2160')||n.includes('4k'))return'4K';if(n.includes('1080'))return'1080p';if(n.includes('720'))return'720p';return'';}

  // ───────────────────────────── 3. UI Flows ─────────────────────────────────
  async function searchAndShow(movie){
    Lampa.Loading.start('TorBox: поиск…');
    try{
      const res=await API.search(movie);
      const list=res.data?.torrents||[];
      if(!list.length) return Lampa.Noty.show('TorBox: ничего не найдено');
      const show=CFG.cachedOnly?list.filter(t=>t.cached):list;
      if(!show.length) return Lampa.Noty.show('Нет кэшированных результатов');
      const items=show.sort((a,b)=>(b.seeders||0)-(a.seeders||0)).map(t=>({
        title:`${t.cached?'⚡':'☁️'} ${t.name||'–'}`,
        subtitle:`${(t.size/2**30).toFixed(2)} GB | 🟢${t.seeders||0}`,
        torrent:t
      }));
      Lampa.Select.show({title:'TorBox: результаты',items,onSelect:i=>handleTorrent(i.torrent,movie,show),onBack:()=>Lampa.Controller.toggle('content')});
    }catch(e){Lampa.Noty.show(e.message,{type:'error'});}finally{Lampa.Loading.stop();}
  }

  async function handleTorrent(t,movie,full){
    Lampa.Loading.start('TorBox…');
    try{
      if(t.cached){
        const files=await API.files(t.id);
        const vids=files.filter(f=>/\.(mkv|mp4|avi)$/i.test(f.name));
        if(!vids.length) return Lampa.Noty.show('Видео‑файлы не найдены');
        if(vids.length===1) return play(t.id,vids[0],movie);
        vids.sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
        Lampa.Select.show({title:'TorBox: файлы',items:vids.map(f=>({title:f.name,subtitle:`${(f.size/2**30).toFixed(2)} GB ${qualityLabel(f.name)}`,file:f})),onSelect:i=>play(t.id,i.file,movie),onBack:()=>displayBack(full,movie)});
      }else{
        await API.addMagnet(t.magnet);
        Lampa.Noty.show('TorBox: торрент отправлен, ждите кеш');
      }
    }catch(e){Lampa.Noty.show(e.message,{type:'error'});}finally{Lampa.Loading.stop();}
  }

  function displayBack(list,movie){
    const items=list.map(t=>({title:`${t.cached?'⚡':'☁️'} ${t.name}`,subtitle:`${(t.size/2**30).toFixed(2)} GB | 🟢${t.seeders||0}`,torrent:t}));
    Lampa.Select.show({title:'TorBox',items,onSelect:i=>handleTorrent(i.torrent,movie,list),onBack:()=>Lampa.Controller.toggle('content')});
  }

  async function play(tid,file,movie){
    Lampa.Loading.start('TorBox: ссылка…');
    try{
      const url=await API.dl(tid,file.id);
      if(!url) throw new Error('TorBox: пустой URL');
      Lampa.Player.play({url,title:file.name||movie.title,poster:movie.img});
      Lampa.Player.callback(Lampa.Activity.backward);
    }catch(e){Lampa.Noty.show(e.message,{type:'error'});}finally{Lampa.Loading.stop();}
  }

  // ───────────────────────── 4. Settings (API / Legacy) ──────────────────────
  const COMPONENT='torbox_enhanced_settings';

  function settingsApi(){
    Lampa.SettingsApi.addComponent({component:COMPONENT,name:'TorBox Enhanced',icon:ICON_SVG});
    const fields=[
      {k:'torbox_api_key',n:'API‑Key',d:'Персональный ключ TorBox',t:'input',def:CFG.apiKey},
      {k:'torbox_cached_only',n:'Только кэшированные',d:'Скрывать не кеш',t:'trigger',def:CFG.cachedOnly},
      {k:'torbox_debug',n:'Debug‑режим',d:'Расширенный лог',t:'trigger',def:CFG.debug}
    ];
    fields.forEach(p=>{
      Lampa.SettingsApi.addParam({component:COMPONENT,param:{name:p.k,type:p.t,values:'',default:p.def},field:{name:p.n,description:p.d},onChange:v=>{if(p.t==='input')CFG.apiKey=v;else if(p.k==='torbox_cached_only')CFG.cachedOnly=v;else CFG.debug=v;}});
    });
  }

  function settingsLegacy(){
    const folder=`<div class="settings-folder selector" data-component="${COMPONENT}"><div class="settings-folder__icon">${ICON_SVG}</div><div class="settings-folder__name">TorBox Enhanced</div></div>`;
    Lampa.Settings.main().render().find('[data-component="more"]').after($(folder));
    const tpl='settings_'+COMPONENT;
    if(!Lampa.Template.get(tpl)){
      Lampa.Template.add(tpl,`<div class="settings-torbox"><div class="settings-param selector" data-key="torbox_api_key">API‑Key <span></span></div><div class="settings-param selector" data-key="torbox_cached_only">Только кеш <span></span></div><div class="settings-param selector" data-key="torbox_debug">Debug <span></span></div></div>`);
    }
    Lampa.Settings.listener.follow('open',e=>{
      if(e.name!==tpl) return;
      e.activity.title('TorBox Enhanced');
      const root=$(Lampa.Template.get(tpl));
      const sync=()=>{root.find('[data-key="torbox_api_key"] span').text(CFG.apiKey?'***':'—');root.find('[data-key="torbox_cached_only"] span').text(CFG.cachedOnly?'Да':'Нет');root.find('[data-key="torbox_debug"] span').text(CFG.debug?'Вкл':'Выкл');};
      sync();
      root.find('[data-key="torbox_api_key"]').on('hover:enter',()=>{Lampa.Input.edit({title:'API‑Key TorBox',value:CFG.apiKey,free:true,nosave:true},v=>{CFG.apiKey=v;sync();Lampa.Controller.toggle('settings_component');});});
      root.find('[data-key="torbox_cached_only"]').on('hover:enter',()=>{CFG.cachedOnly=!CFG.cachedOnly;sync();});
      root.find('[data-key="torbox_debug"]').on('hover:enter',()=>{CFG.debug=!CFG.debug;sync();});
      e.body.empty().append(root);
      Lampa.Controller.enable('settings_component');
    });
  }

  // ───────────────────────────── 5. Boot logic ───────────────────────────────
  const WAIT=500,MAX=60000;let spent=0;
  (function boot(){
    if(window.Lampa&&window.Lampa.Settings){
      try{window.Lampa.SettingsApi?settingsApi():settingsLegacy();hookUI();DBG('TorBox Enhanced ready v3.0.1');}catch(e){console.error('[TorBox] init error',e);}return;}
    if((spent+=WAIT)>=MAX){console.warn('[TorBox] Lampa not detected – abort');return;}
    setTimeout(boot,WAIT);
  })();

  // ───────────────────────────── 6. UI hooks ────────────────────────────────
  function hookUI(){
    Lampa.Listener.follow('full',e=>{
      if(e.type!=='complite')return;
      const root=e.object.activity.render();
      if(root.find('.view--torbox').length)return;
      const btn=$(`<div class="full-start__button selector view--torbox" data-subtitle="TorBox">${ICON_SVG}<span>TorBox</span></div>`);
      btn.on('hover:enter',()=>searchAndShow(e.data.movie));
      root.find('.view--torrent').after(btn);
    });
  }
})();
