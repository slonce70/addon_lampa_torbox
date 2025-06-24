/**
 * TorBox Enhanced Lampa Plugin – v3.0.0 (2025‑06‑24)
 * ==================================================================
 *  ● FIX: меню настроек теперь открывается корректно (bug Lampa.Params.update)
 *  ● NEW: «Перенаправлять TorrServer» – автопоток у TorBox замість TorrServer
 *  ● NEW: Debug‑режим – подробные логи в консоль, если нужно отлавливать API
 *  ● Старая функциональность (поиск по TorBox, кнопка на карточке) сохранена
 *  ● Поддержка Lampa ≥ 2.3.x, чистая обратная совместимость
 *------------------------------------------------------------------
 *  Параметры (Lampa.Storage):
 *   • torbox_api_key           – строка с персональным ключом
 *   • torbox_show_cached_only  – 'true' / 'false'
 *   • torbox_debug             – 'true' / 'false'
 *   • torbox_redirect          – 'true' / 'false'
 *=================================================================*/

(function () {
    'use strict';

    /*=================================  CONSTANTS  =================================*/
    const PLUGIN_ID = 'torbox_enhanced_v300';
    if (window[PLUGIN_ID]) return;            // защита от двойной инициализации
    window[PLUGIN_ID] = true;

    const API_BASE = 'https://api.torbox.app/v1/api';
    const API_SEARCH = 'https://search-api.torbox.app';
    const API_LAMPA = 'https://api.torbox.app/lampa';

    /*================================  HELPERS  ====================================*/
    const LS = {
        get(key, def) {
            try { return window.Lampa ? window.Lampa.Storage.get(key, def) : (localStorage.getItem(key) ?? def); }
            catch (e) { return def; }
        },
        set(key, val) {
            try { window.Lampa ? window.Lampa.Storage.set(key, val) : localStorage.setItem(key, val); }
            catch (e) { /* noop */ }
        }
    };
    const log = (...a) => LS.get('torbox_debug', 'false') === 'true' && console.log('[TorBox]', ...a); // eslint-disable-line no-console

    const hasRedirect = () => LS.get('torbox_redirect', 'false') === 'true';

    const isMagnetLike = (str = '') => /^magnet:|^[a-f0-9]{40}$/i.test(str);

    /*==============================  SETTINGS UI  ===================================*/
    // регистрируем значения в Params → чтобы Lampa сама отрисовала индикаторы
    if (window.Lampa && window.Lampa.Params) {
        Lampa.Params.select('torbox_api_key', '', '');
        Lampa.Params.select('torbox_show_cached_only', { 'Нет': 'false', 'Да': 'true' }, 'false');
        Lampa.Params.select('torbox_debug', { 'Выкл': 'false', 'Вкл': 'true' }, 'false');
        Lampa.Params.select('torbox_redirect', { 'Нет': 'false', 'Да': 'true' }, 'false');
    }

    /** HTML шаблон тела настроек (универсальный для старых версий Lampa) */
    const tplSettings = `
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
        </div>`;
    if (window.Lampa && window.Lampa.Template) Lampa.Template.add('settings_torbox', tplSettings);

    /* вставляем пункт «TorBox» в корневое меню настроек */
    function registerSettingsFolder() {
        const main = Lampa.Settings.main();
        if (!main || !main.render) return;
        if (main.render().find('[data-component="torbox"]').length) return; // уже внедрено

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
        main.render().find('[data-component="more"]').after($btn);
        main.update();

        const badge = () => {
            const hasKey = !!LS.get('torbox_api_key', '');
            $btn.find('.settings-folder__auth').toggleClass('active', hasKey).text(hasKey ? '✓' : '');
        };
        badge();
        Lampa.Storage.listener.follow('change', (e) => e.name === 'torbox_api_key' && badge());

        /* отклик при открытии */
        Lampa.Settings.listener.follow('open', (evt) => {
            if (evt.name !== 'torbox') return;
            evt.body.html(Lampa.Template.get('settings_torbox'));
            // критический фикс – передаём [] вместо false
            Lampa.Params.update(evt.body.find('.selector'), [], evt.body);

            // проверка API‑ключа
            evt.body.find('[data-name="check_api_key"]').on('hover:enter', async () => {
                const status = evt.body.find('[data-name="check_api_key"] .settings-param__status');
                status.removeClass('active error').addClass('wait');
                Lampa.Loading.start();
                try {
                    await TorBoxAPI._call('/torrents/mylist', { limit: 1 });
                    status.removeClass('wait error').addClass('active');
                    Lampa.Noty.show('API‑ключ действителен!', { type: 'success' });
                } catch (e) {
                    status.removeClass('wait active').addClass('error');
                    Lampa.Noty.show(e.message, { type: 'error' });
                } finally {
                    Lampa.Loading.stop();
                }
            });
        });
    }

    /*==============================  TorBox API  ===================================*/
    const TorBoxAPI = {
        async _call(endpoint, params = {}, method = 'GET', base = API_BASE) {
            const apiKey = LS.get('torbox_api_key', '');
            if (!apiKey) throw new Error('API‑ключ TorBox не установлен');

            let url = `${base}${endpoint}`;
            const opt = { method, headers: { 'Authorization': `Bearer ${apiKey}` } };

            if (method === 'GET' && Object.keys(params).length) url += '?' + new URLSearchParams(params).toString();
            else if (method === 'POST') {
                if (params instanceof FormData) opt.body = params;
                else { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(params); }
            }

            const res = await fetch(url, opt);
            if ([401, 403].includes(res.status)) throw new Error('Недействительный API‑ключ');
            const data = await res.json();
            if (!res.ok || data.success === false) throw new Error(data.error || data.detail || `HTTP‑${res.status}`);
            return data;
        },
        search(movie) {
            const q = movie.imdb_id ? `imdb:${movie.imdb_id}` : movie.title;
            return this._call(`/torrents/search/${encodeURIComponent(q)}`, { metadata: 'true', check_cache: 'true' }, 'GET', API_SEARCH);
        },
        addMagnet(magnet) {
            const f = new FormData(); f.append('magnet', magnet);
            return this._call('/torrents/createtorrent', f, 'POST');
        },
        getFiles(id) {
            return this._call('/torrents/mylist', { id }).then(r => (r.data?.[0]?.files || []));
        },
        getDownloadLink(tid, fid) {
            return this._call('/torrents/requestdl', { torrent_id: tid, file_id: fid }).then(r => r.data);
        }
    };

    /*===========================  TorrServer interception  =========================*/
    function setupTorrServerIntercept() {
        if (!window.Lampa || !window.Lampa.Torrent) return;
        if (window.Lampa.Torrent.__torboxPatched) return; // one‑time
        window.Lampa.Torrent.__torboxPatched = true;

        const originalOpen = typeof Lampa.Torrent.open === 'function' ? Lampa.Torrent.open.bind(Lampa.Torrent) : null;

        Lampa.Torrent.open = function (obj) {
            const hash = typeof obj === 'string' ? obj : (obj?.magnet || obj?.hash || obj?.url || '');
            if (hasRedirect() && isMagnetLike(hash)) {
                log('Redirect Torrent.open → TorBox', hash);
                startTorBoxStream(hash);
                return; // прерываем оригинал
            }
            if (originalOpen) return originalOpen(obj);
        };

        // запасной механизм: кнопка в меню торрента
        Lampa.Listener.follow('torrent', (e) => {
            if (e.type !== 'open') return;
            const file = e.object || {};
            const hash = file.magnet || file.hash || '';
            if (!isMagnetLike(hash)) return;
            if (!file.menu) file.menu = [];
            if (file.menu.find(i => i.torbox)) return;
            file.menu.push({ torbox: true, title: '▶ TorBox', onSelect: () => startTorBoxStream(hash) });
        });

        // ещё одна страховка – пункт меню плеера
        Lampa.Listener.follow('player', (e) => {
            if (e.type !== 'file') return;
            const f = e.file || {}; const hash = f.magnet || f.infoHash || '';
            if (!isMagnetLike(hash)) return;
            if (!f.menu) f.menu = [];
            if (f.menu.find(i => i.torbox)) return;
            f.menu.push({ torbox: true, title: '▶ Воспроизвести через TorBox', subtitle: 'Поток TorBox', onSelect: () => startTorBoxStream(hash) });
        });
    }

    /*============================  Stream launcher  ===============================*/
    async function startTorBoxStream(hash) {
        const apiKey = LS.get('torbox_api_key', '');
        if (!apiKey) return Lampa.Noty.show('Сначала введите API‑ключ TorBox в настройках');
        log('TorBox stream req', hash);
        Lampa.Loading.start();
        try {
            const res = await fetch(API_LAMPA, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ magnet: hash, action: 'add', api_key: apiKey })
            });
            const j = await res.json();
            if (j?.play_url) {
                playStream(j.play_url);
            } else throw new Error('TorBox не вернул play_url');
        } catch (e) {
            log('stream error', e);
            Lampa.Noty.show('Ошибка TorBox API', { type: 'error' });
        } finally { Lampa.Loading.stop(); }
    }

    function playStream(url) {
        log('Play stream', url);
        Lampa.Player.play({ url, title: 'TorBox Stream', poster: '' });
        Lampa.Player.callback(() => Lampa.Activity.backward());
    }

    /*===========================  Search integration  =============================*/
    function attachMovieButton() {
        Lampa.Listener.follow('full', (e) => {
            if (e.type !== 'complite') return;
            const $view = e.object.activity.render();
            if ($view.find('.view--torbox').length) return;

            const $btn = $(`
                <div class="full-start__button selector view--torbox" data-subtitle="TorBox">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 2 2 7l10 5 10-5L12 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                        <path d="m2 12 10 5 10-5" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                        <path d="m2 17 10 5 10-5" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                    </svg>
                    <span>TorBox</span>
                </div>`);
            $btn.on('hover:enter', () => searchAndShow(e.data.movie));
            $view.find('.view--torrent').after($btn);
        });
    }

    async function searchAndShow(movie) {
        Lampa.Loading.start();
        try {
            const res = await TorBoxAPI.search(movie);
            const torrents = res.data?.torrents || [];
            if (!torrents.length) return Lampa.Noty.show('Ничего не найдено в TorBox');

            const onlyCached = LS.get('torbox_show_cached_only', 'false') === 'true';
            const list = onlyCached ? torrents.filter(t => t.cached) : torrents;
            if (!list.length) return Lampa.Noty.show('Нет кэшированных результатов');

            displayTorrents(list, movie);
        } catch (e) {
            Lampa.Noty.show(e.message, { type: 'error', time: 5000 });
        } finally { Lampa.Loading.stop(); }
    }

    function displayTorrents(torrents, movie) {
        const items = torrents.sort((a,b)=>(b.seeders||0)-(a.seeders||0)).map(t => ({
            title: `${t.cached ? '⚡' : '☁️'} ${t.name || t.raw_title || 'Без названия'}`,
            subtitle: [`💾 ${(t.size/2**30).toFixed(2)} GB`, `🟢 ${t.seeders||0}`, `🔴 ${t.peers||0}`].filter(Boolean).join(' | '),
            tid: t.id,
            torrent: t
        }));
        Lampa.Select.show({
            title: 'Результаты TorBox',
            items,
            onSelect(item) { handleTorrent(item.torrent, movie, torrents); },
            onBack() { Lampa.Controller.toggle('content'); }
        });
    }

    async function handleTorrent(t, movie, all) {
        Lampa.Loading.start();
        try {
            if (t.cached) {
                const files = await TorBoxAPI.getFiles(t.id);
                const vids = files.filter(f => /\.(mkv|mp4|avi|mov|webm|flv|wmv)$/i.test(f.name));
                if (!vids.length) return Lampa.Noty.show('Видео‑файлы не найдены', { type: 'warning' });
                if (vids.length === 1) return playCached(t.id, vids[0].id, movie);
                Lampa.Select.show({
                    title: 'Выберите файл',
                    items: vids.map(f => ({
                        title: f.name,
                        subtitle: [qualityLabel(f.name), `${(f.size/1024**3).toFixed(2)} GB`].filter(Boolean).join(' | '),
                        tid: t.id, fid: f.id
                    })),
                    onSelect: s => playCached(s.tid, s.fid, movie),
                    onBack: () => displayTorrents(all, movie)
                });
            } else {
                await TorBoxAPI.addMagnet(t.magnet);
                Lampa.Noty.show('Торрент отправлен в TorBox – дождитесь кеширования', { type: 'info', time: 6000 });
            }
        } catch (e) {
            Lampa.Noty.show(e.message, { type: 'error', time: 5000 });
        } finally { Lampa.Loading.stop(); }
    }

    async function playCached(tid, fid, movie) {
        Lampa.Loading.start();
        try {
            const url = await TorBoxAPI.getDownloadLink(tid, fid);
            if (!url) throw new Error('Не удалось получить ссылку');
            Lampa.Player.play({ url, title: movie.title, poster: movie.img });
            Lampa.Player.callback(() => Lampa.Activity.backward());
        } catch (e) {
            Lampa.Noty.show(e.message, { type: 'error', time: 5000 });
        } finally { Lampa.Loading.stop(); }
    }

    const qualityLabel = (n='')=>{n=n.toLowerCase();if(n.includes('2160')||n.includes('4k'))return'✨ 4K';if(n.includes('1080'))return'🔥 1080p';if(n.includes('720'))return'720p';return'';};

    /*=============================  INIT ==========================================*/
    function init() {
        try {
            registerSettingsFolder();
            attachMovieButton();
            setupTorrServerIntercept();
            log('TorBox Enhanced v3.0.0 – ready');
        } catch (e) { console.error('TorBox init error', e); } // eslint-disable-line no-console
    }

    if (window.appready) init();
    else {
        const readyListener = (e) => { if (e.type === 'ready') { Lampa.Listener.remove('app', readyListener); init(); } };
        Lampa.Listener.follow('app', readyListener);
    }

})();
