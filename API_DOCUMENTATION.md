# TorBox Lampa Plugin - API Документація

## 📋 Огляд

Ця документація описує API інтерфейси та методи TorBox Lampa плагіна версії 2.0.0.

## 🔧 Основні класи та модулі

### Config - Менеджер конфігурації

#### Методи

```javascript
// Отримання API ключа
const apiKey = await Config.getApiKey();

// Встановлення API ключа (з шифруванням)
await Config.setApiKey('your-api-key');

// Отримання налаштування
const autoplay = Config.get('autoplay', true);

// Встановлення налаштування
Config.set('preferredQuality', '1080p');

// Очищення всіх налаштувань
Config.clear();
```

#### Доступні налаштування

| Ключ | Тип | За замовчуванням | Опис |
|------|-----|------------------|------|
| `apiKey` | string | null | TorBox API ключ (зашифрований) |
| `autoplay` | boolean | true | Автоматичне відтворення |
| `autoDelete` | boolean | false | Автоматичне видалення торрентів |
| `subtitles` | boolean | true | Підтримка субтитрів |
| `preferredQuality` | string | 'auto' | Бажана якість відео |
| `zipTorrents` | boolean | false | Підтримка ZIP торрентів |
| `caching` | boolean | true | Увімкнення кешування |
| `debugMode` | boolean | false | Режим налагодження |

### ApiClient - HTTP клієнт для TorBox API

#### Конструктор

```javascript
const client = new ApiClient({
    baseURL: 'https://api.torbox.app/v1/api',
    timeout: 30000,
    retries: 3
});
```

#### Методи

```javascript
// Базовий запит
const response = await client.request('/torrents/mylist', {
    method: 'GET',
    headers: { 'Custom-Header': 'value' }
});

// GET запит
const torrents = await client.get('/torrents/mylist');

// POST запит
const result = await client.post('/torrents/createtorrent', {
    magnet: 'magnet:?xt=urn:btih:...'
});

// PUT запит
const updated = await client.put('/torrents/controltorrent', {
    torrent_id: 123,
    operation: 'delete'
});

// DELETE запит
const deleted = await client.delete('/torrents/123');
```

#### Обробка помилок

```javascript
try {
    const result = await client.get('/invalid-endpoint');
} catch (error) {
    if (error instanceof TorBoxError) {
        console.log('TorBox Error:', error.message);
        console.log('Status Code:', error.statusCode);
        console.log('Error Code:', error.errorCode);
    }
}
```

### Cache - Система кешування з LRU

#### Методи

```javascript
// Отримання з кешу
const data = Cache.get('torrents_list');

// Збереження в кеш
Cache.set('torrents_list', torrentsData, 3600); // TTL 1 година

// Перевірка наявності
if (Cache.has('user_settings')) {
    // Дані є в кеші
}

// Видалення з кешу
Cache.delete('old_data');

// Очищення всього кешу
Cache.clear();

// Отримання статистики
const stats = Cache.getStats();
console.log('Cache hits:', stats.hits);
console.log('Cache misses:', stats.misses);
console.log('Hit ratio:', stats.hitRatio);
```

### RateLimiter - Обмеження частоти запитів

#### Конструктор

```javascript
const limiter = new RateLimiter({
    maxRequests: 10,    // Максимум запитів
    windowMs: 60000,    // Вікно часу (1 хвилина)
    skipSuccessfulRequests: false
});
```

#### Методи

```javascript
// Перевірка дозволу на запит
if (limiter.isAllowed()) {
    // Виконати запит
    await makeApiRequest();
} else {
    throw new Error('Rate limit exceeded');
}

// Отримання статистики
const stats = limiter.getStats();
console.log('Requests made:', stats.requestsMade);
console.log('Requests remaining:', stats.requestsRemaining);
console.log('Reset time:', stats.resetTime);
```

### TorBoxError - Розширений клас помилок

#### Конструктор

```javascript
const error = new TorBoxError(
    'API request failed',
    500,
    'INTERNAL_SERVER_ERROR',
    { endpoint: '/torrents/mylist' }
);
```

#### Властивості

| Властивість | Тип | Опис |
|-------------|-----|------|
| `message` | string | Повідомлення про помилку |
| `statusCode` | number | HTTP статус код |
| `errorCode` | string | Код помилки TorBox |
| `context` | object | Додатковий контекст |
| `timestamp` | Date | Час виникнення помилки |

#### Методи

```javascript
// Серіалізація помилки
const errorData = error.toJSON();

// Перевірка типу помилки
if (error.isNetworkError()) {
    // Обробка мережевої помилки
}

if (error.isAuthError()) {
    // Обробка помилки авторизації
}

if (error.isRateLimitError()) {
    // Обробка перевищення ліміту
}
```

### Utils - Утилітарні функції

#### Валідація

