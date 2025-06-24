(() => {
    'use strict';

    const PLUGIN_ID = 'TorBoxPluginV16_Fixed';
    if (window[PLUGIN_ID]) return;  // защита от двойного запуска
    window[PLUGIN_ID] = true;

    /******** 1. Регистрируем параметры *************************************/
    Lampa.Params.add({
        name:     'torbox_api_key',
        type:     'input',
        default:  '',
        description: 'Персональный API-ключ TorBox'
    });

    Lampa.Params.add({
        name:     'torbox_show_cached_only',
        type:     'select',
        values:   { 'Нет':'false', 'Да':'true' },
        default:  'false'
    });

    /******** 2. Страница настроек *******************************************/
    const tpl = `
        <div>
          <div class="settings-param selector"
               data-name="torbox_api_key" data-type="input">
            <div class="settings-param__name">API Ключ TorBox</div>
            <div class="settings-param__value"></div>
          </div>

          <div class="settings-param selector"
               data-name="torbox_show_cached_only" data-type="select">
            <div class="settings-param__name">Показывать только кэшированные</div>
            <div class="settings-param__value"></div>
          </div>

          <div class="settings-param__descr" style="margin-top:1em">
            API-ключ можно получить в личном кабинете на сайте
            <a href="https://torbox.app/settings" target="_blank">torbox.app</a>
          </div>
        </div>`;
    Lampa.Template.add('settings_torbox', tpl);

    // кнопка «TorBox» в основном меню настроек
    const btnSettings = $(`
        <div class="settings-folder selector" data-component="torbox">
          <div class="settings-folder__icon">
            <svg width="58" height="57" viewBox="0 0 58 57" fill="none"
                 xmlns="http://www.w3.org/2000/svg">
              <path d="M20.95 13v32h7.19V34.1l10.56-7.14-10.56-7.14v4.55
                       c0-2.8 2.19-4.56 4.6-4.56h7.32V13H28.14c-3.35 0-7.19 2.49-7.19 7.38V13z"
                    fill="currentColor"/>
              <rect x="2" y="2" width="54" height="53" rx="5"
                    stroke="currentColor" stroke-width="4"/>
            </svg>
          </div>
          <div class="settings-folder__name">TorBox</div>
          <div class="settings-folder__auth"></div>
        </div>`);

    // обработчик открытия нашей вкладки
    Lampa.Settings.listener.follow('open', e=>{
        if (e.name !== 'torbox') return;

        e.body.html(Lampa.Template.get('settings_torbox'));
        Lampa.Params.update(e.body.find('.selector'), [], e.body);
    });

    // добавляем кнопку в дерево настроек
    const main = Lampa.Settings.main();
    if (main && main.render &&
        !main.render().find('[data-component="torbox"]').length) {
        main.render().find('[data-component="more"]').after(btnSettings);
        main.update();
    }

    // сохраняем изменения из формы
    Lampa.Params.listener.follow('update', e=>{
        if (e.name === 'torbox_api_key' || e.name === 'torbox_show_cached_only'){
            Lampa.Storage.set(e.name, e.value);
        }
    });

    /******** 3. API-враппер (без изменений, но apiKey тянем из Storage) *****/
    const API = {
        base:  'https://api.torbox.app/v1/api',
        searchBase: 'https://search-api.torbox.app',

        async call(endpoint, params={}, method='GET', host=this.base){
            const key = Lampa.Storage.get('torbox_api_key', '');
            if (!key){
                Lampa.Noty.show('API-ключ TorBox не установлен', {type:'error'});
                throw new Error('API-ключ отсутствует');
            }

            let url = `${host}${endpoint}`;
            const opt = { method, headers: { 'Authorization': `Bearer ${key}` } };

            if (method === 'GET' && Object.keys(params).length){
                url += '?' + new URLSearchParams(params);
            } else if (method === 'POST'){
                if (params instanceof FormData) { opt.body = params; }
                else {
                    opt.headers['Content-Type']='application/json';
                    opt.body = JSON.stringify(params);
                }
            }

            const res  = await fetch(url, opt);
            const json = await res.json();
            if (!res.ok || json.success===false){
                throw new Error(json.error || json.detail || `HTTP ${res.status}`);
            }
            return json;
        },

        search(movie){
            const q = movie.imdb_id ? `imdb:${movie.imdb_id}` : movie.title;
            return this.call(`/torrents/search/${encodeURIComponent(q)}`,
                             { metadata:'true', check_cache:'true',
                               search_user_engines:'true' }, 'GET',
                             this.searchBase);
        },
        addMagnet(magnet){
            const fd = new FormData();
            fd.append('magnet', magnet);
            return this.call('/torrents/createtorrent', fd, 'POST');
        },
        getFiles(id){
            return this.call('/torrents/mylist', {id})
                   .then(r=>r.data?.[0]?.files||[]);
        },
        getLink(tid, fid){
            return this.call('/torrents/requestdl',
                             {torrent_id:tid, file_id:fid}, 'GET')
                   .then(r=>r.data);
        }
    };

    /******** 4. UI-кнопка на карточке фильма + остальная логика *************/
    function init(){
        Lampa.Listener.follow('full', e=>{
            // удаляем за собой
            if (e.type === 'destroy'){
                e.object.activity.render().find('.view--torbox').remove();
                return;
            }
            if (e.type !== 'complite') return;

            const holder = e.object.activity.render();
            if (holder.find('.view--torbox').length) return;

            const btn = $(`
              <div class="full-start__button selector view--torbox"
                   data-subtitle="TorBox">
                <svg width="24" height="24" viewBox="0 0 24 24">
                  <path d="M12 2 2 7l10 5 10-5-10-5Z" stroke="currentColor"
                        stroke-width="2" stroke-linejoin="round"/>
                  <path d="m2 12 10 5 10-5" stroke="currentColor"
                        stroke-width="2" stroke-linejoin="round"/>
                  <path d="m2 17 10 5 10-5" stroke="currentColor"
                        stroke-width="2" stroke-linejoin="round"/>
                </svg>
                <span>TorBox</span>
              </div>`);

            btn.on('hover:enter', ()=>doSearch(e.data.movie));
            holder.find('.view--torrent').after(btn);
        });
    }

    async function doSearch(movie){
        Lampa.Loading.start();
        try{
            const res  = await API.search(movie);
            const all  = res.data?.torrents || [];
            const only = Lampa.Storage.get('torbox_show_cached_only','false')==='true';
            const list = only ? all.filter(t=>t.cached) : all;

            if (!list.length){
                Lampa.Noty.show(only
                    ? 'Кэшированных результатов нет'
                    : 'Ничего не найдено в TorBox');
                return;
            }
            showSelect(list, movie);
        }catch(err){
            Lampa.Noty.show(err.message || err, {type:'error'});
        }finally{ Lampa.Loading.stop(); }
    }

    function showSelect(arr, movie){
        const items = arr.sort((a,b)=>(b.seeders||0)-(a.seeders||0))
                         .map(t=>{
            const flg = t.cached ? '⚡' : '☁️';
            const sz  = t.size ? `💾 ${(t.size/2**30).toFixed(2)} GB` : '';
            const sd  = t.seeders!==undefined ? `🟢 ${t.seeders}` : '';
            const pc  = t.peers!==undefined   ? `🔴 ${t.peers}` : '';
            return {
                title: `${flg} ${t.name||t.raw_title||'Без названия'}`,
                subtitle: [sz,sd,pc].filter(Boolean).join(' | '),
                torrent: t
            };
        });

        Lampa.Select.show({
            title:'Результаты TorBox',
            items,
            onSelect:item=> pickTorrent(item.torrent, movie, arr),
            onBack: ()=> Lampa.Controller.toggle('content')
        });
    }

    async function pickTorrent(t, movie, origin){
        Lampa.Loading.start();
        try{
            if (t.cached){
                const files = await API.getFiles(t.id);
                const vids  = files.filter(f=>/\.(mkv|mp4|avi|mov|webm|flv|wmv)$/i
                                                     .test(f.name));
                if (!vids.length){
                    Lampa.Noty.show('Видео-файлы не найдены', {type:'warning'});
                    return;
                }
                if (vids.length===1) return play(t.id, vids[0].id, movie);

                Lampa.Select.show({
                    title:'Выберите файл',
                    items: vids.map(f=>({
                        title: f.name,
                        subtitle: f.size
                            ? `${(f.size/2**30).toFixed(2)} GB` : '',
                        tid:t.id, fid:f.id
                    })),
                    onSelect:s=> play(s.tid, s.fid, movie),
                    onBack:()=> showSelect(origin, movie)
                });
            }else{
                await API.addMagnet(t.magnet);
                Lampa.Noty.show('Торрент отправлен в TorBox, ожидайте кэширования');
            }
        }catch(err){
            Lampa.Noty.show(err.message||err, {type:'error'});
        }finally{ Lampa.Loading.stop(); }
    }

    async function play(tid, fid, movie){
        Lampa.Loading.start();
        try{
            const url = await API.getLink(tid, fid);
            if (!url) throw new Error('Не удалось получить ссылку');

            Lampa.Player.play({
                title:  movie.title,
                poster: movie.img,
                url,
                is_torbox:true
            });
            Lampa.Player.callback(()=> Lampa.Activity.backward());
        }catch(err){
            Lampa.Noty.show(err.message||err, {type:'error'});
        }finally{ Lampa.Loading.stop(); }
    }

    /******** 5. Запуск после готовности приложения **************************/
    if (window.appready) init();
    else Lampa.Listener.follow('app',e=>{
        if (e.type==='ready') init();
    });

})();
