(function () {
    'use strict';

    /**
     * Основной класс плагина TorBox для Lampa.
     * Этот плагин обеспечивает интеграцию с сервисом torbox.app для поиска,
     * выбора файлов и воспроизведения торрентов прямо из интерфейса Lampa.
     */
    function Torbox() {
        var _this = this;

        // Настройки плагина с значениями по умолчанию
        this.settings = {
            api_key: '',
            proxy_url: '', // URL вашего прокси-сервера
            show_cached_only: false
        };

        /**
         * Инициализация плагина.
         * Вызывается один раз при старте Lampa.
         */
        this.create = function () {
            this.loadSettings();

            // Добавляем обработчик для активации плагина на страницах с фильмами
            Lampa.Listener.follow('activity', function (e) {
                if (e.type === 'movie' || e.type === 'serial') {
                    _this.buildUI(e.object);
                }
            });
            // Добавляем свои настройки в панель Lampa
            this.addSettings();
        };

        /**
         * Загрузка настроек из локального хранилища Lampa.
         */
        this.loadSettings = function () {
            _this.settings.api_key = Lampa.Storage.get('torbox_api_key', '');
            _this.settings.proxy_url = Lampa.Storage.get('torbox_proxy_url', '');
            _this.settings.show_cached_only = Lampa.Storage.get('torbox_show_cached_only', false);
        };

        /**
         * Добавление полей настроек в интерфейс Lampa, используя современный API.
         */
        this.addSettings = function () {
            Lampa.SettingsApi.addParam({
                component: 'torbox_main',
                param: {
                    name: 'proxy_url',
                    type: 'input',
                    value: _this.settings.proxy_url,
                    placeholder: 'https://my-proxy.vercel.app'
                },
                field: {
                    name: 'URL Прокси-сервера',
                    description: 'Адрес вашего прокси-сервера для обхода CORS'
                },
                onChange: function(value) {
                    _this.settings.proxy_url = value;
                    Lampa.Storage.set('torbox_proxy_url', value);
                }
            });
            Lampa.SettingsApi.addParam({
                component: 'torbox_main',
                param: {
                    name: 'api_key',
                    type: 'input',
                    value: _this.settings.api_key,
                    placeholder: 'Введите ваш API-ключ'
                },
                field: {
                    name: 'TorBox API-ключ',
                    description: 'Ключ можно получить в настройках torbox.app'
                },
                onChange: function(value) {
                    _this.settings.api_key = value;
                    Lampa.Storage.set('torbox_api_key', value);
                }
            });
            Lampa.SettingsApi.addParam({
                component: 'torbox_main',
                param: {
                    name: 'show_cached_only',
                    type: 'checkbox',
                    value: _this.settings.show_cached_only,
                    default: false
                },
                field: {
                    name: 'Показывать только кэшированные',
                    description: 'Будут показаны только торренты, доступные для мгновенного просмотра'
                },
                onChange: function(value) {
                    _this.settings.show_cached_only = value;
                    Lampa.Storage.set('torbox_show_cached_only', value);
                }
            });
            Lampa.Settings.add({
                tag: 'torbox',
                name: 'TorBox',
                icon: 't',
                type: 'component',
                component: 'torbox_main',
                header: true
            });
        };

        /**
         * Встраивание кнопки TorBox в интерфейс карточки фильма.
         * @param {object} card - Объект карточки фильма Lampa.
         */
        this.buildUI = function (card) {
            var button = $('<div class="card-more__button selector"><span>TorBox</span></div>');
            button.on('click', function () {
                if (!_this.settings.api_key || !_this.settings.proxy_url) {
                    return Lampa.Noty.show('URL прокси и API-ключ TorBox должны быть указаны в настройках.');
                }
                _this.search(card);
            });
            card.activity.render().find('.card-more').append(button);
        };

        /**
         * Поиск торрентов через API TorBox.
         * @param {object} card - Объект карточки фильма Lampa.
         */
        this.search = function (card) {
            Lampa.Utils.putToBackground(true);
            Lampa.Modal.open({
                title: 'TorBox',
                html: Lampa.Template.get('loader').render(),
                size: 'medium',
                onBack: function () {
                    _this.onModalClose();
                }
            });

            var query = card.data.imdb_id ? 'imdb:' + card.data.imdb_id : card.data.title;
            // Используем прокси-сервер для запроса
            var url = this.settings.proxy_url + '/api/torrents/search?query=' + encodeURIComponent(query);

            Lampa.Api.get(url, {
                headers: { 'x-api-key': this.settings.api_key }
            }, function (data) {
                if (data.data && data.data.torrents) {
                    _this.displayResults(data.data.torrents);
                } else {
                    Lampa.Noty.show('Торренты не найдены.');
                    _this.onModalClose();
                }
            }, function (err) {
                Lampa.Noty.show('Ошибка поиска в TorBox: ' + (err.status_text || 'Сервер прокси недоступен'));
                _this.onModalClose();
            });
        };

        /**
         * Отображение результатов поиска.
         * @param {Array} torrents - Массив торрентов.
         */
        this.displayResults = function (torrents) {
            var content = Lampa.Template.get('online', {
                title: 'Результаты TorBox',
                items: []
            });
            
            var filtered = this.settings.show_cached_only ? torrents.filter(t => t.cached) : torrents;

            filtered.sort(function (a, b) {
                if (a.cached && !b.cached) return -1;
                if (!a.cached && b.cached) return 1;
                return (b.last_known_seeders || 0) - (a.last_known_seeders || 0);
            });
            
            if (filtered.length === 0) {
                 content.find('.online__content').append('<div class="empty">Ничего не найдено</div>');
            }

            filtered.forEach(function (torrent) {
                var cached_html = torrent.cached ? '<span class="torbox-item__cached">[Кэш]</span>' : '';
                var item = $(`
                    <div class="online__item selector">
                        <div class="online__title">${torrent.raw_title} ${cached_html}</div>
                        <div class="online__info">
                            <span>${_this.formatSize(torrent.size)}</span>
                            <span>S: ${torrent.last_known_seeders || 0}</span>
                            <span>P: ${torrent.last_known_peers || 0}</span>
                        </div>
                    </div>
                `);

                item.on('click', function () {
                    _this.handleTorrentClick(torrent);
                });
                content.find('.online__content').append(item);
            });

            Lampa.Modal.update({ html: content });
        };
        
        /**
         * Обработка клика по торренту: либо показываем файлы, либо добавляем в загрузки.
         * @param {object} torrent - Объект торрента.
         */
        this.handleTorrentClick = function(torrent) {
             if (torrent.cached) {
                // Если торрент кэширован, запрашиваем список файлов
                this.getFiles(torrent.id);
            } else {
                // Если не кэширован, предлагаем добавить в загрузки
                this.addToDownloads(torrent.magnet);
            }
        };

        /**
         * Получение списка файлов для кэшированного торрента.
         * @param {string} torrentId - ID торрента.
         */
        this.getFiles = function(torrentId) {
            Lampa.Modal.update({ html: Lampa.Template.get('loader').render() });
            
            var url = this.settings.proxy_url + '/api/torrents?id=' + torrentId; // Предполагая, что API может вернуть один торрент по ID

            Lampa.Api.get(this.settings.proxy_url + '/api/torrents', { headers: { 'x-api-key': this.settings.api_key } }, function(data) {
                var torrentData = data.data.find(t => t.id == torrentId);
                if (torrentData && torrentData.files) {
                     _this.displayFiles(torrentData);
                } else {
                     Lampa.Noty.show('Не удалось получить список файлов.');
                }
            });
        };

        /**
         * Отображение списка файлов.
         * @param {object} torrent - Объект торрента с файлами.
         */
        this.displayFiles = function(torrent) {
            var content = Lampa.Template.get('online', {
                title: 'Файлы в торренте',
                items: []
            });
            
            // Сортируем файлы по размеру
            torrent.files.sort((a,b) => b.size - a.size);

            torrent.files.forEach(function(file) {
                 var file_item = $(`
                    <div class="online__item selector">
                        <div class="online__title">${file.name}</div>
                        <div class="online__info">${_this.formatSize(file.size)}</div>
                    </div>
                 `);
                 file_item.on('click', function() {
                     _this.getDownloadLink(torrent.id, file.id);
                 });
                 content.find('.online__content').append(file_item);
            });

             Lampa.Modal.update({ html: content });
        };
        
        /**
         * Получение прямой ссылки на файл для просмотра.
         * @param {string} torrentId - ID торрента.
         * @param {string} [fileId] - ID файла (опционально).
         */
        this.getDownloadLink = function (torrentId, fileId) {
            Lampa.Noty.show('Получение ссылки на файл...');
            var url = this.settings.proxy_url + '/api/torrents/download?torrent_id=' + torrentId + (fileId ? '&file_id=' + fileId : '');

            Lampa.Api.get(url, {
                headers: { 'Authorization': 'Bearer ' + this.settings.api_key }
            }, function (response) {
                if (response.success && response.data) {
                    Lampa.Player.play({ url: response.data.data || response.data });
                    _this.onModalClose(true);
                } else {
                    Lampa.Noty.show('Не удалось получить ссылку: ' + (response.error || ''));
                }
            }, function () {
                Lampa.Noty.show('Ошибка при запросе ссылки на файл.');
            });
        };

        /**
         * Добавление торрента в загрузки TorBox.
         * @param {string} magnet - Magnet-ссылка.
         */
        this.addToDownloads = function (magnet) {
            Lampa.Noty.show('Добавление в загрузки TorBox...');
            var url = this.settings.proxy_url + '/api/torrents';

            Lampa.Api.post(url, { magnet: magnet }, {
                headers: { 'x-api-key': this.settings.api_key, 'Content-Type': 'application/json' }
            }, function (response) {
                if (response.success) {
                    Lampa.Noty.show('Торрент успешно добавлен в загрузки!');
                } else {
                    Lampa.Noty.show('Ошибка: ' + (response.error || 'не удалось добавить торрент.'));
                }
                _this.onModalClose(true);
            }, function () {
                Lampa.Noty.show('Ошибка при отправке запроса.');
                _this.onModalClose(true);
            });
        };
        
        /**
         * Вспомогательная функция для форматирования размера файла.
         * @param {number} bytes - Размер в байтах.
         * @returns {string}
         */
        this.formatSize = function (bytes) {
            if (!bytes) return '0 B';
            var i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
            return Math.round(bytes / Math.pow(1024, i), 2) + ' ' + ['B', 'KB', 'MB', 'GB', 'TB'][i];
        };

        /**
         * Обработчик закрытия модального окна.
         */
        this.onModalClose = function(force = false) {
            if(force) Lampa.Modal.close();
            Lampa.Api.abort();
            Lampa.Utils.putToBackground(false);
        };

        // Добавление стилей
        var style = document.createElement('style');
        style.innerHTML = `
            .torbox-item__cached { color: #4caf50; margin-left: 10px; }
            .online__item .online__info span { margin-right: 15px; }
            .empty { text-align: center; padding: 2em; font-size: 1.2em; color: #888; }
        `;
        document.head.appendChild(style);
    }

    // Инициализация плагина при старте Lampa
    if (window.appready) {
        var torbox = new Torbox();
        torbox.create();
    } else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') {
                var torbox = new Torbox();
                torbox.create();
            }
        });
    }

})();
