# Project Roadmap

This document outlines the development plan, completed tasks, and future goals for the Torbox Lampa Plugin project.

## Completed Tasks

- **2024-07-26**: Performed a deep analysis of the `torbox_lampa_plugin_integrated.js` codebase.
- **2024-07-26**: Implemented core features and UX improvements:
    - **Search**: Added a search bar with support for custom queries and search combinations ("refine search").
    - **Cached Filter**: Implemented a toggle button to filter and show only cached torrents (⚡).
    - **History**: Integrated with Lampa's native history, so played movies appear there.
    - **Last Played Indicator**: Added a play icon (▶) next to the last played torrent for quick resume.
    - **Episode Status**: Fixed episode marking, so they immediately appear as watched upon click.
    - **UI/UX**: Improved button layout and remote control navigation focus.
- **2024-07-26**: Fixed the marking system for last played torrents and watched episodes, ensuring immediate and reliable UI updates.
- **2024-07-26**: Implemented display of playback progress (timecodes) for torrents, integrating with Lampa's native watch history.
- **2024-07-26**: Fixed duplicate "Continue Watching" panel issue by centralizing panel management in `updateContinueWatchingPanel()` function, removing duplicate creation logic from `draw()` and `drawEpisodes()` functions.

## Next Steps

*   [ ] Refactor API key storage to avoid using `btoa`.
*   [ ] Improve error handling for network and API requests.
*   [ ] Explore alternatives to polling in the `track` function (e.g., WebSockets if the API supports it).
*   [ ] Make file type detection more flexible (move from hardcoded extensions).
*   [ ] Add i18n support for hardcoded Russian strings. 