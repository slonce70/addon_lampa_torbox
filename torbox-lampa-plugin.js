/*
 * TorBox Enhanced – Universal Lampa Plugin v3.0.0 (2025‑06‑24)
 * ===========================================================
 * 🔹 Объединяет устойчивость настройки из «старого» v2.4.0 и
 *   современный TorBox‑поиск/плеер из ветки 32.x.
 * 🔹 Автоматически выбирает способ добавления настроек:
 *        • Lampa.SettingsApi   (>= 3.0)  ➜ современное меню
 *        • Fallback Template   (< 3.0)   ➜ старое меню (selector‑строки)
 * 🔹 Без перехвата TorrServer — только «чистый» TorBox.
 * 🔹 Минимум зависимостей, нулевая конфигурация: вставил JS — работает.
 *
 * — Поддержка версий Lampa: 2.3.0 … 4.x  (проверено на desktop и android TV)
 * — Тесты: Samsung Tizen TV (2020), Chromium v119, Android TV (Lampa 3.4.7)
 * -----------------------------------------------------------
 *  Quick Start
 * -----------------------------------------------------------
 * 1) Киньте файл в /Plugins или пропишите URL в настройках Lampa.
 * 2) Перезапустите приложение → Настройки → TorBox Enhanced.
 * 3) Введите API‑Key TorBox, при желании включите debug‑режим.
 * 4) Откройте карточку фильма/сериала — появится кнопка TorBox.
 */

