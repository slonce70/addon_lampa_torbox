/*
 * TorBox <-> Lampa integration plugin
 * Version 11.1.0 – Settings page fix, scope clean‑ups, event handling improvements, bug‑fixes.
 *
 * Author: Gemini AI, based on user feedback (June 2025)
 *
 * Changelog v11.1.0
 *  – FIX: Settings page did not open (Activity.push now uses registered component name).
 *  – FIX: missing scope variable «torrents» inside handleTorrentSelection()
 *  – FIX: cleaner event‑unsubscribe on destroy
 *  – IMP: added pre‑check for Lampa API versions ≥ 1.11 (Template names renamed in recent builds)
 *  – IMP: user‑friendly join‑to‑settings via Lampa.Settings.add if present (fallback to manual button injection)
 *  – IMP: shorthand helpers and tighter null‑guards
 */
;(function () {
    'use strict';

    /*──────────────────────────────────────────────────────────────────────────*/
    /*  Global single‑instance guard                                           */
    /*──────────────────────────────────────────────────────────────────────────*/
    const PLUGIN_NAME = 'TorBoxPluginV11';
    if (window[PLUGIN_NAME]) {
        console.log(`TorBox Plugin: ${PLUGIN_NAME} уже запущен.`);
        return;
    }
    window[PLUGIN_NAME] = true;

    /*──────────────────────────────────────────────────────────────────────────*/
    /*  Consts / helpers                                                       */
    /*──────────────────────────────────────────────────────────────────────────*/
    const KEY = {
        API: 'torbox_api_key',
        CACHED_ONLY: 'torbox_show_cached_only'
    };

    const API_BASE = 'https://api.torbox.app/v1/api';
    const API_SEARCH_BASE = 'https://search-api.torbox.app';

    const $S = (k, def = '') => Lampa.Storage.get(k, def);
    const $U = (k, v) => Lampa.Storage.set(k, v);

    /* Small wrapper so that we can easily check Lampa major build differences */
    const hasNewSettingsTemplates = () => !!Lampa.Template.get('settings_input_item');

    /*──────────────────────────────────────────────────────────────────────────*/
    /*  TorBox REST API wrapper                                                */
    /*──────────────────────────────────────────────────────────────────────────*/
    const TorBoxAPI = {
        async call(endpoint, params = {}, method = 'GET', base = API_BASE) {
            const apiKey = $S(KEY.API, '');
            if (!apiKey) throw new Error('API ключ TorBox не установлен');

            let url = `${base}${endpoint}`;
            const options = {
                method,
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            };

            if (method === 'GET' && Object.keys(params).length) {
                url += '?' + new URLSearchParams(params).toString();
            } else if (method === 'POST') {
                options.body = JSON.stringify(params);
            }

            const response = await fetch(url, options).catch(err => {throw new Error(`Сетевая ошибка: ${err.message}`)});
            if (!response.ok) {
                const errTxt = await response.text().catch(()=> '');
                throw new Error(`HTTP ${response.status}: ${response.statusText} – ${errTxt}`);
            }
            const data = await response.json().catch(()=>({success:false,error:'bad json'}));
            if (data.success === false) throw new Error(data.error || data.detail || 'Ошибка API TorBox');
            return data;
        },

        async search(movie) {
            const query = movie.imdb_id ? `imdb:${movie.imdb_id}` : movie.title;
            const params = { metadata: 'true', check_cache: 'true' };
            const {data={}} = await this.call(`/torrents/search/${encodeURIComponent(query)}`, params, 'GET', API_SEARCH_BASE);
            return data.torrents || [];
        },

        add:      magnet   => this.call('/torrents/createtorrent', { magnet }, 'POST'),
        files:    id       => this.call(`/torrents/mylist?id=${id}`).then(r=>Array.isArray(r.data)? r.data.find(t=>t.id==id)?.files||[] : []),
        getDL:    (tid,fid)=> this.call('/torrents/requestdl', { torrent_id: tid, file_id: fid }, 'GET').then(r=>r.data)
    };

    /*──────────────────────────────────────────────────────────────────────────*/
    /*  UI / Controller                                                        */
    /*──────────────────────────────────────────────────────────────────────────*/
    const UI = {
        currentMovie: null,
        currentTorrents: [],

        async searchAndShow(movie){
            this.currentMovie = movie;
            if(!$S(KEY.API,'')){
                Lampa.Noty.show('API‑ключ TorBox не настроен. Перейдите в «Настройки → TorBox».',{type:'warning',time:5e3});
                return;
            }
            Lampa.Loading.start();
            try{
                const list = await TorBoxAPI.search(movie);
                if(!list.length){
                    Lampa.Noty.show('Ничего не найдено в TorBox',{type:'info'});
                    return;
                }
                this.currentTorrents = list;
                this.displayResults();
            }
            catch(err){
                console.error(err);
                Lampa.Noty.show(err.message,{type:'error'});
            }
            finally{Lampa.Loading.stop();}
        },

        displayResults(){
            const cachedOnly = $S(KEY.CACHED_ONLY,'false')==='true';
            const items = this.currentTorrents
                .filter(t=> cachedOnly ? t.cached : true)
                .map(t=>({
                    title: t.name || t.raw_title,
                    subtitle:`${t.cached? '⚡ Кэш':'☁️ Не кэш'}  •  💾 ${(t.size/2**30).toFixed(2)} GB  •  🟢 ${t.seeders||0}`,
                    torrent:t
                }))
                .sort((a,b)=>(b.torrent.seeders||0)-(a.torrent.seeders||0));

            Lampa.Select.show({
                title:'TorBox – найдено',
                items,
                onSelect: item=> this.handleTorrent(item.torrent),
                onBack: ()=> Lampa.Controller.toggle('content')
            });
        },

        async handleTorrent(torrent){
            Lampa.Loading.start();
            try{
                if(torrent.cached){
                    const files = await TorBoxAPI.files(torrent.id);
                    const videos = files.filter(f=>/\.(mkv|mp4|avi|mov|webm)$/i.test(f.name));
                    if(!videos.length){
                        Lampa.Noty.show('Видео‑файлы не найдены',{type:'warning'});
                        return;
                    }
                    if(videos.length===1){
                        await this.play(torrent.id,videos[0].id);
                    }else{
                        Lampa.Select.show({
                            title:'Выбор файла',
                            items: videos.map(f=>({
                                title:f.name,
                                subtitle:`${(f.size/2**30).toFixed(2)} GB`,
                                tid:torrent.id,
                                fid:f.id
                            })).sort((a,b)=>a.title.localeCompare(b.title)),
                            onSelect: sel => this.play(sel.tid,sel.fid),
                            onBack: ()=> this.displayResults()
                        });
                    }
                }
                else{
                    await TorBoxAPI.add(torrent.magnet);
                    Lampa.Noty.show('Торрент отправлен в TorBox. Подождите кэширование.',{type:'success',time:5e3});
                }
            }
            catch(err){ Lampa.Noty.show(err.message,{type:'error'}); }
            finally{ Lampa.Loading.stop(); }
        },

        async play(tid,fid){
            Lampa.Loading.start();
            try{
                const url = await TorBoxAPI.getDL(tid,fid);
                if(!url) throw new Error('Не удалось получить ссылку');
                Lampa.Player.play({url, title:this.currentMovie.title, poster:this.currentMovie.img});
                Lampa.Player.callback(()=> Lampa.Activity.backward());
            }
            catch(err){ Lampa.Noty.show(err.message,{type:'error'}); }
            finally{ Lampa.Loading.stop(); }
        }
    };

    /*──────────────────────────────────────────────────────────────────────────*/
    /*  Settings component                                                     */
    /*──────────────────────────────────────────────────────────────────────────*/
    function buildSettingsComponent(){
        const comp = Lampa.Component.create({
            name:'torbox_settings_page',
            template:`<div class="settings-content"><div class="settings-content__body"></div></div>`,
            onRender(){
                const body = this.find('.settings-content__body');

                /* input field */
                const apiField = (hasNewSettingsTemplates() ?
                    Lampa.Template.get('settings_input_item',{label:'API ключ TorBox',value:$S(KEY.API,'')}) :
                    Lampa.Template.get('settings_input',{name:KEY.API,label:'API Ключ TorBox',placeholder:'Введите API‑ключ',value:$S(KEY.API,'')}));

                apiField.find('input').on('change', e=> $U(KEY.API, e.target.value.trim()));
                body.append(apiField);

                /* select cached only */
                const cacheField = (hasNewSettingsTemplates() ?
                    Lampa.Template.get('settings_select_item',{label:'Показывать только кэш',value:$S(KEY.CACHED_ONLY,'false'),options:[{title:'Нет',value:'false'},{title:'Да',value:'true'}]}) :
                    Lampa.Template.get('settings_select',{name:KEY.CACHED_ONLY,label:'Показывать только кэшированные',value:$S(KEY.CACHED_ONLY,'false'),options:[{title:'Нет',value:'false'},{title:'Да',value:'true'}]}));
                cacheField.find('select').on('change', e=> $U(KEY.CACHED_ONLY, e.target.value));
                body.append(cacheField);
            }
        });

        Lampa.Component.add('torbox_settings_page', comp);
    }

    /*──────────────────────────────────────────────────────────────────────────*/
    /*  Settings entry in main menu                                            */
    /*──────────────────────────────────────────────────────────────────────────*/
    function registerSettingsEntry(){
        /* Newer Lampa builds expose SettingsApi allowing simple registration */
        if(Lampa.Settings?.Api?.add){
            Lampa.Settings.Api.add({
                component:'torbox_settings_page',
                name:'TorBox',
                category:'plugins',
                onPress:()=> Lampa.Activity.push({title:'TorBox',component:'torbox_settings_page',page:1})
            });
            return;
        }

        /* Legacy fallback – inject button */
        const injectBtn = ()=>{
            if(!Lampa.Settings.main) return; //not ready yet
            const root = Lampa.Settings.main().render();
            if(root.find('[data-component="torbox_settings"]').length) return;

            const btnHtml = `
                <div class="settings-folder selector" data-component="torbox_settings" data-static="true">
                    <div class="settings-folder__icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
                    </div>
                    <div class="settings-folder__name">TorBox</div>
                </div>`;
            root.find('[data-component="more"]').after(btnHtml);
            Lampa.Settings.main().update();
        };

        injectBtn();

        /* attach click handler when settings open */
        Lampa.Settings.listener.follow('open', e=>{
            if(['main','plugins'].includes(e.name||'')){
                e.body.find('[data-component="torbox_settings"]').off('hover:enter').on('hover:enter', ()=>{
                    Lampa.Activity.push({title:'Настройки TorBox',component:'torbox_settings_page',page:1});
                });
            }
        });
    }

    /*──────────────────────────────────────────────────────────────────────────*/
    /*  "Watch in TorBox" button inside Full card                              */
    /*──────────────────────────────────────────────────────────────────────────*/
    function injectFullCardButton(){
        const unsub = Lampa.Listener.follow('full', e=>{
            if(e.type!=='complite') return;
            const wrap = e.object.activity.render();
            if(wrap.find('.view--torbox').length) return; //already added

            const btn = $(
                `<div class="full-start__button selector view--torbox" data-subtitle="TorBox">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
                    <span>TorBox</span>
                </div>`);
            Lampa.Template.on(btn, {'enter':()=> UI.searchAndShow(e.data.movie)});

            wrap.find('.view--torrent, .view--online').first().after(btn);
        });

        /* Keep reference for potential cleanup */
        window.addEventListener('unload', ()=> Lampa.Listener.remove('full', unsub));
    }

    /*──────────────────────────────────────────────────────────────────────────*/
    /*  Bootstrapping                                                          */
    /*──────────────────────────────────────────────────────────────────────────*/
    function init(){
        buildSettingsComponent();
        registerSettingsEntry();
        injectFullCardButton();

        console.log(`%c${PLUGIN_NAME} v11.1.0`, 'color:#2E7D32;font-weight:bold;', '– плагин активирован.');
    }

    if(window.appready) init();
    else Lampa.Listener.follow('app', e=>{ if(e.type==='ready') init(); });
})();
