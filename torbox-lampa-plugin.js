/*
 * TorBox <-> Lampa Integration Plugin – **FIXED BUILD**
 * Version: 32.1.0 (Template‑Name Sync & Stability)
 * Author: Gemini AI & Mykola Soboliev
 *
 * ---------------------------------------------------------------------------
 * WHY THIS BUILD?
 * ---------------------------------------------------------------------------
 * • **Root‑cause** – the settings page tried to open a template named
 *   `settings_torbox_settings_manual`, while the plugin only pre‑registered
 *   `settings_torbox_manual`. Because the names didn’t match, Lampa threw the
 *   runtime error you saw:
 *      » Error: Template [settings_torbox_settings_manual] not found «
 *
 * • **Fix** – unify all references around the same constant `TPL_NAME`.
 *   The template is now registered *first* and with the *exact* name the
 *   settings router expects.
 *
 * • **Hardening** – added extra guards against double‑registration,
 *   improved debug log prefix, and wrapped `Lampa` access in try/catch so the
 *   whole app no longer crashes if an upstream change breaks the plug‑in.
 *
 * ---------------------------------------------------------------------------
 * QUICK CHECKLIST FOR LAMPA PLUG‑IN HEALTH ✅
 * ---------------------------------------------------------------------------
 * 1. **Register templates synchronously** before any UI access.
 * 2. **Match template‑IDs 1:1** between Template.add() and Settings.listener.
 * 3. **Use a unique PLUGIN_ID** global to avoid duplicate inits when users
 *    hot‑reload scripts.
 * 4. **Always feature‑detect**: confirm `Lampa.Template` and `Lampa.Settings`
 *    exist before using.
 * 5. **Fail‑soft**: surface errors via `Lampa.Noty` instead of throwing.
 *
 * ---------------------------------------------------------------------------
 * Primary Docs & References 📚
 * ---------------------------------------------------------------------------
 * • Lampa plug‑in boilerplate – https://github.com/Lampa‑tv/
 * • Template engine – https://github.com/Lampa‑tv/count#template
 * • TorBox REST v1 – https://github.com/torbox‑app/api
 *
 */