```javascript
// Валідація magnet посилання
const isValid = Utils.validateMagnetUri('magnet:?xt=urn:btih:...');

// Валідація API ключа
const isValidKey = Utils.validateApiKey('your-api-key');

// Санітизація вводу
const clean = Utils.sanitizeInput('<script>alert("xss")</script>');

// Валідація URL
const isValidUrl = Utils.validateUrl('https://example.com/file.torrent');
```

#### Форматування

```javascript
// Форматування розміру файлу
const size = Utils.formatFileSize(1073741824); // "1.00 GB"

// Форматування тривалості
const duration = Utils.formatDuration(7200); // "2h 0m"

// Форматування швидкості
const speed = Utils.formatSpeed(1048576); // "1.00 MB/s"

// Форматування часу
const time = Utils.formatTime(new Date()); // "14:30:25"
```

#### Debouncing

```javascript
// Створення debounced функції
const debouncedSearch = Utils.debounce((query) => {
    searchTorrents(query);
}, 300);

// Використання
debouncedSearch('movie title');
```

### UI - Інтерфейсні утиліти

#### Toast повідомлення

```javascript
// Показати успішне повідомлення
UI.showToast('Торрент додано успішно!', 'success');

// Показати помилку
UI.showToast('Помилка API', 'error');

// Показати попередження
UI.showToast('Перевірте налаштування', 'warning');

// Показати інформацію
UI.showToast('Завантаження...', 'info', 5000); // 5 секунд
```

#### Прогрес

```javascript
// Показати прогрес
UI.showProgress({
    title: 'Завантаження торренту',
    progress: 45,
    speed: '2.5 MB/s',
    eta: '5m 30s'
});

// Приховати прогрес
UI.hideProgress();
```

#### Діалоги

```javascript
// Показати діалог підтвердження
const confirmed = await UI.showConfirm(
    'Видалити торрент?',
    'Ця дія незворотна'
);

if (confirmed) {
    // Видалити торрент
}

// Показати діалог вибору файлу
const selectedFile = await UI.showFileSelector([
    { name: 'movie.mkv', size: '2.1 GB' },
    { name: 'subtitles.srt', size: '45 KB' }
]);
```

## 🎬 Основні робочі процеси

### 1. Ініціалізація плагіна

```javascript
// Автоматична ініціалізація при завантаженні
window.addEventListener('load', async () => {
    try {
        await TorBoxPlugin.init();
        console.log('TorBox plugin initialized');
    } catch (error) {
        console.error('Failed to initialize plugin:', error);
    }
});
```

### 2. Додавання торренту

```javascript
async function addTorrent(magnetUri) {
    try {
        // Валідація
        if (!Utils.validateMagnetUri(magnetUri)) {
            throw new Error('Invalid magnet URI');
        }
        
        // Додавання торренту
        const response = await ApiClient.post('/torrents/createtorrent', {
            magnet: magnetUri,
            seed: 1
        });
        
        return response.data;
    } catch (error) {
        ErrorBoundary.handleError(error, { action: 'addTorrent' });
        throw error;
    }
}
```

### 3. Отримання списку торрентів

```javascript
async function getTorrents() {
    try {
        // Перевірка кешу
        const cached = Cache.get('torrents_list');
        if (cached) {
            return cached;
        }
        
        // Запит до API
        const response = await ApiClient.get('/torrents/mylist');
        const torrents = response.data;
        
        // Збереження в кеш
        Cache.set('torrents_list', torrents, 300); // 5 хвилин
        
        return torrents;
    } catch (error) {
        ErrorBoundary.handleError(error, { action: 'getTorrents' });
        throw error;
    }
}
```

### 4. Стрімінг відео

```javascript
async function streamVideo(torrentId, fileId) {
    try {
        // Отримання посилання на стрім
        const response = await ApiClient.get(
            `/torrents/requestdl?token=${await Config.getApiKey()}&torrent_id=${torrentId}&file_id=${fileId}&zip_link=false`
        );
        
        const streamUrl = response.data;
        
        // Пошук субтитрів
        const subtitles = await findSubtitles(torrentId);
        
        // Запуск плеєра
        Lampa.Player.play({
            url: streamUrl,
            subtitles: subtitles,
            title: 'TorBox Stream'
        });
        
    } catch (error) {
        ErrorBoundary.handleError(error, { action: 'streamVideo' });
        throw error;
    }
}
```

### 5. Пошук субтитрів

```javascript
async function findSubtitles(torrentId) {
    try {
        const response = await ApiClient.get(`/torrents/torrentinfo?id=${torrentId}`);
        const files = response.data.files || [];
        
        return files
            .filter(file => /\.(srt|vtt|ass|ssa)$/i.test(file.name))
            .map(file => ({
                label: file.name,
                url: `/torrents/requestdl?token=${await Config.getApiKey()}&torrent_id=${torrentId}&file_id=${file.id}&zip_link=false`
            }));
    } catch (error) {
        console.warn('Failed to find subtitles:', error);
        return [];
    }
}
```

