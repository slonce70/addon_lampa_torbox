# Torbox Lampa Plugin

This plugin integrates the [TorBox.app](https://torbox.app/) cloud torrent client with the [Lampa](https://lampa.mx/) media center. It allows users to search for torrents on public trackers, add them to their TorBox account, wait for the download to complete, and play video files directly within the Lampa interface.

## Features

- **Integrated Search**: A search bar within Lampa to find torrents, with support for custom queries and refined search combinations.
- **Cached Torrent Filter**: A toggle button (⚡) to quickly filter and display only torrents that are already cached on TorBox servers for instant streaming.
- **Playback History**: Seamless integration with Lampa's native history, so movies you watch are automatically added to your "Continue Watching" list.
- **Last Played Indicator**: A play icon (▶) appears next to the last torrent you played, allowing you to quickly resume where you left off.
- **Instant Episode Marking**: Episodes are immediately marked as watched when you click on them.
- **Playback Progress**: See your watch progress (timecodes) for torrents, synced with Lampa's history.
- **Improved UI/UX**: Enhanced button layout and remote control navigation for a smoother experience.

## Architecture

The plugin is built with pure JavaScript (ES6+) and follows a modular architecture for clarity and maintainability. Key components include:

- **Utils**: Helper functions for data formatting, string manipulation, and natural sorting.
- **Storage**: A resilient storage solution that uses `localStorage` but gracefully falls back to an in-memory store in environments where `localStorage` is unavailable (like incognito mode).
- **Cache**: An in-memory LRU (Least Recently Used) cache for search results to speed up navigation and reduce API calls.
- **Config**: Centralized configuration management for settings and API keys.
- **Api**: Handles all communication with the TorBox API and public trackers, including CORS proxy support and error handling.
- **UI Components**: The plugin features custom UI components for displaying search results, tracking download progress, and selecting episodes in a series, all designed to integrate smoothly with the Lampa interface.

## Getting Started

1.  **Installation**: (Instructions to be added on how to install the plugin in Lampa).
2.  **Configuration**: Go to the Lampa settings, find the Torbox plugin section, and enter your TorBox API key.

## Development

The project is self-contained and has no external dependencies besides the Lampa API. 