/**
 * TorBox ↔ Lampa integration plugin
 * Version 4.2.0 – Dynamic‑registration patch
 *
 * Changelog:
 *  - NEW: waits for Lampa parser API to appear (up to 30 s) and registers when ready.
 *  - Still supports both modern (Parsers.add) and legacy (Sources.add) APIs.
 *  - Keeps all fixes from 4.1.0 (file‑size sort, error handling, settings panel, etc.)
 *
 * Author: GOD MODE
 */
(function () {
    'use strict';

    /* ---------- GLOBAL GUARD ---------- */
    const NS = 'torbox_lampa_plugin_v4_2';
    if (window[NS]) return;
    window[NS] = true;

    /* ---------- CONSTANTS ---------- */
    const S = {
        API_KEY    : 'torbox_api_key',
        PROXY_URL  : 'torbox_proxy_url',
        CACHED_ONLY: 'torbox_show_cached_only'
    };

    /* ---------- CORE PARSER ---------- */
    const TorBoxParser = {
        /** Universal TorBox API wrapper */
        apiCall(endpoint, params = {}, method = 'GET', ok, fail) {
            const key  = Lampa.Storage.get(S.API_KEY, '');
            let   proxy = Lampa.Storage.get(S.PROXY_URL, '');
            if (!key || !proxy) {
                fail('Set API‑key & Proxy URL in TorBox settings');
                return;
            }
            if (proxy.endsWith('/')) proxy = proxy.slice(0, -1);
            const host = endpoint.startsWith('/torrents/search')
                       ? 'search-api.torbox.app'
                       : 'api.torbox.app/v1/api';
            let url = `${proxy}/${host}${endpoint}`;
            const opts = { headers: { 'x-api-key': key }, timeout: 20000 };
            if (method === 'POST') {
                opts.method = 'POST';
                opts.body   = params;
            } else if (Object.keys(params).length) {
                url += '?' + new URLSearchParams(params).toString();
            }
            Lampa.Request.get(
                url,
                (d) => {
                    try {
                        const j = JSON.parse(d);
                        if (j.success === false) fail(j.error || j.detail || 'API error');
                        else ok(j);
                    } catch (_) { fail('Bad JSON from API'); }
                },
                (e) => fail(typeof e === 'object' ? 'Network / proxy error' : String(e)),
                false,
                opts
            );
        },

        /** Called by Lampa to search */
        start(movie, cb) {
            const q   = movie.imdb_id ? `imdb:${movie.imdb_id}` : `${movie.title} ${movie.year || ''}`.trim();
            const ep  = `/torrents/search/${encodeURIComponent(q)}`;
            this.apiCall(ep, { metadata: 1, check_cache: 1, check_owned: 1 }, 'GET',
                (json) => {
                    const list = json.data?.torrents ? this.toItems(json.data.torrents) : [];
                    cb(list);
                },
                (err) => { Lampa.Noty.show(err, { type: 'error' }); cb([]); }
            );
        },

        toItems(arr) {
            const cachedOnly = Lampa.Storage.get(S.CACHED_ONLY, false);
            return arr.filter(t => cachedOnly ? t.cached : true).map(t => ({
                title  : t.raw_title || t.name,
                info   : `${t.cached || t.owned ? '⚡ ' : ''}${(t.size/2**30).toFixed(2)} GB • S:${t.seeders ?? '?'}`,
                quality: t.resolution || t.quality || '—',
                _torbox: { id: t.id, magnet: t.magnet, cached: !!t.cached, owned: !!t.owned }
            }));
        },

        select(torrent, cb) {
            Lampa.Controller.loading(true);
            (torrent._torbox.cached || torrent._torbox.owned)
                ? this.playCached(torrent, cb)
                : this.addForDownload(torrent);
        },

        /* ---- Cached / owned flow ---- */
        playCached(torrent, cb) {
            const ep = `/torrents/mylist?id=${torrent._torbox.id}`;
            this.apiCall(ep, {}, 'GET', (json) => {
                Lampa.Controller.loading(false);
                const videos = (json.data?.files || [])
                    .filter(f => /\.(mkv|mp4|avi|mov|wmv|flv)$/i.test(f.name))
                    .map(f => ({ title: f.name, info: `${(f.size/2**30).toFixed(2)} GB`, size: f.size, _fid: f.id }))
                    .sort((a,b)=>b.size-a.size);
                if (!videos.length) return Lampa.Noty.show('No video files found', {type:'error'});
                const play = (fid) => {
                    Lampa.Controller.loading(true);
                    this.apiCall(`/torrents/requestdl?torrent_id=${torrent._torbox.id}&file_id=${fid}`, {}, 'GET', (j)=>{
                        Lampa.Controller.loading(false);
                        j.data ? cb({url:j.data}) : Lampa.Noty.show('Stream link error', {type:'error'});
                    }, (e)=>{ Lampa.Controller.loading(false); Lampa.Noty.show(e,{type:'error'}); });
                };
                if (videos.length===1) play(videos[0]._fid);
                else Lampa.Select.show({ title:'Select a file', items:videos, onSelect:s=>play(s._fid), onBack:()=>Lampa.Controller.toggle('content') });
            }, (e)=>{ Lampa.Controller.loading(false); Lampa.Noty.show(e,{type:'error'}); });
        },

        /* ---- Add torrent ---- */
        addForDownload(torrent) {
            this.apiCall('/torrents/createtorrent', { magnet: torrent._torbox.magnet }, 'POST',
                ()=>{ Lampa.Controller.loading(false); Lampa.Noty.show('Torrent added!', {type:'success'}); Lampa.Controller.toggle('content'); },
                (e)=>{ Lampa.Controller.loading(false); Lampa.Noty.show(e,{type:'error'}); }
            );
        },

        back() { Lampa.Controller.toggle('content'); }
    };

    /* ----------   SETTINGS PANEL   ---------- */
    function injectSettings(){
        if (injectSettings.done) return; injectSettings.done = true;
        Lampa.Settings.add({ name:'torbox_settings', title:'TorBox', icon:'fa-cloud-bolt' });
        Lampa.Listener.follow('settings', (e)=>{
            if (e.type!=='open'|| e.name!=='torbox_settings') return;
            e.body.empty();
            const addInput=(label,key,ph='')=>{
                const cur=Lampa.Storage.get(key,'');
                const $i=$(`<div class="settings-param selector"><div class="settings-param__name">${label}</div><div class="settings-param__value">${cur}</div><div class="settings-param__descr">${ph}</div></div>`);
                $i.on('hover:enter',()=>{
                    Lampa.Settings.pget($i,key,(val)=>{Lampa.Storage.set(key,val.trim());$i.find('.settings-param__value').text(val.trim()||'—');},cur);
                });
                e.body.append($i);
            };
            const addCheck=(label,key)=>{
                const v=Lampa.Storage.get(key,false);
                const $c=$(`<div class="settings-param-checkbox selector"><div class="settings-param-checkbox__body"><div class="settings-param-checkbox__name">${label}</div><div class="settings-param-checkbox__value"></div></div></div>`);
                const ch=Lampa.Utils.check($c.find('.settings-param-checkbox__value'),v);
                ch.on('change',(_,st)=>Lampa.Storage.set(key,st));
                e.body.append($c);
            };
            e.body.append('<div class="settings-param__title">TorBox</div>');
            addInput('API Key',S.API_KEY,'Your key from torbox.app');
            addInput('Proxy URL',S.PROXY_URL,'e.g., https://proxy.cors.sh');
            addCheck('Show cached only',S.CACHED_ONLY);
            Lampa.Scroll.update(e.body);
        });
    }

    /* ---------- REGISTRATION (dynamic retry) ---------- */
    function tryRegister(){
        const canModern = typeof Lampa?.Parsers?.add === 'function';
        const canLegacy = typeof Lampa?.Sources?.add === 'function';
        if (canModern){
            Lampa.Parsers.add('torrents',{ handler:TorBoxParser, name:'TorBox', icon:'fa-cloud-bolt' });
            return true;
        }
        if (canLegacy){
            Lampa.Sources.add({ name:'TorBox', type:'torrents', active:true, object:TorBoxParser });
            return true;
        }
        return false;
    }

    function init(){
        injectSettings();
        if (tryRegister()){
            console.log('%cTorBox Plugin v4.2 – Registered', 'color:#0f0');
            return;
        }
        /* if not registered yet, poll for API up to 30s */
        let tries = 0;
        const id = setInterval(()=>{
            if (tryRegister()){ clearInterval(id); console.log('%cTorBox Plugin v4.2 – Registered (delayed)', 'color:#0f0'); }
            else if (++tries>30){ clearInterval(id); console.warn('[TorBox] parser API not found after 30s'); Lampa.Noty.show('TorBox: this Lampa build cannot load torrent parsers.', {type:'error'}); }
        },1000);
    }

    /* ---------- ENTRY ---------- */
    if (window.appready) init();
    else Lampa.Listener.follow('app', (e)=> e.type==='ready' && init());
})();
