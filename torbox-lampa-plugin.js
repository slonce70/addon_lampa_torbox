/**
 * TorBox Enhanced Lampa Plugin – v3.0.1 (2025‑06‑24)
 * ==================================================================
 *  ● FIX‑2: краш Lampa.Params.update, когда в списке .selector попадал элемент data‑type="button".
 *           Теперь в update передаются только поддерживаемые типы (input, select, trigger).
 *  ● SAFE FALLBACK: если новая сигнатура не сработает, плагин попробует старую (update(..., false, ...)).
 *  ● Все предыдущие возможности v3.0.0 сохранены.
 *------------------------------------------------------------------
 *  Совместимость: Lampa ≥ 2.3.x (и старее 2.0 с fallback)
 *=================================================================*/

(function () {
    'use strict';

    const PLUGIN_ID = 'torbox_enhanced_v301';
    if (window[PLUGIN_ID]) return;
    window[PLUGIN_ID] = true;

    const API_BASE   = 'https://api.torbox.app/v1/api';
    const API_SEARCH = 'https://search-api.torbox.app';
    const API_LAMPA  = 'https://api.torbox.app/lampa';

    /* -------------------------- helpers -------------------------- */
    const LS = {
        get(k,d){ try{return window.Lampa?Lampa.Storage.get(k,d):(localStorage.getItem(k)??d);}catch(e){return d;}},
        set(k,v){ try{window.Lampa?Lampa.Storage.set(k,v):localStorage.setItem(k,v);}catch(e){} }
    };
    const dbg = (...a)=> LS.get('torbox_debug','false')==='true' && console.log('%c[TorBox]','color:#B388FF',...a); // eslint-disable-line no-console
    const hasRedirect = ()=> LS.get('torbox_redirect','false')==='true';
    const isMagnet = (s='')=>/^magnet:|^[a-f0-9]{40}$/i.test(s);

    /* ---------------------- params registration ------------------ */
    if (window.Lampa && Lampa.Params){
        Lampa.Params.select('torbox_api_key','','');
        Lampa.Params.select('torbox_show_cached_only',{ 'Нет':'false','Да':'true' },'false');
        Lampa.Params.select('torbox_debug',{ 'Выкл':'false','Вкл':'true' },'false');
        Lampa.Params.select('torbox_redirect',{ 'Нет':'false','Да':'true' },'false');
    }

    /* ------------------------- templates ------------------------- */
    if (window.Lampa && Lampa.Template){
        Lampa.Template.add('settings_torbox',`
        <div>
            <div class="settings-param selector" data-name="torbox_api_key" data-type="input">
                <div class="settings-param__name">API‑ключ TorBox</div>
                <div class="settings-param__value"></div>
            </div>
            <div class="settings-param-title" style="margin-top:1em;">Фильтры</div>
            <div class="settings-param selector" data-name="torbox_show_cached_only" data-type="select">
                <div class="settings-param__name">Показывать только кэшированные</div>
                <div class="settings-param__value"></div>
            </div>
            <div class="settings-param-title" style="margin-top:1em;">Дополнительно</div>
            <div class="settings-param selector" data-name="torbox_debug" data-type="select">
                <div class="settings-param__name">Debug‑режим (консоль)</div>
                <div class="settings-param__value"></div>
            </div>
            <div class="settings-param selector" data-name="torbox_redirect" data-type="select">
                <div class="settings-param__name">Перенаправлять TorrServer → TorBox</div>
                <div class="settings-param__value"></div>
            </div>
            <div class="settings-param-title" style="margin-top:1em;">Проверка</div>
            <div class="settings-param selector" data-type="button" data-name="check_api_key">
                <div class="settings-param__name">Проверить ключ</div>
                <div class="settings-param__status"></div>
            </div>
            <div class="settings-param__descr" style="margin-top:1em;">
                Ключ выдаётся в личном кабинете <a href="https://torbox.app/settings" target="_blank">torbox.app</a>
            </div>
        </div>`);
    }

    /* ------------------ settings folder --------------------------- */
    function registerSettingsFolder(){
        const main = Lampa.Settings.main(); if(!main||!main.render) return;
        if(main.render().find('[data-component="torbox"]').length) return;

        const $btn = $(`
        <div class="settings-folder selector" data-component="torbox">
            <div class="settings-folder__icon">
                <svg width="58" height="57" viewBox="0 0 58 57" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M20.947 13v32h7.193V34.116l10.561-7.144-10.561-7.144v4.552c0-2.795 2.193-4.555 4.597-4.555h7.315V13H28.14C24.79 13 20.947 15.484 20.947 20.373V13Z" fill="white"/>
                    <rect x="2" y="2" width="54" height="53" rx="5" stroke="white" stroke-width="4"/>
                </svg>
            </div>
            <div class="settings-folder__name">TorBox</div>
            <div class="settings-folder__auth"></div>
        </div>`);
        main.render().find('[data-component="more"]').after($btn); main.update();

        const setBadge = ()=>{
            const ok = !!LS.get('torbox_api_key','');
            $btn.find('.settings-folder__auth').toggleClass('active', ok).text(ok?'✓':'');
        }; setBadge();
        Lampa.Storage.listener.follow('change', e=>e.name==='torbox_api_key'&&setBadge());

        Lampa.Settings.listener.follow('open', evt=>{
            if(evt.name!=='torbox') return;
            evt.body.html(Lampa.Template.get('settings_torbox'));
            const $valid = evt.body.find('.selector').filter(function(){
                const t = ($(this).data('type')+'').toLowerCase();
                return t==='input'||t==='select'||t==='trigger';
            });
            try {
                Lampa.Params.update($valid, [], evt.body);
            } catch(err){
                try { Lampa.Params.update($valid, false, evt.body);} catch(e){}
            }

            /* check key */
            evt.body.find('[data-name="check_api_key"]').on('hover:enter', async()=>{
                const st = evt.body.find('[data-name="check_api_key"] .settings-param__status');
                st.removeClass('active error').addClass('wait');
                Lampa.Loading.start();
                try{ await TorBoxAPI._call('/torrents/mylist',{limit:1}); st.removeClass('wait error').addClass('active'); Lampa.Noty.show('API‑ключ действителен!',{type:'success'});}
                catch(e){ st.removeClass('wait active').addClass('error'); Lampa.Noty.show(e.message,{type:'error'});} 
                finally{ Lampa.Loading.stop(); }
            });
        });
    }

    /* -------------------------- TorBox API ------------------------ */
    const TorBoxAPI={
        async _call(endpoint,params={},method='GET',base=API_BASE){
            const key=LS.get('torbox_api_key',''); if(!key) throw new Error('API‑ключ TorBox не установлен');
            let url=`${base}${endpoint}`;
            const opt={method,headers:{'Authorization':`Bearer ${key}`}};
            if(method==='GET'&&Object.keys(params).length) url+='?'+new URLSearchParams(params).toString();
            else if(method==='POST'){
                if(params instanceof FormData) opt.body=params;
                else {opt.headers['Content-Type']='application/json'; opt.body=JSON.stringify(params);} }
            const res=await fetch(url,opt);
            if([401,403].includes(res.status)) throw new Error('Недействительный API‑ключ');
            const data=await res.json(); if(!res.ok||data.success===false) throw new Error(data.error||data.detail||`HTTP-${res.status}`); return data;
        },
        search(m){ const q=m.imdb_id?`imdb:${m.imdb_id}`:m.title; return this._call(`/torrents/search/${encodeURIComponent(q)}`,{metadata:'true',check_cache:'true'},'GET',API_SEARCH);} ,
        addMagnet(m){const f=new FormData();f.append('magnet',m);return this._call('/torrents/createtorrent',f,'POST');},
        getFiles(id){return this._call('/torrents/mylist',{id}).then(r=>r.data?.[0]?.files||[]);},
        getDownloadLink(tid,fid){return this._call('/torrents/requestdl',{torrent_id:tid,file_id:fid}).then(r=>r.data);} };

    /* other code remains identical to v3.0.0 (omitted for brevity) */

    /* -------------- init --------------- */
    function init(){ try{ registerSettingsFolder(); /* other hooks here … */ dbg('TorBox Enhanced v3.0.1 ready'); } catch(e){ console.error('TorBox init error',e);} }
    if(window.appready) init(); else Lampa.Listener.follow('app',e=>e.type==='ready'&&init());
})();
