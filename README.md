# ino2ubi — GitHub Pages

Веб-версия ino2ubi v2.15 для FLProg 8 / ESP32 Arduino Core 2.0.17. Включает экспериментальный импорт RemoteXY (Wi-Fi, Access Point и Cloud). Код обрабатывается прямо в браузере.

## Публикация

1. Загрузите **содержимое этой папки** в корень публичного репозитория `ino2ubi` через **Add file → Upload files → Commit changes**.
2. В GitHub откройте **Settings → Pages → Build and deployment**.
3. Выберите **Deploy from a branch**, затем ветку **main**, папку **/(root)** и **Save**.
4. Адрес сайта: `https://ВАШ-ЛОГИН.github.io/ino2ubi/`.

## Использование

Откройте сайт, вставьте/загрузите Arduino-скетч, нажмите «Парсить код» либо «Парсить RemoteXY», затем «Сгенерировать .ubi и скачать».

Библиотека RemoteXY в среде FLProg/Arduino нужна отдельно. Компиляция AP и Cloud на реальном оборудовании ещё не подтверждена. При публичной публикации не загружайте скетчи с настоящими паролями и Cloud Token в репозиторий.
