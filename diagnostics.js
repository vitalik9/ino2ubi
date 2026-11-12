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
    if ((m = message.match(/^#define\s+([A-Za-z_]\w*)/))) {
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
      advice = 'Используйте API, доступный в Arduino-ESP32 Core 2.0.17; проверьте параметры вызова.';
    } else if ((m = message.match(/^Функция\s+([A-Za-z_]\w*)/))) {
      idx = findByRegex(clean, new RegExp('\\b' + escapeRegex(m[1]) + '\\s*\\('));
      advice = 'Проверьте сигнатуру после экспорта в .ubi и передавайте параметры явно.';
    } else if (/^esp_now_(recv|send)_info_t/.test(message)) {
      idx = findByRegex(clean, /\besp_now_(recv|send)_info_t\b/);
      advice = 'Используйте сигнатуру обратного вызова для ESP32 Core 2.0.17.';
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
      advice = 'Используйте сигнатуру void onRecv(const uint8_t* mac, const uint8_t* data, int len).';
    } else if (/^ledcWrite\(\)/.test(message)) {
      idx = findByRegex(clean, /\bledcWrite\s*\(/);
      advice = 'Для Core 2.0.17 настройте канал через ledcSetup() и ledcAttachPin().';
    } else if (/^delay\(\)/.test(message)) {
      idx = findByRegex(clean, /\bdelay\s*\(/);
      advice = 'Используйте millis() и проверку прошедшего времени вместо блокирующей задержки.';
    } else if (/^Бесконечный цикл/.test(message)) {
      idx = findByRegex(clean, /\bwhile\s*\(\s*1\s*\)|\bfor\s*\(\s*;\s*;\s*\)/);
      advice = 'Цикл должен завершаться быстро, чтобы продолжилось выполнение остальных блоков.';
    } else if ((m = message.match(/^(?:Сложный )?while\(\) на строке (\d+):/))) {
      const number = Number(m[1]);
      const lines = code.split(/\r?\n/);
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
    } else if (/^Условная компиляция/.test(message)) {
      idx = findByRegex(code, /^[ \t]*#\s*(?:if|ifdef|ifndef)\b/m);
      advice = 'Убедитесь, что условные ветки и используемые макросы сохраняются после генерации.';
    } else if (/^Функциональные макросы/.test(message)) {
      idx = findByRegex(code, /^[ \t]*#\s*define\s+\w+\s*\(/m);
      advice = 'По возможности замените функциональный макрос безопасной вспомогательной функцией.';
    } else if (/^Библиотека ESP32_NOW/.test(message)) {
      idx = findByRegex(code, /ESP32_NOW\.h|\bESP_NOW_Peer\b/);
      advice = 'Используйте штатный <esp_now.h> или проверьте установленную версию сторонней библиотеки.';
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
    for (const severity of ['error', 'warning']) {
      for (const message of result[severity === 'error' ? 'errors' : 'warnings'] || []) {
        const place = locate(code, String(message));
        issues.push({ severity, message: String(message), ...place });
      }
    }
    return issues;
  }
  root.ino2ubiDiagnostics = { enrich, locate };
})(typeof window !== 'undefined' ? window : globalThis);
