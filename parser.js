/**
 * Парсер Arduino скетчей (.ino) — извлечение переменных, функций, директив (порт с Python)
 */
const PRIMITIVE_TYPES_LIST = [...PRIMITIVE_TYPES].sort((a, b) => b.length - a.length);
const PRIMITIVE_TYPE_REGEX = new RegExp(
  '^(' + PRIMITIVE_TYPES_LIST.map(t => t.replace(/\s+/g, '\\s+')).join('|') + ')\\b\\s+(.+)$'
);

function maskComments(text) {
  // Length-preserving scanner. A URL, "//" or "/*" inside a C++ string is not a comment.
  let result = '', pos = 0, state = 'normal', escaped = false;
  while (pos < text.length) {
    const c = text[pos], next = text[pos + 1];
    if (state === 'line') {
      if (c === '\n') { state = 'normal'; result += c; } else result += ' ';
      pos++; continue;
    }
    if (state === 'block') {
      if (c === '*' && next === '/') { result += '  '; pos += 2; state = 'normal'; }
      else { result += c === '\n' ? '\n' : ' '; pos++; }
      continue;
    }
    if (state === 'string' || state === 'char') {
      result += c;
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if ((state === 'string' && c === '"') || (state === 'char' && c === "'")) state = 'normal';
      pos++; continue;
    }
    if (c === '/' && next === '/') { state = 'line'; result += '  '; pos += 2; continue; }
    if (c === '/' && next === '*') { state = 'block'; result += '  '; pos += 2; continue; }
    if (c === '"') state = 'string';
    else if (c === "'") state = 'char';
    result += c; pos++;
  }
  return result;
}

function maskNonCode(text) {
  // Keeps structural braces only; strings containing braces should not close a function.
  return maskComments(text).replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g,
    match => match.replace(/[^\n]/g, ' '));
}

function extractFunctionBody(code, funcName) {
  const escaped = funcName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp('void\\s+' + escaped + '\\s*\\(\\s*\\)\\s*\\{');
  const masked = maskNonCode(code);
  const match = masked.match(pattern);
  if (!match) return '';
  let startPos = match.index + match[0].length;
  let braceCount = 1;
  let pos = startPos;
  while (pos < code.length && braceCount > 0) {
    if (masked[pos] === '{') braceCount++;
    else if (masked[pos] === '}') braceCount--;
    pos++;
  }
  if (braceCount === 0) return code.slice(startPos, pos - 1).trim();
  return '';
}

function extractCustomFunctionBody(code, startPos) {
  const masked = maskNonCode(code);
  let braceCount = 1;
  let pos = startPos;
  while (pos < code.length && braceCount > 0) {
    if (masked[pos] === '{') braceCount++;
    else if (masked[pos] === '}') braceCount--;
    pos++;
  }
  if (braceCount === 0) return code.slice(startPos, pos - 1).trim();
  return '';
}

function extractGlobalSection(code) {
  const masked = maskNonCode(code);
  const setupMatch = masked.match(/\bvoid\s+setup\s*\(/);
  const loopMatch = masked.match(/\bvoid\s+loop\s*\(/);
  let firstFuncPos = code.length;
  if (setupMatch && setupMatch.index < firstFuncPos) firstFuncPos = setupMatch.index;
  if (loopMatch && loopMatch.index < firstFuncPos) firstFuncPos = loopMatch.index;
  return code.slice(0, firstFuncPos).trim();
}

function extractLeadingComment(code) {
  let i = 0;
  const n = code.length;
  while (i < n && /\s/.test(code[i])) i++;
  if (i >= n) return null;
  if (code.startsWith('/*', i)) {
    const end = code.indexOf('*/', i + 2);
    const commentBody = end === -1 ? code.slice(i + 2).trim() : code.slice(i + 2, end).trim();
    return commentBody || null;
  }
  if (code.startsWith('//', i)) {
    const lines = [];
    let pos = i;
    while (pos < n) {
      const lineEnd = code.indexOf('\n', pos);
      const end = lineEnd === -1 ? n : lineEnd;
      const line = code.slice(pos, end);
      if (line.trim().startsWith('//')) {
        lines.push(line.replace(/^\s*\/\/\s*/, '').trimEnd());
        pos = end + 1;
      } else break;
    }
    const commentBody = lines.join('\n').trim();
    return commentBody || null;
  }
  return null;
}

function parseFunctionParams(paramsStr) {
  if (!paramsStr || !paramsStr.trim() || paramsStr.trim() === 'void') return [];
  // Split only outside nested calls, templates, braces and quoted values.
  const params = [];
  splitTopLevel(paramsStr, ',').forEach((part, index) => {
    let param = part.trim();
    if (!param) return;
    const defaultPos = findParameterDefault(param);
    if (defaultPos !== -1) param = param.slice(0, defaultPos).trim();
    const arrayMatch = param.match(/(\[[^\]]*\])\s*$/);
    const arraySuffix = arrayMatch ? arrayMatch[1] : '';
    if (arrayMatch) param = param.slice(0, arrayMatch.index).trimEnd();
    const nameMatch = param.match(/\b([A-Za-z_]\w*)\s*$/);
    if (!nameMatch) return;
    const prefix = param.slice(0, nameMatch.index).trim();
    if (!prefix) {
      // Unnamed primitive argument: give it a stable name for the FLProg fields.
      params.push({ type: param, name: '_arg' + (index + 1) });
      return;
    }
    params.push({ type: (prefix + arraySuffix).trim(), name: nameMatch[1] });
  });
  return params;
}

function findParameterDefault(text) {
  let paren = 0, brace = 0, bracket = 0, inString = null, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") { inString = ch; continue; }
    if (ch === '(') paren++; else if (ch === ')') paren--;
    else if (ch === '{') brace++; else if (ch === '}') brace--;
    else if (ch === '[') bracket++; else if (ch === ']') bracket--;
    else if (ch === '=' && paren === 0 && brace === 0 && bracket === 0) return i;
  }
  return -1;
}

