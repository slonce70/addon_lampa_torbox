diff --git a/torbox-lampa-plugin.js b/torbox-lampa-plugin.js
index 583533483659636978ab8a0026299105d19b5cb7..99f8cc48d4c4ee4de21177479236854da50c4152 100644
--- a/torbox-lampa-plugin.js
+++ b/torbox-lampa-plugin.js
@@ -1,38 +1,38 @@
 /*
- * TorBox Enhanced – Universal Lampa Plugin v3.5.0 (2025-06-26)
+ * TorBox Enhanced – Universal Lampa Plugin v3.5.1 (2025-06-26)
  * ============================================================
- * • Пошук: btm.tools (cors → thingproxy) → api.sumanjay.cf → TorBox native.
+ * • Пошук: btm.tools (cors → thingproxy) → api.sumanjay.cf.
  * • Флаги «Тільки кеш» / Debug зберігаються як "1" / "0".
  * • Стабільний fallback — помилки 530 / 525 більше не ламають плагін.
  */
 
 (function () {
   'use strict';
 
   /* ───── Guard double-load ───── */
-  const PLUGIN_ID = 'torbox_enhanced_v3_5_0';
+  const PLUGIN_ID = 'torbox_enhanced_v3_5_1';
   if (window[PLUGIN_ID]) return;
   window[PLUGIN_ID] = true;
 
   /* ───── Helpers ───── */
   const ICON =
     `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 7L12 2L21 7V17L12 22L3 17V7Z" stroke="currentColor" stroke-width="2"/><path d="M12 22V12" stroke="currentColor" stroke-width="2"/><path d="M21 7L12 12L3 7" stroke="currentColor" stroke-width="2"/></svg>`;
 
   const Store = {
     get: (k, d) => {
       try { return localStorage.getItem(k) ?? d; } catch { return d; }
     },
     set: (k, v) => {
       try { localStorage.setItem(k, String(v)); } catch {}
     }
   };
 
   const CFG = {
     get debug()      { return Store.get('torbox_debug',       '0') === '1'; },
     set debug(v)     { Store.set('torbox_debug',        v ? '1' : '0');    },
     get cachedOnly() { return Store.get('torbox_cached_only', '0') === '1'; },
     set cachedOnly(v){ Store.set('torbox_cached_only',   v ? '1' : '0');    }
   };
 
   const LOG  = (...a) => CFG.debug && console.log('[TorBox]', ...a);
   const CORS =  u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`;
diff --git a/torbox-lampa-plugin.js b/torbox-lampa-plugin.js
index 583533483659636978ab8a0026299105d19b5cb7..99f8cc48d4c4ee4de21177479236854da50c4152 100644
--- a/torbox-lampa-plugin.js
+++ b/torbox-lampa-plugin.js
@@ -52,73 +52,51 @@
 
     async search(term) {
       const safe = encodeURIComponent(term).replace(/%3A/ig, ':');
       const qp   = 'metadata=true&search_user_engines=true';
       const timeout = 10000; // 10 секунд timeout
 
       const fetchWithTimeout = async (url, options = {}) => {
         const controller = new AbortController();
         const timeoutId = setTimeout(() => controller.abort(), timeout);
         try {
           const response = await fetch(url, { 
             ...options, 
             signal: controller.signal 
           });
           clearTimeout(timeoutId);
           return response;
         } catch (error) {
           clearTimeout(timeoutId);
           if (error.name === 'AbortError') {
             throw new Error('Запит перевищив час очікування');
           }
           throw error;
         }
       };
 
-      /* 1️⃣ Вбудований пошук TorBox (найкращий варіант) */
-      const key = Store.get('torbox_api_key', '');
-      if (key) {
-        try {
-          const r = await fetchWithTimeout(`${this.MAIN}/torrents/search/${safe}`, {
-             headers: { 
-               'Authorization': `Bearer ${key}`, 
-               'Accept': 'application/json',
-               'User-Agent': 'Lampa/TorBox-Plugin'
-             }
-           });
-          const result = await ok(r);
-          if (result.data && result.data.length > 0) {
-            return {
-              torrents: result.data.map(t => ({
-                ...t,
-                cached: t.cached || false,
-                torbox_id: t.id // Зберігаємо TorBox ID
-              }))
-            };
-          }
-        } catch (e) { LOG('TorBox native', e); }
-      }
+
 
       /* 2️⃣ btm.tools → allorigins */
       try { 
         const result = await ok(await fetchWithTimeout(CORS(`https://btm.tools/api/torrents/search/${safe}?${qp}`))); 
         if (result.torrents && result.torrents.length > 0) return result;
       }
       catch (e) { LOG('btm allorigins', e); }
 
       /* 3️⃣ btm.tools → hexlet */
       try { 
         const result = await ok(await fetchWithTimeout(CORS2(`https://btm.tools/api/torrents/search/${safe}?${qp}`))); 
         if (result.torrents && result.torrents.length > 0) return result;
       }
       catch (e) { LOG('btm hexlet', e); }
 
       /* 4️⃣ api.sumanjay.cf (публічний) */
       try {
         const res = await ok(await fetchWithTimeout(CORS(`https://api.sumanjay.cf/torrent/?query=${safe}`)));
         if (res && res.length > 0) {
           return {
             torrents: res.map(t => ({
               name   : t.name,
               magnet : t.magnet,
               seeders: +t.seeders || 0,
               size   : parseFloat(t.size) * 1024 * 1024 * 1024 || 0,
diff --git a/torbox-lampa-plugin.js b/torbox-lampa-plugin.js
index 583533483659636978ab8a0026299105d19b5cb7..99f8cc48d4c4ee4de21177479236854da50c4152 100644
--- a/torbox-lampa-plugin.js
+++ b/torbox-lampa-plugin.js
@@ -159,51 +137,54 @@
         if (!r.ok) {
           const errorMsg = j.error || j.message || j.detail || `HTTP ${r.status}`;
           LOG(`API Error ${r.status}:`, errorMsg);
           throw new Error(errorMsg);
         }
         return j;
       } catch (error) {
         if (error.name === 'AbortError') {
           throw new Error('Запит перевищив час очікування');
         }
         throw error;
       }
     },
 
     addMagnet(m)  { return this.main('/torrents/createtorrent', { magnet: m }, 'POST'); },
     files(id)     { 
       return this.main('/torrents/mylist', { id }).then(r => {
         const torrent = r.data?.[0];
         if (!torrent) throw new Error('Торрент не знайдено');
         if (!torrent.files || !Array.isArray(torrent.files)) {
           throw new Error('Файли торрента недоступні');
         }
         return torrent.files;
       }); 
     },
-    dl(tid, fid)  { return this.main('/torrents/requestdl', { torrent_id: tid, file_id: fid }).then(r => r.data); }
+    dl(tid, fid)  {
+      const token = Store.get('torbox_api_key', '');
+      return this.main('/torrents/requestdl', { token, torrent_id: tid, file_id: fid }).then(r => r.data);
+    }
   };
 
   /* ───── UI flows ───── */
   async function searchAndShow(movie) {
     Lampa.Loading.start('TorBox: пошук…');
     try {
       // Формуємо пошуковий запит
       let term = movie?.title || '';
       if (movie?.imdb_id) {
         term = `imdb:${movie.imdb_id}`;
       } else if (movie?.original_title && movie.original_title !== movie.title) {
         term = movie.original_title;
       }
       
       if (!term.trim()) {
         Lampa.Noty.show('Не вдалося визначити назву для пошуку', { type: 'error' });
         return;
       }
 
       LOG('Searching for:', term);
       const res = await API.search(term);
       const list = res.data?.torrents || res.torrents || res || [];
       
       if (!Array.isArray(list) || !list.length) { 
         Lampa.Noty.show('TorBox: нічого не знайдено'); 
diff --git a/torbox-lampa-plugin.js b/torbox-lampa-plugin.js
index 583533483659636978ab8a0026299105d19b5cb7..99f8cc48d4c4ee4de21177479236854da50c4152 100644
--- a/torbox-lampa-plugin.js
+++ b/torbox-lampa-plugin.js
@@ -376,36 +357,36 @@
         else                                     CFG.debug      = v;
       }
     }));
   }
 
   /* ───── hook & boot ───── */
   function hook() {
     Lampa.Listener.follow('full', e => {
       if (e.type !== 'complite') return;
       const root = e.object.activity.render();
       if (root.find('.view--torbox').length) return;
 
       const btn = $(
         `<div class="full-start__button selector view--torbox" data-subtitle="TorBox">` +
         `${ICON}<span>TorBox</span></div>`
       );
       btn.on('hover:enter', () => searchAndShow(e.data.movie));
       root.find('.view--torrent').after(btn);
     });
   }
 
   let waited = 0;
   const STEP = 500, MAX = 60000;
   (function bootLoop () {
     if (window.Lampa && window.Lampa.Settings) {
-      try { addSettings(); hook(); LOG('TorBox v3.5.0 ready'); }
+      try { addSettings(); hook(); LOG('TorBox v3.5.1 ready'); }
       catch (e) { console.error('[TorBox]', e); }
       return;
     }
     if ((waited += STEP) >= MAX) {
       console.warn('[TorBox] Lampa не знайдено');
       return;
     }
     setTimeout(bootLoop, STEP);
   })();
 })();
