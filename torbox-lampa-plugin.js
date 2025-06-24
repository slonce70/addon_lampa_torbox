/*
 * TorBox Enhanced – Universal Lampa Plugin v3.0.5 (2025‑06‑24)
 * ============================================================
 * • Search снова через core API `/v1/api/torrents/search/{query}` **с Bearer**, но
 *   запрос проксируется через corsproxy.io – так префлайт проходит.
 * • Другие методы (files/dl/addMagnet) остаются прямыми.
 * • Исправлен баг с encodeURIComponent – `:` больше не кодируется.
 */

(function(){
  'use strict';

  const PLUGIN_ID='torbox_enhanced_v3_0_5';
  if(window[PLUGIN_ID]) return; window[PLUGIN_ID]=true;

  const ICON=`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 7L12 2L21 7V17L12 22L3 17V7Z" stroke="currentColor" stroke-width="2"/><path d="M12 22V12" stroke="currentColor" stroke-width="2"/><path d="M21 7L12 12L3 7" stroke="currentColor" stroke-width="2"/></svg>`;

  const S={g:(k,d)=>{try{return localStorage.getItem(k)??d;}catch{return d;}},s:(k,v)=>{try{localStorage.setItem(k,String(v));}catch{}}};
  const CFG={get key(){return S.g('torbox_api_key','');},set key(v){S.s('torbox_api_key',v.trim());},get dbg(){return S.g('torbox_debug','false')==='true';},set dbg(v){S.s('torbox_debug',!!v);},get cached(){return S.g('torbox_cached_only','false')==='true';},set cached(v){S.s('torbox_cached_only',!!v);}};
  const LOG=(...a)=>CFG.dbg&&console.log('[TorBox]',...a);
  const CORS=u=>`https://corsproxy.io/?${encodeURIComponent(u)}`;

  // ── API
  const API={
    BASE:'https://api.torbox.app/v1/api',

    async _fetch(path,q={},method='GET'){
      if(!CFG.key) throw new Error('TorBox: API‑Key не указан');
      let url=`${this.BASE}${path}`;
      if(method==='GET'&&Object.keys(q).length) url+='?'+new URLSearchParams(q).toString();
      const opt={method,headers:{Authorization:`Bearer ${CFG.key}`}};
      if(method!=='GET'){opt.headers['Content-Type']='application/json';opt.body=JSON.stringify(q);} 
      const r=await fetch(url,opt);const j=await r.json(); if(!r.ok) throw new Error(j.error||j.message||`HTTP ${r.status}`); return j;
    },

    // search via CORS proxy
    async search(term){
      const safe=encodeURIComponent(term).replace(/%3A/ig,':');
      const url=CORS(`${this.BASE}/torrents/search/${safe}?metadata=true&check_cache=true`);
      const r=await fetch(url,{headers:{Authorization:`Bearer ${CFG.key}`}});
      const j=await r.json(); if(!j.success&&j.error) throw new Error(j.message||j.error); return j;
    },

    add(m){return this._fetch('/torrents/createtorrent',{magnet:m},'POST');},
    files(id){return this._fetch('/torrents/mylist',{id}).then(r=>r.data?.[0]?.files||[]);},
    dl(tid,fid){return this._fetch('/torrents/requestdl',{torrent_id:tid,file_id:fid}).then(r=>r.data);}  
  };

  const ql=n=>{n=n.toLowerCase();if(n.includes('2160')||n.includes('4k'))return'4K';if(n.includes('1080'))return'1080p';if(n.includes('720'))return'720p';return'';};

  async function searchAndShow(movie){
    Lampa.Loading.start('TorBox: поиск…');
    try{
      const term=movie?.imdb_id?`imdb:${movie.imdb_id}`:movie.title;
      const res=await API.search(term);
      const list=res.data?.torrents||[];
      if(!list.length) return Lampa.Noty.show('TorBox: ничего не найдено');
      const show=CFG.cached?list.filter(t=>t.cached):list;
      if(!show.length) return Lampa.Noty.show('Нет кэшированных');
      const items=show.sort((a,b)=>(b.seeders||0)-(a.seeders||0)).map(t=>({title:`${t.cached?'⚡':'☁️'} ${t.name}`,subtitle:`${(t.size/2**30).toFixed(2)} GB | 🟢${t.seeders||0}`,torrent:t}));
      Lampa.Select.show({title:'TorBox',items,onSelect:i=>handleTorrent(i.torrent,movie),onBack:()=>Lampa.Controller.toggle('content')});
    }catch(e){Lampa.Noty.show(e.message,{type:'error'});}finally{Lampa.Loading.stop();}
  }

  async function handleTorrent(t,movie){
    Lampa.Loading.start('TorBox…');
    try{
      if(t.cached){
        const files=await API.files(t.id);
        const vids=files.filter(f=>/\.(mkv|mp4|avi)$/i.test(f.name));
        if(!vids.length) return Lampa.Noty.show('Видео не найдены');
        if(vids.length===1) return play(t.id,vids[0],movie);
        vids.sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
        Lampa.Select.show({title:'TorBox: файлы',items:vids.map(f=>({title:f.name,subtitle:`${(f.size/2**30).toFixed(2)} GB ${ql(f.name)}`,file:f})),onSelect:i=>play(t.id,i.file,movie),onBack:()=>searchAndShow(movie)});
      }else{await API.add(t.magnet);Lampa.Noty.show('Отправлено в TorBox, ждите кеш');}
    }catch(e){Lampa.Noty.show(e.message,{type:'error'});}finally{Lampa.Loading.stop();}
  }

  async function play(tid,file,movie){
    Lampa.Loading.start('TorBox: ссылка…');
    try{const u=await API.dl(tid,file.id);if(!u) throw new Error('Пустой URL');Lampa.Player.play({url:u,title:file.name||movie.title,poster:movie.img});Lampa.Player.callback(Lampa.Activity.backward);}catch(e){Lampa.Noty.show(e.message,{type:'error'});}finally{Lampa.Loading.stop();}
  }

  // Settings
  const COMP='torbox_enh';
  function settings(){
    (Lampa.SettingsApi?addApi:addLegacy)();
    function addApi(){
      Lampa.SettingsApi.addComponent({component:COMP,name:'TorBox Enhanced',icon:ICON});
      const p=[
        ['torbox_api_key','API‑Key','Ключ TorBox','input',CFG.key],
        ['torbox_cached_only','Только кеш','Скрывать не кеш','trigger',CFG.cached],
        ['torbox_debug','Debug','Расширенный лог','trigger',CFG.dbg]
      ];
      p.forEach(([k,n,d,t,def])=>Lampa.SettingsApi.addParam({component:COMP,param:{name:k,type:t,values:'',default:def},field:{name:n,description:d},onChange:v=>{if(k==='torbox_api_key')CFG.key=v;else if(k==='torbox_cached_only')CFG.cached=v;else CFG.dbg=v;}}));
    }
    function addLegacy(){
      const html=`<div class="settings-folder selector" data-component="${COMP}"><div class="settings-folder__icon">${ICON}</div><div class="settings-folder__name">TorBox Enhanced</div></div>`;
      Lampa.Settings.main().render().find('[data-component="more"]').after($(html));
      const tpl='settings_'+COMP;
      if(!Lampa.Template.get(tpl))Lampa.Template.add(tpl,`<div class="torbox-set"><div class="settings-param selector" data-k="key">API‑Key <span></span></div><div class="settings-param selector" data-k="cached">Только кеш <span></span></div><div class="settings-param selector" data-k="dbg">Debug <span></span></div></div>`);
      Lampa.Settings.listener.follow('open',e=>{if(e.name!==tpl)return;const r=$(Lampa.Template.get(tpl));const sync=()=>{r.find('[data-k="key"] span').text(CFG.key?'***':'—');r.find('[data-k="cached"] span').text(CFG.cached?'Да':'Нет');r.find('[data-k="dbg"] span').text(CFG.dbg?'Вкл':'Выкл');};sync();r.find('[data-k="key"]').on('hover:enter',()=>{Lampa.Input.edit({title:'API‑Key',value:CFG.key,free:true,nosave:true},v=>{CFG.key=v;sync();Lampa.Controller.toggle('settings_component');});});r.find('[data-k="cached"]').on('hover:enter',()=>{CFG.cached=!CFG.cached;sync();});r.find('[data-k="dbg"]').on('hover:enter',()=>{CFG.dbg=!CFG.dbg;sync();});e.activity.title('TorBox Enhanced');e.body.empty().append(r);Lampa.Controller.enable('settings_component');});
    }
  }

  // Boot
  let t=0,const WAIT=500,MAX=60000; (function loop(){if(window.Lampa&&window.Lampa.Settings){try{settings();hook();LOG('TorBox ready v3.0.5');}catch(e){console.error('[TorBox]',e);}return;}if((t+=WAIT)>=MAX){console.warn('[TorBox] Lampa not found');return;}setTimeout(loop,WAIT);} )();

  function hook(){Lampa.Listener.follow('full',e=>{if(e.type!=='complite')return;const root=e.object.activity.render();if(root.find('.view--torbox').length)return;const btn=$(`<div class="full-start__button selector view--torbox" data-subtitle="TorBox">${ICON}<span>Tor
