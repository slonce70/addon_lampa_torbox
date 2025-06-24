/**
 * TorBox ↔ Lampa integration plugin
 * Version 5.1.0 – Web version compatible (June 2025)
 *
 * Changelog vs 5.0.3:
 *  • Исправлено несоответствие ключей Storage (cached‑only)
 *  • Переключено на публичный Search‑API без авторизации (избавились от CORS)
 *  • RequestDL теперь использует permalink с ?token=…&redirect=true (рекомендация API)
 *  • Упрощена логика fallback, убраны лишние CORS‑прокси для поиска
 *  • Минимизировано количество запросов, улучшена обработка ошибок
 *
 * Author: GOD MODE (updated by ChatGPT‑o3)
 */
(function () {
    'use strict';

    /* ---------- GLOBAL GUARD ---------- */
    const NS = 'torbox_lampa_plugin_v5_1_0';
    if (window[NS]) return;
    window[NS] = true;

    /* ---------- CONSTANTS ---------- */
    const S = {
        API_KEY: 'torbox_api_key',
        CACHED_ONLY: 'torbox_cached_only'
    };

    const API_BASE = 'https://api.torbox.app/v1/api';
    const SEARCH_API = 'https://search-api.torbox.app';

    /* ---------- CORE API ---------- */
    const TorBoxAPI = {
        async call(endpoint, params = {}, method = 'GET') {
            const key = Lampa.Storage.get(S.API_KEY, '');
            if (!key) throw new Error('Установите API‑ключ TorBox в настройках');

            let url = `${API_BASE}${endpoint}`;
            const opts = { method, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` } };

            if (method === 'GET' && Object.keys(params).length) {
                url += '?' + new URLSearchParams(params).toString();
            } else if (method === 'POST') {
                opts.body = JSON.stringify(params);
            }

            const resp = await fetch(url, opts);
            if (!resp.ok) {
                const txt = await resp.text();
                throw new Error(`TorBox API: ${resp.status} ${resp.statusText}\n${txt}`);
            }
            const data = await resp.json();
            if (data.success === false) throw new Error(data.error || data.detail || 'API ошибка');
            return data;
        },

        /* ---------- SEARCH ---------- */
        async searchTorrents(movie) {
            const query = movie.imdb_id ? `imdb:${movie.imdb_id}` : `${movie.title} ${movie.year || ''}`.trim();
            const url = `${SEARCH_API}/torrents/search/${encodeURIComponent(query)}?metadata=1&check_cache=1`;
            try {
                const resp = await fetch(url);
                if (!resp.ok) throw new Error('Ошибка поиска');
                const js = await resp.json();
                return this.format(js?.data || []);
            } catch (err) {
                console.error('TorBox search:', err);
                Lampa.Noty.show(err.message, { type: 'error' });
                return [];
            }
        },

        format(list) {
            const cachedOnly = Lampa.Storage.get(S.CACHED_ONLY, false);
            return list
                .filter(t => cachedOnly ? t.cached : true)
                .map(t => ({
                    title: t.name || t.raw_title,
                    info: `${t.cached ? '⚡ ' : ''}${(t.size / 2 ** 30).toFixed(2)} GB • S:${t.seeders ?? '?'}`,
                    quality: t.resolution || t.quality || '—',
                    size: t.size,
                    cached: !!t.cached,
                    id: t.id,
                    hash: t.hash,
                    magnet: t.magnet
                }))
                .sort((a, b) => b.size - a.size);
        },

        /* ---------- MAIN FLOW ---------- */
        async select(t) {
            Lampa.Loading.start();
            try {
                if (t.cached) await this.playCached(t);
                else await this.add(t);
            } finally {
                Lampa.Loading.stop();
            }
        },

        async add(t) {
            await this.call('/torrents/createtorrent', { magnet: t.magnet }, 'POST');
            Lampa.Noty.show('Торрент добавлен в TorBox!', { type: 'success' });
        },

        async playCached(t) {
            const data = await this.call('/torrents/mylist', { id: t.id });
            const files = (data.data?.files || []).filter(f => /\.(mkv|mp4|avi|mov|wmv|flv|m4v|webm)$/i.test(f.name));
            if (!files.length) throw new Error('Видео‑файлы не найдены');

            if (files.length === 1) {
                await this.play(t.id, files[0].id);
            } else {
                this.chooseFile(t.id, files);
            }
        },

        chooseFile(torrentId, files) {
            Lampa.Select.show({
                title: 'Выберите файл',
                items: files.map(f => ({
                    title: f.name,
                    subtitle: `${(f.size / 2 ** 30).toFixed(2)} GB`,
                    fileId: f.id
                })),
                onSelect: ({ fileId }) => this.play(torrentId, fileId),
                onBack: () => Lampa.Controller.toggle('content')
            });
        },

        async play(torrentId, fileId) {
            const key = Lampa.Storage.get(S.API_KEY, '');
            const url = `${API_BASE}/torrents/requestdl?token=${key}&torrent_id=${torrentId}&file_id=${fileId}&redirect=true`;
            Lampa.Player.play({ url });
        }
    };

    /* ---------- SETTINGS UI ---------- */
    function settings() {
        const apiKey = Lampa.Storage.get(S.API_KEY, '');
        const cachedOnly = Lampa.Storage.get(S.CACHED_ONLY, false);

        Lampa.Select.show({
            title: 'TorBox',
            items: [
                {
                    title: 'API‑ключ',
                    subtitle: apiKey ? '••••••••' : 'Не установлен',
                    input: true,
                    value: apiKey,
                    placeholder: 'Введите API‑ключ',
                    description: 'Ключ можно найти в Dashboard TorBox → API',
                    onChange(v) { Lampa.Storage.set(S.API_KEY, v); }
                },
                {
                    title: 'Только кэшированные торренты',
                    subtitle: cachedOnly ? 'Включено' : 'Выключено',
                    toggle: true,
                    value: cachedOnly,
                    onChange(v) { Lampa.Storage.set(S.CACHED_ONLY, v); }
                }
            ],
            onSelect(item) {
                if (item.input) {
                    const html = $(
                        `<div class="settings-param selector" data-name="field">
                            <div class="settings-param__name">${item.title}</div>
                            <div class="settings-param__value"><input type="text" placeholder="${item.placeholder}" value="${item.value}"/></div>
                            <div class="settings-param__descr">${item.description}</div>
                        </div>
                        <div class="settings-param selector" data-name="save" data-static="true">
                            <div class="settings-param__name">Сохранить</div>
                        </div>`
                    );
                    Lampa.Modal.open({
                        title: item.title,
                        html,
                        size: 'medium',
                        mask: true,
                        onSelect(el) {
                            if (el.data('name') === 'save') {
                                const val = el.closest('.modal').find('input').val().trim();
                                item.onChange(val);
                                Lampa.Modal.close();
                                settings();
                            }
                        },
                        onBack() { Lampa.Modal.close(); settings(); }
                    });
                    setTimeout(() => $('.modal input').focus(), 90);
                } else if (item.toggle) {
                    item.onChange(!item.value);
                    settings();
                }
            },
            onBack() { Lampa.Controller.toggle('content'); }
        });
    }

    /* ---------- COMPONENT ---------- */
    const Component = {
        create() { return this; },
        async searchAndShow(movie) {
            if (!Lampa.Storage.get(S.API_KEY, '')) {
                Lampa.Noty.show('Сначала укажите API‑ключ TorBox', { type: 'error' });
                settings();
                return;
            }
            Lampa.Loading.start();
            try {
                const list = await TorBoxAPI.searchTorrents(movie);
                if (!list.length) {
                    Lampa.Noty.show('Ничего не найдено', { type: 'info' });
                    return;
                }
                Lampa.Select.show({
                    title: 'TorBox — Выберите торрент',
                    items: list.map(t => ({ title: t.title, subtitle: t.info, torrent: t })),
                    onSelect: ({ torrent }) => TorBoxAPI.select(torrent),
                    onBack: () => Lampa.Controller.toggle('content')
                });
            } finally {
                Lampa.Loading.stop();
            }
        }
    };

    /* ---------- INTEGRATION ---------- */
    function integrate() {
        Lampa.Component.add?.('torbox', Component);

        // settings entry
        const addSettings = () => {
            if (!Lampa.Settings.main().render().find('[data-component="torbox"]').length) {
                const field = `
                    <div class="settings-folder selector" data-component="torbox" data-static="true">
                        <div class="settings-folder__icon">
                            <svg width="57" height="57" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="white" stroke-width="2" stroke-linejoin="round"/>
                                <path d="M2 17L12 22L22 17" stroke="white" stroke-width="2" stroke-linejoin="round"/>
                                <path d="M2 12L12 17L22 12" stroke="white" stroke-width="2" stroke-linejoin="round"/>
                            </svg>
                        </div>
                        <div class="settings-folder__name">TorBox</div>
                    </div>`;
                Lampa.Settings.main().render().find('[data-component="more"]').after(field);
                Lampa.Settings.main().update();
            }
        };

        Lampa.Settings.listener.follow('open', e => {
            if (e.name === 'main') e.body.find('[data-component="torbox"]').on('hover:enter', settings);
        });

        // movie menu button
        Lampa.Listener.follow('full', e => {
            if (e.type === 'complite') {
                const { movie } = e.data;
                const btn = $(
                    `<div class="full-start__button selector view--torbox" data-subtitle="TorBox">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                            <path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                            <path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                        </svg>
                        <span>TorBox</span>
                    </div>`
                );
                btn.on('hover:enter', () => Component.searchAndShow(movie));
                $('.full-start__buttons').append(btn);
            }
        });

        if (window.appready) addSettings();
        else Lampa.Listener.follow('app', e => { if (e.type === 'ready') addSettings(); });

        console.log('%cTorBox v5.1.0 — initialized', 'color:#0f0');
    }

    /* ---------- BOOTSTRAP ---------- */
    if (window.appready) integrate();
    else Lampa.Listener.follow('app', e => { if (e.type === 'ready') integrate(); });
})();