## 🔌 Інтеграція з Lampa

### Реєстрація як джерело відео

```javascript
// Реєстрація плагіна
Lampa.Component.add('torbox', TorBoxComponent);

// Додавання до меню
Lampa.SettingsApi.addComponent({
    component: 'torbox',
    name: 'TorBox',
    icon: '<svg>...</svg>'
});

// Реєстрація як джерело
Lampa.VideoSource.add('torbox', {
    name: 'TorBox',
    search: searchTorrents,
    stream: streamVideo
});
```

### Обробка подій Lampa

```javascript
// Підписка на події
Lampa.Listener.follow('full', (e) => {
    if (e.method === 'torbox') {
        handleTorBoxRequest(e.data);
    }
});

// Відправка подій
Lampa.Controller.trigger('torbox', {
    action: 'play',
    data: { magnetUri: 'magnet:...' }
});
```

## 📊 Моніторинг та логування

### Логування подій

```javascript
// Різні рівні логування
Logger.debug('Cache hit for key: torrents_list');
Logger.info('Torrent added successfully', { torrentId: 123 });
Logger.warn('Rate limit approaching', { remaining: 2 });
Logger.error('API request failed', { error: error.message });
```

### Метрики продуктивності

```javascript
// Вимірювання часу виконання
PerformanceMonitor.startTimer('api_request');
const result = await ApiClient.get('/torrents/mylist');
const duration = PerformanceMonitor.endTimer('api_request');

// Запис метрики
PerformanceMonitor.recordMetric('cache_hit_ratio', 0.85);
PerformanceMonitor.recordMetric('active_streams', 3);
```

## 🔒 Безпека

### Валідація та санітизація

```javascript
// Валідація перед API запитом
function validateTorrentRequest(data) {
    const errors = [];
    
    if (!data.magnet || !Utils.validateMagnetUri(data.magnet)) {
        errors.push('Invalid magnet URI');
    }
    
    if (data.seed && (data.seed < 0 || data.seed > 1)) {
        errors.push('Seed must be 0 or 1');
    }
    
    if (errors.length > 0) {
        throw new TorBoxError('Validation failed', 400, 'VALIDATION_ERROR', { errors });
    }
}
```

### Шифрування чутливих даних

```javascript
// Збереження API ключа
const encryptedKey = Security.encrypt(apiKey);
localStorage.setItem('torbox_api_key', encryptedKey);

// Отримання API ключа
const encryptedKey = localStorage.getItem('torbox_api_key');
const apiKey = Security.decrypt(encryptedKey);
```

## 🧪 Тестування

### Мокування API

```javascript
// Мок для тестування
const mockApiClient = {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn()
};

// Налаштування мока
mockApiClient.get.mockResolvedValue({
    data: [{ id: 1, name: 'test.torrent' }]
});
```

### Тестування компонентів

```javascript
describe('TorBox Plugin', () => {
    beforeEach(() => {
        // Очищення кешу та налаштувань
        Cache.clear();
        Config.clear();
    });
    
    test('should add torrent successfully', async () => {
        const magnetUri = 'magnet:?xt=urn:btih:test';
        const result = await addTorrent(magnetUri);
        
        expect(result).toBeDefined();
        expect(result.id).toBeGreaterThan(0);
    });
});
```

## 📈 Оптимізація продуктивності

### Lazy Loading

```javascript
// Ледаче завантаження модулів
const SubtitleModule = lazy(() => import('./modules/subtitles.js'));
const QualityModule = lazy(() => import('./modules/quality.js'));

// Використання
const subtitles = await SubtitleModule.findSubtitles(torrentId);
```

### Пакетування запитів

```javascript
class BatchProcessor {
    constructor(batchSize = 10, delay = 100) {
        this.batchSize = batchSize;
        this.delay = delay;
        this.queue = [];
        this.processing = false;
    }
    
    add(request) {
        this.queue.push(request);
        this.process();
    }
    
    async process() {
        if (this.processing) return;
        this.processing = true;
        
        while (this.queue.length > 0) {
            const batch = this.queue.splice(0, this.batchSize);
            await this.processBatch(batch);
            await new Promise(resolve => setTimeout(resolve, this.delay));
        }
        
        this.processing = false;
    }
}
```

---

## 📞 Підтримка

Для отримання додаткової інформації або повідомлення про помилки:

- **GitHub Issues**: [Створити issue](https://github.com/your-repo/issues)
- **Email**: support@torbox-plugin.com
- **Discord**: [Приєднатися до сервера](https://discord.gg/torbox)

---

**Версія документації**: 2.0.0  
**Остання оновлення**: 2024-12-19