function parseFunctions(code) {
  const masked = maskNonCode(code);
  // Preprocessor directives are not function declarations.
  const structural = masked.replace(/^[ \t]*#[^\n]*/gm, s => ' '.repeat(s.length));
  const functions = {};
  let segmentStart = 0;
  const firstSystemFunc = structural.search(/\bvoid\s+(?:setup|loop)\s*\(/);
  let depth = 0;
  let i = 0;
  while (i < structural.length) {
    const ch = structural[i];
    if (ch === '{' && depth === 0) {
      const declaration = structural.slice(segmentStart, i);
      const m = declaration.match(/^\s*([\s\S]*?)\b([A-Za-z_]\w*)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*(?:noexcept\s*)?$/);
      if (m) {
        const returnType = m[1].trim().replace(/\s+/g, ' ');
        const name = m[2];
        const paramsStr = code.slice(segmentStart, i).match(/\b[A-Za-z_]\w*\s*\(([\s\S]*)\)\s*(?:noexcept\s*)?$/);
        if (returnType && /^[A-Za-z_][\w\s:<>,*&]*$/.test(returnType) &&
            !/\b(?:if|for|while|switch|else|return|new)\b/.test(returnType)) {
          let nesting = 1, j = i + 1;
          while (j < structural.length && nesting) {
            if (structural[j] === '{') nesting++;
            else if (structural[j] === '}') nesting--;
            j++;
          }
          if (nesting) break;
          if (name !== 'setup' && name !== 'loop') {
            let key = name, idx = 2;
            while (Object.prototype.hasOwnProperty.call(functions, key)) key = name + '#' + idx++;
            const signatureParams = m[3].trim();
            functions[key] = {
              name,
              return_type: returnType,
              params: signatureParams,
              parsed_params: parseFunctionParams(signatureParams),
              body: code.slice(i + 1, j - 1).trim(),
              location: firstSystemFunc < 0 || segmentStart < firstSystemFunc ? 'до setup/loop' : 'после loop',
              start: segmentStart + (declaration.match(/^\s*/) || [''])[0].length,
              end: j
            };
          }
          // Never parse declarations within a function as separate globals.
          i = j;
          segmentStart = i;
          continue;
        }
      }
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth = Math.max(0, depth - 1);
      if (depth === 0) segmentStart = i + 1;
    } else if (ch === ';' && depth === 0) segmentStart = i + 1;
    i++;
  }
  return functions;
}

function splitTopLevel(text, delimiter) {
  const parts = [];
  let buf = [];
  let paren = 0, bracket = 0, brace = 0;
  let inString = false, stringChar = '', escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      buf.push(ch);
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === stringChar) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
      buf.push(ch);
      continue;
    }
    if (ch === '(') paren++;
    else if (ch === ')') paren = Math.max(paren - 1, 0);
    else if (ch === '[') bracket++;
    else if (ch === ']') bracket = Math.max(bracket - 1, 0);
    else if (ch === '{') brace++;
    else if (ch === '}') brace = Math.max(brace - 1, 0);
    if (ch === delimiter && paren === 0 && bracket === 0 && brace === 0) {
      const part = buf.join('').trim();
      if (part) parts.push(part);
      buf = [];
    } else buf.push(ch);
  }
  const tail = buf.join('').trim();
  if (tail) parts.push(tail);
  return parts;
}

