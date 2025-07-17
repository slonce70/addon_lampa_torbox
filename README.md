# TorBox Lampa Plugin

A robust JavaScript plugin that seamlessly integrates [TorBox.app](https://torbox.app) cloud torrent client with the [Lampa](https://lampa.mx) media center. Stream torrents instantly through TorBox's cached content or download-on-demand system, all within Lampa's familiar interface.

> **Latest Update (v50.2.3)**: Fixed a bug that prevented remote control focus on the "Continue Watching" panel.

## ✨ Key Features

### 🎬 Smart Content Discovery
- **Intelligent Search**: Parallel multi-parser torrent search across public trackers.
- **Custom Query Support**: Manual search refinement with auto-generated title combinations.
- **Cached Content Priority**: Instant streaming detection with ⚡ indicators for cached torrents.
- **Quality Recognition**: Automatic quality detection (4K/FHD/HD/SD) from torrent titles.

### 🎯 Advanced Filtering & Organization
- **Multi-Dimensional Filtering**: Filter by quality, video type, audio language, codecs, and trackers.
- **Smart Cache Toggle**: One-click filtering between cached (⚡) and all (☁️) torrents.
- **Flexible Sorting**: Sort by seeders, file size, or publication date with persistent preferences.
- **Real-Time Updates**: Dynamic filter options based on available content.

### 🎮 Enhanced User Experience
- **Continue Watching**: Dedicated panel for quick access to your last played content.
- **Visual Progress Tracking**: Progress bars and completion indicators for watched content.
- **Episode Management**: Smart episode detection with watch status tracking.
- **Focus Memory**: Intelligent navigation that remembers your position across operations.
- **Remote Control Optimized**: Full TV remote navigation support with proper focus handling.

### 🛡️ Enterprise-Grade Stability
- **Bulletproof Error Handling**: Comprehensive error protection with graceful degradation.
- **Safe State Management**: Protected data initialization with corruption recovery.
- **Individual Item Isolation**: Failed items don't break the entire interface.
- **Memory Efficient**: LRU caching with automatic cleanup (10-minute TTL, 128 item limit).
- **Network Resilience**: Timeout handling, retry logic, and abort controller support.

### 🔧 Technical Excellence
- **Zero Dependencies**: Pure JavaScript implementation with no external libraries.
- **Modern Syntax**: Utilizes modern JavaScript (ES6+) features, including classes, async/await, and parallel requests.
- **Modular Architecture**: Clean separation of concerns (Utils, Storage, Cache, API, UI).
- **Performance Optimized**: Efficient algorithms with parallel processing and optimized DOM rendering.
- **Readability**: Clean, well-documented code that is easy to maintain and extend.
- **Debug Support**: Comprehensive logging system for troubleshooting.

## 🚀 Quick Start

### Installation
1. Open Lampa and navigate to `Settings` → `Plugins`
2. Click `Add Plugin`
3. Enter the plugin URL:
   ```
   https://slonce70.github.io/addon_lampa_torbox/torbox-lampa-plugin.js
   ```
4. Press `Enter` to install
5. A "TorBox" button will appear on movie/TV show pages

### Initial Setup
1. Go to `Settings` → `TorBox`
2. Configure the required settings:
   - **API Key**: Your TorBox.app API key (get it from [TorBox Dashboard](https://torbox.app/settings))
   - **CORS Proxy URL**: A CORS proxy service URL (e.g., `https://cors-anywhere.herokuapp.com/`)
   - **Debug Mode**: Enable for troubleshooting (optional)

### First Use
1. Navigate to any movie or TV show in Lampa
2. Click the **TorBox** button
3. The plugin will automatically search for torrents
4. Look for ⚡ icons indicating cached (instant) content
5. Click any torrent to start streaming

## 🎛️ Usage Guide

### Interface Overview
- **⚡/☁️ Toggle**: Switch between cached-only and all torrents
- **Filter Menu**: Access comprehensive filtering options
- **Sort Options**: Change sorting method (seeders, size, date)
- **Search Refinement**: Create custom search queries
- **Continue Watching**: Quick access to your last played content

### Navigation Controls
- **Arrow Keys**: Navigate through torrents
- **Enter**: Select and play torrent
- **Back**: Return to previous screen
- **Long Press**: Access context menu (copy magnet link)
- **Right Arrow**: Open filter menu
- **Left Arrow**: Return to main menu

### Filtering Options
- **Quality**: 4K, FHD, HD, SD
- **Video Type**: HDR, Dolby Vision, standard
- **Translation**: Available audio tracks/dubbing
- **Audio Language**: Language options
- **Video Codec**: H.264, H.265, etc.
- **Audio Codec**: AAC, DTS, Dolby Digital, etc.
- **Tracker**: Source tracker information

### Episode Management
For multi-file torrents (TV shows):
- Episodes are automatically detected and sorted
- Watch status is tracked with visual indicators
- Last played episode is highlighted
- Progress is saved across sessions

## ⚙️ Configuration

### Required Settings
| Setting | Description | Example |
|---------|-------------|---------|
| **API Key** | Your TorBox.app API key | `tb_xxxxxxxxxxxxxxxx` |
| **CORS Proxy** | Proxy service for API calls | `https://cors-anywhere.herokuapp.com/` |

### Optional Settings
| Setting | Description | Default |
|---------|-------------|---------|
| **Debug Mode** | Enable console logging | `false` |

### CORS Proxy Setup
Since browsers block cross-origin requests, you need a CORS proxy. Options include:
- **Public Services**: `https://cors-anywhere.herokuapp.com/` (may have rate limits)
- **Self-Hosted**: Deploy your own CORS proxy for better reliability
- **Browser Extensions**: CORS-disabling extensions (not recommended for security)

## 🔧 Troubleshooting

### Common Issues

#### "CORS-proxy не задан в настройках"
- **Cause**: Missing or invalid CORS proxy URL
- **Solution**: Set a valid CORS proxy in TorBox settings

#### "401 – неверный API-ключ"
- **Cause**: Invalid or expired TorBox API key
- **Solution**: Generate a new API key from TorBox dashboard

#### "Все публичные парсеры недоступны"
- **Cause**: Public trackers are down or blocked
- **Solution**: Try again later or check your internet connection

#### No torrents found
- **Cause**: Search terms too specific or content not available
- **Solution**: Use "Refine Search" to try different search combinations

#### Playback issues
- **Cause**: Network problems or torrent not fully cached
- **Solution**: Wait for download completion or try a different torrent

### Debug Mode
Enable debug mode in settings to see detailed logs in browser console:
1. Press `F12` to open developer tools
2. Go to `Console` tab
3. Look for `[TorBox]` prefixed messages

### Performance Tips
- Use cached torrents (⚡) for instant playback
- Clear browser cache if experiencing issues
- Disable other plugins if conflicts occur
- Use wired internet connection for best streaming quality

## 🏗️ Technical Details

### Architecture
```
Plugin Structure:
├── Utils (formatting, sorting, validation)
├── Storage (localStorage with fallback)
├── Cache (LRU with 10min TTL)
├── Config (settings management)
├── API (TorBox and tracker integration)
├── ErrorHandler (centralized error management)
└── MainComponent (UI and state management)
```

### Data Flow
1. **Search**: Query public trackers for torrents
2. **Hash Extraction**: Extract torrent hashes from magnet links
3. **Cache Check**: Verify which torrents are cached in TorBox
4. **Display**: Render torrents with cache indicators
5. **Selection**: Add torrent to TorBox if not cached
6. **Tracking**: Monitor download progress
7. **Playback**: Stream video files directly

### Storage Keys
The plugin uses localStorage for persistence:
- `torbox_api_key_b64`: Encrypted API key
- `torbox_proxy_url`: CORS proxy URL
- `torbox_filters_v2`: Filter preferences
- `torbox_sort_method`: Sort preference
- `torbox_show_only_cached`: Cache filter state
- `torbox_last_torrent_data_*`: Continue watching data
- `torbox_watched_episodes_*`: Episode watch status

### Network Requirements
- **Outbound HTTPS**: Access to TorBox API and public trackers
- **CORS Proxy**: Required for browser-based API calls
- **Bandwidth**: Varies by content quality (HD: ~5Mbps, 4K: ~25Mbps)

## 🤝 Contributing

This is an open-source project. Contributions are welcome!

### Development Setup
1. Clone the repository
2. Edit `torbox-lampa-plugin.js` directly
3. Test in Lampa using the local file URL
4. Submit pull requests for improvements

### Code Style
- Use ES6+ features
- Follow existing naming conventions
- Add comprehensive error handling
- Include debug logging for new features
- Maintain backward compatibility

## 📄 License

This project is open source. See the repository for license details.

## 🔗 Links

- **TorBox.app**: [https://torbox.app](https://torbox.app)
- **Lampa**: [https://lampa.mx](https://lampa.mx)
- **Plugin URL**: [https://slonce70.github.io/addon_lampa_torbox/torbox-lampa-plugin.js](https://slonce70.github.io/addon_lampa_torbox/torbox-lampa-plugin.js)
- **Issues**: Report bugs and feature requests in the repository issues section 