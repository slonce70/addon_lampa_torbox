# TorBox Lampa Plugin - Посібник розробника

## 🚀 Швидкий старт

### Встановлення середовища розробки

```bash
# Клонування репозиторію
git clone <repository-url>
cd addon_lampa_torbox

# Встановлення залежностей
npm install

# Запуск в режимі розробки
npm run dev
```

### Структура проекту

```
addon_lampa_torbox/
├── src/
│   ├── core/              # Основні модулі
│   │   ├── api-client.js  # API клієнт
│   │   ├── cache.js       # Система кешування
│   │   ├── config.js      # Конфігурація
│   │   └── security.js    # Безпека
│   ├── ui/                # UI компоненти
│   │   ├── settings.js    # Налаштування
│   │   ├── player.js      # Плеєр
│   │   └── progress.js    # Прогрес
│   ├── utils/             # Утиліти
│   │   ├── validation.js  # Валідація
│   │   ├── formatting.js  # Форматування
│   │   └── logging.js     # Логування
│   └── main.js            # Головний файл
├── tests/                 # Тести
├── docs/                  # Документація
├── config.json            # Конфігурація
└── package.json           # Залежності
```

## 🛠️ Архітектура

### Основні принципи

1. **Модульність** - кожен модуль має одну відповідальність
2. **Безпека** - всі дані валідуються та санітизуються
3. **Продуктивність** - оптимізоване кешування та lazy loading
4. **Надійність** - error boundaries та graceful degradation
5. **Тестованість** - код покритий тестами

### Паттерни проектування

#### 1. Module Pattern
```javascript
const ApiClient = (() => {
    // Приватні змінні
    let config = {};
    
    // Публічний API
    return {
        request: async (endpoint, options) => {
            // Реалізація
        }
    };
})();
```

#### 2. Observer Pattern
```javascript
class EventEmitter {
    constructor() {
        this.events = {};
    }
    
    on(event, callback) {
        if (!this.events[event]) {
            this.events[event] = [];
        }
        this.events[event].push(callback);
    }
    
    emit(event, data) {
        if (this.events[event]) {
            this.events[event].forEach(callback => callback(data));
        }
    }
}
```

#### 3. Strategy Pattern
```javascript
class QualitySelector {
    constructor() {
        this.strategies = {
            'auto': new AutoQualityStrategy(),
            'manual': new ManualQualityStrategy(),
            'adaptive': new AdaptiveQualityStrategy()
        };
    }
    
    selectQuality(files, strategy = 'auto') {
        return this.strategies[strategy].select(files);
    }
}
```

## 🔒 Безпека

### Валідація вхідних даних

```javascript
// Валідація magnet посилань
function validateMagnetUri(uri) {
    const magnetRegex = /^magnet:\?xt=urn:[a-z0-9]+:[a-z0-9]{32,40}/i;
    return magnetRegex.test(uri);
}

// Санітизація користувацького вводу
function sanitizeInput(input) {
    return input
        .trim()
        .replace(/[<>"'&]/g, '')
        .substring(0, 1000); // Обмеження довжини
}
```

### Шифрування чутливих даних

```javascript
// Простий приклад шифрування для localStorage
function encryptApiKey(apiKey) {
    // В продакшені використовуйте криптографічно стійкі методи
    return btoa(unescape(encodeURIComponent(apiKey)));
}

function decryptApiKey(encryptedKey) {
    try {
        return decodeURIComponent(escape(atob(encryptedKey)));
    } catch {
        return null;
    }
}
```

### Rate Limiting

```javascript
class RateLimiter {
    constructor(maxRequests = 10, windowMs = 60000) {
        this.maxRequests = maxRequests;
        this.windowMs = windowMs;
        this.requests = [];
    }
    
    isAllowed() {
        const now = Date.now();
        this.requests = this.requests.filter(time => now - time < this.windowMs);
        
        if (this.requests.length >= this.maxRequests) {
            return false;
        }
        
        this.requests.push(now);
        return true;
    }
}
```

## ⚡ Продуктивність

### Кешування з LRU

```javascript
class LRUCache {
    constructor(maxSize = 100) {
        this.maxSize = maxSize;
        this.cache = new Map();
        this.accessOrder = new Map();
    }
    
    get(key) {
        if (this.cache.has(key)) {
            this.accessOrder.set(key, Date.now());
            return this.cache.get(key);
        }
        return null;
    }
    
    set(key, value) {
        if (this.cache.size >= this.maxSize) {
            this.evictOldest();
        }
        
        this.cache.set(key, value);
        this.accessOrder.set(key, Date.now());
    }
    
    evictOldest() {
        const oldest = Array.from(this.accessOrder.entries())
            .sort((a, b) => a[1] - b[1])[0];
        
        if (oldest) {
            this.cache.delete(oldest[0]);
            this.accessOrder.delete(oldest[0]);
        }
    }
}
```

### Debouncing

```javascript
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Використання
const debouncedSearch = debounce(searchTorrents, 300);
```

### Lazy Loading

```javascript
class LazyLoader {
    constructor() {
        this.loadedModules = new Map();
    }
    
    async loadModule(moduleName) {
        if (this.loadedModules.has(moduleName)) {
            return this.loadedModules.get(moduleName);
        }
        
        const module = await import(`./modules/${moduleName}.js`);
        this.loadedModules.set(moduleName, module);
        return module;
    }
}
```

## 🧪 Тестування

### Unit тести

```javascript
// tests/api-client.test.js
describe('ApiClient', () => {
    beforeEach(() => {
        // Налаштування
    });
    
    test('should make authenticated request', async () => {
        const mockResponse = { data: 'test' };
        fetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockResponse)
        });
        
        const result = await ApiClient.request('/test');
        expect(result).toEqual(mockResponse);
    });
    
    test('should handle rate limiting', async () => {
        // Тест rate limiting
    });
});
```

