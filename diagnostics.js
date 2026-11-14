/* Source location and human-readable advice for static ino2ubi checks.
 * These diagnostics do not compile the Arduino program. Locations are shown
 * only when the relevant source construct can be identified.
 */
(function (root) {
  'use strict';
  function escapeRegex(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function mask(code) {
    if (typeof maskNonCode === 'function') return maskNonCode(code);
    return String(code);
  }
  function findByRegex(code, pattern) {
    let m = pattern.exec(code);
    return m ? m.index : -1;
  }
  // Tailor advice to what the macro actually represents. Never assume that
  // an arbitrary numeric macro defines an array length.
  function numericDefineAdvice(code, name) {
    const escaped = escapeRegex(name);
    const directive = new RegExp('^[ \t]*#\\s*define\\s+' + escaped + '\\b([^\\r\\n]*)', 'm').exec(code);
    if (!directive) return 'Замените числовой макрос литералом или обычной переменной с пометкой // variable.';
    const raw = directive[1].replace(/\/\/.*$/, '').trim();
    const literal = /^[+\-]?(?:0[xX][0-9a-fA-F]+|0[bB][01]+|\d+(?:\.\d+)?)(?:[uUlLfF]*)$/.test(raw);
    const positiveInteger = /^(?:[1-9][0-9]*|0[xX][1-9a-fA-F][0-9a-fA-F]*|0[bB]1[01]*)$/.test(raw);
    const masked = mask(code).replace(/^[ \t]*#\s*define[^\n]*/gm,
      line => line.replace(/[^\n]/g, ' '));
    const usedAsArrayLength = new RegExp('\\b(?:static\\s+|const\\s+|volatile\\s+)*(?:bool|byte|char|int|long|float|double|String|size_t|u?int(?:8|16|32|64)_t|unsigned\\s+(?:int|long|char))\\s+[A-Za-z_]\\w*\\s*\\[\\s*' + escaped + '\\s*\\]').test(masked);
    const parameter = /\/\/\s*(?:par|parameter)\b/i.test(directive[1]);
    const timeName = /(?:MIN_PRD|PERIOD|INTERVAL|DELAY|TIMEOUT|_MS|TIMER)/i.test(name);
    const timeContext = timeName && new RegExp('(?:\\b(?:millis|micros)\\s*\\(|\\b\\w+\\s*-\\s*\\w+\\s*(?:>=|>|<=|<)\\s*)[\\s\\S]{0,120}\\b' + escaped + '\\b').test(masked);
    if (usedAsArrayLength) {
      if (positiveInteger) return 'Этот макрос задаёт размер массива: вместо [' + name + '] напишите [' + raw + ']. Если значение используется и в логике, храните его отдельно и не допускайте выхода за границы.';
      return 'Для массива вместо [' + name + '] укажите положительный целочисленный литерал в квадратных скобках; выражение размера проверьте вручную.';
    }
    if (timeContext || timeName) {
      const timeLiteral = literal && /^\d+$/.test(raw) ? raw + 'UL' : raw;
      if (literal) return 'Это временной интервал, не размер массива. Замените ' + name + ' на ' + timeLiteral + ' в сравнениях времени; для изменяемой настройки объявите unsigned long ' + name.toLowerCase() + ' = ' + timeLiteral + '; // variable.';
      return 'Это интервал времени, не размер массива. Задайте проверенное числовое значение непосредственно или через unsigned long с пометкой // variable.';
    }
    if (parameter) {
      if (literal) return 'Это параметр, не размер массива. Вместо #define объявите типизированную переменную с ' + raw + ' и пометкой // par; проверьте её тип и диапазон.';
      return 'Замените макрос на типизированный параметр // par с корректным выражением и допустимым типом.';
    }
    if (literal) return 'Это числовая константа, не обязательно размер массива. Вместо ' + name + ' используйте ' + raw + ' либо объявите обычную типизированную переменную // variable.';
    return 'Это числовое выражение, не обязательно размер массива. Перенесите вычисление в обычный C++ или типизированную переменную // variable; проверьте тип и приоритет операций.';
  }
  function locate(code, message) {
    const clean = mask(code);
    let m, idx = -1, advice = '';
    if ((m = message.match(/^(?:FlprogHardwarePwmPin|ModbusRTU)\s+([A-Za-z_]\w*)\.([A-Za-z_]\w*)\(\):/))) {
      // Find the exact member call, not the first occurrence of the class.
      idx = findByRegex(clean, new RegExp('\\b' + escapeRegex(m[1]) + '\\s*\\.\\s*' + escapeRegex(m[2]) + '\\s*\\('));
      advice = 'Проверьте название метода и сигнатуру в библиотеке FLProg, установленной в Arduino IDE.';
    } else if (/^Несколько вызовов initFlprogSystemTimer\(\)/.test(message)) {
      idx = findByRegex(clean, /\binitFlprogSystemTimer\s*\(/);
      advice = 'Flprog_HardwareTimer использует один callback; настройте один общий владелец таймера.';
    } else if (/^initFlprogSystemTimer\(\):/.test(message)) {
      idx = findByRegex(clean, /\binitFlprogSystemTimer\s*\(/);
    } else if (/^initFlprogSystemTimer\([A-Za-z_]\w*\): callback/.test(message)) {
      idx = findByRegex(clean, /\binitFlprogSystemTimer\s*\(/);
      advice = 'Определите void callback() до использования или подключите заголовок с его объявлением; проверяйте сгенерированный FLProg C++.';
    } else if (/^setFlprogSystemTimerTickPeriod(?:\(|\(\):)/.test(message)) {
      idx = findByRegex(clean, /\bsetFlprogSystemTimerTickPeriod\s*\(/);
      advice = 'Период должен быть в диапазоне 10…4294967295 мкс (uint32_t).';
    } else if (/^Используется initFlprogSystemTimer\(\)\/API/.test(message)) {
      idx = findByRegex(clean, /\binitFlprogSystemTimer\s*\(/);
      if(idx < 0) idx = findByRegex(clean, /\b(?:set|get)FlprogSystemTimerTickPeriod\s*\(/);
      advice = 'Добавьте #include <flprogSystemHardwareTimer.h>, если заголовок не подключается транзитивно.';
    } else if (/^ModbusRTU: абстрактный класс/.test(message)) {
      idx = findByRegex(clean, /\bModbusRTU\s+[A-Za-z_]\w*\s*(?:[;=(])/);
      advice = 'Нельзя создать объект ModbusRTU: используйте ModbusMasterRTU или ModbusSlaveRTU с действительным UART executor.';
    } else if ((m = message.match(/^FlprogHardwarePwmPin\s+([A-Za-z_]\w*): вызов tick/))) {
      idx = findByRegex(clean, new RegExp('\\bFlprogHardwarePwmPin\\s+' + escapeRegex(m[1]) + '\\s*\\('));
      advice = 'Обеспечьте периодические вызовы tick() для программного PWM; при ISR проверьте безопасность цифрового вывода.';
    } else if (/^flprog::specialPoll\(\)/.test(message)) {
      idx = findByRegex(clean, /\bflprog\s*::\s*specialPoll\s*\(/);
      advice = 'Используйте flprog::specialPool() (с одним l перед скобкой).';
    } else if ((m = message.match(/^Используется\s+(FlprogHardwarePwmPin|ModbusRTU|ModbusTCP), но нет явного #include/))) {
      idx = findByRegex(clean, new RegExp('\\b' + escapeRegex(m[1]) + '\\b'));
      advice = 'Добавьте подходящий #include или проверьте транзитивную зависимость в FLProg.';
    } else if ((m = message.match(/^Заголовок\s+(\S+)\s+(?:встречается|найден|отсутствует)/))) {
      idx = findByRegex(code, new RegExp('^[ \t]*#\\s*include\\s*[<\"]' + escapeRegex(m[1]) + '[>\"]', 'm'));
    } else if (/^Повторные #include:/.test(message)) {
      m = message.match(/^Повторные #include:\s*([^,\s.]+)/);
      if (m) idx = findByRegex(code, new RegExp('^[ \t]*#\\s*include\\s*[<\"]' + escapeRegex(m[1]) + '[>\"]', 'm'));
    } else if ((m = message.match(/^#define\s+([A-Za-z_]\w*)/))) {
      idx = findByRegex(code, new RegExp('^[ \t]*#\\s*define\\s+' + escapeRegex(m[1]) + '\\b', 'm'));
      advice = numericDefineAdvice(code, m[1]);
    } else if ((m = message.match(/^Массив\s+([A-Za-z_]\w*)\[([^\]]*)\]/))) {
      idx = findByRegex(clean, new RegExp('\\b' + escapeRegex(m[1]) + '\\s*\\[\\s*' + escapeRegex(m[2]) + '\\s*\\]'));
      advice = 'В объявлении массива укажите положительное целое число прямо в квадратных скобках.';
    } else if ((m = message.match(/^return внутри\s+(setup|loop)\(\)/))) {
      const func = new RegExp('\\bvoid\\s+' + m[1] + '\\s*\\(\\s*\\)\\s*\\{', 'g');
      let start = func.exec(clean);
      if (start) {
        let depth = 1, end = start.index + start[0].length;
        while (end < clean.length && depth) {
          if (clean[end] === '{') depth++;
          if (clean[end] === '}') depth--;
          end++;
        }
        // Avoid highlighting a lambda's return: nested returns are not errors.
        const body = clean.slice(start.index + start[0].length, end - 1);
        const candidate = /\breturn\b/g;
        let c;
        while ((c = candidate.exec(body))) {
          const before = body.slice(0, c.index);
          const lambda = /\[[^\]\n]*\]\s*(?:\([^()]*\)\s*)?(?:(?:mutable|constexpr|noexcept)\s*)*(?:->\s*[\w:<>,*&\s]+)?\{/g;
          let lm, inLambda = false;
          while ((lm = lambda.exec(before))) {
            let nesting = 1, p = lm.index + lm[0].length;
            while (p < body.length && nesting) {
              if (body[p] === '{') nesting++;
              else if (body[p] === '}') nesting--;
              p++;
            }
            if (lm.index < c.index && c.index < p) { inLambda = true; break; }
          }
          if (!inLambda) { idx = start.index + start[0].length + c.index; break; }
        }
      }
      advice = 'Вместо return используйте условие if/else, чтобы не прервать остальные блоки FLProg.';
    } else if ((m = message.match(/^([A-Za-z_]\w*)\(\):/))) {
      idx = findByRegex(clean, new RegExp('\\b' + escapeRegex(m[1]) + '\\s*\\('));
      advice = 'Используйте API, доступный в Arduino-ESP32 Core 3.3.11; проверьте параметры вызова.';
    } else if ((m = message.match(/^Функция\s+([A-Za-z_]\w*)/))) {
      idx = findByRegex(clean, new RegExp('\\b' + escapeRegex(m[1]) + '\\s*\\('));
      advice = 'Проверьте сигнатуру после экспорта в .ubi и передавайте параметры явно.';
    } else if (/^esp_now_(recv|send)_info_t/.test(message)) {
      idx = findByRegex(clean, /\besp_now_(recv|send)_info_t\b/);
      advice = 'Сверьте сигнатуру обратного вызова с esp_now.h вашего Core 3.3.11.';
    } else if (/^Обнаружен код ESP8266/.test(message)) {
      idx = findByRegex(code, /ESP8266WiFi\.h|ESP8266WebServer/);
      advice = 'Замените ESP8266 API на соответствующий ESP32 API.';
    } else if (/^В коде есть WiFi/.test(message)) {
      idx = findByRegex(clean, /\bWiFi\s*\./);
      advice = 'Добавьте #include <WiFi.h> в начало скетча.';
    } else if (/^Используется ESP-NOW без/.test(message)) {
      idx = findByRegex(clean, /\besp_now_\w+\s*\(/);
      advice = 'Добавьте #include <esp_now.h>.';
    } else if (/^ESP-NOW callback/.test(message)) {
      m = message.match(/^ESP-NOW callback\s+([A-Za-z_]\w*)/);
      if (m) idx = findByRegex(clean, new RegExp('\\b' + escapeRegex(m[1]) + '\\s*\\('));
      advice = /отправки/.test(message)
        ? 'Для Core 3.3.11 сверьте сигнатуру callback отправки с esp_now.h: первый параметр — структура с информацией об отправке, а не MAC-адрес.'
        : 'Для Core 3.3.11 используйте void onRecv(const esp_now_recv_info_t* info, const uint8_t* data, int len).';
    } else if ((m = message.match(/^(hallRead|esp_task_wdt_init)\(\):/))) {
      idx = findByRegex(clean, new RegExp('\\b' + m[1] + '\\s*\\('));
      advice = m[1] === 'hallRead'
        ? 'Уберите чтение датчика Холла: в Core 3.x функция отсутствует.'
        : 'Для Core 3.x передайте указатель на esp_task_wdt_config_t (см. esp_task_wdt.h) вместо (timeout, panic).';
    } else if (/^ledcWrite\(\)/.test(message)) {
      idx = findByRegex(clean, /\bledcWrite\s*\(/);
      advice = 'Для Core 3.3.11 используйте API ledcAttach() и ledcWrite() с номером GPIO; старые ledcSetup()/ledcAttachPin() удалены.';
    } else if (/^delay\(\)/.test(message)) {
      idx = findByRegex(clean, /\bdelay\s*\(/);
      advice = 'Используйте millis() и проверку прошедшего времени вместо блокирующей задержки.';
    } else if (/^Бесконечный цикл/.test(message)) {
      idx = findByRegex(clean, /\bwhile\s*\(\s*1\s*\)|\bfor\s*\(\s*;\s*;\s*\)/);
      advice = 'Цикл должен завершаться быстро, чтобы продолжилось выполнение остальных блоков.';
    } else if ((m = message.match(/^(?:Сложный )?while\(\) на строке (\d+):/))) {
      const number = Number(m[1]);
      // A-10: split on '\n' only (like every other branch) so a '\r' counts as
      // a character of its line and the cumulative offset matches code.slice().
      const lines = code.split('\n');
      if (number >= 1 && number <= lines.length) {
        idx = lines.slice(0, number - 1).reduce((n, line) => n + line.length + 1, 0);
        const local = lines[number - 1].search(/\bwhile\s*\(/);
        if (local >= 0) idx += local;
      }
      if (message.includes('не закрыта круглая скобка'))
        advice = 'Проверьте парные скобки условия while; затем снова нажмите «Парсить код».';
      else if (message.includes('постоянное истинное'))
        advice = 'Не оставляйте бесконечный while в общем коде блока; при необходимости используйте неблокирующий автомат состояний.';
      else if (message.startsWith('Сложный'))
        advice = 'Проверьте, что условие корректно перенесено в .ubi, цикл гарантированно заканчивается и не блокирует FLProg; при ожидании событий используйте проверку в loop() без while.';
      else advice = 'Убедитесь, что условие изменяется, а цикл быстро завершается; для ожидания событий обычно подходит if с сохранением состояния.';
    } else if ((m = message.match(/^Сетевой вызов ([A-Za-z_]\w*)\.([A-Za-z_]\w*)\(\) на строке (\d+):/))) {
      const lineNumber = Number(m[3]);
      const sourceLines = code.split('\n');
      const maskedLines = clean.split('\n');
      if (lineNumber >= 1 && lineNumber <= sourceLines.length) {
        idx = sourceLines.slice(0, lineNumber - 1).reduce((n, line) => n + line.length + 1, 0);
        const local = new RegExp('\\b' + escapeRegex(m[1]) + '\\s*(?:\\.|->)\\s*' + escapeRegex(m[2]) + '\\s*\\(').exec(maskedLines[lineNumber - 1]);
        if (local) idx += local.index;
      }
      advice = 'Если другие блоки должны работать непрерывно, вынесите ожидание сети в отдельную FreeRTOS-задачу с безопасной передачей результатов или используйте действительно неблокирующий клиент. Тайм-аут лишь ограничивает длительность ожидания и не делает вызов асинхронным.';
    } else if ((m = message.match(/^Несколько потенциально блокирующих сетевых вызовов в loop\(\) \(начиная со строки (\d+)\)/))) {
      const lineNumber = Number(m[1]);
      const sourceLines = code.split('\n');
      if (lineNumber >= 1 && lineNumber <= sourceLines.length) {
        idx = sourceLines.slice(0, lineNumber - 1).reduce((n, line) => n + line.length + 1, 0);
        const firstCall = /\b[A-Za-z_]\w*\s*(?:\.|->)\s*[A-Za-z_]\w*\s*\(/.exec(clean.split('\n')[lineNumber - 1]);
        if (firstCall) idx += firstCall.index;
      }
      advice = 'Несколько ожиданий сети внутри одного прохода loop() могут суммироваться. При требовании непрерывной работы вынесите сетевое взаимодействие из общего цикла (например, в отдельную задачу с безопасным обменом данными) и контролируйте тайм-ауты. Это предупреждение не блокирует экспорт.';
    } else if (/^При использовании отдельного bufferSize/.test(message)) {
      idx = findByRegex(clean, /\bbufferSize\b|\bBufferSize\b/);
      advice = 'Ограничьте предел фактической длиной массива; если размер всегда 32, используйте [32] и число 32.';
    } else if ((m = message.match(/^(?:Условная компиляция|Директива) #\w+ на строке (\d+)/))) {
      // A-04/A-05: new messages carry the exact line number.
      const lineNumber = Number(m[1]);
      const sourceLines = code.split('\n');
      if (lineNumber >= 1 && lineNumber <= sourceLines.length)
        idx = sourceLines.slice(0, lineNumber - 1).reduce((n, line) => n + line.length + 1, 0);
      advice = /^Условная/.test(message)
        ? 'Блок не может воспроизвести #if/#ifdef вне функций: оставьте нужную ветку и удалите директивы условной компиляции.'
        : 'Директивы вне верхней секции и #undef/#pragma/#error/#line не переносятся в .ubi: удалите их или перенесите #define/#include перед setup().';
    } else if (/^Условная компиляция/.test(message)) {
      idx = findByRegex(code, /^[ \t]*#\s*(?:if|ifdef|ifndef)\b/m);
      advice = 'Условные директивы внутри функций сохраняются как есть; проверьте результат после импорта.';
    } else if (/^Функциональн(?:ые|ый) макрос/.test(message)) {
      idx = findByRegex(code, /^[ \t]*#\s*define\s+\w+\(/m);
      advice = 'Проверьте, что #define NAME(x) остался без пробела между именем и скобкой; многострочные макросы запрещены.';
    } else if (/^Библиотека ESP32_NOW/.test(message)) {
      idx = findByRegex(code, /ESP32_NOW\.h|\bESP_NOW_Peer\b/);
      advice = 'Используйте штатный <esp_now.h> или проверьте установленную версию сторонней библиотеки.';
    } else if (/^Неподдерживаемый глобальный тип C\+\+/.test(message)) {
      idx = findByRegex(clean, /\b(?:long\s+long|(?:u?int64_t)|unsigned\s+(?:int|char|short)|signed\s+char|int8_t|size_t)\s+[*&\w]/);
      advice = 'Используйте поддерживаемый тип или переработайте объявление без изменения разрядности данных.';
    } else if (/^Глобальный указатель\/ссылка C\+\+/.test(message)) {
      idx = findByRegex(clean, /\b[A-Za-z_]\w*(?:::[A-Za-z_]\w*)*\s*[*&]+\s*(?:(?:const|volatile)\s+)?[A-Za-z_]\w*/);
      advice = 'Это сознательное ограничение: глобальные указатели и ссылки не изолируются по экземплярам блока. Защита сохранена; используйте локальные переменные или API FLProg.';
    } else if (/^Глобальный массив:/.test(message)) {
      idx = findByRegex(clean, /\b[A-Za-z_]\w*\s*\[[^\]\n]*\]\s*(?:=|;|\{)/);
      advice = 'Глобальные массивы пока не имеют гарантированного UUID.';
    } else if (/^Массивы объектов C\+\+/.test(message)) {
      // A-07: point at the object array, not at the first array of any kind.
      const objectArray = /^[ \t]*(?:(?:const|volatile)\s+)*([A-Za-z_]\w*(?:::[A-Za-z_]\w*)*)\s+[A-Za-z_]\w*\s*\[[^\]\n]*\]/gm;
      let oa;
      while ((oa = objectArray.exec(clean))) {
        if (!/^(?:int|long|short|char|bool|boolean|byte|float|double|unsigned|signed|size_t|String|u?int(?:8|16|32|64)_t)$/.test(oa[1])) { idx = oa.index; break; }
      }
      advice = 'Для каждого элемента массива объектов нужен собственный UUID; замените массив отдельными объектами с конструктором.';
    } else if (/^Глобальная static-переменная/.test(message)) {
      idx = findByRegex(clean, /^[ \t]*static\s+/m);
      advice = 'Уберите static у глобальной переменной (обычная глобальная получает UUID блока); static внутри функций допустим.';
    } else if ((m = message.match(/^Объект без аргументов конструктора \(([^)]*)\)/))) {
      const first = (m[1].match(/^[A-Za-z_]\w*(?:::[A-Za-z_]\w*)*\s+([A-Za-z_]\w*)/) || [])[1];
      if (first) idx = findByRegex(clean, new RegExp('\\b' + escapeRegex(first) + '\\b'));
      advice = 'Объекту нужны аргументы конструктора (Type name(args);), иначе UUID каждого экземпляра гарантировать нельзя; для классов без аргументов задайте их явно или создавайте объект в setup().';
    } else if ((m=message.match(/^Помеченное объявление ([A-Za-z_]\w*) не распознано/))) {
      idx = findByRegex(clean, new RegExp('\\b'+escapeRegex(m[1])+'\\b'));
      advice = 'Выберите поддерживаемый тип и повторно распарсьте скетч.';
    } else if (/^Глобальное объявление после начала setup\(\)\/loop\(\)/.test(message)) {
      // Find first global-looking declaration between the function bodies or after them.
      const fn = /\bvoid\s+(?:setup|loop)\s*\(\s*(?:void\s*)?\)\s*\{/g;
      const parts=[]; let fm;
      while((fm=fn.exec(clean))){let d=1,j=fn.lastIndex;while(j<clean.length&&d){if(clean[j]==='{')d++;else if(clean[j]==='}')d--;j++;}parts.push({start:fm.index,end:j});}
      if(parts.length===2){parts.sort((a,b)=>a.start-b.start);let segments=[[parts[0].end,parts[1].start],[parts[1].end,clean.length]];
        for(const [a,b] of segments){const r=/^\s*(?:(?:const|volatile|static)\s+)*[A-Za-z_]\w*(?:::[A-Za-z_]\w*)*\s+[A-Za-z_]\w*\s*(?:=|;|\[)/gm;const found=r.exec(clean.slice(a,b));if(found){idx=a+found.index+(found[0].match(/^\s*/)||[''])[0].length;break;}}
      }
      advice = 'Перенесите глобальное объявление перед setup() и повторите разбор.';
    } else if ((m=message.match(/^Незакрытая фигурная скобка функции (setup|loop)\(\)/))) {
      idx = findByRegex(clean,new RegExp('\\bvoid\\s+'+m[1]+'\\s*\\(\\s*(?:void\\s*)?\\)\\s*\\{'));
      advice = 'Закройте тело функции фигурной скобкой и повторите разбор.';
    } else if (/^Исходный код пуст/.test(message)) {
      advice = 'Вставьте Arduino-скетч в редактор и нажмите «Парсить код».';
    } else if (/^Не найдена функция void (setup|loop)/.test(message)) {
      advice = 'Добавьте соответствующую функцию void setup() {} или void loop() {}.';
    } else if (/^Повторяются названия входов/.test(message) || /^Псевдоним для/.test(message)) {
      advice = 'Проверьте имена входов и выходов на вкладке «Переменные»: каждому нужно уникальное допустимое имя C++.';
    } else if (/^Вход En уже есть/.test(message)) {
      advice = 'Выключите автоматическое добавление входа En в настройках блока.';
    }
    if (idx < 0) return { line: null, snippet: null, advice };
    const line = code.slice(0, idx).split('\n').length;
    const snippet = code.split(/\r?\n/)[line - 1].trim();
    return { line, snippet: snippet.length > 180 ? snippet.slice(0, 180) + '…' : snippet, advice };
  }
  function enrich(source, result) {
    const code = String(source || '');
    const issues = [];
    for (const severity of ['error', 'warning', 'info']) {
      for (const message of result[severity === 'error' ? 'errors' : (severity === 'warning' ? 'warnings' : 'infos')] || []) {
        const place = locate(code, String(message));
        issues.push({ severity, message: String(message), ...place });
      }
    }
    return issues;
  }
  root.ino2ubiDiagnostics = { enrich, locate };
})(typeof window !== 'undefined' ? window : globalThis);