function splitInitializer(decl) {
  let paren = 0, bracket = 0, brace = 0;
  let inString = false, stringChar = '', escape = false;
  for (let idx = 0; idx < decl.length; idx++) {
    const ch = decl[idx];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === stringChar) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
      continue;
    }
    if (ch === '(') paren++;
    else if (ch === ')') paren = Math.max(paren - 1, 0);
    else if (ch === '[') bracket++;
    else if (ch === ']') bracket = Math.max(bracket - 1, 0);
    else if (ch === '{') brace++;
    else if (ch === '}') brace = Math.max(brace - 1, 0);
    if (ch === '=' && paren === 0 && bracket === 0 && brace === 0) {
      const namePart = decl.slice(0, idx).trim();
      const valuePart = decl.slice(idx + 1).trim();
      return [namePart, valuePart || null];
    }
  }
  return [decl.trim(), null];
}

function splitStatements(text) {
  const statements = [];
  let buf = [];
  let paren = 0, bracket = 0, brace = 0;
  let inString = false, stringChar = '', escape = false;
  let startIdx = 0;
  for (let idx = 0; idx < text.length; idx++) {
    const ch = text[idx];
    if (inString) {
      buf.push(ch);
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === stringChar) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
      buf.push(ch);
      continue;
    }
    if (ch === '(') paren++;
    else if (ch === ')') paren = Math.max(paren - 1, 0);
    else if (ch === '[') bracket++;
    else if (ch === ']') bracket = Math.max(bracket - 1, 0);
    else if (ch === '{') brace++;
    else if (ch === '}') brace = Math.max(brace - 1, 0);
    if (ch === ';' && paren === 0 && bracket === 0 && brace === 0) {
      const statement = buf.join('').trim();
      if (statement) statements.push([statement, startIdx]);
      buf = [];
      startIdx = idx + 1;
    } else buf.push(ch);
  }
  return statements;
}

