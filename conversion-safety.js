/* Export-safety checks for Arduino -> shared FLProg sketch.
 * Conservative diagnostics, NOT a substitute for compiling in FLProg.
 * Do not silently rewrite the C++ program to satisfy a check.
 */
(function (root) {
  'use strict';
  const escapeRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lineAt = (s, pos) => String(s).slice(0, pos).split('\n').length;
  const makeIssue = (source, index, id, description) => ({
    id, line: lineAt(source, index), message: 'Проверка преобразования [' + id + '] (строка ' + lineAt(source, index) + '): ' + description
  });
  function preprocessor(source) {
    const result = [];
    // Match directives at the beginning of a line, including indented directives.
    const re = /^[ \t]*#[ \t]*(if|ifdef|ifndef|elif|else|endif|undef|include_next|pragma|error|warning|line|define)\b([^\r\n]*)/gm;
    let hit;
    const active = maskComments(source);
    const code = typeof maskNonCode === 'function' ? maskNonCode(source) : source;
    while ((hit = re.exec(active))) {
      const kind = hit[1].toLowerCase(), tail = hit[2];
      if (kind === 'define') {
        if (/^[ \t]+[A-Za-z_]\w*\(/.test(tail))
          result.push(makeIssue(source, hit.index, 'CPP-MACRO', 'функциональный #define не переносится генератором без потери аргументов; вынесите реализацию в обычную функцию или библиотеку.'));
        if (/\\\s*$/.test(hit[0]))
          result.push(makeIssue(source, hit.index, 'CPP-MULTILINE', 'многострочный #define с продолжением \\ не сохраняется полностью.'));
      } else {
        // Conditionals INSIDE setup()/loop()/helper bodies are copied verbatim (A-05); only
        // directives outside every function body are lost by the generator.
        if (/^(?:if|ifdef|ifndef|elif|else|endif)$/.test(kind)) {
          let depth = 0;
          for (let i = 0; i < hit.index; i++) { if (code[i] === '{') depth++; else if (code[i] === '}') depth = Math.max(0, depth - 1); }
          if (depth > 0) continue;
        }
        result.push(makeIssue(source, hit.index, 'CPP-CONDITION', 'директива #' + kind + ' не сохраняется в создаваемом .ubi; нельзя безопасно экспортировать одну ветку условной компиляции.'));
      }
    }
    return result;
  }
  function functions(source, parsed) {
    const result = [];
    for (const [key, info] of Object.entries((parsed && parsed.functions) || {})) {
      const name = info.name || key;
      const params = info.params || '';
      const pos = typeof info.start === 'number' ? info.start : source.indexOf(name + '(');
      if (/(^|,)\s*\.\.\.|\(\s*\*/.test(params))
        result.push(makeIssue(source, Math.max(0,pos), 'CPP-FUNCTION', 'параметры функции ' + name + ' содержат variadic или указатель на функцию; это не поддержано генератором параметров FLProg.'));
      if (typeof splitTopLevel === 'function') {
        const list = splitTopLevel(params, ',');
        const defaults = list.some(part => typeof findParameterDefault === 'function' && findParameterDefault(part) >= 0);
        if (defaults)
          result.push(makeIssue(source, Math.max(0,pos), 'CPP-DEFAULT', 'функция ' + name + ' использует аргументы по умолчанию, которые не сохраняются в Code Basic; передавайте значения явно и уберите умолчания.'));
        if ((info.parsed_params || []).length !== list.filter(p => p.trim() && p.trim() !== 'void').length ||
            (info.parsed_params || []).some(p => /^_arg\d+$/.test(p.name)))
          result.push(makeIssue(source, Math.max(0,pos), 'CPP-ARGUMENT', 'парсер не сохранил все именованные параметры функции ' + name + '; экспорт остановлен.'));
      }
    }
    return result;
  }
  function callbacks(source, parsed) {
    const result = [], masked = maskNonCode(source);
    const re = /\b(?:esp_now_register_(?:recv|send)_cb|WiFi\s*\.\s*onEvent)\s*\(\s*([A-Za-z_]\w*)\b/g;
    let hit;
    while ((hit = re.exec(masked))) {
      const name = hit[1];
      const handler = Object.values((parsed && parsed.functions) || {}).find(f => f.name === name);
      if (!handler) continue; // Lambda, library callback, or unsupported form: no guessed rewrite.
      const body = maskNonCode(handler.body || '');
      const ports = Object.entries((parsed && parsed.variables) || {}).filter(([n,v]) =>
        ['input','output','parameter'].includes(v.role) && new RegExp('\\b' + escapeRe(n) + '\\b').test(body));
      const macros = ((parsed && parsed.defines) || []).filter(d =>
        d.role === 'parameter' && new RegExp('\\b' + escapeRe(d.name) + '\\b').test(body));
      if (ports.length || macros.length) {
        const names = [...ports.map(([n])=>n),...macros.map(d=>d.name)];
        result.push(makeIssue(source, hit.index, 'CALLBACK-SCOPE',
          'обработчик ' + name + ' обращается к параметрам/портам FLProg (' + names.join(', ') + ') вне гарантированной области видимости; используйте отдельное внутреннее состояние с безопасной синхронизацией.'));
      }
    }
    return result;
  }
  function initializerSafety(source) {
    const result=[];
    const begin = /\bvoid\s+loop\s*\(\s*\)\s*\{/g;
    const masked = maskNonCode(source), match=begin.exec(masked);
    if (!match) return result;
    let depth=1, j=begin.lastIndex;
    for (; j<masked.length && depth; j++) {
      if (masked[j]==='{') depth++;
      else if (masked[j]==='}') depth--;
    }
    const body=masked.slice(begin.lastIndex,j-1);
    const re=/\b(?:BLEDevice\s*::\s*init|esp_now_init)\s*\(/g;
    let hit;
    while ((hit=re.exec(body))) {
      // Error only on direct, unguarded calls. A guarded state-machine retry
      // may be valid and must not be blanket-blocked as an unsafe class.
      let depth=0;
      for (let i=0;i<hit.index;i++) {
        if (body[i]==='{') depth++;
        else if (body[i]==='}') depth=Math.max(0,depth-1);
      }
      const sameLinePrefix=body.slice(body.lastIndexOf('\n',hit.index-1)+1,hit.index);
      const guardedLine=/\bif\s*\([^;{}]*\)\s*$/.test(sameLinePrefix);
      if (depth===0 && !guardedLine)
        result.push(makeIssue(source, begin.lastIndex+hit.index, 'INIT-LOOP',
          'инициализация BLE/ESP-NOW выполняется при каждом проходе loop(); используйте setup() или однократное управление ресурсом.'));
    }
    return result;
  }
  function identifiers(source, parsed) {
    const result = [], vars=parsed.variables||{}, defs=parsed.defines||[], fns=Object.values(parsed.functions||{});
    const seen=new Map();
    function register(name, kind, position) {
      if (!name) return;
      if (seen.has(name)) result.push(makeIssue(source, Math.max(0,position), 'NAME-COLLISION',
        'идентификатор ' + name + ' используется и как ' + seen.get(name) + ', и как ' + kind + '; FLProg не может гарантировать корректное переименование.'));
      else seen.set(name,kind);
    }
    for (const [name,v] of Object.entries(vars)) register(name,'переменная',v.position||0);
    for (const def of defs) register(def.name,'макрос',def.position||0);
    for (const fn of fns) register(fn.name,'функция',fn.start||0);
    const reserved=/\b__ino2ubi_(?:ble_param|string|numeric)_\w+\b/g;
    const masked=maskNonCode(source);
    let m;
    while ((m=reserved.exec(masked))) result.push(makeIssue(source,m.index,'NAME-RESERVED',
      'идентификатор ' + m[0] + ' зарезервирован для внутренних переменных конвертера.'));
    return result;
  }
  function declarationOrder(source, parsed) {
    const result=[], vars=parsed.variables||{};
    const staticDeclarations=(parsed.static_declarations||[]).map(x=>String(x));
    const extraDeclarations=(parsed.extra_declarations||[]).map(x=>String(x));
    const foreign=[...staticDeclarations,...extraDeclarations];
    const foreignNames=[];
    for (const decl of foreign) {
      // Names from arrays and elementary constructor/object declarations.
      const a=decl.match(/\b([A-Za-z_]\w*)\s*\[[^\]]*\]/);
      const ctor=decl.match(/^\s*(?:[A-Za-z_]\w*(?:::[A-Za-z_]\w*)*\s+)+([A-Za-z_]\w*)\s*\(/);
      const plain=decl.match(/^\s*(?:static\s+|const\s+|volatile\s+)*[A-Za-z_]\w*(?:::[A-Za-z_]\w*)*\s+([A-Za-z_]\w*)\s*(?:=|;)/);
      const name=(a||ctor||plain||[])[1];
      if(name) foreignNames.push(name);
    }
    for(const [name,info] of Object.entries(vars)) {
      if(info.role!=='variable') continue;
      const initializer=String(info.default||'');
      for(const foreignName of foreignNames)
        if(new RegExp('\\b'+escapeRe(foreignName)+'\\b').test(maskNonCode(initializer)))
          result.push(makeIssue(source,source.search(new RegExp('\\b'+escapeRe(name)+'\\b')), 'GLOBAL-ORDER',
            'инициализатор '+name+' зависит от '+foreignName+': FLProg хранит обычные, static и объектные объявления в разных группах и может изменить порядок.'));
    }
    for(const decl of foreign) {
      for(const name of Object.keys(vars)) {
        if(vars[name].role!=='variable') continue;
        const index=decl.indexOf('=');
        const args=index>=0?decl.slice(index+1):/\b[A-Za-z_]\w*\s*\(/.test(decl)?decl.slice(decl.indexOf('(')):'';
        if(new RegExp('\\b'+escapeRe(name)+'\\b').test(maskNonCode(args)))
          result.push(makeIssue(source, Math.max(0,source.indexOf(decl)), 'GLOBAL-ORDER',
            'глобальное объявление зависит от '+name+': порядок групп объявлений не гарантирует исходную последовательность.'));
      }
    }
    return result;
  }
  function validateXmlText(source) {
    const result=[];
    // XML 1.0 cannot represent most C0 control characters, even as entities.
    const re=/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;
    let hit;
    while ((hit=re.exec(source))) result.push(makeIssue(source,hit.index,'XML-CHAR',
      'исходный код содержит управляющий символ U+' + hit[0].charCodeAt(0).toString(16).toUpperCase().padStart(4,'0') + ', недопустимый в XML 1.0.'));
    return result;
  }
  function requiresSingleInstance(source, parsed) {
    const masked = maskNonCode(source);
    return !!((parsed.ble_callbacks || []).length ||
      /\b(?:esp_now_init|esp_now_register_(?:recv|send)_cb|BLEDevice\s*::\s*(?:init|getScan)|WiFi\s*\.\s*(?:begin|onEvent)|Wire\s*\.\s*begin|SPI\s*\.\s*begin|Serial\s*\.\s*begin)\s*\(/.test(masked));
  }
  // Hardware/software resources that exist once per sketch. Each instance of a reusable block
  // runs its own setup(), so such calls are repeated; see compat.js [MULTI-RESOURCE].
  function exclusiveResources(source) {
    const masked = maskNonCode(String(source || ''));
    const rules = [
      ['ESP-NOW (esp_now_init / обработчик приёма-отправки)', /\besp_now_(?:init|register_recv_cb|register_send_cb)\s*\(/, 'ESP-NOW инициализируется один раз, а обработчик приёма/отправки в нём один: второй экземпляр заменит первый.'],
      ['BLE (BLEDevice::init / getScan)', /\bBLEDevice\s*::\s*(?:init|getScan|deinit)\s*\(/, 'Стек BLE общий для всего проекта.'],
      ['Wi-Fi (WiFi.begin / softAP / mode)', /\bWiFi\s*\.\s*(?:begin|softAP|mode|disconnect)\s*\(/, 'Wi-Fi-соединение общее для всего проекта.'],
      ['шина I2C/SPI (Wire.begin / SPI.begin)', /\b(?:Wire|Wire1|SPI)\s*\.\s*begin\s*\(/, 'Шина инициализируется повторно с теми же или другими параметрами.'],
      ['последовательный порт (Serial.begin)', /\bSerial[12]?\s*\.\s*begin\s*\(/, 'Повторная инициализация порта сбрасывает его буферы и скорость.'],
      ['EEPROM/NVS (EEPROM.begin / Preferences)', /\bEEPROM\s*\.\s*begin\s*\(/, 'Области хранения экземпляров могут пересечься.'],
      ['аппаратный таймер/LEDC (timerBegin, ledcAttach, ledcSetup)', /\b(?:timerBegin|ledcAttach|ledcSetup|ledcAttachPin)\s*\(/, 'Аппаратные таймеры и каналы LEDC ограничены и общие для проекта.'],
      ['GPIO/ISR (attachInterrupt, detachInterrupt)', /\b(?:attachInterrupt|detachInterrupt|attachInterruptArg)\s*\(/, 'Один GPIO не может независимо обслуживать два конфликтующих обработчика; проверьте распределение пинов и контекст ISR.'],
      ['системный esp_timer (esp_timer_create)', /\besp_timer_(?:create|start_once|start_periodic|delete)\s*\(/, 'Каждый таймер должен иметь отдельный handle, callback и корректный жизненный цикл.'],
      ['FreeRTOS (xTaskCreate / xTaskCreatePinnedToCore)', /\bxTaskCreate(?:PinnedToCore|Static|PinnedToCoreStatic)?\s*\(/, 'Повторное создание задач требует независимых handle/контекстов, защиты общих данных и контроля ресурсов.'],
      ['ESP-IDF GPIO ISR (gpio_isr_handler_add)', /\bgpio_(?:install_isr_service|isr_handler_add|isr_handler_remove)\s*\(/, 'Сервис прерываний общий, а регистрацию пинов и callback нужно согласовать между блоками.']
    ];
    const found = [];
    for (const [what, re, advice] of rules) {
      const m = re.exec(masked);
      if (m) found.push({ what, line: lineAt(source, m.index), advice });
    }
    return found;
  }
  function inspect(source, parsed) {
    const input=String(source||''), state=parsed||{};
    return [...preprocessor(input),...functions(input,state),...callbacks(input,state),
      ...initializerSafety(input),...identifiers(input,state),...declarationOrder(input,state),...validateXmlText(input)];
  }
  root.ino2ubiConversionSafety={inspect,requiresSingleInstance,exclusiveResources};
})(typeof window !== 'undefined' ? window : globalThis);