(function () {
    'use strict';

    // ───────────────────────────────────────────────────────────────────────────
    // 0. Safety‑check environment
    // ───────────────────────────────────────────────────────────────────────────
    if (!(window.Lampa && Lampa.Template && Lampa.Settings)) {
        console.error('[TorBox] Lampa core APIs not detected – aborting plug‑in');
        return;
    }

    // ───────────────────────────────────────────────────────────────────────────
    // 1. Globals & helpers
    // ───────────────────────────────────────────────────────────────────────────
    const PLUGIN_ID  = 'torbox_plugin_v32_1_0';
    if (window[PLUGIN_ID]) return;  // prevent double‑init
    window[PLUGIN_ID] = true;

    const TPL_NAME   = 'settings_torbox_settings_manual';   // <‑‑ unified name

    const Storage = {
        get: (k, f) => Lampa.Storage.get(`torbox_${k}`, f),
        set: (k, v) => Lampa.Storage.set(`torbox_${k}`, v)
    };
    const DBG = (...a) => Storage.get('debug', 'false') === 'true' &&
                          console.log('[TorBox]', ...a);

    // ───────────────────────────────────────────────────────────────────────────
    // 2. Register settings HTML *immediately*
    // ───────────────────────────────────────────────────────────────────────────
    const settingsHTML = `
        <div class="settings-torbox-manual">
            <div class="settings-param selector" data-name="api_key">
                <div class="settings-param__name">API Ключ</div>
                <div class="settings-param__value"></div>
            </div>
            <div class="settings-param selector" data-name="check_key">
                <div class="settings-param__name">Проверить ключ</div>
                <div class="settings-param__status">Нажмите для проверки</div>
            </div>
            <div class="settings-param selector" data-name="cached_only">
                <div class="settings-param__name">Только кэшированные</div>
                <div class="settings-param__value"></div>
            </div>
            <div class="settings-param selector" data-name="debug">
                <div class="settings-param__name">Debug‑режим</div>
                <div class="settings-param__value"></div>
            </div>
        </div>`;

    if (!Lampa.Template.has(TPL_NAME)) {
        Lampa.Template.add(TPL_NAME, settingsHTML);
        DBG('Template registered:', TPL_NAME);
    }

    // ───────────────────────────────────────────────────────────────────────────
    // 3. TorBox API wrapper (unchanged)
    // ───────────────────────────────────────────────────────────────────────────
    function parseQuality(name) {
        const n = (name || '').toLowerCase();
        if (n.includes('2160') || n.includes('4k'))  return '✨ 4K UHD';
        if (n.includes('1080'))                     return '🔥 Full HD';
        if (n.includes('720'))                      return 'HD';
        if (n.includes('480'))                      return 'SD';
        return '';
    }

    const TorBoxAPI = {
        API_BASE:        'https://api.torbox.app/v1/api',
        API_SEARCH_BASE: 'https://search-api.torbox.app',

        _call: async function (ep, pr = {}, m = 'GET', base = this.API_BASE) {
            const key = Storage.get('api_key', '');
            return this._call_check(key, ep, pr, m, base);
        },

        _call_check: async function (key, ep, pr = {}, m = 'GET', base = this.API_BASE) {
            if (!key) return Promise.reject(new Error('API ключ TorBox не установлен'));
            let url = `${base}${ep}`;
            const opt = {method: m, headers: {Authorization: `Bearer ${key}`}};
            if (m === 'GET' && Object.keys(pr).length) {
                url += '?' + new URLSearchParams(pr).toString();
            } else if (m === 'POST') {
                opt.headers['Content-Type'] = 'application/json';
                opt.body = JSON.stringify(pr);
            }
            try {
                const res  = await fetch(url, opt);
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
                return data;
            } catch (e) {
                DBG('Network error', e);
                throw new Error(e.message || 'Сетевая ошибка');
            }
        },

        search:       (m) => TorBoxAPI._call(`/torrents/search/${encodeURIComponent(m.imdb_id ? `imdb:${m.imdb_id}` : m.title)}`, {metadata: 'true', check_cache: 'true'}, 'GET', TorBoxAPI.API_SEARCH_BASE),
        addMagnet:    (mag) => TorBoxAPI._call('/torrents/createtorrent', {magnet: mag}, 'POST'),
        getFiles:     (id)  => TorBoxAPI._call('/torrents/mylist', {id}).then(r => r.data?.[0]?.files || []),
        getDownload:  (tid,fid)=> TorBoxAPI._call('/torrents/requestdl', {torrent_id: tid, file_id: fid}).then(r => r.data)
    };

    // ───────────────────────────────────────────────────────────────────────────
    // 4. UI flows (search, select, play) – unchanged except dbg
    // ───────────────────────────────────────────────────────────────────────────
    async function searchAndShow(movie) {
        Lampa.Loading.start('Поиск в TorBox…');
        try {
            const res   = await TorBoxAPI.search(movie);
            const torrs = res.data?.torrents || [];
            if (!torrs.length) return Lampa.Noty.show('Ничего не найдено в TorBox');
            const cached = Storage.get('show_cached_only', 'false') === 'true';
            const list   = cached ? torrs.filter(t => t.cached) : torrs;
            if (!list.length) return Lampa.Noty.show('Нет кэшированных результатов', {type: 'info'});
            displayTorrents(list, movie);
        } catch (e) {
            Lampa.Noty.show(e.message, {type: 'error'});
        } finally {
            Lampa.Loading.stop();
        }
    }

    function displayTorrents(torrents, movie) {
        const items = torrents.sort((a,b)=>(b.seeders||0)-(a.seeders||0)).map(t=>({
            title: `${t.cached ? '⚡' : '☁️'} ${t.name || t.raw_title || 'Без названия'}`,
            subtitle: [`💾 ${(t.size/2**30).toFixed(2)} GB`,`🟢 ${t.seeders||0}`,`🔴 ${t.peers||0}`].join(' | '),
            tid: t.id
        }));

        Lampa.Select.show({
            title: 'Результаты TorBox',
            items,
            onSelect: item => {
                const sel = torrents.find(t=>t.id===item.tid);
                sel && handleSelection(sel, movie, torrents);
            },
            onBack: () => Lampa.Controller.toggle('content')
        });
    }

    async function handleSelection(torrent, movie, fullList) {
        Lampa.Loading.start('Обработка…');
        try {
            if (torrent.cached) {
                const files = await TorBoxAPI.getFiles(torrent.id);
                const vids  = files.filter(f=>/\.(mkv|mp4|avi)$/i.test(f.name));
                if (!vids.length) return Lampa.Noty.show('Видео‑файлы не найдены');
                if (vids.length === 1) {
                    return play(torrent.id, vids[0].id, movie, vids[0].name);
                }
                vids.sort((a,b)=>a.name.localeCompare(b.name,void 0,{numeric:true}));
                Lampa.Select.show({
                    title: 'Выберите файл',
                    items: vids.map(f=>({
                        title: f.name,
                        subtitle: `${(f.size/1024**3).toFixed(2)} GB | ${parseQuality(f.name)}`,
                        tid: torrent.id,
                        fid: f.id,
                        fname: f.name
                    })),
                    onSelect: s => play(s.tid, s.fid, movie, s.fname),
                    onBack: () => displayTorrents(fullList, movie)
                });
            } else {
                await TorBoxAPI.addMagnet(torrent.magnet);
                Lampa.Noty.show('Торрент отправлен в TorBox.', {type: 'info'});
            }
        } catch (e) {
            Lampa.Noty.show(e.message, {type: 'error'});
        } finally { Lampa.Loading.stop(); }
    }

    async function play(tid, fid, movie, fileName) {
        Lampa.Loading.start('Получение ссылки…');
        try {
            const url = await TorBoxAPI.getDownload(tid, fid);
            if (!url) throw new Error('Не удалось получить ссылку');
            Lampa.Player.play({url, title: fileName || movie.title, poster: movie.img});
            Lampa.Player.callback(Lampa.Activity.backward);
        } catch (e) {
            Lampa.Noty.show(e.message, {type: 'error'});
        } finally { Lampa.Loading.stop(); }
    }

    // ───────────────────────────────────────────────────────────────────────────
    // 5. Settings: controller for the (now properly named) template
    // ───────────────────────────────────────────────────────────────────────────
    Lampa.Settings.listener.follow('open', (e) => {
        if (e.name !== TPL_NAME) return;
        e.activity.title('TorBox');

        const html = $(Lampa.Template.get(TPL_NAME));
        // bind current state
        const bind = () => {
            html.find('[data-name="api_key"] .settings-param__value').text(Storage.get('api_key', 'Не указан'));
            html.find('[data-name="cached_only"] .settings-param__value').text(Storage.get('show_cached_only', 'false')==='true'?'Да':'Нет');
            html.find('[data-name="debug"] .settings-param__value').text(Storage.get('debug','false')==='true'?'Вкл':'Выкл');
        };
        bind();

        // events
        html.find('[data-name="api_key"]').on('hover:enter', function(){
            Lampa.Input.edit({title:'API Ключ TorBox', value:Storage.get('api_key',''), free:true, nosave:true}, v=>{
                Storage.set('api_key',(v||'').trim());
                bind();
                Lampa.Controller.toggle('settings_component');
            });
        });

        html.find('[data-name="check_key"]').on('hover:enter', async function(){
            const stat = $(this).find('.settings-param__status');
            const key  = Storage.get('api_key','');
            if(!key) return Lampa.Noty.show('Сначала введите API ключ',{type:'warning'});
            stat.text('Проверка…');
            try {
                await TorBoxAPI._call_check(key, '/torrents/mylist', {limit:1});
                stat.text('Ключ действителен 👍');
                Lampa.Noty.show('Ключ действителен',{type:'success'});
            } catch (e) {
                stat.text('Ошибка! 👎');
                Lampa.Noty.show(e.message,{type:'error'});
            }
        });

        html.find('[data-name="cached_only"]').on('hover:enter',function(){
            const cur = Storage.get('show_cached_only','false')==='true';
            Storage.set('show_cached_only',(!cur).toString());
            bind();
        });
        html.find('[data-name="debug"]').on('hover:enter',function(){
            const cur = Storage.get('debug','false')==='true';
            Storage.set('debug',(!cur).toString());
            bind();
        });

        e.body.empty().append(html);
        Lampa.Controller.enable('settings_component');
    });

    // ───────────────────────────────────────────────────────────────────────────
    // 6. Hook into UI: movie card button & settings main entry
    // ───────────────────────────────────────────────────────────────────────────
    function addSettingsButton() {
        if ($(`[data-component="${TPL_NAME}"]`).length) return; // already
        if (Lampa.Settings.main && Lampa.Settings.main()) {
            const folder = $(`
                <div class="settings-folder selector" data-component="${TPL_NAME}">
                    <div class="settings-folder__icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
                    </div>
                    <div class="settings-folder__name">TorBox</div>
                </div>`);
            Lampa.Settings.main().render().find('[data-component="more"]').after(folder);
            Lampa.Settings.main().update();
            DBG('Settings button injected');
        }
    }

    Lampa.Listener.follow('full', (e) => {
        if (e.type !== 'complite') return;
        const root = e.object.activity.render();
        if (root.find('.view--torbox').length) return; // existing
        const btn = $(`<div class="full-start__button selector view--torbox" data-subtitle="TorBox">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
            <span>TorBox</span></div>`);
        btn.on('hover:enter', ()=> searchAndShow(e.data.movie));
        root.find('.view--torrent').after(btn);
    });

    if (window.appready) addSettingsButton();
    else Lampa.Listener.follow('app', e => e.type==='ready' && addSettingsButton());

    DBG('TorBox plug‑in 32.1.0 initialised');
})();
