# Torbox Lampa Plugin

This plugin integrates the [TorBox.app](httpss://torbox.app) cloud torrent client with the [Lampa](httpss://lampa.mx) media center. It allows users to search for torrents on public trackers, add them to their TorBox account, and play video files directly within the Lampa interface.

## Features

- **Integrated Search**: A search bar within Lampa to find torrents, with support for custom queries and refined search combinations.
- **Cached Torrent Filter**: A toggle button (⚡) to quickly filter and display only torrents that are already cached on TorBox servers for instant streaming.
- **Playback History**: Seamless integration with Lampa's native history, so movies you watch are automatically added to your "Continue Watching" list.
- **Last Played Indicator**: A play icon (▶) appears next to the last torrent you played, allowing you to quickly resume where you left off.
- **Instant Episode Marking**: Episodes are immediately marked as watched when you click on them.
- **Playback Progress**: See your watch progress (timecodes) for torrents, synced with Lampa's history.
- **Improved UI/UX**: Enhanced button layout and remote control navigation for a smoother experience.

## Installation

1.  In Lampa, go to `Settings` -> `Plugins`.
2.  Click on `Add Plugin`.
3.  Enter the following URL and press `Enter`:
    ```
    https://slonce70.github.io/addon_lampa_torbox/torbox-lampa-plugin.js
    ```
4.  The plugin will be installed and a "TorBox" button will appear on movie pages.

## Configuration

After installation, go to `Settings` -> `TorBox` to enter your TorBox API key and configure other settings.

## Development

The project is self-contained and has no external dependencies besides the Lampa API. 