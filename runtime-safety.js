/* Runtime risk review for sketches converted into shared FLProg setup()/loop().
 * Heuristic findings are WARNINGS; never rewrite code or block valid hardware-tested
 * BLE, MQTT, NTP or HTTP blocks on the basis of these checks alone.
 * Masks comments and literals before scanning and preserves source offsets.
 */
(function (root) {
  'use strict';
  const escapeRE = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lineAt = (code, index) => code.slice(0, Math.max(0,index)).split('\n').length;
  function region(code, masked, name) {
    const re = new RegExp('\\bvoid\\s+' + name + '\\s*\\(\\s*\\)\\s*\\{', 'g');
    const m = re.exec(masked);
    if (!m) return null;
    let depth = 1, i = re.lastIndex;
    while (i < masked.length && depth) {
      if (masked[i] === '{') depth++;
      else if (masked[i] === '}') depth--;
      i++;
    }
    return depth ? null : {start:re.lastIndex, end:i-1, body:masked.slice(re.lastIndex,i-1)};
  }
  function inspect(source, parsed, options) {
    const code = String(source || ''), clean = typeof maskNonCode === 'function' ? maskNonCode(code) : code;
    const warnings = [], seen = new Set();
    const emit = (index, id, description) => {
      const line = lineAt(code, index), key=id+':'+line;
      if (seen.has(key)) return;
      seen.add(key);
      warnings.push('Риск выполнения [' + id + '] (строка ' + line + '): ' + description);
    };
    const loop = region(code, clean, 'loop');
    const setup = region(code, clean, 'setup');
    // 1. A blocking operation in the shared loop blocks other FLProg blocks too.
    if (loop) {
      const delays = /\b(delay|delayMicroseconds)\s*\(\s*([A-Za-z_]\w*|\d+)(?:[uUlL]*)\s*\)/g;
      let m;
      while ((m = delays.exec(loop.body))) {
        const literal = /^\d+$/.test(m[2]);
        const amount = literal ? Number(m[2]) : null;
        if (literal && (m[1] === 'delay' ? amount < 50 : amount < 1000)) continue;
        emit(loop.start+m.index, 'BLOCKING-DELAY',
          'в общем loop() вызов ' + m[1] + '() может задерживать другие блоки; используйте millis()/автомат состояний, если нужна отзывчивость.');
      }
      const blocking = /\b(?:pulseIn|pulseInLong|readStringUntil|readBytesUntil|waitForConnectResult)\s*\(|\b[A-Za-z_]\w*\s*(?:\.|->)\s*(?:GET|POST|PUT|connect|readString|readStringUntil|readBytesUntil|waitForConnectResult)\s*\(/g;
      while ((m = blocking.exec(loop.body)))
        emit(loop.start+m.index,'BLOCKING-IO','потенциально ожидающий ввод/сеть вызов в общем loop() может остановить выполнение остальных блоков на время тайм-аута.');
      const repeated = /\b(?:WiFi\s*\.\s*begin|Wire\s*\.\s*begin|SPI\s*\.\s*begin|EEPROM\s*\.\s*begin|Serial\s*\.\s*begin)\s*\(/g;
      while ((m = repeated.exec(loop.body))) {
        const prefix=loop.body.slice(Math.max(0,m.index-120),m.index);
        const guarded=/\bif\s*\([^{};]*\)\s*\{?\s*$/.test(prefix);
        if (!guarded) emit(loop.start+m.index,'RESOURCE-REINIT',
          'инициализация оборудования в loop() без очевидной проверки состояния; при повторении возможны сбои других блоков.');
      }
      // A comparison to a future timestamp is not rollover-safe for uint32_t millis().
      const rollover = /\b(?:millis|micros)\s*\(\s*\)\s*(?:>=|>|<=|<)\s*[A-Za-z_]\w*\s*\+|\b[A-Za-z_]\w*\s*\+\s*[A-Za-z_]\w*\s*(?:>=|>|<=|<)\s*(?:millis|micros)\s*\(\s*\)/g;
      while ((m = rollover.exec(loop.body)))
        emit(loop.start+m.index,'TIMER-WRAP','сравнение с суммой времени может нарушиться после переполнения millis()/micros(); безопаснее сравнивать разность беззнаковых счётчиков.');
      const equalTime = /\b(?:millis|micros)\s*\(\s*\)\s*==|==\s*\b(?:millis|micros)\s*\(\s*\)/g;
      while ((m = equalTime.exec(loop.body)))
        emit(loop.start+m.index,'TIMER-EQUALITY','точное равенство системному таймеру может пропустить событие; используйте сравнение прошедшего интервала.');
      // Local timer resets every loop iteration, so a time-based state machine may never fire.
      const locals = /\b(?:unsigned\s+long|uint32_t|unsigned\s+int|int32_t|long)\s+([A-Za-z_]\w*)\s*=\s*(?:millis|micros)\s*\(\s*\)\s*;/g;
      while ((m = locals.exec(loop.body))) {
        const before = loop.body.slice(Math.max(0,m.index-20),m.index);
        if (/\bstatic\s*$/.test(before)) continue;
        const later=loop.body.slice(m.index+m[0].length);
        if (new RegExp('\\b'+escapeRE(m[1])+'\\b\\s*[-+]|[-+]\\s*\\b'+escapeRE(m[1])+'\\b').test(later))
          emit(loop.start+m.index,'TIMER-RESET','локальная отметка '+m[1]+' создаётся заново при каждом проходе loop(); для хранения времени между проходами используйте // variable или static.');
      }
    }
    // Busy waits can starve the shared FLProg sketch or hold up its startup.
    for (const section of [loop,setup].filter(Boolean)) {
      const wait = /\bwhile\s*\(\s*(?:WiFi\s*\.\s*status\s*\(\s*\)|!\s*[A-Za-z_]\w*\s*\.\s*connected\s*\(\s*\)|(?:millis|micros)\s*\(\s*\)[^)]*)[^)]*\)/g;
      let hit;
      while ((hit=wait.exec(section.body)))
        emit(section.start+hit.index, 'BUSY-WAIT',
          'ожидание Wi-Fi/соединения/таймера через while() может задержать остальные блоки FLProg; ограничьте ожидание и обеспечьте выход из цикла.');
    }
    // 2. Narrow, syntactic timer hazards even outside loop (helpers called by loop).
    let m;
    const smallTime = /\b(?:int16_t|uint16_t|short|unsigned\s+short|byte|uint8_t|int8_t)\s+([A-Za-z_]\w*)\s*=\s*(?:millis|micros)\s*\(/g;
    while ((m = smallTime.exec(clean)))
      emit(m.index,'TIMER-WIDTH','переменная '+m[1]+' не вмещает 32-битное значение таймера; используйте uint32_t или unsigned long.');
    // 3. Prevent accidental GPIO mode conflicts with literal pin numbers; dynamic pins require project review.
    const pins = new Map();
    const pinRe = /\bpinMode\s*\(\s*(\d+)\s*,\s*(INPUT_PULLUP|INPUT_PULLDOWN|INPUT|OUTPUT|OUTPUT_OPEN_DRAIN)\s*\)/g;
    while ((m = pinRe.exec(clean))) {
      const pin = m[1], mode=m[2], prev=pins.get(pin);
      if (prev && prev.mode !== mode)
        emit(m.index,'GPIO-MODE','GPIO'+pin+' настроен как '+prev.mode+' (строка '+prev.line+') и '+mode+'; проверьте, не конфликтуют ли назначения.');
      else if (!prev) pins.set(pin,{mode,line:lineAt(code,m.index)});
    }
    // 4. Callback code can execute in another task/ISR; blocking operations are especially risky.
    const callbackRanges = [];
    for (const cb of (parsed && parsed.ble_callbacks) || []) {
      const start=code.indexOf(cb.source);
      if (start>=0) callbackRanges.push({start,body:clean.slice(start,start+cb.source.length),kind:'BLE'});
    }
    const functionDefs = Object.values((parsed && parsed.functions) || {});
    const registrations = /\b(?:esp_now_register_(?:recv|send)_cb|WiFi\s*\.\s*onEvent)\s*\(\s*([A-Za-z_]\w*)/g;
    while ((m=registrations.exec(clean))) {
      const fn = functionDefs.find(f=>f.name===m[1]);
      if (!fn) continue;
      const start = code.indexOf(fn.body, fn.start || 0);
      if (start >=0) callbackRanges.push({start,body:clean.slice(start,start+fn.body.length),kind:'Wi-Fi/ESP-NOW'});
    }
    for (const callback of callbackRanges) {
      const ops = /\b(?:delay|delayMicroseconds|WiFi\s*\.\s*begin|BLEDevice\s*::\s*init|esp_now_init)\s*\(|\b[A-Za-z_]\w*\s*(?:\.|->)\s*(?:GET|POST|readString|connect)\s*\(/g;
      while ((m=ops.exec(callback.body)))
        emit(callback.start+m.index,'CALLBACK-BLOCK','в '+callback.kind+' callback есть потенциально блокирующая операция или инициализация; обработчик должен быстро возвращать управление.');
    }
    // 5. Repeat initialization in setup() (possibly intentional but needs review).
    if (setup) {
      for (const [label,re] of [
        ['BLE', /\bBLEDevice\s*::\s*init\s*\(/g],
        ['ESP-NOW',/\besp_now_init\s*\(/g],
        ['Wi-Fi',/\bWiFi\s*\.\s*begin\s*\(/g],
        ['I2C',/\bWire\s*\.\s*begin\s*\(/g],
        ['SPI',/\bSPI\s*\.\s*begin\s*\(/g]
      ]) {
        const hits=[...setup.body.matchAll(re)];
        if (hits.length>1) emit(setup.start+hits[1].index,'RESOURCE-DUPLICATE',
          label+' инициализируется несколько раз в setup(); проверьте управление общим ресурсом.');
      }
    }
    return {errors: [], warnings};
  }
  root.ino2ubiRuntimeSafety = {inspect};
})(typeof window !== 'undefined' ? window : globalThis);
