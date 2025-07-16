# Technical Stack

## Core Technologies
- **Language**: Pure JavaScript (ES6+)
- **Architecture**: IIFE (Immediately Invoked Function Expression) for scope isolation
- **Runtime**: Browser-based, no Node.js dependencies
- **API Integration**: TorBox.app REST API, Public tracker parsers (Viewbox, Jacred)

## Key Libraries & Dependencies
- **Lampa API**: Core media center framework integration
- **Native Browser APIs**: 
  - Fetch API for HTTP requests
  - LocalStorage for persistence
  - AbortController for request cancellation

## Architecture Patterns
- **Modular Design**: Separated concerns (Utils, Storage, Cache, Config, Api, UI Components)
- **Event-Driven**: Lampa listener system integration
- **State Management**: Centralized state object with localStorage persistence
- **Error Handling**: Centralized ErrorHandler with typed error system
- **Caching**: LRU cache implementation for search results (10-minute TTL)

## Build System
- **No Build Process**: Single-file distribution
- **No Package Manager**: Self-contained with no external dependencies
- **Deployment**: Static file hosting (GitHub Pages)

## Development Commands
Since this is a single-file plugin with no build system:
- **Testing**: Load directly in Lampa via plugin URL
- **Development**: Edit `torbox-lampa-plugin.js` directly
- **Deployment**: Commit to repository (auto-deploys via GitHub Pages)

## Code Standards
- Use `'use strict';` mode
- IIFE pattern for namespace isolation
- Consistent error handling with typed errors
- Modular function organization
- Comprehensive logging with debug mode