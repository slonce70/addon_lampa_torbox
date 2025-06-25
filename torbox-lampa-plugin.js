/*
 * TorBox Enhanced – Universal Lampa Plugin v9.3.0 (2025-06-25)
 * ============================================================
 * • ИСПРАВЛЕНА КРИТИЧЕСКАЯ ОШИБКА: Устранена ошибка 'Lampa.Activity.create is not a function' путем перехода на правильный, классовый подход к созданию страниц (Activity).
 * • ПРАВИЛЬНАЯ АРХИТЕКТУРА: Логика отображения результатов переписана с использованием класса, наследующего Lampa.OOP.Controller, в соответствии с документацией и примерами.
 * • СТАБИЛЬНОСТЬ: Новый подход обеспечивает корректную интеграцию в жизненный цикл Lampa и правильное управление состоянием страницы.
 */

(function () {
    'use strict';

    /* ───── Guard double-load ───── */
    const PLUGIN_ID = 'torbox_enhanced_v9_3_0';
    if (window[PLUGIN_ID]) return;
    window[PLUGIN_ID] = true;

    /* ───── Helpers & Config ───── */
    const ICON = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 7L12 2L21 7V17L12 22L3 17V7Z" stroke="currentColor" stroke-width="2"/><path d="M12 22V12" stroke="currentColor" stroke-width="2"/><path d="M21 7L12 12L3 7" stroke="currentColor" stroke-width="2"/></svg>`;
    const Store = {
        get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
        set: (k, v) => { try { localStorage.setItem(k, String(v)); } catch { } }
    };
    const CFG = {
        get debug() { return Store.get('torbox_debug', '0') === '1'; },
        set debug(v) { Store.set('torbox_debug', v ? '1' : '0'); },
        get proxyUrl() { return Store.get('torbox_proxy_url', ''); },
        set proxyUrl(v) { Store.set('torbox_proxy_url', v); }
    };
    const LOG = (...a) => CFG.debug && console.log('[TorBox]', ...a);
    const ql = n => {
        if (!n) return '';
        const name = n.toLowerCase();
        if (/(2160|4k|uhd)/.test(name)) return '4K';
        if (/1080/.test(name)) return '1080p';
        if (/720/.test(name)) return '720p';
        return 'SD';
    };

    /* ───── Inject Styles ───── */
    const component_style = `
        .torbox-activity { padding: 0 2em; }
        .torbox-activity__header { display: flex; align-items: center; margin-bottom: 1.5em; }
        .torbox-activity__title { font-size: 1.8em; font-weight: bold; }
        .torbox-activity__buttons { margin-left: auto; display: flex; gap: 1em; }
        .torbox-activity .card { background-color: rgba(255, 255, 255, 0.05); padding: 1em; margin-bottom: 1em; border-radius: 8px; }
        .torbox-activity .card__title { font-weight: bold; line-height: 1.3; }
        .torbox-activity .card__subtitle { margin-top: 0.5em; color: rgba(255, 255, 255, 0.7); }
    `;
    Lampa.Template.add('style', component_style);

    /* ───── TorBox API wrapper (unchanged) ───── */
    const API = {
        SEARCH_API: 'https://search-api.torbox.app', MAIN_API: 'https://api.torbox.app/v1/api',
        async proxiedCall(targetUrl, options = {}) { const proxy = CFG.proxyUrl; if (!proxy) throw new Error('URL вашего персонального прокси не указано в настройках.'); const proxiedUrl = `${proxy}?url=${encodeURIComponent(targetUrl)}`; LOG(`Calling via proxy: ${targetUrl}`); const r = await fetch(proxiedUrl, options); const responseText = await r.text(); if (r.status === 401) throw new Error(`Ошибка авторизации (401). Проверьте ваш API-ключ.`); if (responseText.includes("NO_AUTH")) throw new Error('Ошибка авторизации (NO_AUTH). Проверьте API-ключ и ваш тарифный план TorBox.'); if (!r.ok) throw new Error(`Ошибка сети: HTTP ${r.status}`); try { const j = JSON.parse(responseText); if (j.success === false) throw new Error(j.message || 'API вернул ошибку.'); return j; } catch (e) { LOG('Invalid JSON or API error:', responseText, e); throw new Error(e.message || 'Получен некорректный ответ от сервера.'); } },
        async search(imdbId) { const key = Store.get('torbox_api_key', ''); if (!key) throw new Error('API-Key не указан.'); const url = `${this.SEARCH_API}/torrents/imdb:${imdbId}?check_cache=true&check_owned=false&search_user_engines=true`; const options = { headers: { 'Authorization': `Bearer ${key}` } }; const res = await this.proxiedCall(url, options); return res.data?.torrents || []; },
        addMagnet(m) { return this.directAction('/torrents/createtorrent', { magnet: m }, 'POST'); },
        files(hash) { return this.directAction('/torrents/mylist', { id: hash }).then(r => r.data?.[0]?.files || []); },
        dl(thash, fid) { return this.directAction('/torrents/requestdl', { torrent_id: thash, file_id: fid }).then(r => r.data); },
        async directAction(path, body = {}, method = 'GET') { const key = Store.get('torbox_api_key', ''); if (!key) throw new Error('API-Key не указан.'); let url = `${this.MAIN_API}${path}`; const options = { method, headers: { 'Authorization': `Bearer ${key}`, 'Accept': 'application/json' } }; if (method !== 'GET') { options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(body); } else if (Object.keys(body).length) { url += '?' + new URLSearchParams(body).toString(); } return await this.proxiedCall(url, options); }
    };

    // ИЗМЕНЕНО: Создаем класс для нашей страницы, как в примере online.js
    class TorrentsActivity extends Lampa.OOP.Controller {
        constructor(torrents, movie) {
            super();
            this.torrents = torrents;
            this.movie = movie;
        }

        create() {
            this.activity.loader(false); // Показываем, что загрузка завершена
            this.activity.style.background = ''; // Убираем фон загрузки

            // Сортируем по сидам по умолчанию
            this.torrents.sort((a, b) => (b.last_known_seeders || 0) - (a.last_known_seeders || 0));

            const container = $('<div class="torbox-activity scroll-content"></div>');
            const header = $(`<div class="torbox-activity__header"><div class="torbox-activity__title">TorBox</div><div class="torbox-activity__buttons"></div></div>`);
            const sortButton = $('<div class="button selector">Сортировать по размеру</div>');
            
            sortButton.on('hover:enter', () => {
                Lampa.Noty.show('Функция сортировки в разработке');
            });

            header.find('.torbox-activity__buttons').append(sortButton);
            container.append(header);

            const listContainer = $('<div class="torbox-activity__list"></div>');
            this.torrents.forEach(t => {
                const card = $(`<div class="card selector"><div class="card__title">${t.cached ? '⚡' : '☁️'} ${t.raw_title || t.title}</div><div class="card__subtitle">[${ql(t.raw_title || t.title)}] ${(t.size / 2 ** 30).toFixed(2)} GB | 🟢 ${t.last_known_seeders || 0}</div></div>`);
                card.on('hover:enter', () => handleTorrent(t, this.movie));
                listContainer.append(card);
            });
            container.append(listContainer);
            
            this.activity.append(container);
        }

        start() {
            super.start();
            this.create();
        }

        pause() { super.pause(); }
        stop() { super.stop(); }
        
        // Переключение фокуса на элементы
        toggle() {
            Lampa.Controller.collectionSet(this.activity.render(), this.activity.render().find('.selector'));
            Lampa.Controller.toggle('content');
        }

        back() { Lampa.Activity.backward(); }
        destroy() {
            super.destroy();
            this.activity.destroy();
        }
    }


    /* ───── UI flows ───── */
    async function searchAndShow(movie) {
        Lampa.Loading.start('TorBox: поиск…');
        try {
            if (!movie.imdb_id) throw new Error("Для поиска нужен IMDb ID.");
            const list = await API.search(movie.imdb_id);
            if (!list || !list.length) {
                return Lampa.Noty.show('TorBox: торренты не найдены.');
            }
            // ИЗМЕНЕНО: Запускаем наш новый класс Activity
            Lampa.Activity.start({
                torrents: list,
                movie: movie
            }, TorrentsActivity);

        } catch (e) {
            LOG('SearchAndShow Error:', e);
            Lampa.Noty.show(`TorBox: ${e.message}`, { type: 'error' });
        } finally {
            Lampa.Loading.stop();
        }
    }

    async function handleTorrent(t, movie) {
        Lampa.Loading.start('TorBox: обработка...');
        try {
            if (t.cached) {
                const files = await API.files(t.hash);
                const vids = files.filter(f => /\.(mkv|mp4|avi)$/i.test(f.name));
                if (!vids.length) { return Lampa.Noty.show('Видеофайлы не найдены.'); }
                if (vids.length === 1) { return play(t.hash, vids[0], movie); }
                vids.sort((a, b) => b.size - a.size);
                Lampa.Select.show({
                    title: 'TorBox: выбор файла',
                    items: vids.map(f => ({ title: f.name, subtitle: `${(f.size / 2 ** 30).toFixed(2)} GB | ${ql(f.name)}`, file: f })),
                    onSelect: i => play(t.hash, i.file, movie),
                    // При нажатии "назад" из выбора файла, возвращаемся на нашу страницу
                    onBack: () => {
                        Lampa.Activity.start({ torrents: API.search(movie.imdb_id), movie: movie }, TorrentsActivity);
                    }
                });
            } else {
                await API.addMagnet(t.magnet);
                Lampa.Noty.show('Отправлено в TorBox. Ожидайте кеширования.');
            }
        } catch (e) { LOG('HandleTorrent Error:', e); Lampa.Noty.show(`TorBox: ${e.message}`, { type: 'error' }); } finally { Lampa.Loading.stop(); }
    }

    async function play(torrentHash, file, movie) {
        Lampa.Loading.start('TorBox: получение ссылки…');
        try {
            const url = await API.dl(torrentHash, file.id);
            if (!url) throw new Error('Не удалось получить ссылку.');
            Lampa.Player.play({ url, title: file.name || movie.title, poster: movie.img });
            Lampa.Player.callback(Lampa.Activity.backward);
        } catch (e) { LOG('Play Error:', e); Lampa.Noty.show(`TorBox: ${e.message}`, { type: 'error' }); } finally { Lampa.Loading.stop(); }
    }

    /* ───── Settings & Boot (unchanged) ───── */
    function addSettings() {
        const COMP = 'torbox_enh'; if (!Lampa.SettingsApi) return;
        Lampa.SettingsApi.addComponent({ component: COMP, name: 'TorBox Enhanced', icon: ICON });
        const fields = [
            { k: 'torbox_proxy_url', n: 'URL вашего CORS-прокси', d: 'Вставьте сюда URL вашего воркера с Cloudflare', t: 'input', def: CFG.proxyUrl },
            { k: 'torbox_api_key', n: 'Ваш личный API-Key', d: 'Обязательно. Взять на сайте TorBox.', t: 'input', def: Store.get('torbox_api_key', '') },
            { k: 'torbox_debug', n: 'Режим отладки', d: 'Записывать подробную информацию в консоль разработчика (F12)', t: 'trigger', def: CFG.debug }
        ];
        fields.forEach(p => Lampa.SettingsApi.addParam({ component: COMP, param: { name: p.k, type: p.t, default: p.def }, field: { name: p.n, description: p.d },
            onChange: v => { const val = String(typeof v === 'object' ? v.value : v).trim(); if (p.k === 'torbox_proxy_url') CFG.proxyUrl = val; if (p.k === 'torbox_api_key') Store.set(p.k, val); if (p.k === 'torbox_debug') CFG.debug = Boolean(v); if (Lampa.Settings) Lampa.Settings.update(); }
        }));
    }

    function hook() {
        Lampa.Listener.follow('full', e => {
            if (e.type !== 'complite' || !e.data.movie) return;
            const root = e.object.activity.render();
            if (root.find('.view--torbox').length) return;
            const btn = $(`<div class="full-start__button selector view--torbox" data-subtitle="TorBox">${ICON}<span>TorBox</span></div>`);
            btn.on('hover:enter', () => searchAndShow(e.data.movie));
            root.find('.view--torrent').after(btn);
        });
    }

    (function bootLoop() {
        if (window.Lampa && window.Lampa.OOP) {
            try { addSettings(); hook(); LOG('TorBox v9.3.0 ready'); }
            catch (e) { console.error('[TorBox] Boot Error:', e); }
            return;
        }
        setTimeout(bootLoop, 500);
    })();
})();
