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

  // Single place that interprets saved settings (used by the UI when a project is opened).
  // A project saved before the multi-instance option existed has no field: it means "unchecked" (single instance).
  function restoreSettings(settings) {
    const s = settings || {};
    return {
      blockName: String(s.blockName || ''),
      blockDescription: String(s.blockDescription || ''),
      enableInput: s.enableInput === true,
      allowMultipleInstances: s.allowMultipleInstances === true
    };
  }

  function makeProject(code, parsed, settings) {
    return {
      format: 'ino2ubi-project-v1',
      version: 1,
      code: String(code),
      parsed: JSON.parse(JSON.stringify(parsed)),
      settings: { blockName: String(settings.blockName || ''),
        blockDescription: String(settings.blockDescription || ''),
        enableInput: !!settings.enableInput, allowMultipleInstances: settings.allowMultipleInstances === true, remoteXYEepromOffset: settings.remoteXYEepromOffset || '0', exportMode: settings.exportMode || 'professional', professionalHeader: settings.professionalHeader || '', professionalHeaderFilename: settings.professionalHeaderFilename || '', targetProfile: settings.targetProfile || 'esp32-arduino-3.3.11' }
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
      if (numeric && d.role !== 'parameter')
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

  // A-04 / A-05: the parser reads directives only from the section before the
  // first setup()/loop(). A directive anywhere else outside a function body, and
  // any directive that the generator cannot reproduce, used to be dropped
  // silently. Block them with an explicit location instead.
  function checkTopLevelDirectives(code) {
    const errors = [];
    const source = String(code || '');
    const masked = typeof maskNonCode === 'function' ? maskNonCode(source) : source;
    const lines = masked.split('\n');
    const reported = new Set();
    let depth = 0, seenFunction = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const directive = line.match(/^[ \t]*#\s*(\w+)/);
      if (directive) {
        const kind = directive[1];
        if (depth === 0) {
          const where = 'на строке ' + (i + 1);
          if (/^(?:if|ifdef|ifndef|else|elif|elifdef|elifndef|endif)$/.test(kind)) {
            if (!reported.has('conditional'))
              errors.push('Условная компиляция #' + kind + ' ' + where + ' вне функций не поддерживается [CPP-CONDITION]: условие будет потеряно, а обе ветки попадут в блок. Оставьте одну ветку без #if/#ifdef или используйте условия только внутри setup()/loop().');
            reported.add('conditional');
          } else if (/^(?:undef|error|warning|line|include_next)$/.test(kind) || (kind === 'pragma' && !/^[ \t]*#\s*pragma\s+once\b/.test(line))) {
            if (!reported.has(kind))
              errors.push('Директива #' + kind + ' ' + where + ' вне функций не поддерживается [CPP-DIRECTIVE]: она была бы потеряна при экспорте в .ubi. Удалите её или перенесите в обычный C++ внутри функций.');
            reported.add(kind);
          } else if (seenFunction && (kind === 'define' || kind === 'include')) {
            if (!reported.has(kind + '-late'))
              errors.push('Директива #' + kind + ' ' + where + ' стоит после начала setup()/loop() [CPP-DIRECTIVE]: она была бы потеряна при экспорте. Перенесите её в начало скетча, перед setup().');
            reported.add(kind + '-late');
          }
        }
        continue; // directive text never contributes braces
      }
      if (!seenFunction && depth === 0 && /\bvoid\s+(?:setup|loop)\s*\(/.test(line)) seenFunction = true;
      for (const ch of line) {
        if (ch === '{') depth++;
        else if (ch === '}') depth = Math.max(0, depth - 1);
      }
    }
    return errors;
  }

  // Name of a global array from a parser declaration such as `const int values[10] = {0};`.
  const PRIMITIVE_ARRAY_ELEMENTS = /^(?:int|long|short|char|bool|boolean|byte|float|double|String|u?int(?:8|16|32)_t)$/;
  function arrayDeclName(decl) {
    const head = String(decl).split('=')[0];
    const m = head.match(/([A-Za-z_]\w*)\s*\[/);
    return m ? m[1] : null;
  }

  function validateConverterInput(code, parsed, enableInput, allowMultipleInstances = false) {
    const safety = checkArrayAndDefineSafety(code, parsed);
    const flow = checkSharedExecutionSafety(code);
    const loops = checkWhileSafety(code);
    const errors = [...safety.errors, ...flow.errors, ...loops.errors];
    const warnings = [...safety.warnings, ...flow.warnings, ...loops.warnings];
    // Always check the source rather than trusting saved .i2u.json metadata.
    const fresh = typeof parseArduinoCode === 'function' ? parseArduinoCode(code) : parsed;
    const globals = String(fresh.global_section_raw || '');
    let cleanGlobals = typeof maskNonCode === 'function' ? maskNonCode(globals) : globals;
    // Global section also contains helper bodies. Mask those entire functions;
    // otherwise local C++ expressions (e.g. return value * gain) look like globals.
    for (const helper of Object.values(fresh.functions || {})) {
      if (Number.isInteger(helper.start) && Number.isInteger(helper.end) && helper.start < cleanGlobals.length) {
        const end = Math.min(helper.end,cleanGlobals.length);
        cleanGlobals = cleanGlobals.slice(0,helper.start) +
          cleanGlobals.slice(helper.start,end).replace(/[^\n]/g,' ') + cleanGlobals.slice(end);
      }
    }
    const known = new Set(typeof PRIMITIVE_TYPES !== 'undefined' ? PRIMITIVE_TYPES : []);
    const declarations = cleanGlobals.replace(/^[ \t]*#(?:include|define|pragma)[^\n]*/gm, '');
    // 64-bit and uncommon primitive types must never be silently mapped to 32-bit.
    if (/\b(?:long\s+long|(?:u?int64_t)|unsigned\s+(?:int|char|short)|signed\s+char|int8_t|size_t)\s+[A-Za-z_*&]/.test(declarations))
      errors.push('Неподдерживаемый глобальный тип C++: безопасное отображение типа в FLProg не доказано; используйте поддерживаемый тип либо отдельную реализацию.');
    // Pointers, references, multidimensional indirection, pointer qualifiers.
    if (/(?:^|[;{}\n])\s*(?:(?:static|extern|const|volatile|unsigned|signed|struct)\s+)*(?:[A-Za-z_]\w*(?:::[A-Za-z_]\w*)*(?:\s*<[^;{}]+>)?(?:\s+[A-Za-z_]\w*)?)\s*[*&]+\s*(?:const\s+|volatile\s+|[*&]\s*)*[A-Za-z_]\w*/m.test(declarations))
      errors.push('Глобальный указатель/ссылка C++: безопасная генерация и изоляция пока не поддерживаются. Это сознательное ограничение: указатель, общий для нескольких экземпляров блока, может привести к конфликту (например, глобальный hw_timer_t* timer). Защита сохранена; вынесите логику в вызовы API FLProg или в локальные переменные функций.');
    // Simple primitive static globals are isolated with FLProg UUID tags in Professional.
    // Reject any non-primitive/static object, function-local static with nontrivial
    // constructor, or unsupported declarator rather than silently sharing state.
    if (allowMultipleInstances) for (const raw of (fresh.static_declarations || [])) {
      const decl=String(raw).trim();
      if (!/^static\s+/.test(decl)) continue;
      const scalar=/^static\s+(?:(?:const|volatile)\s+)*(?:bool|boolean|byte|char|short|int|long|float|double|u?int(?:8|16|32)_t|unsigned\s+(?:char|short|int|long))\s+[A-Za-z_]\w*\s*(?:=\s*[^;]+)?;$/;
      const array=/^static\s+(?:(?:const|volatile)\s+)*(?:bool|boolean|byte|char|short|int|long|float|double|u?int(?:8|16|32)_t|unsigned\s+(?:char|short|int|long))\s+[A-Za-z_]\w*\s*\[[1-9][0-9]*\]\s*(?:=\s*[^;]+)?;$/;
      if (!scalar.test(decl) && !array.test(decl))
        errors.push('Глобальная static-конструкция не может быть безопасно изолирована по экземплярам: '+decl.slice(0,90));
    }
    if (/\b(?:enum|struct|class|union)\s+[A-Za-z_]\w*\s*[{;:]/.test(declarations))
      errors.push('Глобальные enum/struct/class/union требуют отдельного безопасного преобразования.');
    // Template objects reach the declare section untagged: harmless for one instance only.
    if (allowMultipleInstances && /\b(?:std::)?[A-Za-z_]\w*\s*<[^;\n]+>\s+[A-Za-z_]\w*\s*[;=({]/.test(declarations))
      errors.push('Шаблонный глобальный объект: независимость экземпляров не подтверждена. Для режима «один экземпляр» снимите галочку «Использовать блок несколько раз в одном проекте».');
    // Global arrays of FLProg primitive types (int/float/bool/...) are isolated per instance by the
    // Professional generator (name_<UUID>). Arrays of any other element type (objects, templates,
    // pointers) are still refused: their element constructors/names cannot be isolated safely.
    if (allowMultipleInstances) {
      const arrayDecl = /(?:^|[;\n])\s*(?:const\s+|volatile\s+)*([A-Za-z_]\w*(?:::[A-Za-z_]\w*)*)\s+[A-Za-z_]\w*\s*\[[^\]]*\]/gm;
      let am;
      while ((am = arrayDecl.exec(declarations))) {
        if (!PRIMITIVE_ARRAY_ELEMENTS.test(am[1]) && !known.has(am[1])) {
          errors.push('Глобальный массив: тип элементов «' + am[1] + '» не поддерживается (изолируются только массивы int/float/bool/byte/char/String и т.п.).');
          break;
        }
      }
    }
    // A-03: an array declared inside a declarator list (int a = 1, c[3];) is not
    // at the start of a statement, so the check above cannot see it. The parser
    // moves such arrays into static_declarations; block every non-static one here.
    // Arrays found by the parser are all primitive-typed (see parser.js). Check their names:
    // the per-instance suffix is added to the name, so it must be unique and not shared with
    // another global entity of the same block.
    const arrayNames = [];
    for (const raw of (fresh.static_declarations || [])) {
      const d = String(raw).trim();
      if (!/\[[^\]]*\]/.test(d) || /^static\b/.test(d)) continue;
      const nm = arrayDeclName(d);
      if (nm) arrayNames.push(nm);
    }
    {
      const seen = new Set();
      const others = new Set([
        ...Object.keys(fresh.variables || {}),
        ...(fresh.defines || []).map(x => x.name),
        ...Object.entries(fresh.functions || {}).filter(([k]) => k !== 'setup' && k !== 'loop').map(([k, f]) => f.name || k)
      ]);
      for (const nm of arrayNames) {
        if (seen.has(nm)) errors.push('Конфликт имени массива ' + nm + ': массив объявлен повторно.');
        else if (others.has(nm)) errors.push('Конфликт имени массива ' + nm + ': то же имя используется у переменной, #define или функции блока.');
        seen.add(nm);
      }
    }
    for (const message of checkTopLevelDirectives(code)) errors.push(message);
    // Nested constructor expressions can be mistaken for a primitive declaration
    // by the lightweight parser (for example: String obj(String(pin));).
    // Refuse the unsafe case instead of silently exporting a wrong variable.
    if (/\bString\s+[A-Za-z_]\w*\s*\(\s*String\s*\(/.test(declarations))
      errors.push('Вложенный конструктор String не поддерживается надёжно: экспорт остановлен, чтобы не потерять объявление объекта.');
    for (const declaration of (fresh.extra_declarations || [])) {
      const d=String(declaration).trim();
      // A-02: also catches lists such as `Servo s1, s2;`.
      if (allowMultipleInstances && /^[A-Za-z_]\w*(?:::[A-Za-z_]\w*)*\s+[A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*\s*;?$/.test(d) && !known.has(d.split(/\s+/)[0]))
        errors.push('Объект без аргументов конструктора ('+d+'): невозможно гарантировать UUID каждого экземпляра. Задайте аргументы конструктора либо снимите галочку «Использовать блок несколько раз в одном проекте».');
      // constexpr/inline/thread_local variables are copied verbatim (no UUID): two instances would redefine them.
      if (allowMultipleInstances && /^(?:constexpr|inline|thread_local)\b/.test(d))
        errors.push('Глобальное объявление «'+d.replace(/\s+/g,' ').slice(0,60)+'» не получит UUID экземпляра: при нескольких экземплярах будет переопределено. Используйте обычную глобальную переменную (const/volatile допустимы) либо снимите галочку «Использовать блок несколько раз в одном проекте».');
    }
    // Guard against the parser silently omitting source declared after setup/loop.
    const structural = typeof maskNonCode === 'function' ? maskNonCode(String(code)) : String(code);
    const starts = [];
    for (const fn of ['setup','loop']) {
      const match = /\bvoid\s+(setup|loop)\s*\(\s*(?:void\s*)?\)\s*\{/g;
      let m;
      while ((m=match.exec(structural))) if(m[1]===fn) starts.push({start:m.index, brace:match.lastIndex-1, name:fn});
    }
    if (starts.length === 2) {
      const ranges=[];
      for (const entry of starts) {
        let depth=1,j=entry.brace+1;
        while (j<structural.length && depth>0) { if(structural[j]==='{')depth++; else if(structural[j]==='}')depth--;j++; }
        if(depth) errors.push('Незакрытая фигурная скобка функции '+entry.name+'(): экспорт остановлен.');
        ranges.push([entry.start,j]);
      }
      const tail = structural.slice(Math.max(...ranges.map(r=>r[1])))
        .replace(/^[ \t]*#[^\n]*/gm,'').trim();
      const between = structural.slice(Math.min(...ranges.map(r=>r[1])),Math.max(...ranges.map(r=>r[0])))
        .replace(/^[ \t]*#[^\n]*/gm,'').trim();
      // Helper functions after loop are already supported; reject only a bare declaration.
      for (const piece of [tail,between]) {
        const stripped=piece.replace(/(?:[A-Za-z_][\w:<>,*&\s]*\([^;{}]*\)\s*\{[^{}]*\})/g,'').trim();
        if (/^(?:[A-Za-z_]\w*\s+){1,3}[A-Za-z_]\w*\s*(?:=|;|\[)/.test(stripped))
          errors.push('Глобальное объявление после начала setup()/loop() может быть потеряно парсером: перенесите его перед setup().');
      }
    }
    // Early detection of unsupported arbitrary globals without preventing include directives.
    const full = String(code || '');
    // CPP-MULTILINE is reported with its line by conversion-safety.js; keep a fallback if it is absent.
    if (!root.ino2ubiConversionSafety && /^\s*#define[^\n]*\\\s*$/m.test(full))
      errors.push('Многострочный #define с продолжением строки пока не поддерживается безопасно.');
    if (/\b(?:WiFi|Wire|Serial|Serial1|Serial2)\s*\.\s*begin\s*\(/.test(structural))
      warnings.push('Общий аппаратный ресурс: убедитесь, что Wi-Fi, I2C или UART инициализируется единственным владельцем.');
    // Every instance runs its own setup(): an exclusive resource would be initialised once per instance.
    if (allowMultipleInstances && root.ino2ubiConversionSafety && root.ino2ubiConversionSafety.exclusiveResources) {
      for (const hit of root.ino2ubiConversionSafety.exclusiveResources(code))
        warnings.push('Риск выполнения [MULTI-RESOURCE] (строка ' + hit.line + '): блок использует ' + hit.what + '; при нескольких экземплярах инициализация/регистрация повторится в каждом экземпляре. ' +
          hit.advice + ' Либо снимите галочку «Использовать блок несколько раз в одном проекте».');
    }
    // An unrecognized annotated input/output/parameter must never disappear.
    for (const line of globals.split('\n')) {
      if (!/\/\/\s*(?:in|out|par|input|output|parameter)(?=\s*(?::|$))/i.test(line)) continue;
      const decl = line.split('//')[0].trim();
      const m = decl.match(/\b([A-Za-z_]\w*)\s*(?:=[^;]*)?;\s*$/);
      if (m && !Object.prototype.hasOwnProperty.call(fresh.variables||{},m[1]))
        errors.push('Помеченное объявление '+m[1]+' не распознано как контакт/параметр FLProg: экспорт заблокирован.');
    }
    // The generator groups variables, constructors and helpers; reject known
    // dependency-on-source-order patterns rather than moving declarations blindly.
    const knownGlobals = Object.keys(fresh.variables || {});
    for (const raw of fresh.extra_declarations || []) {
      const declaration = String(raw);
      const initializer = declaration.replace(/^[^=(]*[=(]/,'');
      const firstName = knownGlobals.find(n => new RegExp('\\b'+n+'\\b').test(initializer));
      if (firstName && !/^PubSubClient\s/.test(declaration) &&
          !(Array.isArray(parsed.declaration_order) && parsed.declaration_order.length))
        errors.push('Глобальный конструктор зависит от переменной '+firstName+'; отсутствуют данные исходного порядка объявлений. Перепарсите скетч.');
    }
    for (const [name, info] of Object.entries(fresh.variables || {})) {
      const value=String(info.default || '');
      if (Object.values(fresh.functions || {}).some(f => new RegExp('\\b'+(f.name||'')+'\\s*\\(').test(value)))
        errors.push('Инициализатор глобальной переменной '+name+' вызывает вспомогательную функцию; её прототип может отсутствовать в Code Professional.');
    }
    // Input/output variables cannot be declared const/volatile and rewritten as FLProg contacts safely.
    for (const [name, info] of Object.entries((parsed && parsed.variables) || {})) {
      if (info && info.role !== 'variable' && /\b(?:const|volatile|static)\b/.test(info.qualifiers || ''))
        errors.push('Контакт/параметр '+name+': квалификаторы const/volatile/static не поддержаны для роли '+info.role+'.');
    }
    // Only non-primitive element types are object arrays. Primitive arrays
    // already receive the blocking error above, so do not mislabel them.
    const objectArray = /^\s*(?:const\s+|volatile\s+)*([A-Za-z_]\w*(?:::[A-Za-z_]\w*)*)\s+[A-Za-z_]\w*\s*\[[^\]\n]*\]/gm;
    let arrayMatch;
    while ((arrayMatch=objectArray.exec(declarations))) {
      if (allowMultipleInstances && !known.has(arrayMatch[1]) && !/^(?:int|long|short|char|bool|byte|float|double|unsigned|signed|size_t|u?int(?:8|16|32|64)_t)$/.test(arrayMatch[1])) {
        warnings.push('Массивы объектов C++ требуют ручной проверки нескольких экземпляров: имена не всегда получают UUID.');
        break;
      }
    }
    if (!code.trim()) errors.push('Исходный код пуст.');
    if (!/\bvoid\s+setup\s*\(\s*(?:void\s*)?\)\s*\{/m.test(code))
      errors.push('Не найдена функция void setup() {...}.');
    if (!/\bvoid\s+loop\s*\(\s*(?:void\s*)?\)\s*\{/m.test(code))
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
    if (enableInput) {
      const taken = [];
      if (vars.En && vars.En.role !== 'input') taken.push('переменная/параметр En');
      if ((parsed.defines || []).some(d => d.name === 'En')) taken.push('#define En');
      if (Object.entries(parsed.functions || {}).some(([key, f]) => (f.name || key) === 'En')) taken.push('функция En');
      if ((fresh.extra_declarations || []).some(d => /(?:^|[\s*&,])En\s*(?:[;=({,\[]|$)/.test(String(d)))) taken.push('глобальный объект En');
      if ((fresh.static_declarations || []).some(d => /\bEn\s*(?:[;=\[,])/.test(String(d)))) taken.push('глобальный массив/static En');
      if (pins.some(([n, v]) => v.role !== 'parameter' && n !== 'En' && (v.alias || n) === 'En')) taken.push('контакт с псевдонимом En');
      if (taken.length)
        errors.push('Имя En занято (' + taken.join(', ') + '): автоматический вход En создать нельзя. Переименуйте идентификатор в коде или отключите галочку En.');
    }
    // Parameter defaults are validated by the generator at export time; report the same problems now,
    // while the user can still fix the sketch, instead of failing only when «Создать .ubi» is pressed.
    if (root.ino2ubiProfessional && root.ino2ubiProfessional.validateParameterDefault) {
      const checkDefault = (name, info) => {
        try { root.ino2ubiProfessional.validateParameterDefault(name, info); }
        catch (error) { errors.push(String(error.message)); }
      };
      for (const [name, info] of Object.entries(fresh.variables || {})) if (info.role === 'parameter') checkDefault(name, info);
      for (const d of fresh.defines || []) if (d.role === 'parameter') checkDefault(d.name, { type: d.type || 'String', default: d.value });
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
    // Conditionals outside functions are already blocked above; inside function
    // bodies they are kept verbatim and only need a review.
    if (/^\s*#\s*(?:if|ifdef|ifndef|else|elif|endif)\b/m.test(code) && !errors.some(m => /^Условная компиляция/.test(m)))
      warnings.push('Условная компиляция #if/#ifdef внутри функций сохраняется как есть; проверьте результат после импорта.');
    if (/^\s*#define\s+\w+\(/m.test(code))
      warnings.push('Функциональный макрос #define: проверьте сохранение определения и вызовов в итоговом C++ FLProg.');
    // conversion-safety.js / runtime-safety.js produce ID-tagged findings with line numbers.
    // Checks relaxed on purpose for Code Professional are skipped here:
    //  - CPP-CONDITION: placement of #if/#ifdef is handled above (line-aware, tagged);
    //  - CPP-MACRO, CPP-DEFAULT, CPP-FUNCTION, CPP-ARGUMENT: the Professional generator keeps
    //    one-line function-like macros verbatim (C4), default arguments in prototypes (A-01),
    //    function-pointer parameters verbatim, and the parser names unnamed arguments;
    //  - GLOBAL-ORDER: the original declaration order is preserved by declaration_order (H3).
    if (root.ino2ubiConversionSafety) {
      const skip = new Set(['CPP-CONDITION', 'CPP-MACRO', 'CPP-DEFAULT', 'CPP-FUNCTION', 'CPP-ARGUMENT', 'GLOBAL-ORDER']);
      for (const issue of root.ino2ubiConversionSafety.inspect(code, fresh))
        if (!skip.has(issue.id) && !errors.includes(issue.message)) errors.push(issue.message);
    }
    if (root.ino2ubiRuntimeSafety) {
      for (const message of root.ino2ubiRuntimeSafety.inspect(code, fresh, { board: 'esp32' }).warnings)
        if (!warnings.includes(message)) warnings.push(message);
    }
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

  root.ino2ubiCompat = { readText, openSourceFile, makeProject, restoreSettings,
    inspectGeneratedXml, validateConverterInput, checkArrayAndDefineSafety, checkSharedExecutionSafety, checkWhileSafety, replaceCodeIdentifiers };
})(typeof window !== 'undefined' ? window : globalThis);
