# INO2UBI v2.16 RC2 — AUDIT FIX (проверяемый кандидат)

Основа: RC2 Code Professional / FLProg 9.8.6 / ESP32 Arduino Core 3.3.11.

Включены защитные исправления P0 и части замечаний HIGH/MEDIUM аудита: контроль глобальных указателей, ссылок, 64-битных типов, массивов, static, объявлений типов, объектов без конструктора; обнаружение некоторых потерянных аннотированных объявлений и зависимостей от порядка, поддержка setup(void)/loop(void), защита от некорректной подстановки членов объектов, дополнительная обработка callback, изоляция локальных переменных внутри блоков setup/loop, исправление подсказок Core 3.3.11.

Неподдерживаемые конструкции блокируются диагностикой вместо молчаливой порчи, что **сужает** область экспортируемого C++ относительно RC2. Полноценная поддержка произвольного C++ не заявлена. Некоторые сложные конструкции парсера могут оставаться непроверенными.

Проверено: синтаксис JS, тесты парсера и диагностики; GitHub Pages и полный экспорт в браузере не подтверждены; импорт/компиляция в FLProg 9.8.6 и испытания на ESP32 не выполнялись. Не заменять стабильную RC2 до подтверждения в целевой среде.


## Callback UUID fix (candidate)
- Helper function identifiers used as callback arguments or function-pointer values are UUID-tagged, not only direct calls.
- Namespace and member accesses remain unchanged.
- Validate with two FLProg instances under ESP32 Core 3.3.11.

## H2 String constructor UUID fix (candidate)
A global `String name("value");` is registered as per-instance C++ object, so the declaration and member accesses are UUID-tagged. The original Arduino API, include and object state remain unchanged. A real two-instance FLProg compilation is still required.


H3 candidate: original relative order of parsed global variables, statics and constructor declarations is retained in Professional declare code via declaration_order. Existing callback/H2 fixes retained. Reparse old .i2u.json projects with mixed declarations. Nested String constructors with ambiguous parsing are rejected. Browser export / FLProg 9.8.6 compilation must be confirmed by user.


## RC2 AUDIT FINAL CANDIDATE — 14.11.2026

- Сохранены исправления H1 (передача callback), H2 (UUID объектов String), H3 (порядок глобальных объявлений).
- C4: однострочные функциональные #define сохраняются как исходная директива; предупреждение уточнено, многострочные директивы блокируются.
- H5: сохранена защита обращений к членам объектов/namespace от ошибочной UUID-подстановки.
- Диагностика отличает числовые массивы от массивов объектов и указывает строки для проверенных случаев H4/H6/C2/C5/M5.
- Статус: кандидат. FLProg-компиляция именно этого ZIP и работа на ESP32 требуют подтверждения.


## FIXED A-01…A-13 (НЕ ИСПЫТАНО, не STABLE) — 14.11.2026

Исправления по `AUDIT_REPORT.md`. После правок тесты, браузерные прогоны и компиляция в FLProg 9.8.6 / на ESP32 **не выполнялись**. Версию нельзя считать стабильной.

- A-01: для всех хелперов в declare генерируются прототипы (значения параметров по умолчанию остаются только в прототипе).
- A-02: UUID получают объекты `Type n(args)`, `Type n{args}`, `Type n = expr` и все имена в списках `Type a(1), b(2);`; список безаргументных объектов (`Servo s1, s2;`) блокируется.
- A-03: массив внутри списка деклараторов (`int a=1, c[3];`) блокируется как глобальный массив.
- A-04/A-05: `#define`/`#include` после начала setup()/loop(), `#undef`, `#pragma` (кроме `once`), `#error`, `#warning`, `#line` и `#if/#ifdef/#else/#endif` вне функций блокируются с номером строки; внутри функций условные директивы сохраняются как есть.
- A-06: для Core 3.3.11 добавлены: проверка сигнатуры приёмного callback ESP-NOW (`const esp_now_recv_info_t*`), предупреждение о сигнатуре callback отправки, предупреждения об отсутствии `<WiFi.h>`/`<esp_now.h>`, `esp_task_wdt_init`, ошибка `hallRead`; подсказки Core 2.x удалены.
- A-07: строки для static, объектов без аргументов, массивов объектов (теперь указывает на объект) и `ledcWrite`.
- A-08: при открытии `.i2u.json` списки extra/static объявлений берутся из актуального разбора кода.
- A-09: ограничение на глобальные указатели сохранено, сообщение объясняет причину; предупреждение ESP8266 уточнено.
- A-10: исправлено смещение строки `while()` при CRLF.
- A-11: кириллица в имени блока транслитерируется в имени файла `.ubi`.
- A-12: внутренние ID блока выбираются через `crypto.getRandomValues` (диапазон и формат прежние).
- A-13: удалены неиспользуемые `crc32`/`zipFiles`; обновлены версия и комментарий в `esp32.js`.
