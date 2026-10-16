/* Preflight for ESP32 Arduino core 2.0.17 (ESP-IDF 4.4.7).
 * Run on source, before any conversion. Never silently rewrite an API.
 * Static diagnostics are advisory: they do not replace a C++ compilation.
 */
(function (root) {
  'use strict';

  const TARGET = Object.freeze({ board: 'ESP32', core: '2.0.17', id: 'esp32-arduino-2.0.17' });

  // Keep lengths/positions of code and replace comments, quotes and char literals.
  function maskNonCodeSafe(code) {
    if (typeof maskNonCode === 'function') return maskNonCode(code);
    let out = '', i = 0, mode = 'code', escaped = false;
    while (i < code.length) {
      const ch = code[i], next = code[i + 1];
      if (mode === 'line') {
        if (ch === '\n') {out += '\n'; mode = 'code';} else out += ' ';
        i++; continue;
      }
      if (mode === 'block') {
        if (ch === '*' && next === '/') { out += '  '; i += 2; mode = 'code'; }
        else {out += ch === '\n' ? '\n' : ' '; i++;}
        continue;
      }
      if (mode === 'string' || mode === 'char') {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if ((mode === 'string' && ch === '"') || (mode === 'char' && ch === "'")) mode = 'code';
        out += ch === '\n' ? '\n' : ' '; i++; continue;
      }
      if (ch === '/' && next === '/') {out += '  '; i += 2; mode = 'line'; continue;}
      if (ch === '/' && next === '*') {out += '  '; i += 2; mode = 'block'; continue;}
      if (ch === '"' || ch === "'") {mode = ch === '"' ? 'string' : 'char'; out += ' '; i++; continue;}
      out += ch; i++;
    }
    return out;
  }

  // Count top-level arguments in each call to a named function.
  // Masked input preserves nested parentheses, but ignores comment/string commas.
  function callArgumentCounts(masked, name) {
    const re = new RegExp('\\b' + name + '\\s*\\(', 'g');
    const results = [];
    let match;
    while ((match = re.exec(masked)) !== null) {
      let pos = re.lastIndex, depth = 1, count = 1, any = false;
      while (pos < masked.length && depth) {
        const ch = masked[pos++];
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if (ch === ',' && depth === 1) count++;
        else if (!/\s/.test(ch) && depth === 1) any = true;
      }
      if (!depth) results.push({ count: any ? count : 0, offset: match.index });
      re.lastIndex = pos;
    }
    return results;
  }

  // Identify synchronous network operations in user code. They are legal C++,
  // but running them inside the shared FLProg setup()/loop() can delay other blocks.
  // Only inspect calls on declared WiFiClient / WiFiClientSecure / HTTPClient
  // instances to avoid confusing unrelated objects with network clients.
  function checkBlockingNetworkCalls(source) {
    const code = String(source || '');
    const clean = maskNonCodeSafe(code);
    const instances = new Map();
    const definitions = /\b(?:WiFiClientSecure|WiFiClient|HTTPClient)\s*\*?\s*([A-Za-z_]\w*)\s*(?=[;=(])/g;
    let definition;
    while ((definition = definitions.exec(clean))) {
      const type = definition[0].match(/\b(WiFiClientSecure|WiFiClient|HTTPClient)\b/)[1];
      instances.set(definition[1], type);
    }
    const methods = {
      WiFiClient: {
        connect: 'Ожидание соединения и DNS может задержать общий цикл.',
        find: 'Поиск данных в потоке может ждать их до истечения тайм-аута.',
        findUntil: 'Поиск данных в потоке может ждать их до истечения тайм-аута.',
        parseInt: 'Ожидание числа в потоке может длиться до тайм-аута.',
        parseFloat: 'Ожидание числа в потоке может длиться до тайм-аута.',
        readString: 'Чтение строки может ждать данные до истечения тайм-аута.',
        readStringUntil: 'Чтение строки может ждать разделитель до истечения тайм-аута.',
        readBytes: 'Чтение заданного числа байтов может ожидать данные до тайм-аута.',
        readBytesUntil: 'Чтение байтов может ждать разделитель до истечения тайм-аута.',
        print: 'Отправка в сетевой сокет при перегрузке может ожидать место в буфере.',
        println: 'Отправка в сетевой сокет при перегрузке может ожидать место в буфере.',
        write: 'Передача данных в сокет при перегрузке может задерживать выполнение.'
      },
      HTTPClient: {
        GET: 'Выполняет синхронный HTTP-запрос с ожиданием сети и ответа.',
        POST: 'Выполняет синхронный HTTP-запрос с ожиданием сети и ответа.',
        PUT: 'Выполняет синхронный HTTP-запрос с ожиданием сети и ответа.',
        PATCH: 'Выполняет синхронный HTTP-запрос с ожиданием сети и ответа.',
        DELETE: 'Выполняет синхронный HTTP-запрос с ожиданием сети и ответа.',
        sendRequest: 'Выполняет синхронный HTTP-запрос с ожиданием сети и ответа.',
        getString: 'Может ожидать получения тела HTTP-ответа.'
      }
    };
    const warnings = [];
    const networkCalls = [];
    // Only aggregate calls directly written inside the FLProg loop() body.
    // Calls in helper functions are still warned about individually, but
    // we cannot prove those helpers run from loop() without control-flow analysis.
    let loopStart = -1, loopEnd = -1;
    const loopMatch = /\bvoid\s+loop\s*\(\s*(?:void\s*)?\)\s*\{/g.exec(clean);
    if (loopMatch) {
      loopStart = loopMatch.index + loopMatch[0].length;
      let nesting = 1, cursor = loopStart;
      while (cursor < clean.length && nesting > 0) {
        if (clean[cursor] === '{') nesting++;
        else if (clean[cursor] === '}') nesting--;
        cursor++;
      }
      if (nesting === 0) loopEnd = cursor - 1;
    }
    const calls = /\b([A-Za-z_]\w*)\s*(?:\.|->)\s*([A-Za-z_]\w*)\s*\(/g;
    let call;
    while ((call = calls.exec(clean))) {
      const receiver = call[1], method = call[2];
      const type = instances.get(receiver);
      if (!type) continue;
      const group = methods[type === 'HTTPClient' ? 'HTTPClient' : 'WiFiClient'];
      if (!Object.prototype.hasOwnProperty.call(group, method)) continue;
      const line = code.slice(0, call.index).split('\n').length;
      warnings.push('Сетевой вызов ' + receiver + '.' + method + '() на строке ' + line +
        ': ' + group[method] + ' В FLProg это может задержать выполнение других блоков.');
      if (call.index >= loopStart && call.index < loopEnd)
        networkCalls.push({ line, receiver, method });
    }
    if (networkCalls.length >= 2) {
      const first = networkCalls[0];
      warnings.push('Несколько потенциально блокирующих сетевых вызовов в loop() (начиная со строки ' +
        first.line + '): обнаружено ' + networkCalls.length +
        ' операций. Ожидания могут складываться и задерживать выполнение следующих блоков FLProg даже без delay().');
    }
    return { errors: [], warnings };
  }

  function checkEsp32Core2017(source, parsed) {
    const code = String(source || '');
    const clean = maskNonCodeSafe(code);
    const errors = [], warnings = [];
    const addError = (message) => { if (!errors.includes(message)) errors.push(message); };
    const addWarning = (message) => { if (!warnings.includes(message)) warnings.push(message); };

    const newCoreCalls = [
      ['ledcAttach', 'Используйте ledcSetup(channel, frequency, resolution) и ledcAttachPin(pin, channel).'],
      ['ledcAttachChannel', 'В Core 2.0.17 нужны ledcSetup() и ledcAttachPin().'],
      ['ledcDetach', 'В Core 2.0.17 используйте ledcDetachPin(pin).'],
      ['ledcChangeFrequency', 'Проверьте старый API ledcSetup(channel, frequency, resolution).'],
      ['ledcOutputInvert', 'Функция появилась в Core 3.x; для 2.0.17 требуется другое решение.'],
      ['ledcFade', 'Функция из нового LEDC API; реализуйте плавное изменение через ledcWrite(channel, duty).'],
      ['ledcFadeWithInterrupt', 'Новый API Core 3.x недоступен в 2.0.17.'],
      ['ledcFadeWithInterruptArg', 'Новый API Core 3.x недоступен в 2.0.17.'],
      ['timerAlarm', 'Используйте timerAlarmWrite(timer, ticks, autoreload) и timerAlarmEnable(timer).']
    ];
    for (const [fn, advice] of newCoreCalls) {
      if (new RegExp('\\b' + fn + '\\s*\\(').test(clean))
        addError(fn + '(): несовместимо с Arduino-ESP32 2.0.17. ' + advice);
    }

    for (const call of callArgumentCounts(clean, 'timerBegin')) {
      if (call.count !== 3)
        addError('timerBegin(): для Core 2.0.17 нужны 3 аргумента — timerBegin(timerIndex, divider, countUp).');
    }
    for (const call of callArgumentCounts(clean, 'timerAttachInterrupt')) {
      if (call.count !== 3)
        addError('timerAttachInterrupt(): для Core 2.0.17 нужны 3 аргумента — (timer, callback, edge).');
    }

    if (/\besp_now_recv_info_t\b/.test(clean))
      addError('esp_now_recv_info_t недоступен в Arduino-ESP32 2.0.17. Используйте приёмный callback: void onRecv(const uint8_t* mac, const uint8_t* data, int len).');
    if (/\besp_now_send_info_t\b/.test(clean))
      addError('esp_now_send_info_t относится к более новому ESP-IDF; для Core 2.0.17 callback отправки принимает const uint8_t* mac.');
    if (/\bESP_NOW_Peer\b/.test(clean) || /^\s*#\s*include\s*[<"]ESP32_NOW\.h[>"]/m.test(code))
      addWarning('Библиотека ESP32_NOW.h / ESP_NOW_Peer не входит в стандартный ESP-NOW API Core 2.0.17. Используйте <esp_now.h> или проверьте установленную стороннюю библиотеку.');
    if (/^\s*#\s*include\s*[<"]ESP8266WiFi\.h[>"]/m.test(code) || /\bESP8266WebServer\b/.test(clean))
      addError('Обнаружен код ESP8266. Для ESP32 используйте <WiFi.h> и WebServer (при необходимости).');

    if (/\bledcWrite\s*\(/.test(clean) && !/\bledcSetup\s*\(/.test(clean) &&
        !/\bledcAttachPin\s*\(/.test(clean)) {
      addWarning('ledcWrite() в Core 2.0.17 принимает номер канала, не GPIO. Убедитесь, что канал ранее настроен через ledcSetup и ledcAttachPin.');
    }
    if (/\bWiFi\s*\./.test(clean) && !/^\s*#\s*include\s*[<"]WiFi\.h[>"]/m.test(code))
      addWarning('В коде есть WiFi.*, но нет явного #include <WiFi.h>.');
    if (/\besp_now_(?:init|register_recv_cb|send|add_peer)\s*\(/.test(clean) &&
        !/^\s*#\s*include\s*[<"]esp_now\.h[>"]/m.test(code))
      addWarning('Используется ESP-NOW без явного #include <esp_now.h>.');

    const functions = Object.values(parsed && parsed.functions || {});
    if (/\besp_now_register_recv_cb\s*\(/.test(clean)) {
      const callbacks = functions.filter(f => f && f.name !== 'setup' && f.name !== 'loop' &&
        new RegExp('\\besp_now_register_recv_cb\\s*\\(\\s*' + String(f.name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\)').test(clean));
      for (const callback of callbacks) {
        const params = callback.parsed_params || [];
        if (params.length !== 3 || !/\buint8_t\b/.test(params[0] && params[0].type || '') ||
            !/\*/.test(params[0] && params[0].type || '') || !/\bconst\b/.test(params[0] && params[0].type || '')) {
          addError('ESP-NOW callback ' + callback.name + ' должен принимать (const uint8_t* mac, const uint8_t* data, int len) для Core 2.0.17.');
        }
      }
      if (callbacks.length === 0)
        addWarning('ESP-NOW callback приёма не удалось сопоставить с распознанной функцией; проверьте её сигнатуру вручную.');
    }

    if (/\b(?:xTaskCreatePinnedToCore|attachInterrupt|esp_now_register_recv_cb)\s*\(/.test(clean))
      addWarning('Callbacks и FreeRTOS-задачи выполняются вне обычного loop; проверьте потокобезопасность и доступ к данным блока.');
    if (/\b(?:WiFi\.begin|WiFi\.mode|esp_now_init)\s*\(/.test(clean))
      addWarning('Инициализация Wi-Fi/ESP-NOW из нескольких FLProg-блоков может конфликтовать; назначьте одного владельца инициализации.');

    for (const warning of checkBlockingNetworkCalls(code).warnings) addWarning(warning);

    return { target: TARGET, errors, warnings, ok: errors.length === 0 };
  }
  root.ino2ubiEsp32 = { target: TARGET, checkEsp32Core2017, callArgumentCounts, checkBlockingNetworkCalls };
})(typeof window !== 'undefined' ? window : globalThis);
