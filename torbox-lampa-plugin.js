/*
 * TorBox Enhanced – Universal Lampa Plugin v3.0.3 (2025‑06‑24)
 * ============================================================
 * 🔄 **Major fix:** Search API требует заголовок **X-Api-Key** (а не Bearer) и
 *     другой endpoint `btm.tools/api/torrents/search`.
 *     Теперь поиск идёт туда, с ключом X-Api-Key + автоматический CORS‑proxy.
 * 🔹 Убрана proxy‑обёртка для main API (оно принимает Bearer → CORS O K);
 *     proxy используется только для `btm.tools` из‑за CORS.
 * 🔹 Версия/PLUGIN_ID bump → `torbox_enhanced_v3_0_3`.
 */

(function(){
  'use strict';

  // ───────────────────────────── 0. Guard double‑load ─────────────────────────
  const PLUGIN_ID='torbox_enhanced_v3_0_3';
  if(window[PLUGIN_ID])return;window[PLUGIN_ID]=true;

  // ───────────────────────────────────── 1. Utils ─────────────────────────────
  const ICON=`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 7L12 2L21 7V17L12 22L3 17V7Z" stroke="currentColor" stroke-width="2"/><path d="M12 22V12" stroke="currentColor" stroke-width="2"/><path d="M21 7L12 12L3 7" stroke="currentColor" stroke-width="2"/></svg>`;
  const Storage={get:(k,d)=>{try{return localStorage.getItem(k)??d;}catch{return d;}},set:(k,v)=>{try{localStorage.setItem(k,String(v));}catch{}}};
  const CFG={get apiKey(){return Storage.get('torbox_api_key','');},set apiKey(v){Storage.set('torbox_api_key',v.trim());},get debug(){return Storage.get('torbox_debug','false')==='true';},set debug(v){Storage.set('torbox_debug',!!v);},get cachedOnly(){return Storage.get('torbox_cached_only','false')==='true';},set cachedOnly(v){Storage.set('torbox_cached_only',!!v);}};
  const DBG=(...a)=>CFG.debug&&console.log('[TorBox]',...a);

  const CORS=(url)=>`https://corsproxy.io/?${encodeURIComponent(url)}`;

  // ───────────────────────────── 2. TorBox API ────────────────────────────────
  const API={
    BASE:'https://api.torbox.app/v1/api',
    SEARCH:'https://btm.tools/api', // docs: https://github.com/jittarao/torbox-app

    async _reqBearer(endpoint,qs={},method='GET'){
      if(!CFG.apiKey)throw new Error('TorBox: API‑Key не указан');
      let url=`${this.BASE}${endpoint}`;
      if(method==='GET'&&Object.keys(qs).length)url+='?'+new URLSearchParams(qs).toString();
      const opt={method,headers:{Authorization:`Bearer ${CFG.apiKey}`}};
      if(method!=='GET'){opt.headers['Content-Type']='application/json';opt.body=JSON.stringify(qs);} 
      const r=await fetch(url,opt);const j=await r.json();if(!r.ok)throw new Error(j.error||j.message||`HTTP ${r.status}`);return j;
    },

    async _reqSearch(term){
      if(!CFG.apiKey)throw new Error('TorBox: API‑Key не указан');
      const url=CORS(`${this.SEARCH}/torrents/search?query=${encodeURIComponent(term)}&search_user_engines=true`);
      const opt={method:'GET',headers:{'X-Api-Key':CFG.apiKey}};
      const r=await fetch(url,opt);const j=await r.json();if(!r.success&&!j.success)throw new Error(j.message||'Search error');return j;
    },

    search(meta){const term=meta?.imdb_id?`imdb:${meta.imdb_id}`:meta.title;return this._reqSearch(term);},
    addMagnet(m){return this._reqBearer('/torrents/createtorrent',{magnet:m},'POST');},
    files(id){return this._reqBearer('/torrents/mylist',{id}).then(r=>r.data?.[0]?.files||[]);},
    dl(tid,fid){return this._reqBearer('/torrents/requestdl',{torrent_id:tid,file_id:fid}).then(r=>r.data);}  
  };

  const ql=(n)=>{n=n.toLowerCase();if(n.includes('2160')||n.includes('4k'))return'4K';if(n.includes('1080'))return'1080p';if(n.includes('720'))return'720p';return'';};

  // ───────────────────────────── 3. UI flows ─────────────────────────────────
  async function searchAndShow(movie){
    Lampa.Loading.start('TorBox: поиск…');
    try{
      const res=await API.search(movie);
      const list=res.data?.torrents||[];
      if(!list.length)return Lampa.Noty.show('TorBox: ничего не найдено');
      const show=CFG.cachedOnly?list.filter(t=>t.cached):list;
      if(!show.length)return Lampa.Noty.show('Нет кэшированных');
      const items=show.sort((a,b)=>(b.seeders||0)-(a.seeders||0)).map(t=>({title:`${t.cached?'⚡':'☁️'} ${t.name}`,subtitle:`${(t.size/2**30).toFixed(2)} GB | 🟢${t.seeders||0}`,torrent:t}));
      Lampa.Select.show({title:'TorBox',items,onSelect:i=>handleTorrent(i.torrent,movie,show),onBack:()=>Lampa.Controller.toggle('content')});
    }catch(e){Lampa.Noty.show(e.message,{type:'error'});}finally{Lampa.Loading.stop();}
  }

  async function handleTorrent(t,movie,all){
    Lampa.Loading.start('TorBox…');
    try{
      if(t.cached){const files=await API.files(t.id);const vids=files.filter(f=>/\.(mkv|mp4|avi)$/i.test(f.name));if(!vids.length)return Lampa.Noty.show('Видео не найдены');if(vids.length===1)return play(t.id,vids[0],movie);
        vids.sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
        Lampa.Select.show({title:'TorBox: файлы',items:vids.map(f=>({title:f.name,subtitle:`${(f.size/2**30).toFixed(2)} GB ${ql(f.name)}`,file:f})),onSelect:i=>play(t.id,i.file,movie),onBack:()=>searchAndShow(movie)});
      }else{await API.addMagnet(t.magnet);Lampa.Noty.show('Отправлено в TorBox, ждите кеш');}
    }catch(e){Lampa.Noty.show(e.message,{type:'error'});}finally{Lampa.Loading.stop();}
  }

  async function play(tid,file,movie){
    Lampa.Loading.start('TorBox: ссылка…');
    try{const url=await API.dl(tid,file.id);if(!url)throw new Error('Пустой URL');Lampa.Player.play({url,title:file.name||movie.title,poster:movie.img});Lampa.Player.callback(Lampa.Activity.backward);}catch(e){Lampa.Noty.show(e.message,{type:'error'});}finally{Lampa.Loading.stop();}
  }

  // ───────────────────────────── 4. Settings ────────────────────────────────
  const COMP='torbox_settings';
  function addSettings(){
    if(window.Lampa.SettingsApi){
      Lampa.SettingsApi.addComponent({component:COMP,name:'TorBox Enhanced',icon:ICON});
      const f=[{k:'torbox_api_key',n:'API‑Key',d:'Ключ TorBox',t:'input',def:CFG.apiKey},{k:'torbox_cached_only',n:'Только кеш',d:'Скрывать не кеш',t:'trigger',def:CFG.cachedOnly},{k:'torbox_debug',n:'Debug',d:'Расширенный лог',t:'trigger',def:CFG.debug}];
      f.forEach(p=>Lampa.SettingsApi.addParam({component:COMP,param:{name:p.k,type:p.t,values:'',default:p.def},field:{name:p.n,description:p.d},onChange:v=>{if(p.t==='input')CFG.apiKey=v;else if(p.k==='torbox_cached_only')CFG.cachedOnly=v;else CFG.debug=v;}}));
    }else{
      const html=`<div class="settings-folder selector" data-component="${COMP}"><div class="settings-folder__icon">${ICON}</div><div class="settings-folder__name">TorBox Enhanced</div></div>`;Lampa.Settings.main().render().find('[data-component="more"]').after($(html));
      const tpl='settings_'+COMP;if(!Lampa.Template.get(tpl)){Lampa.Template.add(tpl,`<div class="settings-torbox"><div class="settings-param selector" data-k="apikey">API‑Key <span></span></div><div class="settings-param selector" data-k="cached">Только кеш <span></span></div><div class="settings-param selector" data-k="debug">Debug <span></span></div></div>`);} 
      Lampa.Settings.listener.follow('open',e=>{if(e.name!==tpl)return;const root=$(Lampa.Template.get(tpl));const sync=()=>{root.find('[data-k="apikey"] span').text(CFG.apiKey?'***':'—');root.find('[data-k="cached"] span').text(CFG.cachedOnly?'Да':'Нет');root.find('[data-k="debug"] span').text(CFG.debug?'Вкл':'Выкл');};sync();root.find('[data-k="apikey"]').on('hover:enter',()=>{Lampa.Input.edit({title:'API‑Key TorBox',value:CFG.apiKey,free:true,nosave:true},v=>{CFG.apiKey=v;sync();Lampa.Controller.toggle('settings_component');});});root.find('[data-k="cached"]').on('hover:enter',()=>{CFG.cachedOnly=!CFG.cachedOnly;sync();});root.find('[data-k="debug"]').on('hover:enter',()=>{CFG.debug=!CFG.debug;sync();});e.body.empty().append(root);Lampa.Controller.enable('settings_component');});
    }
  }

  // ───────────────────────────── 5. Boot ────────────────────────────────────
  const WAIT=500,MAX=60000;let t=0;(function init(){if(window.Lampa&&window.Lampa.Settings){try{addSettings();hook();DBG('TorBox Enhanced ready v3.0.3');}catch(err){console.error('[TorBox] init error',err);}return;}if((t+=WAIT)>=MAX){console.warn('[TorBox] Lampa not detected');return;}setTimeout(init,WAIT);} )();

  // ───────────────────────────── 6. UI hook ────────────────────────────────
  function hook(){Lampa.Listener.follow('full',e=>{if(e.type!=='complite')return;const r=e.object.activity.render();if(r.find('.view--torbox').length)return;const b=$(`<div class="full-start__button selector view--torbox" data-subtitle="TorBox">${ICON}<span>TorBox</span></div>`);b.on('hover:enter',()=>searchAndShow(e.data.movie));r.find('.view--torrent').after(b);});}
})();
