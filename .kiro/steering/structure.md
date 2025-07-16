# Project Structure

## Repository Organization

```
├── .git/                    # Git version control
├── .gitignore              # Git exclusions (.cursor/ only)
├── .kiro/                  # Kiro AI assistant configuration
│   └── steering/           # AI guidance documents
├── README.md               # User installation and usage guide
├── project.md              # Detailed technical analysis (Ukrainian)
├── ROADMAP.md              # Development timeline and future plans
└── torbox-lampa-plugin.js  # Main plugin file (single-file distribution)
```

## Code Organization (within torbox-lampa-plugin.js)

The plugin follows a modular structure within a single file:

### Core Modules
- **Utils**: Pure utility functions (formatting, sorting, HTML escaping)
- **Storage**: Safe localStorage wrapper with fallback to in-memory storage
- **Cache**: LRU cache implementation for search results
- **Config**: Centralized configuration management with Base64 API key storage
- **Api**: HTTP request handling and TorBox API integration
- **ErrorHandler**: Centralized error display system

### UI Components
- **MainComponent**: Primary torrent list interface and search functionality
- **EpisodeListComponent**: Episode selection for multi-file torrents

### Integration Points
- **Lampa Listeners**: Event-driven integration with media center
- **Plugin Registration**: Component, template, and settings registration

## File Conventions

### Main Plugin File
- **Single file**: All functionality contained in `torbox-lampa-plugin.js`
- **IIFE wrapper**: Entire plugin wrapped for scope isolation
- **Guard clause**: Prevents multiple initialization
- **Strict mode**: `'use strict';` for enhanced error checking

### Documentation Files
- **README.md**: English user documentation
- **project.md**: Ukrainian technical analysis
- **ROADMAP.md**: Development planning and completed tasks

## Naming Conventions
- **Variables**: camelCase (e.g., `torrent_data`, `last_played`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `PLUGIN_ID`, `TTL_MS`)
- **Functions**: camelCase (e.g., `formatBytes`, `searchPublicTrackers`)
- **Storage keys**: snake_case with prefix (e.g., `torbox_api_key_b64`)
- **CSS classes**: kebab-case with prefix (e.g., `torbox-item__tech-bar`)