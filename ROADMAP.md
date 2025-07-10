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
- **2025-07-09**: Investigated TorBox.app API capabilities. Confirmed that WebSockets/SSE are not supported, making the current polling mechanism in the `track` function the optimal solution.
- **2024-10-01**: Fixed bug where header controls (search, sort, filter, cached toggle) were inactive via remote when no torrents in list, by making empty state focusable.

## Next Steps & Potential Improvements

*   **[ ] Improve Error Handling:** Enhance the `ErrorHandler` to provide more specific and user-friendly messages for different API and network errors.
*   **[ ] Refactor Configuration:** Move hardcoded values (like cache limits and polling intervals) from the code into the central `Config` module to simplify future adjustments.
*   **[ ] Add Internationalization (i18n):** Replace all hardcoded Russian strings with a localization system to allow for easy translation into other languages.
*   **[ ] Flexible File Type Detection:** Modify the file detection logic to be less reliant on hardcoded extensions (`.mkv`, `.mp4`, `.avi`) and potentially inspect MIME types if available.
*   **[ ] API Key Security:** While perfect client-side security is not feasible, investigate if there are slightly more secure ways to handle the API key than Base64, or add a clear warning to the user in the settings about the risks.
*   **[ ] Explore Relay API:** Consider experimenting with the unofficial Relay API (`relay.torbox.app`) to potentially get faster status updates by calling `requestupdate` before polling. This is a low-priority research task.