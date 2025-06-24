/**
 * TorBox <-> Lampa integration plugin
 * Version: 17.2.0  (settings‑menu hot‑fix)
 * Author: Gemini AI & <ваше имя>
 *
 * CHANGE‑LOG v17.2.0
 * ──────────────────────────
 * • Исправлена критическая ошибка в меню настроек:
 *     Lampa.Params.update теперь вызывается корректно (вторым аргументом передаётся массив [], а не false).
 *    Из‑за этой ошибки плагин «зависал» при входе в подраздел «TorBox» и ввод API‑ключа был невозможен.  
 * • Добавлен бейдж‑индикатор авторизации рядом с пунктом «TorBox» в общем меню настроек.  
 *    Индикатор в режиме real‑time реагирует на добавление/удаление ключа.
 * • Небольшой рефакторинг и защита от двойной инициализации.
 */

(function () {
    'use strict';

    /*==============================================================================
     *  CONSTANTS / GUARDS
     *============================================================================*/
    const PLUGIN_NAME = 'TorBoxPluginV17_2';
    if (window[PLUGIN_NAME]) return; // не допускаем повторный запуск
    window[PLUGIN_NAME] = true;

    /*==============================================================================
     *  1.  ПАРАМЕТРЫ (сохраняются через Lampa.Storage)
     *============================================================================*/
    // API‑ключ (текстовая строка)
    Lampa.Params.select('torbox_api_key', '', '');

    // Пользовательский фильтр «Показывать только кэшированные»
    Lampa.Params.select('torbox_show_cached_only', { 'Нет': 'false', 'Да': 'true' }, 'false');

    /*==============================================================================
     *  2.  UI  НАСТРОЕК
     *============================================================================*/
    function addTorboxSettings() {
        /*-------------------------- 2.1 Шаблон страницы --------------------------*/
        const settingsTemplate = `
            <div>
                <div class="settings-param selector" data-name="torbox_api_key" data-type="input" placeholder="Введите ваш персональный API‑ключ">
                    <div class="settings-param__name">API ключ TorBox</div>
                    <div class="settings-param__value"></div>
                </div>

                <div class="settings-param-title" style="margin-top:1em;">Проверка</div>
                <div class="settings-param selector" data-type="button" data-name="check_api_key">
                    <div class="settings-param__name">Проверить ключ</div>
                    <div class="settings-param__status"></div>
                </div>

                <div class="settings-param-title" style="margin-top:1em;">Фильтры</div>
                <div class="settings-param selector" data-name="torbox_show_cached_only" data-type="select">
                    <div class="settings-param__name">Показывать только кэшированные</div>
                    <div class="settings-param__value"></div>
                </div>

                <div class="settings-param__descr" style="margin-top:1em;">
                    API‑ключ можно получить в личном кабинете на сайте <a href="https://torbox.app/settings" target="_blank">torbox.app</a>
                </div>
            </div>`;
        Lampa.Template.add('settings_torbox', settingsTemplate);

        /*---------------------- 2.2 Пункт «TorBox» в дереве настроек -------------*/
        const folderButton = $(`
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

        /*----------------------- 2.3 Реакция на открытие папки -------------------*/
        Lampa.Settings.listener.follow('open', (e) => {
            if (e.name !== 'torbox') return;

            e.body.html(Lampa.Template.get('settings_torbox'));

            // ────────────  ВАЖНОЕ ИСПРАВЛЕНИЕ  ────────────
            // Вторым аргументом обязательно должен быть массив изменений (может быть пустым),
            // иначе Lampa.Params.update внутри вызывает .forEach и падает с TypeError.
            // Ранее передавалось «false», из‑за чего клик по папке приводил к крэшу скрипта.
            Lampa.Params.update(e.body.find('.selector'), [], e.body);
            // ──────────────────────────────────────────────

            /* Проверка ключа */
            e.body.find('[data-name="check_api_key"]').on('hover:enter', async () => {
                const status = e.body.find('[data-name="check_api_key"] .settings-param__status');
                status.removeClass('active error').addClass('wait');
                Lampa.Loading.start();
                try {
                    await TorBoxAPI._call('/torrents/mylist', { limit: 1 });
                    status.removeClass('wait error').addClass('active');
                    Lampa.Noty.show('API‑ключ действителен!', { type: 'success' });
                } catch (err) {
                    status.removeClass('wait active').addClass('error');
                    Lampa.Noty.show(err.message, { type: 'error' });
                } finally {
                    Lampa.Loading.stop();
                }
            });
        });

        /*-------------------- 2.4 Встраиваем папку в «Главные» ------------------*/
        const mainSettings = Lampa.Settings.main();
        if (mainSettings && mainSettings.render) {
            if (!mainSettings.render().find('[data-component="torbox"]').length) {
                mainSettings.render().find('[data-component="more"]').after(folderButton);
                mainSettings.update();
            }
        }

        /*------------------ 2.5 Бейдж «✓» при наличии ключа ---------------------*/
        function syncAuthBadge() {
            const hasKey = !!Lampa.Storage.get('torbox_api_key', '');
            mainSettings.render().find('[data-component="torbox"] .settings-folder__auth')
                .toggleClass('active', hasKey)
                .text(hasKey ? '✓' : '');
        }
        syncAuthBadge();

        // реагируем на изменение ключа в любом месте интерфейса
        Lampa.Storage.listener.follow('change', (e) => {
            if (e.name === 'torbox_api_key') syncAuthBadge();
        });
    }

    /*==============================================================================
     *  3.  API‑обёртка  (без изменений)
     *============================================================================*/
    const TorBoxAPI = {
        API_BASE: 'https://api.torbox.app/v1/api',
        API_SEARCH_BASE: 'https://search-api.torbox.app',

        async _call(endpoint, params = {}, method = 'GET', base = this.API_BASE) {
            const apiKey = Lampa.Storage.get('torbox_api_key', '');
            if (!apiKey) throw new Error('API‑ключ TorBox не установлен');

            let url = `${base}${endpoint}`;
            const options = { method, headers: { 'Authorization': `Bearer ${apiKey}` } };

            if (method === 'GET' && Object.keys(params).length) {
                url += '?' + new URLSearchParams(params).toString();
            } else if (method === 'POST') {
                if (params instanceof FormData) {
                    options.body = params;
                } else {
                    options.headers['Content-Type'] = 'application/json';
                    options.body = JSON.stringify(params);
                }
            }

            const response = await fetch(url, options);
            if ([401, 403].includes(response.status)) throw new Error('Неверный или недействительный API‑ключ');
            const data = await response.json();
            if (!response.ok || data.success === false) {
                throw new Error(data.error || data.detail || `HTTP‑ошибка: ${response.status}`);
            }
            return data;
        },

        search(movie) {
            const query = movie.imdb_id ? `imdb:${movie.imdb_id}` : movie.title;
            return this._call(`/torrents/search/${encodeURIComponent(query)}`, { metadata: 'true', check_cache: 'true' }, 'GET', this.API_SEARCH_BASE);
        },
        addMagnet(magnet) {
            const form = new FormData();
            form.append('magnet', magnet);
            return this._call('/torrents/createtorrent', form, 'POST');
        },
        getFiles(id) {
            return this._call('/torrents/mylist', { id }).then(r => (r.data && r.data[0] ? r.data[0].files || [] : []));
        },
        getDownloadLink(torrentId, fileId) {
            return this._call('/torrents/requestdl', { torrent_id: torrentId, file_id: fileId }).then(r => r.data);
        }
    };

    /*==============================================================================
     *  4.  ЛОГИКА плагина (по‑большей части без изменений)
     *============================================================================*/
    function startPlugin() {
        /* 4.1 Регистрируем меню настроек */
        addTorboxSettings();

        /* 4.2 Кнопка «TorBox» на карточке фильма */
        Lampa.Listener.follow('full', (e) => {
            if (e.type !== 'complite' || e.object.activity.render().find('.view--torbox').length) return;
            const btn = $(
                `<div class="full-start__button selector view--torbox" data-subtitle="TorBox">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 2 2 7l10 5 10-5L12 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                        <path d="m2 12 10 5 10-5" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                        <path d="m2 17 10 5 10-5" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                    </svg>
                    <span>TorBox</span>
                </div>`);
            btn.on('hover:enter', () => searchAndShow(e.data.movie));
            e.object.activity.render().find('.view--torrent').after(btn);
        });

        /* ------------------ поиск и отображение результата ------------------- */
        async function searchAndShow(movie) {
            Lampa.Loading.start();
            try {
                const res = await TorBoxAPI.search(movie);
                const torrents = res.data?.torrents || [];
                if (!torrents.length) return Lampa.Noty.show('Ничего не найдено в TorBox');

                const onlyCached = Lampa.Storage.get('torbox_show_cached_only', 'false') === 'true';
                const list = onlyCached ? torrents.filter(t => t.cached) : torrents;
                if (!list.length) return Lampa.Noty.show('Нет кэшированных результатов');

                displayTorrents(list, movie);
            } catch (e) {
                Lampa.Noty.show(e.message, { type: 'error', time: 5000 });
            } finally {
                Lampa.Loading.stop();
            }
        }

        /* ------------------- экран выбора раздачи --------------------------- */
        function displayTorrents(torrents, movie) {
            const items = torrents
                .sort((a, b) => (b.seeders || 0) - (a.seeders || 0))
                .map(t => ({
                    title: `${t.cached ? '⚡' : '☁️'} ${t.name || t.raw_title || 'Без названия'}`,
                    subtitle: [`💾 ${(t.size / 2 ** 30).toFixed(2)} GB`, `🟢 ${t.seeders || 0}`, `🔴 ${t.peers || 0}`].filter(Boolean).join(' | '),
                    torrent_id: t.id
                }));

            Lampa.Select.show({
                title: 'Результаты TorBox',
                items,
                onSelect(item) {
                    const full = torrents.find(t => t.id === item.torrent_id);
                    if (full) handleTorrent(full, movie, torrents);
                },
                onBack() { Lampa.Controller.toggle('content'); }
            });
        }

        /* ---------------- обработка выбора раздачи ------------------------- */
        async function handleTorrent(torrent, movie, list) {
            Lampa.Loading.start();
            try {
                if (torrent.cached) {
                    const files = await TorBoxAPI.getFiles(torrent.id);
                    const videos = files.filter(f => /\.(mkv|mp4|avi|mov|webm|flv|wmv)$/i.test(f.name));
                    if (!videos.length) return Lampa.Noty.show('Видео‑файлы не найдены', { type: 'warning' });

                    if (videos.length === 1) {
                        await play(torrent.id, videos[0].id, movie);
                    } else {
                        Lampa.Select.show({
                            title: 'Выберите файл',
                            items: videos.map(f => ({
                                title: f.name,
                                subtitle: [qualityLabel(f.name), sizeLabel(f.size)].filter(Boolean).join(' | '),
                                tid: torrent.id,
                                fid: f.id
                            })),
                            onSelect: sel => play(sel.tid, sel.fid, movie),
                            onBack: () => displayTorrents(list, movie)
                        });
                    }
                } else {
                    await TorBoxAPI.addMagnet(torrent.magnet);
                    Lampa.Noty.show('Торрент отправлен в TorBox. Ожидайте загрузку.', { type: 'info', time: 5000 });
                }
            } catch (e) {
                Lampa.Noty.show(e.message, { type: 'error', time: 5000 });
            } finally {
                Lampa.Loading.stop();
            }
        }

        function qualityLabel(name = '') {
            const n = name.toLowerCase();
            if (n.includes('2160p') || n.includes('4k')) return '✨ 4K UHD';
            if (n.includes('1080p')) return '🔥 Full HD';
            if (n.includes('720p'))  return 'HD';
            if (n.includes('480p'))  return 'SD';
            return '';
        }
        const sizeLabel = size => size ? `${(size / 1024 ** 3).toFixed(2)} GB` : '';

        /* ----------------‑‑ запускаем воспроизведение ------------------------ */
        async function play(torrentId, fileId, movie) {
            Lampa.Loading.start();
            try {
                const url = await TorBoxAPI.getDownloadLink(torrentId, fileId);
                if (!url) throw new Error('Не удалось получить ссылку');
                Lampa.Player.play({ url, title: movie.title, poster: movie.img });
                Lampa.Player.callback(() => Lampa.Activity.backward());
            } catch (e) {
                Lampa.Noty.show(e.message, { type: 'error', time: 5000 });
            } finally {
                Lampa.Loading.stop();
            }
        }
    }

    /*==============================================================================
     *  5.  Автозапуск
     *============================================================================*/
    if (window.appready) startPlugin();
    else Lampa.Listener.follow('app', e => e.type === 'ready' && startPlugin());

})();
