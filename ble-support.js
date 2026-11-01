/* Targeted BLE callback support for FLProg / ESP32 Core 2.0.17.
 * The supported shape is a top-level subclass of BLEAdvertisedDeviceCallbacks,
 * with exactly one global default-constructed instance before setup().
 * We never silently export arbitrary user-defined C++ classes.
 */
(function (root) {
  'use strict';
  const ident = /^[A-Za-z_]\w*$/;
  const esc = x => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lineOf = (text, offset) => text.slice(0, offset).split('\n').length;
  function replaceTokens(source, replacements) {
    const text = String(source || '');
    const masked = maskNonCode(text);
    const parts = [], re = /\b[A-Za-z_]\w*\b/g;
    let last = 0, found;
    while ((found = re.exec(masked))) {
      const value = replacements[found[0]];
      if (value === undefined) continue;
      const left = masked.slice(0, found.index).trimEnd();
      if (left.endsWith('.') || left.endsWith('->') || left.endsWith('::')) continue;
      parts.push(text.slice(last, found.index), value);
      last = re.lastIndex;
    }
    parts.push(text.slice(last));
    return parts.join('');
  }
  function inspect(source, parsed) {
    const code = String(source || '');
    const issues = [], callbacks = [];
    const beforeSetup = (parsed.global_section_raw || '');
    const clean = maskNonCode(beforeSetup);
    // Only recognize top-level classes; nested ones are not portable through FLProg.
    const re = /\b(class|struct)\s+([A-Za-z_]\w*)\s*([^;{}]*)\{/g;
    let m;
    while ((m = re.exec(clean))) {
      const start = m.index, braceAt = re.lastIndex - 1;
      let depth = 1, end = braceAt + 1;
      for (; end < clean.length && depth > 0; end++) {
        if (clean[end] === '{') depth++;
        else if (clean[end] === '}') depth--;
      }
      if (depth || !/^\s*;/.test(clean.slice(end))) {
        issues.push({ line: lineOf(beforeSetup, start), message: 'BLE/class: не удалось найти завершающее }; для ' + m[2] + '.' });
        break;
      }
      const semi = end + clean.slice(end).search(/;/) + 1;
      const raw = beforeSetup.slice(start, semi);
      if (m[1] !== 'class' || !/\bpublic\s+BLEAdvertisedDeviceCallbacks\b/.test(m[3])) {
        issues.push({ line: lineOf(beforeSetup, start), message: 'BLE/class: неподдерживаемый пользовательский ' + m[1] + ' ' + m[2] + '; для экспорта нужен поддерживаемый BLE callback или внешняя библиотека.' });
        re.lastIndex = semi;
        continue;
      }
      const className = m[2];
      const instanceRe = new RegExp('\\b' + esc(className) + '\\s+([A-Za-z_]\\w*)\\s*;', 'g');
      const instances = [...clean.matchAll(instanceRe)].filter(x => x.index >= semi);
      if (instances.length !== 1) {
        issues.push({ line: lineOf(beforeSetup, start), message: 'BLE/class: ' + className + ' должен иметь ровно один глобальный экземпляр вида ' + className + ' имя;' });
        re.lastIndex = semi;
        continue;
      }
      const obj = instances[0][1];
      const used = maskNonCode(raw);
      const captured = [], params = [], unsupported = [];
      for (const [name, v] of Object.entries(parsed.variables || {})) {
        if (!new RegExp('\\b' + esc(name) + '\\b').test(used)) continue;
        if (v.role === 'variable') captured.push(name);
        else if (v.role === 'parameter') params.push(name);
        else unsupported.push(name);
      }
      for (const d of parsed.defines || []) {
        if (d.role === 'parameter' && new RegExp('\\b' + esc(d.name) + '\\b').test(used)) params.push(d.name);
      }
      if (unsupported.length) issues.push({ line: lineOf(beforeSetup, start), message: 'BLE/class: прямой доступ callback к входам/выходам FLProg (' + unsupported.join(', ') + ') не поддерживается; используйте внутреннее состояние.' });
      const paramInfo = {};
      for (const name of [...new Set(params)]) {
        const v = (parsed.variables || {})[name] || (parsed.defines || []).find(d => d.name === name);
        if (!v || !/^(?:String|bool|boolean|byte|uint8_t|int|int16_t|uint16_t|long|unsigned long|int32_t|uint32_t|float|double|char)$/.test(v.type)) {
          issues.push({ line: lineOf(beforeSetup, start), message: 'BLE/class: неподдерживаемый тип параметра ' + name + '.' });
          continue;
        }
        const shadow = '__ino2ubi_ble_param_' + name;
        if (new RegExp('\\b' + esc(shadow) + '\\b').test(code)) {
          issues.push({ line: lineOf(beforeSetup, start), message: 'BLE/class: зарезервированное имя уже используется: ' + shadow + '.' });
        }
        paramInfo[name] = { type:v.type, shadow };
      }
      callbacks.push({ className, objectName:obj, source:raw, captured, parameters:paramInfo, line:lineOf(beforeSetup, start) });
      re.lastIndex = semi;
    }
    if (callbacks.length > 1)
      issues.push({ line: callbacks[1].line, message: 'BLE/class: несколько BLE callback-классов в одном блоке пока не поддерживаются.' });
    // Reject classes defined inside setup/loop or after the global section
    // and point to the exact source line rather than an unhelpful null.
    const all = maskNonCode(code);
    const setupAt = all.search(/\bvoid\s+(?:setup|loop)\s*\(/);
    const allMatches = [...all.matchAll(/\b(?:class|struct)\s+[A-Za-z_]\w*\s*[^;{}]*\{/g)];
    for (const hit of allMatches) {
      if (setupAt >= 0 && hit.index > setupAt) {
        issues.push({line:lineOf(code,hit.index), message:'BLE/class: определение класса после setup()/loop() не поддерживается.'});
      }
    }
    return { callbacks, issues };
  }
  function build(callback, variables) {
    let classText = callback.source;
    // FLProg parameters are inserted as expressions; callbacks need stable
    // variables at file scope, not inline text expressions or raw literals.
    classText = replaceTokens(classText, Object.fromEntries(
      Object.entries(callback.parameters).map(([name, info]) => [name, info.shadow])
    ));
    const captured = callback.captured.map(name => {
      const v = variables[name];
      return v.type + ' ' + name + (v.default != null ? ' = ' + v.default : '') + ';';
    });
    // Compatibility with ESP32 Core 2.0.17; the BLE address API there returns
    // Arduino String, while some other versions return std::string.
    classText = classText.replace(/\bstd\s*::\s*string\s+([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*\s*\.\s*getAddress\s*\(\s*\)\s*\.\s*toString\s*\(\s*\))\s*;/g,
      'String $1 = $2.c_str();');
    classText = classText.replace(/("(?:\\.|[^"\\])*")\s*\.\s*c_str\s*\(\s*\)/g, '$1');
    const params = Object.values(callback.parameters).map(v =>
      v.type + ' ' + v.shadow + (v.type === 'String' ? ' = String("")' : ' = 0') + ';'
    );
    // Don't split the class into a declaration with an empty name: FLProg drops it.
    return [...captured, ...params, classText, callback.className].join('\n');
  }
  function snapshots(callbacks) {
    const unique = new Map();
    for (const cb of callbacks || []) for (const [name, data] of Object.entries(cb.parameters)) {
      unique.set(data.shadow, data.type === 'String'
        ? '  if (' + data.shadow + ' != String(' + name + ')) ' + data.shadow + ' = String(' + name + ');'
        : '  ' + data.shadow + ' = ' + name + ';');
    }
    return [...unique.values()].join('\n');
  }
  function withinSupportedCallback(index, code, parsed) {
    return (parsed.ble_callbacks || []).some(cb => {
      const start = code.indexOf(cb.source);
      return start >= 0 && start <= index && index < start + cb.source.length;
    });
  }
  function verifySource(code, parsed) {
    const issues = [];
    const masked = maskNonCode(String(code || ''));
    const badString = /\bstd\s*::\s*string\s+([A-Za-z_]\w*)\s*=\s*[A-Za-z_]\w*\s*\.\s*getAddress\s*\(\s*\)\s*\.\s*toString\s*\(\s*\)/g;
    let m;
    while ((m = badString.exec(masked))) {
      if (withinSupportedCallback(m.index, code, parsed)) continue;
      issues.push({line:lineOf(code,m.index), message:'BLE/API: std::string из getAddress().toString() несовместим с ESP32 Core 2.0.17; используйте String address = device.getAddress().toString().c_str();' });
    }
    const literalMethod = /"(?:\\.|[^"\\])*"\s*\.\s*c_str\s*\(/g;
    while ((m = literalMethod.exec(maskComments(code)))) {
      if (withinSupportedCallback(m.index, code, parsed)) continue;
      issues.push({line:lineOf(code,m.index), message:'BLE/String: вызов .c_str() у строкового литерала недопустим.' });
    }
    // When the source explicitly uses a legacy global scanner pointer but
    // contains no declaration, the resulting FLProg sketch cannot compile.
    const scanner = /\bblePresenceScanner\b/g;
    if (scanner.test(masked) && !/\b(?:BLEScan\s*\*\s*|auto\s*\*\s*)blePresenceScanner\b/.test(masked)) {
      const first = /\bblePresenceScanner\b/.exec(masked);
      issues.push({line:lineOf(code, first.index), message:'BLE/scanner: blePresenceScanner используется без объявления BLEScan *blePresenceScanner.' });
    }
    // Detect direct String-parameter .c_str; after FLProg substitution it may
    // become "mac".c_str() (the generated body differs from Arduino source).
    for (const [name, v] of Object.entries(parsed.variables || {})) {
      if (v.role !== 'parameter' || v.type !== 'String') continue;
      // setup/loop/helpers are already transformed to local Arduino String
      // snapshots by string-params.js. Only GLOBAL expressions remain unsafe.
      const globalText = parsed.global_section_raw || '';
      const globalBase = code.indexOf(globalText);
      const globalMasked = maskNonCode(globalText);
      const pat = new RegExp('\\b' + esc(name) + '\\s*\\.\\s*c_str\\s*\\(', 'g');
      while ((m = pat.exec(globalMasked))) {
        const absoluteIndex = (globalBase >= 0 ? globalBase : 0) + m.index;
        if (withinSupportedCallback(absoluteIndex, code, parsed)) continue;
        issues.push({line:lineOf(code,absoluteIndex), message:'BLE/String: глобальное выражение ' + name + '.c_str() небезопасно: FLProg подставляет текстовый параметр как литерал.' });
      }
    }
    return issues;
  }
  root.ino2ubiBleSupport = {inspect, build, snapshots, verifySource, replaceTokens};
})(typeof window !== 'undefined' ? window : globalThis);