function parseGlobalSection(globalSection, functions) {
  let section = globalSection;
  for (const [funcName, funcInfo] of Object.entries(functions)) {
    if (funcInfo.location !== 'до setup/loop') continue;
    const escaped = funcName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const headPattern = new RegExp('(unsigned\\s+long|unsigned\\s+int|void|int|long|bool|boolean|float|double|byte|char|String|uint8_t|uint16_t|uint32_t|int32_t)\\s+' + escaped + '\\s*\\([^)]*\\)\\s*\\{');
    let match;
    while ((match = maskComments(section).match(headPattern)) !== null) {
      const start = match.index;
      const braceStart = match.index + match[0].length;
      let depth = 1;
      let pos = braceStart;
      while (pos < section.length && depth > 0) {
        if (section[pos] === '{') depth++;
        else if (section[pos] === '}') depth--;
        pos++;
      }
      const end = depth === 0 ? pos : section.length;
      section = section.slice(0, start) + section.slice(end);
    }
  }

  const globalIncludes = section.match(/^\s*#include[^\n]*$/gm) || [];
  globalIncludes.forEach((s, i) => { globalIncludes[i] = s.trim(); });

  function inferDefineType(value) {
    if (!value) return 'String';
    const s = value.trim();
    if (/^"(?:[^"\\]|\\.)*"$/.test(s) || /^'(?:[^'\\]|\\.)*'$/.test(s)) return 'String';
    if (/^(true|false)$/i.test(s)) return 'boolean';
    if (/^[+-]?(?:0[xX][0-9a-fA-F]+|0[bB][01]+|[0-9]+)[uUlL]*$/.test(s)) return 'long';
    if (/^[+-]?(?:(?:[0-9]+\.[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?|[0-9]+[eE][+-]?[0-9]+)[fF]?$/.test(s)) return 'float';
    return 'String'; // macro expression / symbolic constant is not a numeric default
  }

  const defines = [];
  let lineOffset = 0;
  section.split('\n').forEach(line => {
    const stripped = line.trim();
    if (!stripped.startsWith('#define')) {
      lineOffset += line.length + 1;
      return;
    }
    const m = stripped.match(/^#define\s+([A-Za-z_][A-Za-z0-9_]*)\s*(.*)$/);
    if (!m) {
      lineOffset += line.length + 1;
      return;
    }
    const name = m[1];
    let rest = m[2].trim();
    // Маркер роли для #define ищем в комментарии на той же строке: // par
    const role = /\/\/\s*(?:par|parameter)\b/i.test(rest) ? 'parameter' : 'global';
    const value = maskComments(rest).trim();
    defines.push({ name, value, role, type: inferDefineType(value), position: lineOffset });
    lineOffset += line.length + 1;
  });

  const variables = {};
  const extraDeclarations = [];
  const staticDeclarations = [];

  function normalizeType(typeName) {
    return typeName.trim().replace(/\s+/g, ' ');
  }

  function maskDirectives(text) {
    return text.replace(/^[ \t]*#.*$/gm, match => ' '.repeat(match.length));
  }
  const maskedSection = maskComments(maskDirectives(section));

  for (const [statement, startIdx] of splitStatements(maskedSection)) {
    const stmt = statement.trim();
    if (!stmt || stmt.startsWith('#')) continue;
    // Прототипы функций и объявления объектов вида Type Name(args);
    // Раньше мы их просто пропускали, теперь сохраняем как extra_declarations,
    // чтобы, например, строки вида "U8G2_ST7920_128X64_1_HW_SPI u8g2(...);" попадали в блок declare.
    if (/\w+\s*\([^)]*\)\s*$/.test(stmt) && !stmt.includes('=')) {
      extraDeclarations.push(stmt + ';');
      continue;
    }

    // Определяем строку исходного кода, к которой относится текущее объявление.
    // Берём позицию самого объявления в "замаскированной" секции, чтобы корректно
    // найти строку комментария (// in, // out, // par) без сдвига на соседнюю строку.
    const stmtIndexInMasked = maskedSection.indexOf(statement, startIdx);
    const anchorIdx = stmtIndexInMasked !== -1 ? stmtIndexInMasked : startIdx;
    const lineStart = section.lastIndexOf('\n', anchorIdx) + 1;
    let lineEnd = section.indexOf('\n', anchorIdx);
    if (lineEnd === -1) lineEnd = section.length;
    const lineText = section.slice(lineStart, lineEnd);

    // Автоопределение роли переменной по комментарию на той же строке:
    // // in, // out, // par
    let role = 'variable';
    if (/\/\/\s*(?:in|input)\b/i.test(lineText)) role = 'input';
    else if (/\/\/\s*(?:out|output)\b/i.test(lineText)) role = 'output';
    else if (/\/\/\s*(?:par|parameter)\b/i.test(lineText)) role = 'parameter';

    const qualifiers = stmt.match(/^\s*((?:(?:static|const|volatile)\s+)+)/);
    const qualifierText = qualifiers ? qualifiers[1].trim().replace(/\s+/g, ' ') + ' ' : '';
    const stmtNoQual = qualifiers ? stmt.slice(qualifiers[0].length) : stmt;
    const isStatic = /^\s*static\b/.test(stmt);

    const primitiveMatch = stmtNoQual.match(PRIMITIVE_TYPE_REGEX);
    if (primitiveMatch) {
      const varType = normalizeType(primitiveMatch[1]);
      const decls = primitiveMatch[2].trim();
      // A C array must remain a global C declaration. It cannot be converted
      // to a FLProg scalar variable or its [size] and initializer are lost.
      // Keep the legacy static_declarations field for saved-project compatibility;
      // it now also carries non-static C arrays.
      splitTopLevel(decls, ',').forEach(decl => {
        const one = (decl || '').trim();
        if (!one) return;
        const [namePart, valuePart] = splitInitializer(one);
        if (isStatic || /\[[^\]]*\]/.test(namePart)) {
          staticDeclarations.push(qualifierText + varType + ' ' + one + ';');
          return;
        }
        const nameMatch = namePart.match(/[A-Za-z_][A-Za-z0-9_]*/g);
        const varName = nameMatch ? nameMatch[nameMatch.length - 1] : null;
        if (!varName) return;
        variables[varName] = {
          type: varType,
          default: valuePart,
          role,
          alias: varName,
          position: startIdx
        };
      });
      continue;
    }
    if (/^[A-Za-z_][A-Za-z0-9_:<>]*\s+.+$/s.test(stmt)) extraDeclarations.push(stmt + ';');
  }

  return [variables, globalIncludes, defines, extraDeclarations, staticDeclarations];
}

function parseArduinoCode(code) {
  const leadingComment = extractLeadingComment(code);
  const functions = parseFunctions(code);
  const globalSectionRaw = extractGlobalSection(code);
  let declarationsOnly = globalSectionRaw;
  // A helper defined before setup() is not a global variable declaration.
  // Mask its complete definition, retaining positions for legacy // in/out/par comments.
  for (const info of Object.values(functions)) {
    if (info.start < declarationsOnly.length) {
      const end = Math.min(info.end, declarationsOnly.length);
      declarationsOnly = declarationsOnly.slice(0, info.start) +
        declarationsOnly.slice(info.start, end).replace(/[^\n]/g, ' ') +
        declarationsOnly.slice(end);
    }
  }
  const [variables, globalIncludes, defines, extraDeclarations, staticDeclarations] =
    parseGlobalSection(declarationsOnly, functions);
  return {
    leading_comment: leadingComment,
    variables,
    functions,
    global_section_raw: globalSectionRaw,
    global_includes: globalIncludes,
    defines,
    extra_declarations: extraDeclarations,
    static_declarations: staticDeclarations
  };
}

// Для GitHub Pages / standalone
if (typeof window !== 'undefined') {
  window.parseArduinoCode = parseArduinoCode;
  window.extractFunctionBody = extractFunctionBody;
}
