(function () {
    'use strict';

    /**
     * Основной класс плагина TorBox для Lampa.
     * Этот плагин обеспечивает интеграцию с сервисом torbox.app для поиска
     * и воспроизведения торрентов прямо из интерфейса Lampa.
     */
    function Torbox() {
        var _this = this;

        // URL API TorBox
        this.API_BASE = 'https://api.torbox.app/v1/api/';
        this.API_SEARCH_BASE = 'https://search-api.torbox.app/';

        // Настройки плагина
        this.settings = {
            api_key: '',
            show_cached_only: false
        };

        /**
         * Инициализация плагина.
         * Вызывается при старте Lampa.
         */
        this.create = function () {
            // Загрузка сохраненных настроек
            this.loadSettings();

            // Добавление обработчика для активации плагина на страницах с фильмами
            Lampa.Listener.follow('activity', function (e) {
                if (e.type === 'movie' || e.type === 'serial') {
                    _this.buildUI(e.object);
                }
            });

            // Добавление настроек в панель Lampa
            this.addSettings();
        };

        /**
         * Загрузка настроек из локального хранилища Lampa.
         */
        this.loadSettings = function () {
            _this.settings.api_key = Lampa.Storage.get('torbox_api_key', '');
            _this.settings.show_cached_only = Lampa.Storage.get('torbox_show_cached_only', false);
        };

        /**
         * Добавление полей настроек в интерфейс Lampa.
         */
        this.addSettings = function () {
            var settings_field = Lampa.Template.get('settings_input', {
                title: 'TorBox API-ключ',
                placeholder: 'Введите ваш API-ключ от torbox.app'
            });

            var field = settings_field.find('input');
            field.val(_this.settings.api_key);
            field.on('change', function () {
                _this.settings.api_key = field.val();
                Lampa.Storage.set('torbox_api_key', _this.settings.api_key);
            });
            
            var cached_only_field = Lampa.Template.get('settings_checkbox', {
                title: 'Показывать только кэшированные',
                name: 'torbox_show_cached_only'
            });

            cached_only_field.find('input').prop('checked', _this.settings.show_cached_only).on('change', function () {
                _this.settings.show_cached_only = $(this).is(':checked');
                Lampa.Storage.set('torbox_show_cached_only', _this.settings.show_cached_only);
            });
            
            Lampa.Settings.add({
                tag: 'torbox',
                name: 'TorBox',
                type: 'content',
                content: settings_field.append(cached_only_field)
            });
        };

        /**
         * Встраивание кнопки TorBox в интерфейс карточки фильма.
         * @param {object} card - Объект карточки фильма Lampa.
         */
        this.buildUI = function (card) {
            var button = $('<div class="card-more__button selector"><span>TorBox</span></div>');
            button.on('click', function () {
                if (!_this.settings.api_key) {
                    return Lampa.Noty.show('API-ключ TorBox не указан в настройках плагина.');
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
                onBack: function onBack() {
                    Lampa.Modal.close();
                    Lampa.Api.abort();
                    Lampa.Utils.putToBackground(false);
                }
            });

            // Формирование запроса: сначала по IMDB ID, если он есть, иначе по названию.
            var query = card.data.imdb_id ? 'imdb:' + card.data.imdb_id : card.data.title;
            var url = _this.API_SEARCH_BASE + 'torrents/search/' + encodeURIComponent(query);
            
            Lampa.Api.get(url, {
                headers: {
                    'Authorization': 'Bearer ' + _this.settings.api_key
                }
            }, function (data) {
                if (data.data && data.data.torrents) {
                    _this.displayResults(data.data.torrents, card);
                } else {
                    Lampa.Noty.show('Торренты не найдены.');
                    Lampa.Modal.close();
                    Lampa.Utils.putToBackground(false);
                }
            }, function (err) {
                Lampa.Noty.show('Ошибка поиска в TorBox: ' + (err.status_text || 'Неизвестная ошибка'));
                Lampa.Modal.close();
                Lampa.Utils.putToBackground(false);
            });
        };
        
        /**
         * Отображение результатов поиска в модальном окне.
         * @param {Array} torrents - Массив торрентов от API TorBox.
         * @param {object} card - Объект карточки фильма.
         */
        this.displayResults = function (torrents, card) {
            var list = $('<div class="torbox-results"></div>');

            // Фильтрация и сортировка
            var filtered = _this.settings.show_cached_only ? torrents.filter(t => t.cached) : torrents;

            filtered.sort(function (a, b) {
                if (a.cached && !b.cached) return -1;
                if (!a.cached && b.cached) return 1;
                return (b.last_known_seeders || 0) - (a.last_known_seeders || 0);
            });
            
            if (filtered.length === 0) {
                 list.append('<div class="empty">Ничего не найдено</div>');
            }

            filtered.forEach(function (torrent) {
                var cached_html = torrent.cached ? '<span class="torbox-item__cached">[Кэш]</span>' : '';
                var item = $(`
                    <div class="torbox-item selector">
                        <div class="torbox-item__title">${torrent.raw_title} ${cached_html}</div>
                        <div class="torbox-item__details">
                            <span>${_this.formatSize(torrent.size)}</span>
                            <span>S: ${torrent.last_known_seeders || 0}</span>
                            <span>P: ${torrent.last_known_peers || 0}</span>
                        </div>
                    </div>
                `);

                item.on('click', function () {
                    if (torrent.cached) {
                        _this.getDownloadLink(torrent.id);
                    } else {
                        _this.addToDownloads(torrent.magnet);
                    }
                });
                list.append(item);
            });

            Lampa.Modal.update({
                title: 'Результаты TorBox',
                html: list,
                size: 'medium',
                onBack: function onBack() {
                    Lampa.Modal.close();
                    Lampa.Utils.putToBackground(false);
                }
            });
        };

        /**
         * Получение прямой ссылки на файл для кэшированного торрента.
         * @param {string} torrentId - ID торрента в TorBox.
         */
        this.getDownloadLink = function (torrentId) {
            Lampa.Noty.show('Получение ссылки на файл...');
            var url = _this.API_BASE + 'torrents/requestdl?torrent_id=' + torrentId;

            Lampa.Api.get(url, {
                headers: {
                    'Authorization': 'Bearer ' + _this.settings.api_key
                }
            }, function (response) {
                if (response.success && response.data) {
                    Lampa.Player.play({
                        url: response.data
                    });
                    Lampa.Modal.close();
                    Lampa.Utils.putToBackground(false);
                } else {
                    Lampa.Noty.show('Не удалось получить ссылку: ' + (response.error || ''));
                }
            }, function () {
                Lampa.Noty.show('Ошибка при запросе ссылки на файл.');
            });
        };
        
        /**
         * Добавление некэшированного торрента в загрузки TorBox.
         * @param {string} magnet - Magnet-ссылка торрента.
         */
        this.addToDownloads = function (magnet) {
            Lampa.Noty.show('Добавление в загрузки TorBox...');
            var url = _this.API_BASE + 'torrents/createtorrent';

            Lampa.Api.post(url, {
                magnet: magnet
            }, {
                headers: {
                    'Authorization': 'Bearer ' + _this.settings.api_key
                }
            }, function (response) {
                if (response.success) {
                    Lampa.Noty.show('Торрент успешно добавлен в загрузки!');
                } else {
                    Lampa.Noty.show('Ошибка: ' + (response.error || 'не удалось добавить торрент.'));
                }
                Lampa.Modal.close();
                Lampa.Utils.putToBackground(false);
            }, function () {
                Lampa.Noty.show('Ошибка при отправке запроса на добавление торрента.');
                Lampa.Modal.close();
                Lampa.Utils.putToBackground(false);
            });
        };

        /**
         * Вспомогательная функция для форматирования размера файла.
         * @param {number} bytes - Размер в байтах.
         * @returns {string} - Отформатированная строка.
         */
        this.formatSize = function (bytes) {
            if (bytes === 0) return '0 B';
            var i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
            return Math.round(bytes / Math.pow(1024, i), 2) + ' ' + ['B', 'KB', 'MB', 'GB', 'TB'][i];
        };

        // Добавление стилей для плагина
        var style = document.createElement('style');
        style.innerHTML = `
            .torbox-results { padding: 1em; }
            .torbox-item {
                padding: 10px;
                border-radius: 8px;
                background-color: rgba(255, 255, 255, 0.05);
                margin-bottom: 10px;
                cursor: pointer;
            }
            .torbox-item:hover {
                 background-color: rgba(255, 255, 255, 0.1);
            }
            .torbox-item__title {
                font-weight: bold;
                margin-bottom: 5px;
            }
            .torbox-item__cached {
                color: #4caf50; /* Зеленый цвет для кэшированных */
                margin-left: 10px;
            }
            .torbox-item__details {
                font-size: 0.9em;
                color: #ccc;
                display: flex;
                gap: 15px;
            }
            .empty {
                text-align: center;
                padding: 2em;
                font-size: 1.2em;
                color: #888;
            }
        `;
        document.head.appendChild(style);
    }

    // Создание и запуск экземпляра плагина
    var torbox = new Torbox();
    torbox.create();

})();
