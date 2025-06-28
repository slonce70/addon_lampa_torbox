/* TorBox Enhanced – Universal Lampa Plugin v30.1.1
 * =====================================================================
 * • Повністю перевірений і збірний файл (без обрізань)
 * • Store / safeStorage ─ працює навіть без localStorage
 * • Послідовний парсинг: Viewbox → Jacred (можна додати ще)
 * • Список торрентів = одна вертикальна колонка
 * • Увесь функціонал кешу, API, модалок, відтворення збережено
 * ==================================================================== */
(function () {
    'use strict';

    // ───────── guard ─────────
    const PLUGIN_ID = 'torbox_enhanced_v30_1_1';
    if (window[PLUGIN_ID]) return;
    window[PLUGIN_ID] = true;

    // ───────── utils ─────────
    const Utils = {
        escapeHtml(t = '') {
            const d = document.createElement('div'); d.textContent = t; return d.innerHTML;
        },
        formatBytes(b = 0, spd = false) {
            const B = Number(b); if (!B) return spd ? '0 KB/s' : '0 B';
            const k = 1024, s = spd ? ['B/s','KB/s','MB/s','GB/s'] : ['B','KB','MB','GB','TB'];
            const i = Math.floor(Math.log(B)/Math.log(k));
            return (B/Math.pow(k,i)).toFixed(2)+' '+s[i];
        },
        formatTime(sec = 0) {
            const s = parseInt(sec,10); if (isNaN(s)||s<0) return 'н/д';
            if (s===Infinity||s>2592000) return '∞';
            const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), r=Math.floor(s%60);
            return [h?`${h}ч`:null,m?`${m}м`:null,`${r}с`].filter(Boolean).join(' ');
        },
        formatAge(iso){
            if(!iso) return 'н/д';
            const d=new Date(iso); if(isNaN(d)) return 'н/д';
            const diff=Math.floor((Date.now()-d)/1000), m=Math.floor(diff/60), h=Math.floor(m/60), days=Math.floor(h/24);
            if(diff<60) return diff+' сек. назад';
            if(m<60) return m+' мин. назад';
            if(h<24) return h+' ч. назад';
            return days+' д. назад';
        },
        getQualityLabel(title='',raw){
            if(raw?.info?.quality) return raw.info.quality+'p';
            if(/2160p|4K|UHD/i.test(title)) return '4K';
            if(/1080p|FHD/i.test(title)) return 'FHD';
            if(/720p|HD/i.test(title))  return 'HD';
            return 'SD';
        },
        naturalSort(a,b){
            const re=/(\d+)/g, A=a.name.split(re), B=b.name.split(re);
            for(let i=0;i<Math.min(A.length,B.length);i++){
                if(i%2){const d=parseInt(A[i],10)-parseInt(B[i],10); if(d) return d;}
                else if(A[i]!==B[i]) return A[i].localeCompare(B[i]);
            }
            return a.name.length-b.name.length;
        }
    };

    // ───────── safeStorage + Store ─────────
    const safeStorage=(()=>{try{localStorage.setItem('__t','1');localStorage.removeItem('__t');return localStorage;}catch{const m={};return{getItem:k=>m[k]??null,setItem:(k,v)=>m[k]=String(v),removeItem:k=>delete m[k],clear:()=>Object.keys(m).forEach(k=>delete m[k])};}})();
    const Store={get:(k,d=null)=>{const v=safeStorage.getItem(k);return v!==null?v:d;},set:(k,v)=>safeStorage.setItem(k,String(v))};

    // ───────── simple LRU cache ─────────
    const Cache=(()=>{const m=new Map(),LIM=128;return{get(k){if(!m.has(k))return null;const o=m.get(k);if(Date.now()-o.ts>600000){m.delete(k);return null;}m.delete(k);m.set(k,o);return o.val;},set(k,v){if(m.has(k))m.delete(k);m.set(k,{ts:Date.now(),val:v});if(m.size>LIM)m.delete(m.keys().next().value);}}})();

    // ───────── config ─────────
    const Config=(()=>{const DEF={proxyUrl:'https://my-torbox-proxy.slonce70.workers.dev/',apiKey:''};
        const CFG={get debug(){return Store.get('torbox_debug','0')==='1';},set debug(v){Store.set('torbox_debug',v?'1':'0');},
                   get proxyUrl(){return Store.get('torbox_proxy_url')||DEF.proxyUrl;},set proxyUrl(v){Store.set('torbox_proxy_url',v);},
                   get apiKey(){const b64=Store.get('torbox_api_key_b64','');if(!b64)return DEF.apiKey;try{return atob(b64);}catch{Store.set('torbox_api_key_b64','');return DEF.apiKey;}},
                   set apiKey(v){if(!v)return Store.set('torbox_api_key_b64','');Store.set('torbox_api_key_b64',btoa(v));}};
        const LOG=(...a)=>CFG.debug&&console.log('[TorBox]',...a);
        const PUBLIC_PARSERS=[{name:'Viewbox',url:'jacred.viewbox.dev',key:'viewbox'},{name:'Jacred',url:'jacred.xyz',key:''}];
        const ICON=`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 7L12 2L21 7V17L12 22L3 17V7Z" stroke="currentColor" stroke-width="2"/><path d="M12 22V12" stroke="currentColor" stroke-width="2"/><path d="M21 7L12 12L3 7" stroke="currentColor" stroke-width="2"/></svg>`;
        return{CFG,LOG,PUBLIC_PARSERS,ICON};})();
    const {CFG,LOG,PUBLIC_PARSERS,ICON}=Config;

    // ───────── API ─────────
    const Api=(()=>{const MAIN='https://api.torbox.app/v1/api';
        const process=(txt,s)=>{if(s===401)throw{type:'auth',message:'401 – API-key?'};if(s>=400)throw{type:'network',message:`HTTP ${s}`};
            if(!txt)throw{type:'api',message:'Empty response'};try{if(typeof txt==='string'&&txt.startsWith('http'))return{url:txt};
                const j=typeof txt==='object'?txt:JSON.parse(txt);if(j?.success===false)throw{type:'api',message:j.message||'API error'};return j;}
            catch{throw{type:'api',message:'Bad JSON'};}};
        const request=async(u,opt={},sig)=>{if(!CFG.proxyUrl)throw{type:'validation',message:'Proxy URL not set'};
            opt.headers=opt.headers||{};if(opt.is_torbox_api!==false)opt.headers['X-Api-Key']=CFG.apiKey;delete opt.headers['Authorization'];
            const url=`${CFG.proxyUrl}?url=${encodeURIComponent(u)}`;try{const r=await fetch(url,{...opt,signal:sig});return process(await r.text(),r.status);}catch(e){if(e.name==='AbortError'||e.type)throw e;throw{type:'network',message:e.message};}};
        const searchPublicTrackers=async(movie,sig)=>{for(const p of PUBLIC_PARSERS){const qs=new URLSearchParams({apikey:p.key,Query:`${movie.title} ${movie.year||''}`.trim(),title:movie.title,title_original:movie.original_title,Category:'2000,5000'});if(movie.year)qs.append('year',movie.year);
                const url=`https://${p.url}/api/v2.0/indexers/all/results?${qs}`;LOG('Parser',p.name,url);
                try{const j=await request(url,{method:'GET',is_torbox_api:false},sig);if(j&&Array.isArray(j.Results)&&j.Results.length){LOG('Success',p.name);return j.Results;}}catch(err){LOG('Fail',p.name,err.message);} }
            throw{type:'api',message:'Парсери без результатів'};};
        const checkCached=async(hashes,sig)=>{if(!hashes.length)return{};const out={};for(let i=0;i<hashes.length;i+=100){const chunk=hashes.slice(i,i+100),qs=new URLSearchParams();chunk.forEach(h=>qs.append('hash',h));qs.append('format','object');qs.append('list_files','false');
                try{const j=await request(`${MAIN}/torrents/checkcached?${qs}`,{method:'GET'},sig);if(j?.data)Object.assign(out,j.data);}catch(e){LOG('cache chunk',e.message);} }return out;};
        const addMagnet=(mag,sig)=>{const fd=new FormData();fd.append('magnet',mag);fd.append('seed','3');return request(`${MAIN}/torrents/createtorrent`,{method:'POST',body:fd},sig);};
        const stopTorrent=(id,sig)=>request(`${MAIN}/torrents/controltorrent`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({torrent_id:id,operation:'pause'})},sig);
        const myList=(id,s)=>request(`${MAIN}/torrents/mylist?id=${id}&bypass_cache=true`,{method:'GET'},s);
        const requestDl=(tid,fid,s)=>request(`${MAIN}/torrents/requestdl?torrent_id=${tid}&file_id=${fid}&token=${CFG.apiKey}`,{method:'GET'},s);
        return{searchPublicTrackers,checkCached,addMagnet,stopTorrent,myList,requestDl};})();

    // ───────── UI helpers ─────────
    const UI=(()=>{let cache={};
        const show=(title,back)=>{if($('.modal').length)Lampa.Modal.close();cache={};
            const w=document.createElement('div');w.className='torbox-status';w.innerHTML=`<div class="torbox-status__title">${title}</div>
            <div class="torbox-status__info" data-name="status">…</div><div class="torbox-status__info" data-name="progress-text"></div>
            <div class="torbox-status__progress-container"><div class="torbox-status__progress-bar" style="width:0%"></div></div>
            <div class="torbox-status__info" data-name="speed"></div><div class="torbox-status__info" data-name="eta"></div>
            <div class="torbox-status__info" data-name="peers"></div>`;
            Lampa.Modal.open({title:'TorBox',html:$(w),size:'medium',onBack:back||(()=>Lampa.Modal.close())});};
        const upd=d=>{if(!cache.body)cache.body=$('.modal__content .torbox-status');if(!cache.body.length)return;
            const set=(n,v)=>{if(!cache[n])cache[n]=cache.body.find(`[data-name="${n}"]`);cache[n].text(v||'');};
            set('status',d.status);set('progress-text',d.progressText);set('speed',d.speed);set('eta',d.eta);set('peers',d.peers);
            if(!cache.bar)cache.bar=cache.body.find('.torbox-status__progress-bar');cache.bar.css('width',Math.min(100,d.progress||0)+'%');};
        const ErrorHandler={show:(t,e)=>{Lampa.Noty.show(`${t==='network'?'Сетева':'Помилка'}: ${e.message||'??'}`,{type:'error'});LOG('ERR',t,e);}};
        return{showStatus:show,updateStatusModal:upd,ErrorHandler};})();
    const {ErrorHandler}=UI;

    // ───────── component ─────────
    function TorBoxComponent(obj){
        Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach(k=>{if(k!=='constructor'&&typeof this[k]==='function')this[k]=this[k].bind(this);});
        this.activity=obj.activity;this.movie=obj.movie;this.abortController=new AbortController();
        this.sort_types=[{key:'seeders',title:'По сидам (убыв.)',field:'last_known_seeders',reverse:true},
                         {key:'size_desc',title:'По размеру (убыв.)',field:'size',reverse:true},
                         {key:'size_asc',title:'По размеру (возр.)',field:'size',reverse:false},
                         {key:'age',title:'По дате добавления',field:'publish_date',reverse:true}];
        this.defaultFilters={quality:'all',tracker:'all',video_type:'all',translation:'all',lang:'all',video_codec:'all',audio_codec:'all'};
        this.state={scroll:null,files:null,filter:null,last:null,initialized:false,all_torrents:[],
                    sort:Store.get('torbox_sort_method','seeders'),
                    filters:JSON.parse(Store.get('torbox_filters_v2',JSON.stringify(this.defaultFilters)))};
    }
    TorBoxComponent.prototype.create=function(){this._init();return this.render();};
    TorBoxComponent.prototype.render=function(){return this.state.files.render();};

    // ── life-cycle controls
    TorBoxComponent.prototype.start=function(){this.activity.loader(false);
        Lampa.Controller.add('head',{toggle:()=>{Lampa.Controller.collectionSet(this.state.filter.render());Lampa.Controller.collectionFocus(false,this.state.filter.render());},
            right:()=>Navigator.move('right'),left:()=>Navigator.move('left'),down:()=>Lampa.Controller.toggle('content'),back:()=>Lampa.Controller.toggle('content')});
        Lampa.Controller.add('content',{toggle:()=>{Lampa.Controller.collectionSet(this.state.scroll.render());Lampa.Controller.collectionFocus(this.state.last||false,this.state.scroll.render());},
            up:()=>{this.state.scroll.is_first()?Lampa.Controller.toggle('head'):Navigator.move('up');},
            down:()=>Navigator.move('down'),left:()=>Lampa.Controller.toggle('menu'),
            back:()=>{if($('body').find('.select').length)return Lampa.Select.close();
                      if($('body').find('.filter').length){Lampa.Filter.hide();return Lampa.Controller.toggle('content');}
                      Lampa.Activity.backward();}});
        Lampa.Controller.toggle('content');};
    TorBoxComponent.prototype.pause  =function(){Lampa.Controller.add('content',null);Lampa.Controller.add('head',null);};
    TorBoxComponent.prototype.stop   =function(){Lampa.Controller.add('content',null);Lampa.Controller.add('head',null);};
    TorBoxComponent.prototype.destroy=function(){this.abortController.abort();this.pause();this.state.scroll?.destroy();this.state.files?.destroy();this.state.filter?.destroy();};

    // ── init helpers
    TorBoxComponent.prototype._init=function(){if(this.state.initialized)return;
        this.state.scroll=new Lampa.Scroll({mask:true,over:true});
        this.state.files =new Lampa.Explorer(this.params);
        this.state.filter=new Lampa.Filter(this.params);

        this._initFilterHandlers();
        this.state.scroll.body().addClass('torrent-list');
        this.state.files.appendFiles(this.state.scroll.render());
        this.state.files.appendHead(this.state.filter.render());
        this.state.scroll.minus(this.state.files.render().find('.explorer__files-head'));

        this._load();
        this.state.initialized=true;};

    TorBoxComponent.prototype._initFilterHandlers=function(){
        this.state.filter.onSelect=(type,a,b)=>{
            Lampa.Select.close();
            if(type==='sort'){this.state.sort=a.key;Store.set('torbox_sort_method',a.key);}
            else if(type==='filter'){
                if(a.refresh)return this._load(true);
                if(a.reset)this.state.filters=JSON.parse(JSON.stringify(this.defaultFilters));
                else if(a.stype)this.state.filters[a.stype]=b.value;
                Store.set('torbox_filters_v2',JSON.stringify(this.state.filters));
            }
            this._display();Lampa.Controller.toggle('content');};
        this.state.filter.onBack=()=>Lampa.Controller.toggle('content');};

    // ── filter + sort + UI
    TorBoxComponent.prototype._updateFilterUI=function(){
        const {filter,sort,filters,all_torrents}=this.state;
        filter.set('sort',this.sort_types.map(i=>({...i,selected:i.key===sort})));
        filter.render().find('.filter--sort span').text('Сортировка');
        filter.chosen('sort',[this.sort_types.find(s=>s.key===sort)?.title||'']);

        const build=(k,title,arr)=>{const u=[...new Set(arr.flat().filter(Boolean))].sort();
            const items=['all',...u].map(v=>({title:v==='all'?'Все':v.toUpperCase(),value:v,selected:filters[k]===v}));
            return{title,subtitle:filters[k]==='all'?'Все':filters[k].toUpperCase(),items,stype:k};};
        const f_items=[
            build('quality','Качество',all_torrents.map(t=>t.quality)),
            build('video_type','Тип видео',all_torrents.map(t=>t.video_type)),
            build('translation','Перевод',all_torrents.map(t=>t.voices)),
            build('lang','Язык аудио',all_torrents.map(t=>t.audio_langs)),
            build('video_codec','Видео кодек',all_torrents.map(t=>t.video_codec)),
            build('audio_codec','Аудио кодек',all_torrents.map(t=>t.audio_codecs)),
            build('tracker','Трекер',all_torrents.map(t=>t.trackers)),
            {title:'Сбросить фильтры',reset:true},{title:'Обновить список',refresh:true}];
        filter.set('filter',f_items);filter.render().find('.filter--filter span').text('Фильтр');
        filter.chosen('filter',f_items.filter(f=>f.stype&&filters[f.stype]!=='all').map(f=>`${f.title}: ${filters[f.stype]}`));
    };

    TorBoxComponent.prototype._applyFiltersSort=function(){
        const {all_torrents,filters,sort}=this.state;
        let list=all_torrents.filter(t=>{
            if(filters.quality!=='all'&&t.quality!==filters.quality)return false;
            if(filters.video_type!=='all'&&t.video_type!==filters.video_type)return false;
            if(filters.translation!=='all'&&!(t.voices||[]).includes(filters.translation))return false;
            if(filters.lang!=='all'&&!(t.audio_langs||[]).includes(filters.lang))return false;
            if(filters.video_codec!=='all'&&t.video_codec!==filters.video_codec)return false;
            if(filters.audio_codec!=='all'&&!(t.audio_codecs||[]).includes(filters.audio_codec))return false;
            if(filters.tracker!=='all'&&!(t.trackers||[]).includes(filters.tracker))return false;
            return true;});
        const s=this.sort_types.find(s=>s.key===sort);if(s){list.sort((a,b)=>{let A=a[s.field]||0,B=b[s.field]||0;
                if(s.field==='publish_date'){A=A?new Date(A).getTime():0;B=B?new Date(B).getTime():0;}
                return A<B?-1:A>B?1:0;});if(s.reverse)list.reverse();}
        return list;
    };

    // ── draw helpers
    TorBoxComponent.prototype._renderEmpty=function(msg){
        const r=this.state.scroll.render();r.empty();$('<div class="empty"><div class="empty__text">'+msg+'</div></div>').appendTo(r);this.activity.loader(false);};

    TorBoxComponent.prototype._createTechBar=function(t){
        const bar=document.createElement('div');bar.className='torbox-item__tech-bar';
        const tag=(txt,cls)=>{const d=document.createElement('div');d.className=`torbox-item__tech-item torbox-item__tech-item--${cls}`;d.textContent=txt;return d;};
        bar.appendChild(tag(t.video_resolution,'res'));if(t.video_codec)bar.appendChild(tag(t.video_codec.toUpperCase(),'codec'));
        if(t.has_hdr)bar.appendChild(tag('HDR','hdr'));if(t.has_dv)bar.appendChild(tag('Dolby Vision','dv'));
        (t.raw_data.ffprobe||[]).filter(s=>s.codec_type==='audio').forEach(s=>bar.appendChild(tag(`${s.tags?.language?.toUpperCase()||'???'} ${s.codec_name?.toUpperCase()||''} ${s.channel_layout||''}`,'audio')));
        return bar;};

    TorBoxComponent.prototype._createItem=function(t,lastHash){
        const it=document.createElement('div');it.className='torbox-item selector';if(lastHash&&t.hash===lastHash)it.classList.add('torbox-item--last-played');
        const title=document.createElement('div');title.className='torbox-item__title';title.textContent=`${t.cached?'⚡':'☁️'} ${t.raw_title}`;
        const info=document.createElement('div');info.className='torbox-item__main-info';info.innerHTML=`[${t.quality}] ${Utils.formatBytes(t.size)} | 🟢 <span style="color:var(--color-good);">${t.last_known_seeders||0}</span> / 🔴 <span style="color:var(--color-bad);">${t.last_known_peers||0}</span>`;
        const meta=document.createElement('div');meta.className='torbox-item__meta';meta.textContent=`Трекери: ${t.trackers?.join(', ')||'н/д'} | Додано: ${t.age||'н/д'}`;
        it.append(title,info,meta);if(t.video_resolution)it.appendChild(this._createTechBar(t));return it;};

    TorBoxComponent.prototype._draw=function(list){
        this.state.last=null;const r=this.state.scroll.render();r.empty();
        if(!list.length)return this._renderEmpty('Нічого не знайдено');const lastHash=Store.get(`torbox_last_torrent_${this.movie.imdb_id||this.movie.id}`,null);
        const frag=document.createDocumentFragment();list.forEach(t=>{const el=this._createItem(t,lastHash);$(el).on('hover:focus',()=>{this.state.last=el;this.state.scroll.update($(el),true);});
            $(el).on('hover:enter',()=>this._onClick(t));frag.appendChild(el);});r.append(frag);};

    // ── torrent workflow
    TorBoxComponent.prototype._procRaw=function(raw,hash,cachedSet){
        const v=raw.ffprobe?.find(s=>s.codec_type==='video'),aud=raw.ffprobe?.filter(s=>s.codec_type==='audio')||[];
        return{raw_title:raw.Title,size:raw.Size,magnet:raw.MagnetUri,hash,
            last_known_seeders:raw.Seeders,last_known_peers:raw.Peers||raw.Leechers,
            trackers:(raw.Tracker||'').split(/, ?/).filter(Boolean),cached:cachedSet.has(hash.toLowerCase()),
            publish_date:raw.PublishDate,age:Utils.formatAge(raw.PublishDate),
            quality:Utils.getQualityLabel(raw.Title,raw),video_type:raw.info?.videotype?.toLowerCase(),
            voices:raw.info?.voices,video_codec:v?.codec_name,video_resolution:v?`${v.width}x${v.height}`:null,
            audio_langs:[...new Set(aud.map(s=>s.tags?.language).filter(Boolean))],
            audio_codecs:[...new Set(aud.map(s=>s.codec_name).filter(Boolean))],
            has_hdr:/hdr/i.test(raw.Title)||raw.info?.videotype?.toLowerCase()==='hdr',
            has_dv:/dv|dolby vision/i.test(raw.Title)||raw.info?.videotype?.toLowerCase()==='dovi',
            raw_data:raw};};

    TorBoxComponent.prototype._load=async function(force=false){
        this.activity.loader(true);this._renderEmpty('Завантаження…');
        try{
            const cacheKey=`torbox_list_${this.movie.imdb_id||this.movie.id}`;
            if(!force&&Cache.get(cacheKey))this.state.all_torrents=Cache.get(cacheKey);else{
                this._renderEmpty('Пошук торентів…');
                const raw=await Api.searchPublicTrackers(this.movie,this.abortController.signal);
                if(!raw.length)return this._renderEmpty('Парсер без результатів');
                const withHash=raw.map(r=>{const m=r.MagnetUri.match(/urn:btih:([a-fA-F0-9]{40})/i);return m?{raw:r,hash:m[1]}:null;}).filter(Boolean);
                if(!withHash.length)return this._renderEmpty('Hash не знайдено');
                this._renderEmpty('Перевірка кешу…');
                const cached=await Api.checkCached(withHash.map(h=>h.hash),this.abortController.signal);
                const cs=new Set(Object.keys(cached).map(h=>h.toLowerCase()));
                this.state.all_torrents=withHash.map(o=>this._procRaw(o.raw,o.hash,cs));Cache.set(cacheKey,this.state.all_torrents);}
            this._display();}
        catch(e){this._renderEmpty(e.message||'Помилка');ErrorHandler.show(e.type||'unknown',e);}finally{this.activity.loader(false);}};

    TorBoxComponent.prototype._display=function(){this._updateFilterUI();this._draw(this._applyFiltersSort());};

    // ── click / tracking
    TorBoxComponent.prototype._track=function(id){
        return new Promise((ok,fail)=>{let active=true;
            const tick=async()=>{if(!active)return;try{const {data:[d]}=await Api.myList(id,this.abortController.signal);
                    const st=d.download_state||d.status,prog=parseFloat(d.progress),perc=isNaN(prog)?0:(prog>1?prog:prog*100);
                    UI.updateStatusModal({status:st,progress:perc,progressText:`${perc.toFixed(2)}% з ${Utils.formatBytes(d.size)}`,
                        speed:`Швидкість: ${Utils.formatBytes(d.download_speed,true)}`,eta:`Залишилось: ${Utils.formatTime(d.eta)}`,
                        peers:`Сіди: ${d.seeds||0} / Піри: ${d.peers||0}`});
                    if((st==='completed'||d.download_finished||perc>=100)&&d.files?.length){active=false;if(st.startsWith('uploading'))
                            try{await Api.stopTorrent(d.id,this.abortController.signal);}catch(e){LOG('stop fail',e.message);}
                        return ok(d);}setTimeout(tick,5000);}catch(e){active=false;fail(e);} };
            const cancel=()=>{if(active){active=false;fail({type:'user',message:'Скасовано'});} };
            UI.showStatus('Відстеження…',cancel);this.abortController.signal.addEventListener('abort',cancel);tick();});};

    TorBoxComponent.prototype._onClick=async function(t){
        try{if(!t.magnet)throw{type:'validation',message:'Magnet?'};UI.showStatus('Додавання…');
            const res=await Api.addMagnet(t.magnet,this.abortController.signal);const tid=res.data.torrent_id||res.data.id;
            if(!tid)throw{type:'api',message:'ID?'};const d=await this._track(tid);d.hash=t.hash;Lampa.Modal.close();this._selectFile(d);}
        catch(e){if(e.type!=='user'&&e.name!=='AbortError')ErrorHandler.show(e.type||'unknown',e);Lampa.Modal.close();}};

    TorBoxComponent.prototype._selectFile=function(d){
        const vids=d.files.filter(f=>/\.(mkv|mp4|avi)$/i.test(f.name));if(!vids.length)throw{type:'validation',message:'Файл не знайдено'};
        vids.sort(Utils.naturalSort);const play=f=>this._play(d.id,d.hash,f);
        if(vids.length===1)return play(vids[0]);
        const last=Store.get(`torbox_last_played_${this.movie.imdb_id||this.movie.id}`,null);
        Lampa.Select.show({title:'Вибір файлу',items:vids.map(f=>({title:last&&String(f.id)===String(last)?`▶️ ${f.name}`:f.name,subtitle:Utils.formatBytes(f.size),
            file:f,cls:last&&String(f.id)===String(last)?'select__item--last-played':undefined})),onSelect:i=>play(i.file),onBack:()=>Lampa.Controller.toggle('content')});
    };

    TorBoxComponent.prototype._play=async function(tid,hash,file){
        UI.showStatus('Отримання посилання…');try{const {data,url}=await Api.requestDl(tid,file.id,this.abortController.signal);const link=data||url;
            const mid=this.movie.imdb_id||this.movie.id;Store.set(`torbox_last_torrent_${mid}`,hash);Store.set(`torbox_last_played_${mid}`,String(file.id));
            Lampa.Modal.close();Lampa.Player.play({url:link,title:file.name||this.movie.title,poster:this.movie.img});
            Lampa.Player.listener.follow('complite',()=>this._display());}
        catch(e){ErrorHandler.show(e.type||'unknown',e);Lampa.Modal.close();}};

    // ───────── plugin integration ─────────
    const Plugin=(()=>{const addSettings=()=>{if(!Lampa.SettingsApi)return;
            Lampa.SettingsApi.addComponent({component:'torbox_enh',name:'TorBox Enhanced',icon:ICON});
            [{k:'torbox_proxy_url',n:'CORS-proxy URL',d:`По замовч.: ${CFG.proxyUrl}`,t:'input',v:CFG.proxyUrl},
             {k:'torbox_api_key',n:'API-Key',d:'Опційно',t:'input',v:CFG.apiKey},
             {k:'torbox_debug',n:'Debug',d:'Логи в консолі',t:'trigger',v:CFG.debug}]
            .forEach(p=>Lampa.SettingsApi.addParam({component:'torbox_enh',
                param:{name:p.k,type:p.t,values:'',default:p.v},
                field:{name:p.n,description:p.d},
                onChange:v=>{const val=typeof v==='object'?v.value:v;if(p.k==='torbox_proxy_url')CFG.proxyUrl=val.trim();
                              if(p.k==='torbox_api_key')CFG.apiKey=val.trim();if(p.k==='torbox_debug')CFG.debug=Boolean(val);},
                onRender:f=>{if(p.k==='torbox_api_key')f.find('input').attr('type','password');}}));};
        const boot=()=>{Lampa.Listener.follow('full',e=>{if(e.type!=='complite'||!e.data.movie)return;
                const r=e.object.activity.render();if(!r||!r.length||r.find('.view--torbox').length)return;
                const btn=$(`<div class="full-start__button selector view--torbox" data-subtitle="TorBox">${ICON}<span>TorBox</span></div>`);
                btn.on('hover:enter',()=>Lampa.Activity.push({component:'torbox_component',title:`TorBox - ${e.data.movie.title||e.data.movie.name}`,movie:e.data.movie}));
                (r.find('.view--torrent').length?r.find('.view--torrent'):r.find('.full-start__play')).after(btn);} );};
        const init=()=>{const css=document.createElement('style');css.textContent=`
            .torrent-list{padding:1em;display:block!important;}
            .torbox-item{width:100%;padding:1em 1.2em;margin:.5em 0;border-radius:.8em;background:var(--color-background-light);cursor:pointer;transition:.3s;border:2px solid transparent;overflow:hidden;}
            .torbox-item--last-played{border-left:4px solid var(--color-second);background:rgba(var(--color-second-rgb),.1);}
            .torbox-item:hover,.torbox-item.focus{background:var(--color-primary);color:var(--color-background);transform:translateX(.8em);border-color:rgba(255,255,255,.3);box-shadow:0 4px 20px rgba(0,0,0,.2);}
            .torbox-item__title{font-weight:600;margin-bottom:.3em;font-size:1.1em;}
            .torbox-item__main-info{font-size:.95em;opacity:.9;margin-bottom:.3em;}
            .torbox-item__meta{font-size:.9em;opacity:.7;margin-bottom:.8em;}
            .torbox-item__tech-bar{display:flex;flex-wrap:wrap;gap:.6em;margin:0 -1.2em -1em -1.2em;padding:.6em 1.2em;background:rgba(0,0,0,.1);font-size:.85em;font-weight:500;}
            .torbox-item__tech-item{padding:.2em .5em;border-radius:.4em;}
            .torbox-item__tech-item--res{background:#3b82f6;color:#fff}.torbox-item__tech-item--codec{background:#16a34a;color:#fff}
            .torbox-item__tech-item--audio{background:#f97316;color:#fff}.torbox-item__tech-item--hdr{background:linear-gradient(45deg,#ff8c00,#ffa500);color:#fff}
            .torbox-item__tech-item--dv{background:linear-gradient(45deg,#4b0082,#8a2be2);color:#fff}
            .select__item--last-played>.select__item-title{color:var(--color-second)!important;font-weight:600;}
            .torbox-status{padding:1.5em 2em;text-align:center;min-height:200px}
            .torbox-status__title{font-size:1.4em;margin-bottom:1em;font-weight:600}
            .torbox-status__info{font-size:1.1em;margin-bottom:.8em}
            .torbox-status__progress-container{margin:1.5em 0;background:rgba(255,255,255,.1);border-radius:8px;height:12px;overflow:hidden}
            .torbox-status__progress-bar{height:100%;width:0;background:linear-gradient(90deg,var(--color-primary),var(--color-primary-light,#4CAF50));transition:width .5s}
            `;
            document.head.appendChild(css);
            Lampa.Component.add('torbox_component',TorBoxComponent);
            addSettings();boot();LOG('TorBox v30.1.1 ready');};
        return{init};})();

    // ───────── bootloader ─────────
    (function boot(){if(window.Lampa?.Activity)try{Plugin.init();}catch(e){console.error('[TorBox] boot err',e);}else setTimeout(boot,300);})();
})();