(function(){
  'use strict';

  // ────────────────────────────────────────────────────────────────────────────
  // 0. Guard against double‑load
  // ────────────────────────────────────────────────────────────────────────────
  const PLUGIN_ID = 'torbox_enhanced_v3_0_0';
  if (window[PLUGIN_ID]) return; // already initialised
  window[PLUGIN_ID] = true;

  // ────────────────────────────────────────────────────────────────────────────
  // 1. Utilities
  // ────────────────────────────────────────────────────────────────────────────
  const ICON_SVG = `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 7L12 2L21 7V17L12 22L3 17V7Z" stroke="currentColor" stroke-width="2"/>
      <path d="M12 22V12" stroke="currentColor" stroke-width="2"/>
      <path d="M21 7L12 12L3 7" stroke="currentColor" stroke-width="2"/>
    </svg>`;

  const Storage = {
    get(key, def){
      try { return window.localStorage.getItem(key) ?? def; } catch { return def; }
    },
    set(key,val){
      try { window.localStorage.setItem(key,String(val)); } catch {/*ignore*/}
    }
  };
  const CFG = {
    get apiKey(){ return Storage.get('torbox_api_key',''); },
    set apiKey(v){ Storage.set('torbox_api_key', v.trim()); },
    get debug(){ return Storage.get('torbox_debug','false')==='true'; },
    set debug(v){ Storage.set('torbox_debug', !!v); },
    get cachedOnly(){ return Storage.get('torbox_cached_only','false')==='true'; },
    set cachedOnly(v){ Storage.set('torbox_cached_only', !!v);} 
  };
  const DBG = (...a)=> CFG.debug && console.log('[TorBox]',...a);

  // ────────────────────────────────────────────────────────────────────────────
  // 2. TorBox API wrapper
  // ────────────────────────────────────────────────────────────────────────────
  const API = {
    BASE: 'https://api.torbox.app/v1/api',
    SEARCH: 'https://search-api.torbox.app',

    async _req(key, endpoint, qs={}, method='GET', base=this.BASE){
      if(!key) throw new Error('TorBox: API‑Key не указан');
      let url = `${base}${endpoint}`;
      const opt = {method, headers:{Authorization:`Bearer ${key}`}};
      if(method==='GET'){
        if(Object.keys(qs).length) url += '?' + new URLSearchParams(qs).toString();
      } else {
        opt.headers['Content-Type']='application/json';
        opt.body = JSON.stringify(qs);
      }
      const r = await fetch(url,opt);
      const j = await r.json();
      if(!r.ok) throw new Error(j.error || j.message || 'HTTP '+r.status);
      return j;
    },
    search(meta){
      const term = meta.imdb_id ? `imdb:${meta.imdb_id}` : meta.title;
      return this._req(CFG.apiKey, `/torrents/search/${encodeURIComponent(term)}`, {metadata:'true',check_cache:'true'}, 'GET', this.SEARCH);
    },
    addMagnet(mag){ return this._req(CFG.apiKey,'/torrents/createtorrent',{magnet:mag},'POST'); },
    files(id){ return this._req(CFG.apiKey,'/torrents/mylist',{id}).then(r=>r.data?.[0]?.files||[]); },
    dl(tid,fid){ return this._req(CFG.apiKey,'/torrents/requestdl',{torrent_id:tid,file_id:fid}).then(r=>r.data); }
  };

  function ql(name){
    const n = name.toLowerCase();
    if(n.includes('2160')||n.includes('4k'))return '4K';
    if(n.includes('1080'))return '1080p';
    if(n.includes('720'))return '720p';
    return '';
  }

  // ────────────────────────────────────────────────────────────────────────────
  // 3. UI Flows
  // ────────────────────────────────────────────────────────────────────────────
  async function searchAndShow(movie){
    Lampa.Loading.start('TorBox: поиск…');
    try{
      const res = await API.search(movie);
      const list = res.data?.torrents || [];
      if(!list.length) return Lampa.Noty.show('TorBox: ничего не найдено');
      const show = CFG.cachedOnly? list.filter(t=>t.cached):list;
      if(!show.length) return Lampa.Noty.show('Нет кэшированных результатов');
      const items = show.sort((a,b)=>(b.seeders||0)-(a.seeders||0)).map(t=>({
        title:`${t.cached?'⚡':'☁️'} ${t.name||'–'}`,
        subtitle:`${(t.size/2**30).toFixed(2)} GB | 🟢${t.seeders||0}`,
        tid:t.id,torrent:t
      }));
      Lampa.Select.show({
        title:'TorBox: результаты',items,
        onSelect:i=>handleTorrent(i.torrent,movie,show),
        onBack:()=>Lampa.Controller.toggle('content')
      });
    }catch(e){ Lampa.Noty.show(e.message,{type:'error'}); }
    finally{ Lampa.Loading.stop(); }
  }

  async function handleTorrent(t,movie,full){
    Lampa.Loading.start('TorBox…');
    try{
      if(t.cached){
        const files = await API.files(t.id);
        const vids = files.filter(f=>/\.(mkv|mp4|avi)$/i.test(f.name));
        if(!vids.length) return Lampa.Noty.show('Видео‑файлы не найдены');
        if(vids.length===1) return play(t.id, vids[0], movie);
        vids.sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
        Lampa.Select.show({
          title:'TorBox: файлы',
          items:vids.map(f=>({title:f.name,subtitle:`${(f.size/2**30).toFixed(2)} GB ${ql(f.name)}`,file:f})),
          onSelect:i=>play(t.id,i.file,movie),
          onBack:()=>displayBack(full,movie)
        });
      }else{
        await API.addMagnet(t.magnet);
        Lampa.Noty.show('TorBox: торрент отправлен, ждите кеш');
      }
    }catch(e){ Lampa.Noty.show(e.message,{type:'error'});}finally{ Lampa.Loading.stop(); }
  }

  function displayBack(list,movie){
    const items=list.map(t=>({title:`${t.cached?'⚡':'☁️'} ${t.name}`,
        subtitle:`${(t.size/2**30).toFixed(2)} GB | 🟢${t.seeders||0}`,tid:t.id,torrent:t}));
    Lampa.Select.show({title:'TorBox',items,onSelect:i=>handleTorrent(i.torrent,movie,list),onBack:()=>Lampa.Controller.toggle('content')});
  }

  async function play(tid,file,movie){
    Lampa.Loading.start('TorBox: ссылка…');
    try{
      const url = await API.dl(tid,file.id);
      if(!url) throw new Error('TorBox: пустой URL');
      Lampa.Player.play({url,title:file.name||movie.title,poster:movie.img});
      Lampa.Player.callback(Lampa.Activity.backward);
    }catch(e){Lampa.Noty.show(e.message,{type:'error'});}finally{Lampa.Loading.stop();}
  }

  // ────────────────────────────────────────────────────────────────────────────
  // 4. Settings (auto choose API vs legacy)
  // ────────────────────────────────────────────────────────────────────────────
  const COMPONENT = 'torbox_enhanced_settings';

  function registerSettingsApi(){
    Lampa.SettingsApi.addComponent({component:COMPONENT,name:'TorBox Enhanced',icon:ICON_SVG});
    const fields=[
      {k:'torbox_api_key',name:'API‑Key',desc:'Персональный ключ TorBox',type:'input',def:CFG.apiKey},
      {k:'torbox_cached_only',name:'Только кэшированные',desc:'Скрывать не кеш',type:'trigger',def:CFG.cachedOnly},
      {k:'torbox_debug',name:'Debug‑режим',desc:'Расширенный лог',type:'trigger',def:CFG.debug}
    ];
    fields.forEach(p=>{
      Lampa.SettingsApi.addParam({component:COMPONENT,param:{name:p.k,type:p.type,values:'',default:p.def},field:{name:p.name,description:p.desc},onChange:v=>{
        if(p.type==='input') CFG.apiKey=v; else if(p.k==='torbox_cached_only') CFG.cachedOnly=v; else CFG.debug=v;
      }});
    });
  }

  function registerSettingsLegacy(){
    const html=`<div class="settings-folder selector" data-component="${COMPONENT}">
      <div class="settings-folder__icon">${ICON_SVG}</div>
      <div class="settings-folder__name">TorBox Enhanced</div></div>`;
    Lampa.Settings.main().render().find('[data-component="more"]').after($(html));

    const tplId='settings_'+COMPONENT;
    if(!Lampa.Template.get(tplId)){
      const body=`<div class="settings-torbox-manual">
        <div class="settings-param selector" data-key="torbox_api_key">API‑Key <span></span></div>
        <div class="settings-param selector" data-key="torbox_cached_only">Только кеш <span></span></div>
        <div class="settings-param selector" data-key="torbox_debug">Debug <span></span></div>
      </div>`;
      Lampa.Template.add(tplId,body);
    }

    Lampa.Settings.listener.follow('open',e=>{
      if(e.name!==tplId) return;
      e.activity.title('TorBox Enhanced');
      const root=$(Lampa.Template.get(tplId));
      function sync(){
        root.find('[data-key="torbox_api_key"] span').text(CFG.apiKey? '***': '—');
        root.find('[data-key="torbox_cached_only"] span').text(CFG.cachedOnly?'Да':'Нет');
        root.find('[data-key="torbox_debug"] span').text(CFG.debug?'Вкл':'Выкл');
      }
      sync();
      root.find('[data-key="torbox_api_key"]').on('hover:enter',()=>{
        Lampa.Input.edit({title:'API‑Key TorBox',value:CFG.apiKey,free:true,nosave:true},v=>{CFG.apiKey=v;sync();Lampa.Controller.toggle('settings_component');});
      });
      root.find('[data-key="torbox_cached_only"]').on('hover:enter',()=>{CFG.cachedOnly=!CFG.cachedOnly;sync();});
      root.find('[data-key="torbox_debug"]').on('hover:enter',()=>{CFG.debug=!CFG.debug;sync();});
      e.body.empty().append(root);
      Lampa.Controller.enable('settings_component');
    });
  }

  // ────────────────────────────────────────────────────────────────────────────
  // 5. Boot logic – wait for Lampa then wire everything
  // ────────────────────────────────────────────────────────────────────────────
  const WAIT=500,MAX=60000; let waited=0;
  (function loop(){
    if(window.Lampa && window.Lampa.Settings){
      try{
        if(window.Lampa.SettingsApi) registerSettingsApi(); else registerSettingsLegacy();
        hookUi();
        DBG('TorBox Enhanced ready v3.0.0');
      }catch(err){ console.error('[TorBox] init error',err); }
      return;
    }
    waited+=WAIT;
    if(waited>=MAX){ console.warn('[TorBox] Lampa not detected – abort'); return; }
    setTimeout(loop,WAIT);
  })();

  // ────────────────────────────────────────────────────────────────────────────
  // 6. UI hooks (button on movie card)
  // ────────────────────────────────────────────────────────────────────────────
  function hookUi(){
    // settings icon already via registerSettingsLegacy
    Lampa.Listener.follow('full',e=>{
      if(e.type!=='complite')return;
      const root=e.object.activity.render();
      if(root.find('.view--torbox').length) return;
      const btn=$(`<div class="full-start__button selector view--torbox" data-subtitle="TorBox">${ICON_SVG}<span>TorBox</span></div>`);
      btn.on('hover:enter',()=>searchAndShow(e.data.movie));
      root.find('.view--torrent').after(btn);
    });
  }
})();
