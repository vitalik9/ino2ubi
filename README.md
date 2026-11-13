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
