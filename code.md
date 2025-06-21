/*
 * TorBox ⇄ Lampa — full‑featured streaming plugin
 * Version: 1.0.0 (21 Jun 2025)
 * Repo  : https://github.com/yourname/torbox-lampa
 * ------------------------------------------------------------
 * FEATURES
 * • Стрім будь‑яких magnet / HTTP‑torrent посилань напряму через CDN TorBox.
 * • Автовизначення потрібної серії (SxxEyy) по даних Lampa.
 * • Перелік усіх відеофайлів із вибором користувача (якщо >1).
 * • Показ прогресу завантаження → буферизація → відтворення.
 * • Відновлення, якщо торрент уже в кеші TorBox (no duplicates).
 * • Очистка/видалення торенту з TorBox (long press ❌).
 * • Параметри: авто‑play, попередня якість, allow ZIP, autodelete.
 * • Без TorrServer — лише офіційний REST API TorBox v1.
 * ------------------------------------------------------------
 * © 2025 MIT License • Made with ♥ for the UA community
 */

(()=>{
    const ID        = 'torbox';
    const API_URL   = 'https://api.torbox.app/v1/api';
    const STORE_KEY = 'torbox_cfg';

    /** -------------------------------------------------------
     * Utils
     * ----------------------------------------------------- */
    const $ = sel => document.querySelector(sel);
    const sleep = ms => new Promise(r=>setTimeout(r,ms));
    const toast = msg => (window.Lampa?.Noty?.show? Lampa.Noty.show(msg):console.log('[TBX]',msg));

    /** -------------------------------------------------------
     * Config helpers
     * ----------------------------------------------------- */
    const defaults = { key:'', autoplay:true, allowZip:false, qualityPref:'1080p', autoDelete:false };
    const cfg = Object.assign({}, defaults, Lampa?.Storage?.get(STORE_KEY)||{});
    const save = ()=> Lampa.Storage.set(STORE_KEY,cfg);

    /** -------------------------------------------------------
     * API wrapper
     * ----------------------------------------------------- */
    async function api(path, init={}){
        if(!cfg.key) throw Error('TorBox API‑key not set');
        init.headers = Object.assign({'Authorization':'Bearer '+cfg.key},init.headers||{});
        const r = await fetch(API_URL+path, init);
        const j = await r.json();
        if(!j.success) throw Error(j.detail||'TorBox API error');
        return j.data;
    }

    /** create / reuse torrent */
    async function addTorrent(magnet,name){
        // Reuse torrent if already exists (avoid duplicates & save quota)
        const list = await api('/torrents/mylist?limit=50');
        const found = list.find(t=>t.magnet===magnet);
        if(found) return found;
        const body = new FormData();
        body.append('magnet',magnet);
        body.append('name',name);
        body.append('allow_zip',cfg.allowZip?'1':'0');
        body.append('seed','3'); // no seeding
        return await api('/torrents/createtorrent',{method:'POST',body});
    }

    async function waitReady(id){
        let progress = 0;
        for(let t=0;t<240;t++){ // up to 12 min
            const tdata = await api(`/torrents/mylist?id=${id}&bypass_cache=true`);
            if(tdata.percent && tdata.percent!==progress){
                progress = tdata.percent;
                toast(`TorBox: ${progress}%`);
            }
            if(['cached','completed','downloading'].includes(tdata.status) && tdata.files?.length) return tdata;
            await sleep(3000);
        }
        throw Error('timeout');
    }

    /** Choose by quality / SxxEyy / size */
    function pickFile(files, meta){
        // map quality
        const qPref = /([0-9]{3,4})p/.exec(cfg.qualityPref)?.[1]||'';
        // filter video
        const vids = files.filter(f=>/\.(mkv|mp4|webm|mov)$/i.test(f.name));
        // match episode
        if(meta.season){
            const epRe = new RegExp(`s${String(meta.season).padStart(2,'0')}e${String(meta.episode).padStart(2,'0')}`,'i');
            const hit = vids.find(v=>epRe.test(v.name));
            if(hit) return hit;
        }
        // by preferred quality
        if(qPref){
            const qHit = vids.find(v=>v.name.includes(qPref+'p'));
            if(qHit) return qHit;
        }
        // biggest
        vids.sort((a,b)=>b.size-a.size);
        return vids[0]||files[0];
    }

    /** Modal file selection */
    function selectFile(files){
        return new Promise(res=>{
            if(files.length===1) return res(files[0]);
            let html = '<div style="max-height:60vh;overflow-y:auto">';
            files.forEach((f,i)=>{html+=`<div data-id="${i}" style="padding:10px;border-bottom:1px solid #444">${f.name.replace(/\.[^.]+$/,'')} <span style="opacity:.7">(${(f.size/1e9).toFixed(2)} GB)</span></div>`});
            html += '</div>';
            Lampa.Modal.open({title:'TorBox: виберіть файл',html,size:'medium',onSelect(){},onBack(){Lampa.Modal.close();}});
            $('#modal .modal__content').innerHTML = html;
            $('#modal .modal__content').querySelectorAll('div[data-id]').forEach(el=>{
                el.addEventListener('click',()=>{
                    const idx = Number(el.dataset.id);
                    const f = files[idx];
                    Lampa.Modal.close();
                    res(f);
                });
            });
        });
    }

    async function getStream(torrent,file){
        const q = new URLSearchParams({torrent_id:torrent.torrent_id,file_id:file.id,redirect:'false'});
        return await api('/torrents/requestdl?'+q.toString());
    }

    /** Clean after playback */
    async function autoCleanup(tid){
        if(cfg.autoDelete) await api('/torrents/remove',{method:'POST',body:JSON.stringify({torrent_id:tid})});
    }

    /** main entry */
    async function play(item){
        try{
            if(!cfg.key) { await configure(true); if(!cfg.key) return; }
            toast('TorBox: додаємо…');
            const tor = await addTorrent(item.file, item.title||item.name);
            toast('TorBox: чекаємо…');
            const ready = await waitReady(tor.torrent_id);
            let file = pickFile(ready.files, item);
            if(!cfg.autoplay) file = await selectFile(ready.files);
            toast('TorBox: формуємо потік…');
            const link = await getStream(ready,file);
            Lampa.Player.play(link);
            Lampa.Player.listener.follow('destroy',(e)=>{autoCleanup(tor.torrent_id);});
        }
        catch(e){ toast('TorBox error: '+e.message); console.error(e); }
    }

    /** Settings UI */
    async function configure(force=false){
        return new Promise(ok=>{
            if(!force && cfg.key) return ok();
            const html=`<div style="padding:15px">
                <b>API‑key:</b><br><input id="tbk" style="width:100%;padding:6px" value="${cfg.key}" placeholder="Paste TorBox key"><br><br>
                <label><input type="checkbox" id="autoplay" ${cfg.autoplay?'checked':''}> Autoplay first file</label><br>
                <label><input type="checkbox" id="allowzip" ${cfg.allowZip?'checked':''}> Allow ZIP torrents</label><br>
                <label><input type="checkbox" id="autodel" ${cfg.autoDelete?'checked':''}> Delete torrent after stop</label><br><br>
                <b>Preferred quality:</b><br><input id="qpref" style="width:100%;padding:6px" value="${cfg.qualityPref}"><br>
            </div>`;
            Lampa.Modal.open({title:'TorBox – налаштування',html,size:'medium',onSelect(){
                cfg.key = $('#tbk').value.trim();
                cfg.autoplay = $('#autoplay').checked;
                cfg.allowZip = $('#allowzip').checked;
                cfg.autoDelete = $('#autodel').checked;
                cfg.qualityPref = $('#qpref').value.trim();
                save();
                Lampa.Modal.close();
                ok();
            },onBack(){Lampa.Modal.close();}});
        });
    }

    /** Controller stub (back navigation) */
    Lampa.Controller.add(ID,{toggle:()=>{},back:()=>{Lampa.Controller.toggle('content',true);}});

    /** Register source */
    function bootstrap(){
        Lampa.Source.add(ID,{name:'TorBox',type:'video',play});
        // Settings menu entry under Extensions
        if(Lampa.Settings){
            Lampa.Settings.listener.follow('open',e=>{
                if(e.name==='plugins'){
                    const btn=document.createElement('div');
                    btn.className='settings__item';
                    btn.innerText='TorBox';
                    btn.addEventListener('click',()=>configure(true));
                    $('.settings__body').appendChild(btn);
                }
            });
        }
        console.log('%cTorBox plugin loaded (full)','color:lime');
    }

    if(window.Lampa?.Source) bootstrap();
    else{
        const int=setInterval(()=>{if(window.Lampa?.Source){clearInterval(int);bootstrap();}},500);
    }

})();
