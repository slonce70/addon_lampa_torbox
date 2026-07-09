# TorBox Lampa Plugin

**English** | [Українська](README.uk.md)

A plugin for [Lampa](https://lampa.mx) that adds torrent streaming via [TorBox.app](https://torbox.app) right from the movie/series card.

Current version: **51.2.11**

## Features

- 🔍 Torrent search via public parsers (MaxVol, Jacred) with failover and automatic cooldown for unavailable ones
- ⚡ TorBox cache check: instantly see which torrents are cached (⚡) and which are not (☁️), plus a "cached only" toggle
- 🎛 Filters (quality, video type, voiceover, audio language, codecs, tracker) and sorting (seeders, size, date)
- 📺 Series: episode list, watched-episode tracking, "Continue watching" panel
- 🎬 Movies: file list with automatic best-file pick (largest, excluding sample/trailer)
- ⬇ Direct download links via TorBox with system handoff and clipboard fallback
- 🕹 Full TV remote navigation
- 🌍 Interface languages: English, Ukrainian, Russian

## Installation

1. Open Lampa: `Settings` → `Plugins` → `Add plugin`.
2. Paste the URL:
   ```
   https://slonce70.github.io/addon_lampa_torbox/torbox-lampa-plugin.js
   ```
3. Press `Enter` and restart Lampa.

## Configuration

`Settings` → `TorBox`:

- **CORS proxy URL** — the proxy all requests go through. Required. Note: the proxy can see your API key, so only use a proxy you trust (HTTPS strongly recommended).
- **API key** — your TorBox API key. A default key is baked in so the plugin works out of the box; a key you enter always takes precedence.

Advanced parameters (quality/audio/codec priority, excluded trackers, status polling, video extensions, custom parsers, debug and diagnostics) are hidden from the UI and run on sensible defaults. If needed, they can be overridden via the corresponding `torbox_*` keys in `localStorage`.

### CORS proxy (Cloudflare Worker)

The source of the reference CORS proxy lives in [proxy/cloudflare-worker.js](proxy/cloudflare-worker.js). It only proxies requests to the TorBox API and the public parsers, attaches the API key server-side for `api.torbox.app` only, and returns CORS headers on every response (including errors). To deploy your own copy:

```bash
cd proxy
npx wrangler deploy
```

If you use custom parsers, add their domains to `ALLOWED_HOSTS` in the worker.

## TV remote control

- Navigation follows standard Lampa rules: `.selector` elements and `hover:focus` / `hover:enter` events.
- `Right` from the torrent list opens the filters immediately.
- The `⚡/☁️` toggle is built into the filter bar and does not break focus.
- In the file list: `OK` on a file starts playback, `Right` moves focus to the `⬇` download button.

## Development

### Quick checks (local)

```bash
npm ci
npm run validate
npm run test:unit
npx playwright install chromium
npm run test:e2e
```

CI (GitHub Actions) runs the same steps on every push and pull request.

### Manual TV checklist

- Open a movie/series card → open TorBox.
- While loading: `Right/Left/Up/Down/Back` do not break the screen.
- Torrent list: `Up/Down` scrolls, focus never gets lost.
- `Right` from the list → filters open immediately.
- With "Continue watching" present: `Up` from the first list item → "Continue watching", then `Up` → search/filters.
- `⚡/☁️` toggle: `OK` switches the mode, the list refreshes, focus does not jump.
- `OK` on a torrent opens the video file list (movies, single-file releases and series).
- In the file list: `OK` on a file starts playback; `Right` from a file → the `⬇` button; `OK` on `⬇` requests a direct TorBox link, hands it to the system for download/external open and copies the link as a fallback; `Left` returns to the file; `Back` returns to the torrent list.

## Troubleshooting

- Enable debug mode (`localStorage.torbox_debug = '1'`) and watch the `Console` for messages prefixed with `[TorBox]`.
- If filters "don't open" on TV, the cause is almost always focus (wrong button focused) or the element missing from the navigation collection.

## Disclaimer

The plugin does not host or distribute any content. It only integrates the TorBox API and public torrent indexers into the Lampa interface. You are responsible for how you use it and for complying with the laws of your country.