### Integration тести

```javascript
// tests/integration/torrent-streaming.test.js
describe('Torrent Streaming Integration', () => {
    test('should stream torrent from magnet link', async () => {
        const magnetUri = 'magnet:?xt=urn:btih:...';
        const result = await TorrentStreaming.play({ url: magnetUri });
        
        expect(result.streamUrl).toBeDefined();
        expect(result.subtitles).toBeInstanceOf(Array);
    });
});
```

### E2E тести

```javascript
// tests/e2e/user-flow.test.js
describe('User Flow', () => {
    test('complete streaming workflow', async () => {
        // 1. Відкрити налаштування
        await page.click('[data-testid="settings-button"]');
        
        // 2. Ввести API ключ
        await page.fill('[data-testid="api-key-input"]', 'test-api-key');
        
        // 3. Зберегти налаштування
        await page.click('[data-testid="save-button"]');
        
        // 4. Запустити стрімінг
        await page.click('[data-testid="play-button"]');
        
        // 5. Перевірити результат
        await expect(page.locator('[data-testid="player"]')).toBeVisible();
    });
});
```

## 📝 Логування

### Структуроване логування

```javascript
class Logger {
    constructor(level = 'info') {
        this.level = level;
        this.levels = {
            debug: 0,
            info: 1,
            warn: 2,
            error: 3
        };
    }
    
    log(level, message, context = {}) {
        if (this.levels[level] >= this.levels[this.level]) {
            const logEntry = {
                timestamp: new Date().toISOString(),
                level,
                message,
                context,
                plugin: 'torbox-enhanced',
                version: '2.0.0'
            };
            
            console[level](`[TorBox]`, logEntry);
            
            // Відправка в зовнішній сервіс логування
            this.sendToExternalService(logEntry);
        }
    }
    
    debug(message, context) { this.log('debug', message, context); }
    info(message, context) { this.log('info', message, context); }
    warn(message, context) { this.log('warn', message, context); }
    error(message, context) { this.log('error', message, context); }
}
```

## 🔧 Налаштування середовища

### ESLint конфігурація

```json
// .eslintrc.json
{
  "extends": ["eslint:recommended"],
  "env": {
    "browser": true,
    "es2021": true
  },
  "parserOptions": {
    "ecmaVersion": 12,
    "sourceType": "module"
  },
  "rules": {
    "no-console": "warn",
    "no-unused-vars": "error",
    "prefer-const": "error",
    "no-var": "error"
  }
}
```

### Prettier конфігурація

```json
// .prettierrc
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": true,
  "printWidth": 80,
  "tabWidth": 2
}
```

### Husky hooks

```json
// package.json
{
  "husky": {
    "hooks": {
      "pre-commit": "lint-staged",
      "pre-push": "npm test"
    }
  },
  "lint-staged": {
    "*.js": ["eslint --fix", "prettier --write"]
  }
}
```

## 📊 Моніторинг та метрики

### Performance моніторинг

```javascript
class PerformanceMonitor {
    constructor() {
        this.metrics = new Map();
    }
    
    startTimer(name) {
        this.metrics.set(name, performance.now());
    }
    
    endTimer(name) {
        const startTime = this.metrics.get(name);
        if (startTime) {
            const duration = performance.now() - startTime;
            this.recordMetric(`${name}_duration`, duration);
            this.metrics.delete(name);
            return duration;
        }
    }
    
    recordMetric(name, value) {
        // Відправка метрик в аналітичний сервіс
        if (window.gtag) {
            window.gtag('event', 'custom_metric', {
                metric_name: name,
                metric_value: value
            });
        }
    }
}
```

### Error tracking

```javascript
class ErrorTracker {
    constructor(config) {
        this.config = config;
        this.errorQueue = [];
    }
    
    captureError(error, context = {}) {
        const errorInfo = {
            message: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent,
            url: window.location.href,
            context
        };
        
        this.errorQueue.push(errorInfo);
        
        // Відправка помилок батчами
        if (this.errorQueue.length >= 10) {
            this.flushErrors();
        }
    }
    
    async flushErrors() {
        if (this.errorQueue.length === 0) return;
        
        try {
            await fetch(this.config.errorEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.errorQueue)
            });
            
            this.errorQueue = [];
        } catch (e) {
            console.warn('Failed to send error reports:', e);
        }
    }
}
```

## 🚀 Деплой

### Build процес

```bash
# Збірка для продакшену
npm run build

# Мініфікація
npm run minify

# Генерація документації
npm run docs

# Запуск тестів
npm test

# Перевірка якості коду
npm run lint
```

### CI/CD pipeline

```yaml
# .github/workflows/ci.yml
name: CI/CD

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '16'
      - run: npm ci
      - run: npm test
      - run: npm run lint
      - run: npm run build
```

## 📚 Додаткові ресурси

### Корисні посилання
- [TorBox API Documentation](https://torbox.app/api)
- [Lampa Plugin Development](https://github.com/yumkam/lampa)
- [JavaScript Best Practices](https://github.com/ryanmcdermott/clean-code-javascript)
- [Security Guidelines](https://owasp.org/www-project-top-ten/)

### Інструменти розробки
- **VS Code** з розширеннями: ESLint, Prettier, GitLens
- **Chrome DevTools** для налагодження
- **Postman** для тестування API
- **Jest** для unit тестів
- **Playwright** для E2E тестів

---

**Пам'ятайте:** Завжди дотримуйтесь принципів безпечного кодування та тестуйте свій код перед деплоєм!