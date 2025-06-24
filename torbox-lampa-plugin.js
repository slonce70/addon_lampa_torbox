(function () {
    'use strict';

    /**
     * Клас для інтеграції сервісу Torbox.app у Lampa.mx
     * @version 1.0.0
     * @author Gemini
     */
    class TorboxPlugin {
        /**
         * Конструктор класу. Ініціалізує налаштування та ендпоінти API.
         */
        constructor() {
            this.settings = {};
            this.api_endpoints = {
                search: '/api/torrents/search',
                add: '/api/torrents',
                details: '/api/torrents/', // {id} буде додано в кінці
                download: '/api/torrents/download'
            };
            this.loadSettings();
        }

        /**
         * Завантажує налаштування (API ключ, URL проксі) зі сховища Lampa.
         * Також видаляє слеш в кінці URL проксі, щоб уникнути помилок.
         */
        loadSettings() {
            this.settings.api_key = Lampa.Storage.get('torbox_api_key', '');
            this.settings.proxy_url = Lampa.Storage.get('torbox_proxy_url', '');
            if (this.settings.proxy_url && this.settings.proxy_url.endsWith('/')) {
                this.settings.proxy_url = this.settings.proxy_url.slice(0, -1);
            }
        }

        /**
         * Головний метод ініціалізації плагіна.
         * Реєструє компонент та фільтр в Lampa і додає панель налаштувань.
         */
        init() {
            // Реєструємо наш клас як компонент-парсер в Lampa.
            // Це дозволяє Lampa викликати методи 'start', 'select', 'back' нашого об'єкта.
            Lampa.Component.add('torbox_parser', this);

            // Додаємо TorBox як нове джерело (фільтр) для торрентів.
            Lampa.Filter.add('torrents', {
                title: 'TorBox',
                name: 'torbox_parser', // Посилаємось на наш зареєстрований компонент
                wait: true // Дуже важливо: вказує Lampa, що наш парсер асинхронний і потрібно чекати на результат.
            });

            // Створюємо секцію налаштувань для плагіна.
            this.addSettingsPanel();

            console.log('TorBox Plugin', 'inited');
        }

        /**
         * Централізований метод для виконання всіх запитів до API Torbox через проксі.
         * Використовує async/await для зручності.
         * @param {string} endpoint - Ключ ендпоінту з this.api_endpoints (напр., 'search').
         * @param {object} params - Об'єкт з параметрами запиту (query для GET, body для POST).
         * @param {string} method - HTTP-метод ('GET' або 'POST').
         * @param {string} path_param - Додатковий параметр для шляху (напр., ID торрента).
         * @returns {Promise<object>} - Повертає Promise, який вирішується з JSON-відповіддю від API.
         */
        apiCall(endpoint, params = {}, method = 'GET', path_param = '') {
            return new Promise((resolve, reject) => {
                // Перевірка наявності обов'язкових налаштувань перед кожним запитом.
                if (!this.settings.api_key || !this.settings.proxy_url) {
                    return reject("URL проксі та API-ключ TorBox повинні бути вказані в налаштуваннях.");
                }

                let url = this.settings.proxy_url + this.api_endpoints[endpoint] + path_param;
                
                const options = {
                    headers: { 'x-api-key': this.settings.api_key },
                    timeout: 20000 // 20 секунд на випадок повільного проксі
                };

                if (method === 'GET') {
                    if (Object.keys(params).length > 0) {
                        url += '?' + new URLSearchParams(params).toString();
                    }
                } else if (method === 'POST') {
                    options.method = 'POST';
                    // Torbox API очікує дані у форматі application/x-www-form-urlencoded
                    options.body = new URLSearchParams(params).toString(); 
                    options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
                }

                // Використовуємо вбудований в Lampa метод для запитів.
                Lampa.Api.get(url, options, resolve, (err) => {
                    const error_text = err.statusText || 'Недоступний проксі-сервер або помилка API';
                    console.error('TorBox API Error:', err);
                    reject(error_text);
                });
            });
        }

        /**
         * Метод, що викликається Lampa для початку пошуку торрентів.
         * @param {object} movie - Об'єкт Lampa з інформацією про фільм (title, year, imdb_id).
         * @param {function} on_data - Callback-функція Lampa для повернення результатів.
         * @param {function} on_error - Callback-функція Lampa для повідомлення про помилку.
         */
        async start(movie, on_data, on_error) {
            this.loadSettings();
            
            // Пріоритетний пошук за IMDB ID, якщо він є, бо він найнадійніший.
            const query = movie.imdb_id ? `imdb:${movie.imdb_id}` : `${movie.title} ${movie.year || ''}`.trim();

            try {
                const response = await this.apiCall('search', { query });
                if (response.data && response.data.torrents && response.data.torrents.length > 0) {
                    const torrents = this.processResults(response.data.torrents);
                    on_data(torrents); // Повертаємо оброблені дані в Lampa
                } else {
                    on_data([]); // Повертаємо порожній масив, якщо торренти не знайдені
                }
            } catch (error) {
                Lampa.Noty.show(error.toString(), { type: 'error' });
                on_error(error); // Повідомляємо Lampa про помилку
            }
        }

        /**
         * Обробляє результати пошуку та форматує їх для коректного відображення в Lampa.
         * @param {Array} torrents - Масив торрентів, отриманий від API.
         * @returns {Array} - Відформатований масив об'єктів для інтерфейсу Lampa.
         */
        processResults(torrents) {
            return torrents.map(torrent => {
                const info = [];
                // Додаємо позначку, якщо торрент вже завантажений в Torbox.
                if (torrent.cached) info.push('✔ Кеш'); 
                info.push(this.formatSize(torrent.size));
                info.push(`S: ${torrent.last_known_seeders || 0}`);
                info.push(`P: ${torrent.last_known_peers || 0}`);

                return {
                    title: torrent.raw_title,
                    info: info.join(' | '),
                    size: torrent.size,
                    magnet: torrent.magnet,
                    // Зберігаємо кастомні дані, які знадобляться нам на наступному кроці.
                    _torbox: {
                        id: torrent.id,
                        cached: torrent.cached,
                    }
                };
            });
        }

        /**
         * Метод, що викликається Lampa, коли користувач обирає торрент з нашого джерела.
         * Це центральний диспетчер логіки плагіна.
         * @param {object} torrent_data - Дані про обраний торрент, які ми самі сформували в processResults.
         * @param {function} call_callback - Callback-функція Lampa для запуску плеєра.
         */
        async select(torrent_data, call_callback) {
            Lampa.Controller.loading.show(); // Показуємо індикатор завантаження

            try {
                if (torrent_data._torbox.cached) {
                    // Сценарій A: Торрент кешований -> отримуємо файли та посилання на стрім.
                    await this.playCachedTorrent(torrent_data, call_callback);
                } else {
                    // Сценарій Б: Торрент не кешований -> додаємо його на завантаження в Torbox.
                    await this.addTorrentToDownloads(torrent_data);
                }
            } catch (error) {
                Lampa.Noty.show(error.toString(), { type: 'error' });
                Lampa.Controller.toggle('content'); // У випадку помилки повертаємо користувача до контенту.
            } finally {
                Lampa.Controller.loading.hide(); // Завжди ховаємо індикатор завантаження.
            }
        }
        
        /**
         * Реалізує логіку для відтворення кешованого торрента.
         */
        async playCachedTorrent(torrent_data, call_callback) {
            Lampa.Noty.show('Запит файлів з кешу...');
            // Використовуємо ефективний запит для отримання деталей ОДНОГО торрента.
            const torrent_details = await this.apiCall('details', {}, 'GET', torrent_data._torbox.id);
            
            if (!torrent_details.data || !torrent_details.data.files || torrent_details.data.files.length === 0) {
                throw new Error('Не вдалося отримати список файлів або торрент порожній.');
            }

            // Форматуємо файли для вікна вибору Lampa і сортуємо за розміром.
            const files = torrent_details.data.files.map(file => ({
                title: file.name,
                size: file.size,
                path: file.name, // Lampa може використовувати це поле для відображення
                _torbox_file_id: file.id
            })).sort((a, b) => b.size - a.size);

            if (files.length === 1) {
                // Якщо у торренті лише один файл, відтворюємо його одразу без вибору.
                Lampa.Noty.show('Отримання посилання на файл...');
                await this.getStreamAndPlay(torrent_data._torbox.id, files[0]._torbox_file_id, call_callback);
            } else {
                // Показуємо стандартне вікно вибору файлу від Lampa.
                Lampa.Select.show({
                    title: 'Виберіть файл для відтворення',
                    items: files,
                    onSelect: async (selected_file) => {
                        Lampa.Controller.loading.show();
                        try {
                            Lampa.Noty.show('Отримання посилання на файл...');
                            await this.getStreamAndPlay(torrent_data._torbox.id, selected_file._torbox_file_id, call_callback);
                        } catch (error) {
                            Lampa.Noty.show(error.toString(), { type: 'error' });
                        } finally {
                            Lampa.Controller.loading.hide();
                        }
                    },
                    onBack: () => {
                        Lampa.Controller.toggle('content');
                    }
                });
            }
        }

        /**
         * Реалізує логіку для додавання некешованого торрента на завантаження.
         */
        async addTorrentToDownloads(torrent_data) {
            Lampa.Noty.show('Торрент не в кеші. Додаємо в завантаження TorBox...');
            const response = await this.apiCall('add', { magnet: torrent_data.magnet }, 'POST');

            if (response.success) {
                Lampa.Noty.show('Торрент успішно додано!', { type: 'success' });
            } else {
                throw new Error(response.error || response.detail || 'Невідома помилка при додаванні торрента.');
            }
            Lampa.Controller.toggle('content'); // Повертаємо користувача до картки фільму.
        }

        /**
         * Отримує фінальне посилання на стрім та передає його в плеєр Lampa.
         */
        async getStreamAndPlay(torrent_id, file_id, call_callback) {
            const response = await this.apiCall('download', { torrent_id, file_id });
            
            if (response.success && response.data) {
                // Це фінальний крок: передаємо посилання в Lampa, яка запустить плеєр.
                call_callback({ url: response.data, title: this.title });
            } else {
                throw new Error('Не вдалося отримати посилання на стрім.');
            }
        }

        /**
         * Допоміжна функція для форматування розміру файлу в читабельний вигляд (KB, MB, GB).
         */
        formatSize(bytes) {
            if (!bytes || bytes === 0) return '0 B';
            const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
            return Math.round(bytes / Math.pow(1024, i), 2) + ' ' + ['B', 'KB', 'MB', 'GB', 'TB'][i];
        }

        /**
         * Створює та додає панель налаштувань для плагіна в інтерфейс Lampa.
         */
        addSettingsPanel() {
            var LampaSettings = Lampa.Settings;

            LampaSettings.add({
                title: 'TorBox',
                name: 'torbox_settings',
                section: 'parser', // Додаємо в секцію "Парсер"
                onRender: (html) => {
                    let field_proxy = LampaSettings.pget(html, 'torbox_proxy_url', 'URL проксі');
                    field_proxy.val(Lampa.Storage.get('torbox_proxy_url', ''));

                    let field_api_key = LampaSettings.pget(html, 'torbox_api_key', 'TorBox API-ключ');
                    field_api_key.val(Lampa.Storage.get('torbox_api_key', ''));

                    html.find('input').on('change', function () {
                        Lampa.Storage.set($(this).data('name'), $(this).val());
                    });
                }
            });
        }

        /**
         * Метод для повернення назад (викликається Lampa).
         */
        back() {
            Lampa.Controller.toggle('content');
        }
    }

    // Створюємо єдиний екземпляр нашого плагіна та ініціалізуємо його.
    // Це єдина частина коду, що виконується при завантаженні скрипта.
    new TorboxPlugin().init();

})();
