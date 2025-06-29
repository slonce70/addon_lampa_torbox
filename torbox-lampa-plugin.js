/* TorBox Lampa Plugin - Refactored Version */
(function () {
    'use strict';

    function startPlugin() {
        // ───────────────────────────── guard ──────────────────────────────
        const PLUGIN_ID = 'torbox_lampa_plugin_refactored';
        if (window[PLUGIN_ID]) return;
        window[PLUGIN_ID] = true;

        // ───────────────────── core ▸ STORAGE ─────────────────────────────
        const Storage = {
            get: Lampa.Storage.get.bind(Lampa.Storage),
            set: Lampa.Storage.set.bind(Lampa.Storage),
            toggle: Lampa.Storage.toggle.bind(Lampa.Storage),
        };

        // ───────────────────── core ▸ UTILS ───────────────────────────────
        const Utils = {
            escapeHtml(str = '') {
                const div = document.createElement('div');
                div.textContent = str;
                return div.innerHTML;
            },
            formatBytes(bytes = 0, speed = false) {
                const B = Number(bytes);
                if (isNaN(B) || B === 0) return speed ? '0 KB/s' : '0 B';
                const k = 1024;
                const sizes = speed ? ['B/s', 'KB/s', 'MB/s', 'GB/s'] : ['B', 'KB', 'MB', 'GB', 'TB'];
                const i = Math.floor(Math.log(B) / Math.log(k));
                return `${(B / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
            },
            formatAge(iso) {
                if (!iso) return 'н/д';
                const d = new Date(iso);
                if (isNaN(d.getTime())) return 'н/д';
                const diff = Math.floor((Date.now() - d.getTime()) / 1000); // sec
                if (diff < 60) return `${diff} сек. назад`;
                if (diff < 3600) return `${Math.floor(diff / 60)} хв. назад`;
                if (diff < 86400) return `${Math.floor(diff / 3600)} год. назад`;
                return `${Math.floor(diff / 86400)} д. назад`;
            },
            getQualityLabel(title = '') {
                if (/2160p|4K|UHD/i.test(title)) return '4K';
                if (/1080p|FHD/i.test(title)) return 'FHD';
                if (/720p|HD/i.test(title)) return 'HD';
                return 'SD';
            },
            extractHash: (magnet) => (magnet.match(/urn:btih:([a-fA-F0-9]{40})/i) || [])[1] || null,
        };

        // ───────────────────── core ▸ CONFIG ───────────────────────────────
        const Config = (() => {
            const DEF = {
                proxyUrl: 'https://my-torbox-proxy.slonce70.workers.dev/',
                apiKey: ''
            };
            const CFG = {
                get debug() { return Storage.get('torbox_debug', '0') === '1'; },
                set debug(v) { Storage.set('torbox_debug', v ? '1' : '0'); },
                get proxyUrl() { return Storage.get('torbox_proxy_url', DEF.proxyUrl); },
                set proxyUrl(v) { Storage.set('torbox_proxy_url', v.trim()); },
                get apiKey() {
                    const b64 = Storage.get('torbox_api_key_b64', '');
                    if (!b64) return DEF.apiKey;
                    try { return atob(b64); }
                    catch { Storage.set('torbox_api_key_b64', ''); return DEF.apiKey; }
                },
                set apiKey(v) {
                    if (!v) return Storage.set('torbox_api_key_b64', '');
                    Storage.set('torbox_api_key_b64', btoa(v.trim()));
                }
            };
            const LOG = (...a) => CFG.debug && console.log('[TorBox]', ...a);
            const PUBLIC_PARSERS = [
                { name: 'Viewbox', url: 'jacred.viewbox.dev', key: 'viewbox' },
                { name: 'Jacred', url: 'jacred.xyz', key: '' }
            ];
            const ICON = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 7L12 2L21 7V17L12 22L3 17V7Z" stroke="currentColor" stroke-width="2"/><path d="M12 22V12" stroke="currentColor" stroke-width="2"/><path d="M21 7L12 12L3 7" stroke="currentColor" stroke-width="2"/></svg>`;
            return { CFG, LOG, PUBLIC_PARSERS, ICON, DEF };
        })();
        const { CFG, LOG } = Config;

        // ───────────────────── core ▸ API ────────────────────────────────
        const Api = (() => {
            const API_URL = 'https://api.torbox.app/v1/api';

            const handleResponse = async (res) => {
                const { status } = res;
                if (status === 401) throw { type: 'auth', message: '401 – неверный API-ключ' };
                if (status === 403) throw { type: 'auth', message: '403 – доступ ��апрещен, проверьте права ключа' };
                if (status === 429) throw { type: 'network', message: '429 – слишком много запросов, попробуйте позже' };
                if (status >= 500) throw { type: 'network', message: `Ошибка сервера TorBox (${status})` };
                if (status >= 400) throw { type: 'network', message: `Ошибка клиента (${status})` };
                
                const text = await res.text();
                if (!text) throw { type: 'api', message: 'Пустой ответ от сервера' };
                if (text.startsWith('http')) return { success: true, url: text };

                try {
                    const json = JSON.parse(text);
                    if (json?.success === false) {
                        throw { type: 'api', message: json.detail || json.message || 'Неизвестная ошибка API' };
                    }
                    return json;
                } catch (e) {
                    if (e.type) throw e;
                    throw { type: 'api', message: 'Некорректный JSON в ответе' };
                }
            };

            const request = async (url, opt = {}, signal) => {
                if (!CFG.proxyUrl) throw { type: 'validation', message: 'CORS-proxy не задан в настройках' };

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort('timeout'), 20000);
                if (signal) signal.addEventListener('abort', () => controller.abort(signal.reason));

                const proxyUrl = `${CFG.proxyUrl}?url=${encodeURIComponent(url)}`;
                const headers = { ...opt.headers };
                if (opt.is_torbox_api !== false) headers['X-Api-Key'] = CFG.apiKey;
                
                try {
                    const res = await fetch(proxyUrl, { ...opt, headers, signal: controller.signal });
                    return await handleResponse(res);
                } catch (e) {
                    if (controller.signal.aborted) {
                        if (controller.signal.reason === 'timeout') {
                            throw { type: 'network', message: 'Таймаут запроса (20 сек)' };
                        }
                        // User aborted, do nothing
                        return Promise.reject({ type: 'user_aborted' });
                    }
                    throw { type: 'network', message: e.message || 'Неизвестная сетевая ошибка' };
                } finally {
                    clearTimeout(timeoutId);
                }
            };

            const searchPublicTrackers = async (movie, signal) => {
                for (const p of Config.PUBLIC_PARSERS) {
                    const qs = new URLSearchParams({
                        apikey: p.key,
                        Query: `${movie.title} ${movie.year || ''}`.trim(),
                        title: movie.title,
                        title_original: movie.original_title,
                        Category: '2000,5000'
                    });
                    if (movie.year) qs.append('year', movie.year);
                    const url = `https://${p.url}/api/v2.0/indexers/all/results?${qs}`;
                    LOG('Parser:', p.name, url);
                    try {
                        const json = await request(url, { method: 'GET', is_torbox_api: false }, signal);
                        if (json?.Results?.length) {
                            LOG('Parser success:', p.name, json.Results.length);
                            return json.Results;
                        }
                        LOG('Parser empty:', p.name);
                    } catch (err) {
                        if (err.type === 'user_aborted') throw err;
                        LOG('Parser fail:', p.name, err.message);
                    }
                }
                throw { type: 'api', message: 'Все публичные парсеры недоступны или без результатов' };
            };

            const checkCached = async (hashes, signal) => {
                if (!hashes.length) return {};
                const data = {};
                for (let i = 0; i < hashes.length; i += 100) {
                    const chunk = hashes.slice(i, i + 100);
                    const qs = new URLSearchParams({ format: 'object', list_files: 'false' });
                    chunk.forEach(h => qs.append('hash', h));
                    try {
                        const r = await request(`${API_URL}/torrents/checkcached?${qs}`, { method: 'GET' }, signal);
                        if (r?.data) Object.assign(data, r.data);
                    } catch (e) {
                        if (e.type === 'user_aborted') throw e;
                        LOG('checkCached chunk error', e.message);
                    }
                }
                return data;
            };

            const addMagnet = (magnet, signal) => request(`${API_URL}/torrents/createtorrent`, {
                method: 'POST',
                body: new URLSearchParams({ magnet, seed: '3' })
            }, signal);

            const getTorrentInfo = (id, signal) => request(`${API_URL}/torrents/mylist?id=${id}&bypass_cache=true`, { method: 'GET' }, signal);
            
            const requestDownloadLink = (tid, fid, signal) => request(`${API_URL}/torrents/requestdl?torrent_id=${tid}&file_id=${fid}&token=${CFG.apiKey}`, { method: 'GET' }, signal);

            return { searchPublicTrackers, checkCached, addMagnet, getTorrentInfo, requestDownloadLink };
        })();

        // ───────────────────── component ▸ TorBoxComponent ───────────────
        function TorBoxComponent(object) {
            let scroll, files, filter, last, activity;
            let abort = new AbortController();
            
            const state = {
                all_torrents: [],
                sort: Storage.get('torbox_sort_method', 'seeders'),
                filters: JSON.parse(Storage.get('torbox_filters_v2', '{}')),
                last_hash: null,
            };

            const sort_types = [
                { key: 'seeders', title: 'По сидам', field: 'seeders', reverse: true },
                { key: 'size', title: 'По размеру', field: 'size', reverse: true },
                { key: 'age', title: 'По дате', field: 'publish_date', reverse: true }
            ];

            const showError = (err) => {
                if (err.type === 'user_aborted') return;
                Lampa.Noty.show(err.message || 'Произошла ошибка', { type: 'error' });
                LOG('Error:', err.type, err.message, err);
            };

            const processRawTorrent = (raw, hash, is_cached) => ({
                title: Utils.escapeHtml(raw.Title),
                size: raw.Size,
                magnet: raw.MagnetUri,
                hash,
                seeders: raw.Seeders,
                leechers: raw.Peers || raw.Leechers,
                tracker: (raw.Tracker || '').split(/, ?/)[0],
                cached: is_cached,
                publish_date: raw.PublishDate ? new Date(raw.PublishDate).getTime() : 0,
                quality: Utils.getQualityLabel(raw.Title),
                info: `[${Utils.getQualityLabel(raw.Title)}] ${Utils.formatBytes(raw.Size)} | S: ${raw.Seeders || 0} / P: ${raw.Peers || 0}`,
                voices: raw.info?.voices?.join(', ') || '',
            });

            const search = async (force = false) => {
                abort.abort();
                abort = new AbortController();
                activity.loader(true);
                reset();

                const cacheKey = `torbox_search_${object.movie.id || object.movie.imdb_id}`;
                const cached = Lampa.Cache.get(cacheKey);
                if (!force && cached) {
                    LOG('Loaded torrents from cache.');
                    state.all_torrents = cached;
                    build();
                    activity.loader(false);
                    return;
                }

                empty('Получение списка торрентов...');
                try {
                    const raw_results = await Api.searchPublicTrackers(object.movie, abort.signal);
                    if (abort.signal.aborted) return;
                    if (!raw_results.length) return empty('Парсер не вернул результатов.');

                    const with_hash = raw_results.map(r => ({ raw: r, hash: Utils.extractHash(r.MagnetUri) })).filter(x => x.hash);
                    if (!with_hash.length) return empty('Не найдено валидных торрентов.');

                    empty(`Проверка кэша TorBox (${with_hash.length})...`);
                    const cached_map = await Api.checkCached(with_hash.map(x => x.hash), abort.signal);
                    if (abort.signal.aborted) return;

                    state.all_torrents = with_hash.map(({ raw, hash }) => processRawTorrent(raw, hash, !!cached_map[hash.toLowerCase()]));
                    Lampa.Cache.set(cacheKey, state.all_torrents, 60 * 10); // 10 min cache
                    build();
                } catch (err) {
                    showError(err);
                    empty(err.message || 'Ошибка при поиске');
                } finally {
                    activity.loader(false);
                }
            };

            const onTorrentClick = async (torrent) => {
                Lampa.Loading.start('Добавление торрента в TorBox...');
                try {
                    const res = await Api.addMagnet(torrent.magnet, abort.signal);
                    const tid = res.data?.torrent_id || res.data?.id;
                    if (!tid) throw { type: 'api', message: 'Не удалось получить ID торрента' };
                    
                    const torrent_data = await track(tid);
                    torrent_data.hash = torrent.hash;
                    selectFile(torrent_data);
                } catch (e) {
                    showError(e);
                } finally {
                    Lampa.Loading.stop();
                }
            };

            const track = (id) => {
                return new Promise((resolve, reject) => {
                    const trackerAbort = new AbortController();
                    let resolved = false;

                    const modal = Lampa.Modal.open({
                        title: 'Отслеживание торрента',
                        html: Lampa.Template.get('modal_loading'),
                        onBack: () => {
                            trackerAbort.abort();
                            modal.close();
                            reject({ type: 'user_aborted' });
                        }
                    });
                    const progress_elem = modal.find('.modal-loading__percent');
                    const status_elem = modal.find('.modal-loading__text');

                    const poll = async () => {
                        if (trackerAbort.signal.aborted) return;
                        try {
                            const json = await Api.getTorrentInfo(id, trackerAbort.signal);
                            const d = Array.isArray(json.data) ? json.data[0] : json.data;
                            if (!d) throw { type: 'api', message: 'Торрент не найден в списке' };

                            const perc = parseFloat(d.progress) > 1 ? parseFloat(d.progress) : parseFloat(d.progress) * 100;
                            const is_finished = d.download_state === 'completed' || d.download_state === 'uploading' || d.download_finished || perc >= 100;

                            progress_elem.text(`${perc.toFixed(2)}%`);
                            status_elem.text(d.download_state || 'Ожидание...');

                            if (is_finished && d.files?.length) {
                                resolved = true;
                                modal.close();
                                return resolve(d);
                            }
                            setTimeout(poll, 5000);
                        } catch (e) {
                            if (e.type !== 'user_aborted') {
                                modal.close();
                                reject(e);
                            }
                        }
                    };
                    poll();
                });
            };

            const selectFile = (torrent_data) => {
                const vids = torrent_data.files.filter(f => /\.mkv|mp4|avi$/i.test(f.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
                if (!vids.length) return showError({ message: 'Видеофайлы не найдены в торренте' });
                if (vids.length === 1) return play(torrent_data, vids[0]);

                const lastId = Storage.get(`torbox_last_played_${object.movie.imdb_id || object.movie.id}`);
                Lampa.Select.show({
                    title: 'Выберите файл для воспроизведения',
                    items: vids.map(f => ({
                        title: f.name,
                        subtitle: Utils.formatBytes(f.size),
                        selected: String(f.id) === lastId,
                        file: f
                    })),
                    onSelect: i => play(torrent_data, i.file),
                    onBack: () => Lampa.Controller.toggle('content')
                });
            };

            const play = async (torrent_data, file) => {
                Lampa.Loading.start('Получение ссылки на файл...');
                try {
                    const res = await Api.requestDownloadLink(torrent_data.id, file.id, abort.signal);
                    const link = res.url || res.data;
                    if (!link) throw { type: 'api', message: 'Не удалось получить ссылку на файл' };

                    const proxiedLink = `${CFG.proxyUrl}?url=${encodeURIComponent(link)}`;
                    LOG('Original link:', link);
                    LOG('Proxied link:', proxiedLink);

                    const mid = object.movie.imdb_id || object.movie.id;
                    state.last_hash = torrent_data.hash;
                    Storage.set(`torbox_last_torrent_${mid}`, torrent_data.hash);
                    Storage.set(`torbox_last_played_${mid}`, String(file.id));

                    Lampa.Player.play({
                        url: proxiedLink,
                        title: `${object.movie.title} | ${file.name}`,
                        poster: object.movie.img,
                        subtitles: []
                    });
                    Lampa.Player.callback = () => Lampa.Activity.backward();

                } catch (e) {
                    showError(e);
                } finally {
                    Lampa.Loading.stop();
                }
            };

            const create = function () {
                activity = this.activity;
                activity.loader(false);

                scroll = new Lampa.Scroll({ mask: true, over: true });
                files = new Lampa.Explorer(object);
                filter = new Lampa.Filter(object);

                files.appendFiles(scroll.render());
                files.appendHead(filter.render());
                scroll.minus(files.render().find('.explorer__files-head'));
                
                return files.render();
            };

            const empty = (msg) => {
                scroll.clear();
                const empty_msg = Lampa.Template.get('list_empty', { message: msg });
                scroll.append(empty_msg);
            };
            
            const reset = () => {
                last = false;
                scroll.clear();
                scroll.reset();
            };

            const build = () => {
                buildFilter();
                draw(applyFiltersSort());
            };

            const buildFilter = () => {
                const buildItems = (key, title, values) => {
                    const unique = ['all', ...[...new Set(values.flat().filter(Boolean))].sort()];
                    return {
                        title: title,
                        subtitle: state.filters[key] || 'Все',
                        items: unique.map(v => ({ title: v === 'all' ? 'Все' : v, value: v, selected: state.filters[key] === v })),
                        stype: key
                    };
                };
                
                const f_items = [
                    buildItems('quality', 'Качество', state.all_torrents.map(t => t.quality)),
                    buildItems('voices', 'Перевод', state.all_torrents.map(t => t.voices)),
                    buildItems('tracker', 'Трекер', state.all_torrents.map(t => t.tracker)),
                    { title: 'Сбросить фильтры', reset: true },
                    { title: 'Обновить список', refresh: true }
                ];

                filter.set('filter', f_items);
                filter.chosen('filter', f_items.filter(f => f.stype && state.filters[f.stype] && state.filters[f.stype] !== 'all').map(f => `${f.title}: ${state.filters[f.stype]}`));
                
                filter.set('sort', sort_types.map(s => ({ ...s, selected: s.key === state.sort })));
                filter.chosen('sort', [(sort_types.find(s => s.key === state.sort) || {}).title]);
            };

            const applyFiltersSort = () => {
                let list = state.all_torrents.filter(t => {
                    return !Object.keys(state.filters).some(key => 
                        state.filters[key] && state.filters[key] !== 'all' && t[key] !== state.filters[key]
                    );
                });
                const s = sort_types.find(s => s.key === state.sort);
                if (s) {
                    list.sort((a, b) => (a[s.field] > b[s.field] ? -1 : 1) * (s.reverse ? 1 : -1));
                }
                return list;
            };
            
            const draw = (items) => {
                reset();
                if (!items.length) return empty('Ничего не найдено по заданным фильтрам');

                const lastKey = `torbox_last_torrent_${object.movie.imdb_id || object.movie.id}`;
                const lastHash = Storage.get(lastKey);

                items.forEach(item_data => {
                    const item = Lampa.Template.get('cub_item', item_data);
                    item.addClass('torrent');
                    if (item_data.cached) item.addClass('torrent--cached');
                    if (item_data.hash === lastHash) item.addClass('focus');

                    const q = item.find('.cub-item__quality');
                    q.text(`${item_data.quality} / ${Utils.formatBytes(item_data.size)}`);
                    item.find('.cub-item__title').text(item_data.title);
                    item.find('.cub-item__info').html(`S: ${item_data.seeders} P: ${item_data.leechers} / ${item_data.tracker} / ${Utils.formatAge(item_data.publish_date)}`);

                    item.on('hover:focus', (e) => {
                        last = e.target;
                        state.last_hash = item_data.hash;
                        scroll.update($(e.target), true);
                    }).on('hover:enter', () => {
                        onTorrentClick(item_data);
                    }).on('hover:long', () => {
                        Lampa.Select.show({
                            title: 'Действия',
                            items: [{ title: 'Скопировать Magnet' }],
                            onSelect: () => {
                                Lampa.Utils.copyTextToClipboard(item_data.magnet, () => Lampa.Noty.show('Magnet-ссылка скопирована'));
                                Lampa.Controller.toggle('content');
                            }
                        });
                    });
                    scroll.append(item);
                });

                if (scroll.render().find('.focus').length) {
                    last = scroll.render().find('.focus')[0];
                }
            };

            this.start = function () {
                Lampa.Controller.add('content', {
                    toggle: () => {
                        Lampa.Controller.collectionSet(scroll.render(), files.render());
                        Lampa.Controller.collectionFocus(last || false, scroll.render());
                    },
                    up: () => Navigator.move('up'),
                    down: () => Navigator.move('down'),
                    left: () => {
                        if (Navigator.canmove('left')) Navigator.move('left');
                        else Lampa.Controller.toggle('menu');
                    },
                    right: () => {
                        if (Navigator.canmove('right')) Navigator.move('right');
                        else filter.show(Lampa.Lang.translate('title_filter'), 'filter');
                    },
                    back: this.back
                });
                Lampa.Controller.toggle('content');
                search();
            };
            
            this.back = function() {
                abort.abort();
                Lampa.Activity.backward();
            };

            this.pause = this.stop = () => {};
            
            this.destroy = function () {
                abort.abort();
                if(files) files.destroy();
                if(scroll) scroll.destroy();
                if(filter) filter.destroy();
            };

            filter.onSelect = (type, a, b) => {
                Lampa.Select.close();
                if (type === 'sort') {
                    state.sort = a.key;
                    Storage.set('torbox_sort_method', a.key);
                } else if (type === 'filter') {
                    if (a.refresh) return search(true);
                    if (a.reset) state.filters = {};
                    else state.filters[a.stype] = b.value;
                    Storage.set('torbox_filters_v2', JSON.stringify(state.filters));
                }
                state.last_hash = null;
                build();
                Lampa.Controller.toggle('content');
            };
            filter.onBack = () => Lampa.Controller.toggle('content');
            if (filter.addButtonBack) filter.addButtonBack();

            this.create = create;
        }

        // ───────────────────── plugin ▸ main integration ───────────────
        const manifest = {
            type: 'video',
            version: '36.0.1',
            name: 'TorBox Refactored',
            description: 'Улучшенный плагин для просмотра торрентов через TorBox',
            component: 'torbox_component',
        };

        const addSettings = () => {
            const component = { component: 'torbox_enh', name: 'TorBox', icon: Config.ICON };
            const params = [
                { k: 'torbox_proxy_url', n: 'URL CORS-прокси', d: `Default: ${Config.DEF.proxyUrl}`, t: 'input', v: CFG.proxyUrl },
                { k: 'torbox_api_key', n: 'API-Key', d: 'Ваш персональный ключ TorBox', t: 'input', v: CFG.apiKey, p: true },
                { k: 'torbox_debug', n: 'Debug-режим', d: 'Выводить лог в консоль', t: 'trigger', v: CFG.debug }
            ];
            
            Lampa.Settings.add(component);
            params.forEach(p => {
                Lampa.Settings.addParam({
                    component: component.component,
                    param: { name: p.k, type: p.t, 'default': p.v },
                    field: { name: p.n, description: p.d, password: !!p.p },
                    onChange: val => CFG[p.k.replace('torbox_', '')] = val,
                });
            });
        };

        const addCardButton = () => {
            Lampa.Listener.follow('full', e => {
                if (e.type !== 'complite' || !e.data.movie) return;
                const root = e.object.activity.render();
                if (!root?.length || root.find('.view--torbox').length) return;
                
                const btn = $(`<div class="full-start__button selector view--torbox" data-subtitle="TorBox">${Config.ICON}<span>TorBox</span></div>`);
                btn.on('hover:enter', () => {
                    Lampa.Activity.push({
                        component: manifest.component,
                        title: `TorBox - ${e.data.movie.title || e.data.movie.name}`,
                        movie: e.data.movie
                    });
                });
                root.find('.view--torrent, .full-start__torrent').first().after(btn);
            });
        };

        Lampa.Component.add(manifest.component, TorBoxComponent);
        addSettings();
        addCardButton();
        LOG(`TorBox v${manifest.version} ready`);
    }

    // Bootloader
    if (window.Lampa) {
        startPlugin();
    } else {
        document.addEventListener('lampa:ready', startPlugin, { once: true });
    }
})();
