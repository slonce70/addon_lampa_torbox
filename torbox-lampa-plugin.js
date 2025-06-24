(function () {
    'use strict';

    function Torbox() {
        var _this = this;
        var api_key, proxy_url;

        this.create = function () {
            this.addSettings();

            // Инициализация компонента-парсера
            var component = new Lampa.Interaction.Component();

            component.on('start', this.start.bind(this));
            component.on('back', this.back.bind(this));

            Lampa.Component.add('torbox', component);
        };

        // Загрузка и обновление настроек
        this.loadSettings = function () {
            api_key = Lampa.Storage.get('torbox_api_key', '');
            proxy_url = Lampa.Storage.get('torbox_proxy_url', '');
        };

        // Старт работы парсера (вызывается Lampa)
        this.start = function (movie, callback) {
            this.loadSettings();

            if (!api_key || !proxy_url) {
                return Lampa.Noty.show('URL прокси и API-ключ TorBox должны быть указаны в настройках.');
            }

            // 'movie' содержит всю информацию о фильме
            var query = movie.imdb_id ? 'imdb:' + movie.imdb_id : (movie.title + ' ' + (movie.year || ''));
            var search_url = proxy_url + '/api/torrents/search?query=' + encodeURIComponent(query);

            Lampa.Api.get(search_url, {
                headers: { 'x-api-key': api_key }
            }, function (data) {
                if (data.data && data.data.torrents) {
                    var torrents = _this.processResults(data.data.torrents);
                    callback(torrents, false); // Передаем результаты в Lampa
                } else {
                    Lampa.Noty.show('Торренты не найдены.');
                    callback([]); // Возвращаем пустой массив
                }
            }, function (err) {
                Lampa.Noty.show('Ошибка поиска TorBox: ' + (err.statusText || 'Недоступен прокси-сервер'));
                callback([]);
            });
        };

        // Форматирование результатов для Lampa
        this.processResults = function(torrents) {
            return torrents.map(function(torrent) {
                var info = [];
                if(torrent.cached) info.push('Кэш');
                info.push(_this.formatSize(torrent.size));
                info.push('S:' + (torrent.last_known_seeders || 0));
                info.push('P:' + (torrent.last_known_peers || 0));
                
                return {
                    title: torrent.raw_title,
                    info: info.join(' | '),
                    size: torrent.size,
                    magnet: torrent.magnet,
                    // Добавляем кастомные поля для дальнейшей обработки
                    _torbox: {
                        id: torrent.id,
                        cached: torrent.cached,
                    }
                };
            });
        };
        
        // Обработка выбора торрента
        this.onTorrentSelect = function(torrent_data, call_callback) {
            if (torrent_data._torbox.cached) {
                // Если торрент кэширован, получаем список файлов
                Lampa.Noty.show('Запрос файлов из кэша...');
                var list_url = proxy_url + '/api/torrents'; // Endpoint для получения списка торрентов

                Lampa.Api.get(list_url, {
                    headers: { 'x-api-key': api_key, 'bypass-cache': 'true' }
                }, function(response) {
                    var full_torrent = response.data.find(function(t) { return t.id.toString() === torrent_data._torbox.id.toString(); });
                    if (full_torrent && full_torrent.files) {
                        // Показываем список файлов для выбора
                        var files = full_torrent.files.map(function(file) {
                            return {
                                title: file.name,
                                size: file.size,
                                _torbox_file_id: file.id
                            };
                        });
                        files.sort(function(a, b) { return b.size - a.size; });
                        
                        // Используем Lampa.Select для выбора файла
                        Lampa.Select.show({
                            title: 'Выберите файл',
                            items: files,
                            onSelect: function(selected_file) {
                                Lampa.Noty.show('Получение ссылки на файл...');
                                _this.getStreamLink(torrent_data._torbox.id, selected_file._torbox_file_id, call_callback);
                            },
                            onBack: function() { Lampa.Controller.toggle('content'); }
                        });

                    } else {
                        // Если файлов нет, но торрент кэширован, пытаемся скачать как zip
                         _this.getStreamLink(torrent_data._torbox.id, null, call_callback);
                    }
                });

            } else {
                // Если не кэширован, добавляем на скачивание
                Lampa.Noty.show('Торрент не кэширован. Добавляем в загрузки TorBox...');
                var add_url = proxy_url + '/api/torrents';
                
                var formData = new FormData();
                formData.append('magnet', torrent_data.magnet);

                var xhr = new XMLHttpRequest();
                xhr.open('POST', add_url, true);
                xhr.setRequestHeader('x-api-key', api_key);
                xhr.onload = function() {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        var res = JSON.parse(xhr.responseText);
                        if (res.success) Lampa.Noty.show('Торрент успешно добавлен!');
                        else Lampa.Noty.show('Ошибка: ' + (res.error || res.detail));
                    } else {
                        Lampa.Noty.show('Ошибка сервера при добавлении торрента.');
                    }
                };
                xhr.send(formData);
                Lampa.Controller.toggle('content'); // Возвращаемся к карточке фильма
            }
        };

        this.getStreamLink = function(torrent_id, file_id, call_callback) {
             var link_url = proxy_url + '/api/torrents/download?torrent_id=' + torrent_id + (file_id ? '&file_id=' + file_id : '&zip_link=true');
             Lampa.Api.get(link_url, { headers: { 'x-api-key': api_key } }, function(response) {
                 if (response.success && (response.data.data || response.data)) {
                     // Передаем URL в коллбэк, который запустит плеер
                     call_callback({
                         url: response.data.data || response.data
                     });
                 } else {
                     Lampa.Noty.show('Не удалось получить ссылку на стрим.');
                 }
             });
        };

        // Метод для добавления в список источников
        this.addFilter = function() {
            Lampa.Filter.add('torrents', {
                title: 'TorBox',
                name: 'torbox',
                onSelect: this.onTorrentSelect.bind(this),
                onBack: this.back.bind(this)
            });
        };

        this.back = function() {
            Lampa.Controller.toggle('content');
        };

        this.formatSize = function (bytes) {
            if (!bytes || bytes === 0) return '0 B';
            var i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
            return Math.round(bytes / Math.pow(1024, i), 2) + ' ' + ['B', 'KB', 'MB', 'GB', 'TB'][i];
        };
        
        // Добавление настроек
        this.addSettings = function() {
            var component_name = 'torbox_settings_component';
            if (Lampa.Component.exist(component_name)) return;

            Lampa.Component.add(component_name, {
                template: '<div></div>',
                create: function() {}
            });
            
            var addParam = function(options) {
                var field = Lampa.Template.get('settings_' + options.param.type, options.field);
                var input = field.find('input, textarea');
                input.on('change', function() { options.onChange(this.type === 'checkbox' ? this.checked : this.value); });
                Lampa.Settings.add(options.param.name, field, component_name);
            };

            addParam({
                component: component_name,
                param: { name: 'torbox_proxy_url', type: 'input', value: _this.settings.proxy_url, placeholder: 'https://proxy.example.com' },
                field: { name: 'URL прокси', description: 'Адрес вашего прокси-сервера' },
                onChange: function(value) { Lampa.Storage.set('torbox_proxy_url', value); }
            });

             addParam({
                component: component_name,
                param: { name: 'torbox_api_key', type: 'input', value: _this.settings.api_key, placeholder: 'Ваш API ключ' },
                field: { name: 'TorBox API-ключ', description: 'Ключ от вашего аккаунта torbox.app' },
                onChange: function(value) { Lampa.Storage.set('torbox_api_key', value); }
            });

             addParam({
                component: component_name,
                param: { name: 'torbox_show_cached_only', type: 'checkbox', value: _this.settings.show_cached_only },
                field: { name: 'Только кэшированные'},
                onChange: function(value) { Lampa.Storage.set('torbox_show_cached_only', value); }
            });

            this.addFilter();
        };
    }

    new Torbox().start();

})();
