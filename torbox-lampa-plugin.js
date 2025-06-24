(function () {
    'use strict';

    /**
     * Основной класс плагина TorBox для Lampa.
     * Этот плагин обеспечивает интеграцию с сервисом torbox.app для поиска,
     * выбора файлов и воспроизведения торрентов прямо из интерфейса Lampa.
     */
    function Torbox() {
        var _this = this;

        // Настройки плагина со значениями по умолчанию
        this.settings = {
            api_key: '',
            proxy_url: '', // URL вашего прокси-сервера
            show_cached_only: false
        };
        
        // Переменная для хранения последнего поискового запроса, чтобы не делать лишних вызовов
        this.last_search_query = '';

        /**
         * Инициализация плагина.
         */
        this.start = function () {
            // Ждем полной готовности Lampa перед инициализацией
            Lampa.Listener.follow('app', function (e) {
                if (e.type === 'ready') {
                    _this.loadSettings();
                    _this.addSettings();
                    
                    // Добавляем обработчик для встраивания UI в карточки
                    Lampa.Listener.follow('activity', function (e) {
                        if (e.type === 'movie' || e.type === 'serial') {
                            _this.buildUI(e.object);
                        }
                    });
                }
            });
        };

        /**
         * Загрузка настроек из локального хранилища Lampa.
         */
        this.loadSettings = function () {
            this.settings.api_key = Lampa.Storage.get('torbox_api_key', '');
            this.settings.proxy_url = Lampa.Storage.get('torbox_proxy_url', '');
            this.settings.show_cached_only = Lampa.Storage.get('torbox_show_cached_only', false);
        };
        
        /**
         * Создание и добавление настроек плагина в Lampa.
         * Используется современный и правильный подход через Lampa.Component и Lampa.SettingsApi.
         */
        this.addSettings = function () {
            var component_name = 'torbox_settings_component';

            // 1. Создаем компонент для наших настроек
            Lampa.Component.add(component_name, {
                template: '<div></div>', // Пустой контейнер
                create: function() {}
            });

            // 2. Добавляем параметры в созданный компонент
            Lampa.SettingsApi.addParam({
                component: component_name,
                param: { name: 'proxy_url', type: 'input', value: _this.settings.proxy_url, placeholder: 'https://my-proxy.vercel.app' },
                field: { name: 'URL прокси', description: 'Адрес вашего прокси-сервера для запросов к TorBox API' },
                onChange: function(value) {
                    _this.settings.proxy_url = value;
                    Lampa.Storage.set('torbox_proxy_url', value);
                }
            });

            Lampa.SettingsApi.addParam({
                component: component_name,
                param: { name: 'api_key', type: 'input', value: _this.settings.api_key, placeholder: 'Введите ваш API-ключ' },
                field: { name: 'TorBox API-ключ', description: 'Ключ можно получить в настройках вашего аккаунта torbox.app' },
                onChange: function(value) {
                    _this.settings.api_key = value;
                    Lampa.Storage.set('torbox_api_key', value);
                }
            });
            
            Lampa.SettingsApi.addParam({
                component: component_name,
                param: { name: 'show_cached_only', type: 'checkbox', value: _this.settings.show_cached_only, "default": false },
                field: { name: 'Только кэшированные', description: 'Показывать только те торренты, которые доступны для немедленного просмотра' },
                onChange: function(value) {
                    _this.settings.show_cached_only = value;
                    Lampa.Storage.set('torbox_show_cached_only', value);
                }
            });

            // 3. Добавляем наш компонент как новый раздел в главные настройки
            Lampa.Settings.add({
                tag: 'torbox',
                name: 'TorBox',
                type: 'component',
                component: component_name,
                icon: 't'
            });
        };

        /**
         * Встраивание кнопки в интерфейс карточки фильма.
         * @param {object} card - Объект карточки фильма Lampa.
         */
        this.buildUI = function (card) {
            // Используем Lampa.Template для создания кнопки
            var button = $(Lampa.Template.get('button_more', {title: 'TorBox'}).render());

            button.on('click', function () {
                if (!_this.settings.api_key || !_this.settings.proxy_url) {
                    return Lampa.Noty.show('URL прокси и API-ключ TorBox должны быть указаны в настройках.');
                }
                _this.search(card);
            });
            card.activity.render().find('.card-more').append(button);
        };

        /**
         * Поиск торрентов через прокси-сервер.
         * @param {object} card - Объект карточки фильма Lampa.
         */
        this.search = function (card) {
            Lampa.Utils.putToBackground(true);
            var query = card.data.imdb_id ? 'imdb:' + card.data.imdb_id : card.data.title;
            this.last_search_query = query;

            Lampa.Modal.open({
                title: 'TorBox - Поиск',
                html: Lampa.Template.get('loader').render(),
                size: 'medium',
                onBack: _this.onModalClose
            });

            var url = this.settings.proxy_url + '/api/torrents/search?query=' + encodeURIComponent(query);

            Lampa.Api.get(url, {
                headers: { 'x-api-key': this.settings.api_key }
            }, function (data) {
                // Убедимся, что результаты соответствуют последнему запросу
                if (_this.last_search_query !== query) return;

                if (data.data && data.data.torrents) {
                    _this.displayResults(data.data.torrents);
                } else {
                    Lampa.Noty.show('Торренты не найдены.');
                    _this.onModalClose(true);
                }
            }, function (err) {
                Lampa.Noty.show('Ошибка поиска: ' + (err.statusText || 'Сервер прокси недоступен'));
                _this.onModalClose(true);
            });
        };

        /**
         * Отображение результатов поиска в стандартном шаблоне Lampa.
         * @param {Array} torrents - Массив торрентов.
         */
        this.displayResults = function (torrents) {
            var filtered = this.settings.show_cached_only ? torrents.filter(function(t) { return t.cached; }) : torrents;

            filtered.sort(function (a, b) {
                if (a.cached && !b.cached) return -1;
                if (!a.cached && b.cached) return 1;
                return (b.last_known_seeders || 0) - (a.last_known_seeders || 0);
            });
            
            var online = Lampa.Object.clone(Lampa.Tpl.get.call(this, 'online', {}));
                online.find('.online__content').empty();
            
            if (filtered.length === 0) {
                online.find('.online__content').append('<div class="empty">Ничего не найдено</div>');
            }

            filtered.forEach(function (torrent) {
                var cached_html = torrent.cached ? '<span class="torbox-item__cached">[Кэш]</span>' : '';
                var item_html = '<div class="online__item selector" style="height: auto; padding: 10px 15px;">' +
                                    '<div class="online__title" style="white-space: normal; height: auto; max-height: none; line-height: 1.4;">' + torrent.raw_title + ' ' + cached_html + '</div>' +
                                    '<div class="online__info" style="margin-top: 5px;">' +
                                        '<span>' + _this.formatSize(torrent.size) + '</span>' +
                                        '<span>S: ' + (torrent.last_known_seeders || 0) + '</span>' +
                                        '<span>P: ' + (torrent.last_known_peers || 0) + '</span>' +
                                    '</div>' +
                                '</div>';

                var item_element = $(item_html);
                item_element.on('click', function () { _this.handleTorrentClick(torrent); });
                online.find('.online__content').append(item_element);
            });
            
            Lampa.Modal.update({title: 'Результаты TorBox', html: online });
        };
        
        /**
         * Обработка клика по торренту.
         * @param {object} torrent - Объект торрента.
         */
        this.handleTorrentClick = function(torrent) {
             if (torrent.cached) {
                this.getFiles(torrent.id);
            } else {
                this.addToDownloads(torrent);
            }
        };

        /**
         * Получение и отображение списка файлов для торрента.
         * @param {string} torrentId - ID торрента.
         */
        this.getFiles = function(torrentId) {
            Lampa.Modal.update({ html: Lampa.Template.get('loader').render() });
            
            Lampa.Api.get(this.settings.proxy_url + '/api/torrents', { headers: { 'x-api-key': this.settings.api_key, 'bypass-cache': 'true' } }, function(data) {
                var torrentData = data.data.find(function(t) { return t.id.toString() === torrentId.toString(); });
                if (torrentData && torrentData.files && torrentData.files.length > 1) {
                     _this.displayFiles(torrentData);
                } else {
                     _this.getDownloadLink(torrentId, torrentData && torrentData.files ? torrentData.files[0].id : null);
                }
            }, function() {
                 Lampa.Noty.show('Не удалось получить список файлов, скачиваем торрент целиком.');
                 _this.getDownloadLink(torrentId, null);
            });
        };

        /**
         * Отображение списка файлов в торренте.
         * @param {object} torrent - Объект торрента с файлами.
         */
        this.displayFiles = function(torrent) {
            var content = Lampa.Template.get('online', { title: 'Файлы в торренте' });
            content.find('.online__content').empty();
            
            torrent.files.sort(function(a,b){ return b.size - a.size; });

            torrent.files.forEach(function(file) {
                 var file_item = $(
                    '<div class="online__item selector">' +
                        '<div class="online__title">' + file.name + '</div>' +
                        '<div class="online__info">' + _this.formatSize(file.size) + '</div>' +
                    '</div>'
                 );
                 file_item.on('click', function() { _this.getDownloadLink(torrent.id, file.id); });
                 content.find('.online__content').append(file_item);
            });

            Lampa.Modal.update({ html: content });
        };
        
        /**
         * Получение прямой ссылки на файл и запуск плеера.
         * @param {string} torrentId - ID торрента.
         * @param {string} [fileId] - ID файла. Если не указан, скачивается весь торрент.
         */
        this.getDownloadLink = function (torrentId, fileId) {
            Lampa.Noty.show('Получение ссылки на файл...');
            var url = this.settings.proxy_url + '/api/torrents/download?torrent_id=' + torrentId + (fileId ? '&file_id=' + fileId : '&zip_link=true');

            Lampa.Api.get(url, { headers: { 'x-api-key': this.settings.api_key } }, function (response) {
                if (response.success && response.data) {
                    var stream_url = response.data.data || response.data; // Совместимость с разными форматами ответа
                    Lampa.Player.play({ url: stream_url, title: "TorBox Stream" });
                    _this.onModalClose(true);
                } else {
                    Lampa.Noty.show('Не удалось получить ссылку: ' + (response.error || 'неизвестная ошибка'));
                }
            }, function () { Lampa.Noty.show('Ошибка при запросе ссылки на файл.'); });
        };

        /**
         * Добавление торрента в загрузки TorBox.
         * @param {object} torrent - Объект торрента.
         */
        this.addToDownloads = function (torrent) {
            Lampa.Noty.show('Добавление в загрузки...');
            var url = this.settings.proxy_url + '/api/torrents';
            
            var formData = new FormData();
            formData.append('magnet', torrent.magnet);
            
            var xhr = new XMLHttpRequest();
            xhr.open('POST', url, true);
            xhr.setRequestHeader('x-api-key', _this.settings.api_key);
            
            xhr.onload = function () {
                var response;
                try {
                    response = JSON.parse(xhr.responseText);
                } catch (e) {
                    Lampa.Noty.show('Ошибка ответа сервера.');
                    return;
                }
                
                if (xhr.status >= 200 && xhr.status < 300 && response.success) {
                    Lampa.Noty.show('Торрент успешно добавлен!');
                } else {
                    Lampa.Noty.show('Ошибка добавления: ' + (response.error || response.detail || 'неизвестная ошибка.'));
                }
                _this.onModalClose(true);
};

            xhr.onerror = function () {
                 Lampa.Noty.show('Сетевая ошибка при отправке запроса.');
                _this.onModalClose(true);
            };
            
            xhr.send(formData);
        };
        
        /**
         * Форматирование размера файла.
         * @param {number} bytes - Размер в байтах.
         * @returns {string}
         */
        this.formatSize = function (bytes) {
            if (!bytes || bytes === 0) return '0 B';
            var i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
            return Math.round(bytes / Math.pow(1024, i), 2) + ' ' + ['B', 'KB', 'MB', 'GB', 'TB'][i];
        };

        /**
         * Закрытие модального окна и сброс состояния.
         */
        this.onModalClose = function(force) {
            if(force) Lampa.Modal.close();
            Lampa.Api.abort();
            Lampa.Utils.putToBackground(false);
            this.last_search_query = '';
        };

        var style = document.createElement('style');
        style.innerHTML = `
            .torbox-item__cached { color: #4caf50; font-weight: bold; }
            .online__item .online__info span { margin-right: 15px; }
            .empty { text-align: center; padding: 2em; font-size: 1.2em; color: #888; }
        `;
        document.head.appendChild(style);
    }
    
    // Запускаем плагин
    new Torbox().start();

})();
