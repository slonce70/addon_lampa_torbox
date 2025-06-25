/*
 * TorBox Enhanced – Lampa Plugin v10.1.0 (2025‑06‑25)
 * ==================================================
 * CHANGELOG 10.1.0
 * – Fix: graceful handling of network / CORS errors ("Failed to fetch")
 * – Fix: fallback to CORS proxy (corsproxy.io) when primary API request fails
 * – Refactor: moved loader + Noty logic into reusable util
 * – Add: compact torrent list renderer inside dedicated Activity page
 * ------------------------------------------------------------------
 * Docs: https://support.torbox.app & Lampa plugin API (https://github.com/yumata/lampa-source)
 * ------------------------------------------------------------------
 */

(function () {
  'use strict';

  /**
   * ------------------------------------------------------------------
   * 0. CONSTS & UTILS
   * ------------------------------------------------------------------
   */
  const API_BASE = 'https://search-api.torbox.app';
  const CORS_PROXY = 'https://corsproxy.io/?url='; // public Cloudflare worker

  /**
   * Small helper: show loader while async task runs
   */
  function withLoader(promise) {
    const loader = Lampa.Loading.start();
    return promise
      .finally(() => loader.stop());
  }

  /**
   * ------------------------------------------------------------------
   * 1. NETWORK LAYER
   * ------------------------------------------------------------------
   */
  async function fetchJson(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return response.json();
  }

  /**
   * TorBox REST wrapper with automatic CORS‑proxy fallback
   */
  const TorBox = {
    /**
     * Search torrents by free‑form query
     * @param {string} query – movie title
     * @returns {Promise<Array>} list of torrent objects
     */
    async search(query) {
      const endpoint = `${API_BASE}/torrents/search/${encodeURIComponent(query)}`;
      try {
        return await fetchJson(endpoint);
      } catch (e1) {
        console.log('[TorBox] primary API failed', e1);
        try {
          return await fetchJson(CORS_PROXY + encodeURIComponent(endpoint));
        } catch (e2) {
          console.error('[TorBox] proxy API failed', e2);
          throw e2;
        }
      }
    }
  };

  /**
   * ------------------------------------------------------------------
   * 2. COMPONENT: TORRENT LIST PAGE
   * ------------------------------------------------------------------
   */
  function ComponentTorBoxList(params = {}) {
    const self = this;

    let scroll;

    self.create = function () {
      const layout = $(`
        <div class="torbox-list">
          <div class="torbox-list__head head">
            <div class="head__title">TorBox — ${params.movie.title}</div>
          </div>
        </div>`);

      scroll = new Lampa.Scroll({ mask: true, over: true });
      layout.append(scroll.render());

      (params.results || []).forEach(item => {
        const card = Lampa.Template.get('torrent', {
          title: item.title || item.filename || 'Torrent',
          info: `${item.size || ''} | ⬆ ${item.seeders || 0}`,
          quality: item.quality || ''
        });

        card.on('hover:enter', () => {
          Lampa.Player.open({ url: item.magnet || item.link, title: item.title });
        });

        scroll.append(card);
      });

      scroll.update();
      return layout;
    };

    self.destroy = function () {
      scroll && scroll.destroy();
    };
  }

  /**
   * ------------------------------------------------------------------
   * 3. BOOTSTRAP: Add button & wire events
   * ------------------------------------------------------------------
   */
  function bootstrap() {
    Lampa.Listener.follow('full', e => {
      if (e.type !== 'build') return;

      const movie = e.data;
      const btn = Lampa.Template.get('button', { title: 'TorBox' }).addClass('view--torbox');

      btn.on('hover:enter', () => {
        withLoader(
          TorBox.search(movie.title)
            .then(data => {
              const list = Array.isArray(data) ? data : (data.results || data.torrents || []);
              if (!list.length) {
                Lampa.Noty.show('TorBox: нічого не знайдено');
                return;
              }
              Lampa.Activity.push({
                url: '',
                title: 'TorBox',
                component: 'torbox_list_component',
                movie,
                results: list
              });
            })
            .catch(err => {
              console.error('[TorBox] search error', err);
              Lampa.Noty.show('TorBox: помилка пошуку');
            })
        );
      });

      // insert button after existing sources (torrent / parser / online)
      e.block.find('.view--torrent, .view--parser, .view--online').after(btn);
    });

    Lampa.Component.add('torbox_list_component', ComponentTorBoxList);
  }

  bootstrap();
})();
