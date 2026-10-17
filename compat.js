/* Import/export compatibility for original ino2ubi and FLProg 8.
 * No server, no project-specific conversion layers: JSON is an editable save format,
 * original .ino/.txt inputs remain the source of truth.
 */
(function (root) {
  'use strict';
  const sourceExtensions = /\.(ino|txt|cpp|c|hpp|h)$/i;

  function readText(bytes) {
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe)
      return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff)
      return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
      return new TextDecoder('utf-8').decode(bytes.subarray(3));
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch (_) { return new TextDecoder('windows-1251').decode(bytes); }
  }

  function openSourceFile(filename, bytes) {
    const name = String(filename || '');
    const text = readText(bytes);
    if (/\.ubi$|\.ubl$/i.test(name))
      throw new Error('Файл .ubi/.ubl является блоком FLProg, а не исходным кодом; загрузите .ino/.txt или проект .i2u.json.');
    if (/\.json$/i.test(name)) {
      let data;
      try { data = JSON.parse(text); }
      catch (_) { throw new Error('Неверный JSON-файл проекта.'); }
      if (!data || data.format !== 'ino2ubi-project-v1' || typeof data.code !== 'string' ||
          !data.parsed || typeof data.parsed !== 'object' || Array.isArray(data.parsed))
        throw new Error('Это не проект ino2ubi (.i2u.json).');
      if (!data.parsed.variables || !data.parsed.functions || !Array.isArray(data.parsed.defines))
        throw new Error('В файле проекта отсутствуют данные о переменных, функциях или #define.');
      return { kind: 'project', code: data.code, settings: data.settings || {}, parsed: data.parsed };
    }
    if (!sourceExtensions.test(name)) throw new Error('Поддерживаются .ino, .txt, .cpp, .c, .h, .hpp и .i2u.json.');
    if (/\x00/.test(text)) throw new Error('Исходный файл содержит двоичные данные.');
    return { kind: 'code', code: text, name: name.replace(/\.(ino|txt|cpp|c|hpp|h)$/i, '') };
  }

  function makeProject(code, parsed, settings) {
    return {
      format: 'ino2ubi-project-v1',
      version: 1,
      code: String(code),
      parsed: JSON.parse(JSON.stringify(parsed)),
      settings: { blockName: String(settings.blockName || ''),
        blockDescription: String(settings.blockDescription || ''),
        enableInput: !!settings.enableInput, remoteXYEepromOffset: settings.remoteXYEepromOffset || '0', exportMode: settings.exportMode || 'basic', professionalHeader: settings.professionalHeader || '', professionalHeaderFilename: settings.professionalHeaderFilename || '', targetProfile: 'esp32-arduino-2.0.17' }
    };
  }

  function inspectGeneratedXml(xml) {
    const ids = new Set(), duplicates = [], missing = [];
    for (const m of xml.matchAll(/\bsixx\.id="(\d+)"/g)) {
      if (ids.has(m[1])) duplicates.push(m[1]);
      ids.add(m[1]);
    }
    for (const m of xml.matchAll(/\bsixx\.idref="(\d+)"/g))
      if (!ids.has(m[1])) missing.push(m[1]);
    return { valid: duplicates.length === 0 && missing.length === 0,
      duplicates: [...new Set(duplicates)], missing: [...new Set(missing)], objects: ids.size };
  }

  // Arduino macros are emitted by FLProg into a shared generated sketch.
  // A renamed #define can collide with a declaration or stop being usable as
  // an array bound. For the FLProg 8 / ESP32 profile enforce literal C-array
  // extents and avoid numeric object-like macros entirely.
  function checkArrayAndDefineSafety(code, parsed) {
    const errors = [], warnings = [];
    const addError = message => { if (!errors.includes(message)) errors.push(message); };
    const source = String(code || '');
    const definitions = (parsed && parsed.defines) || [];
    for (const d of definitions) {
      const name = String(d.name || '').trim();
      const value = String(d.value || '').trim();
      if (!name) continue;
      // A numeric literal and common numeric expressions (parentheses,
      // shifts, arithmetic) are banned, whether or not used in an array.
      const numeric = /^(?:\(?[+\-~]*\s*(?:\d|0[xX][a-fA-F0-9]))/.test(value) ||
        ['long', 'float'].includes(d.type);
      if (numeric)
        addError('#define ' + name + ': числовой макрос несовместим с правилами ino2ubi / FLProg 9.8.0. Способ замены зависит от назначения макроса — см. «Как исправить» ниже.');
    }

    // Check declarations already extracted by the parser, not references such
    // as eventState[head]. This keeps diagnostics focused on C array extents.
    const declarations = [
      ...((parsed && parsed.static_declarations) || []),
      ...((parsed && parsed.extra_declarations) || [])
    ];
    for (const raw of declarations) {
      const decl = String(raw || '');
      const match = decl.match(/\b([A-Za-z_][A-Za-z_0-9]*)\s*((?:\[[^\]]*\]\s*)+)\s*(?==|;)/);
      if (!match) continue;
      for (const dim of match[2].matchAll(/\[([^\]]*)\]/g)) {
        const size = dim[1].trim();
        if (!/^[1-9][0-9]*$/.test(size))
          addError('Массив ' + match[1] + '[' + size + ']: указывайте размер явным положительным числом, например [' + '32' + '].');
      }
    }
    // A project saved by the old parser may contain a scalar variable for
    // an array declaration. Refuse to emit that stale data; a fresh parse
    // reconstructs the real declaration without losing its [size].
    if (typeof parseArduinoCode === 'function' && parsed) {
      const current = parseArduinoCode(source);
      const freshArrays = (current.static_declarations || []).filter(d => /\[[^\]]*\]/.test(d));
      const savedArrays = new Set((parsed.static_declarations || []).map(d => String(d).replace(/\s+/g, ' ').trim()));
      for (const decl of freshArrays) {
        if (!savedArrays.has(String(decl).replace(/\s+/g, ' ').trim())) {
          addError('Проект содержит массив из старого парсера (' + decl.trim() + '). Нажмите «Парсить код» повторно, затем проверьте настройки блока.');
        }
      }
    }
    if (/\b(?:bufferSize|BufferSize)\b/.test(source) && /\[[1-9][0-9]*\]/.test(source))
      warnings.push('При использовании отдельного bufferSize ограничивайте его фактической ёмкостью массива, чтобы избежать выхода за границы.');
    return { errors, warnings };
  }

  // FLProg injects each block's setup/loop code into the shared Arduino
  // setup()/loop(). An early return here skips every block following it.
  // Returns inside helpers/lambdas remain valid C++ and do not exit the shared function.
  function checkSharedExecutionSafety(code) {
    const errors = [];
    for (const section of ['setup', 'loop']) {
      const body = extractFunctionBody(String(code || ''), section);
      if (!body) continue;
      const masked = maskNonCode(body); // preserve offsets; ignore comments & literals
      const nestedLambdaRanges = [];
      const lambdaPattern = /\[[^\]\n]*\]\s*(?:\([^()]*\)\s*)?(?:(?:mutable|constexpr|noexcept)\s*)*(?:->\s*[\w:<>,*&\s]+)?\{/g;
      let found;
      while ((found = lambdaPattern.exec(masked))) {
        let depth = 1, pos = lambdaPattern.lastIndex;
        while (pos < masked.length && depth > 0) {
          if (masked[pos] === '{') depth++;
          else if (masked[pos] === '}') depth--;
          pos++;
        }
        nestedLambdaRanges.push([found.index, pos]);
        lambdaPattern.lastIndex = pos;
      }
      const returns = /\breturn\b/g;
      let earlyReturn = false;
      while ((found = returns.exec(masked))) {
        if (!nestedLambdaRanges.some(([start, end]) => start <= found.index && found.index < end)) {
          earlyReturn = true;
          break;
        }
      }
      if (earlyReturn) {
        errors.push('return внутри ' + section + '(): нельзя использовать в коде блока FLProg — он завершит общий ' + section + '() и пропустит следующие блоки. Замените ранний выход на if/else или вынесите логику во вспомогательную функцию.');
      }
    }
    return { errors, warnings: [] };
  }

  // A while-loop is legal C++ and does not inherently break the parser.
  // However, it may block the shared FLProg loop/setup. Report only actionable
  // warnings, and diagnose malformed loop conditions conservatively.
  function checkWhileSafety(code) {
    const errors = [], warnings = [];
    const source = String(code || '');
    // The existing parser masks comments, character literals, and strings while
    // preserving every character offset. Ignore preprocessor directive lines.
    const masked = maskNonCode(source).replace(/^[ \t]*#[^\n]*/gm,
      line => line.replace(/[^\n]/g, ' '));
    const loops = /\bwhile\s*\(/g;
    let match;
    while ((match = loops.exec(masked))) {
      const start = loops.lastIndex;
      let pos = start, depth = 1;
      for (; pos < masked.length && depth > 0; pos++) {
        if (masked[pos] === '(') depth++;
        else if (masked[pos] === ')') depth--;
      }
      const lineNo = source.slice(0, match.index).split('\n').length;
      if (depth !== 0) {
        errors.push('while() на строке ' + lineNo + ': не закрыта круглая скобка условия; проверьте синтаксис.');
        break;
      }
      const condition = masked.slice(start, pos - 1).trim();
      const compound = /&&|\|\||\?/.test(condition);
      const constantTrue = /^(?:true|1|\(\s*true\s*\)|\(\s*1\s*\))$/.test(condition);
      if (constantTrue)
        warnings.push('while() на строке ' + lineNo + ': постоянное истинное условие; цикл без выхода может остановить остальные блоки FLProg.');
      else if (compound)
        warnings.push('Сложный while() на строке ' + lineNo + ': несколько условий допустимы в C++, но проверьте перенос через ino2ubi и гарантированное завершение цикла.');
      else
        warnings.push('while() на строке ' + lineNo + ': убедитесь, что цикл быстро завершается и не задерживает остальные блоки FLProg.');
    }
    return { errors, warnings };
  }

  function validateConverterInput(code, parsed, enableInput) {
    const safety = checkArrayAndDefineSafety(code, parsed);
    const flow = checkSharedExecutionSafety(code);
    const loops = checkWhileSafety(code);
    const errors = [...safety.errors, ...flow.errors, ...loops.errors];
    const warnings = [...safety.warnings, ...flow.warnings, ...loops.warnings];
    if (!code.trim()) errors.push('Исходный код пуст.');
    if (!/\bvoid\s+setup\s*\(\s*\)\s*\{/m.test(code))
      errors.push('Не найдена функция void setup() {...}.');
    if (!/\bvoid\s+loop\s*\(\s*\)\s*\{/m.test(code))
      errors.push('Не найдена функция void loop() {...}.');
    const vars = parsed.variables || {};
    const pins = Object.entries(vars).filter(([, value]) => ['input','output','parameter'].includes(value.role));
    for (const [name, val] of pins) {
      if (val.role === 'input' && enableInput && (val.alias || name) === 'En')
        errors.push('Вход En уже есть в исходном коде, отключите автоматическое добавление En.');
      if (val.role !== 'parameter' && val.alias !== name &&
          !/^[A-Za-z_][A-Za-z_0-9]*$/.test(val.alias || ''))
        errors.push('Псевдоним для ' + name + ' должен быть допустимым C++ идентификатором.');
    }
    const aliases = pins.filter(([, v]) => v.role !== 'parameter').map(([name,v]) => v.alias || name);
    if (new Set(aliases).size !== aliases.length) errors.push('Повторяются названия входов или выходов.');
    for (const [key, fn] of Object.entries(parsed.functions || {})) {
      const fnName = fn.name || key;
      if (/(?:^|,)\s*[^,]*?=/.test(fn.params || ''))
        warnings.push('Функция ' + fnName + ' имеет параметры по умолчанию: FLProg может не сохранить значения по умолчанию; передавайте их явно при вызове.');
      if (/[.]{3}|\(\s*\*/.test(fn.params || ''))
        warnings.push('Функция ' + fnName + ' использует параметры, требующие ручной проверки после конвертации.');
    }
    if (/\bdelay\s*\(/.test(code)) warnings.push('delay() блокирует выполнение других блоков FLProg.');
    if (/\bfor\s*\(\s*;\s*;\s*\)/.test(maskNonCode(code)))
      warnings.push('Бесконечный цикл может остановить выполнение схемы FLProg.');
    if (/^\s*#\s*(?:if|ifdef|ifndef|else|elif|endif)\b/m.test(code))
      warnings.push('Условная компиляция #if/#ifdef требует проверки после импорта.');
    if (/^\s*#define\s+\w+\s*\(/m.test(code))
      warnings.push('Функциональные макросы #define могут быть обработаны некорректно.');
    return { errors, warnings };
  }

  // Preserve comments and strings when substituting identifiers for edited pin aliases.
  function replaceCodeIdentifiers(code, map) {
    let result = '', i = 0, state = 'code';
    while (i < code.length) {
      const ch = code[i], next = code[i + 1];
      if (state === 'code') {
        if (ch === '/' && next === '/') { state = 'line'; result += '//'; i += 2; continue; }
        if (ch === '/' && next === '*') { state = 'block'; result += '/*'; i += 2; continue; }
        if (ch === '"' || ch === "'") { state = ch; result += ch; i++; continue; }
        if (/[A-Za-z_]/.test(ch)) {
          let j = i + 1;
          while (j < code.length && /[A-Za-z0-9_]/.test(code[j])) j++;
          const word = code.slice(i, j);
          result += Object.prototype.hasOwnProperty.call(map, word) ? map[word] : word;
          i = j; continue;
        }
      } else if (state === 'line' && ch === '\n') state = 'code';
      else if (state === 'block' && ch === '*' && next === '/') {
        result += '*/'; i += 2; state = 'code'; continue;
      } else if ((state === '"' || state === "'") && ch === '\\') {
        result += code.slice(i, i + 2); i += 2; continue;
      } else if (ch === state) state = 'code';
      result += ch; i++;
    }
    return result;
  }

  root.ino2ubiCompat = { readText, openSourceFile, makeProject,
    inspectGeneratedXml, validateConverterInput, checkArrayAndDefineSafety, checkSharedExecutionSafety, checkWhileSafety, replaceCodeIdentifiers };
})(typeof window !== 'undefined' ? window : globalThis);
