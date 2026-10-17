/* FIX14: A // par String is emitted by FLProg as a C++ string literal, not an
 * Arduino String object. Keep the source's String semantics in both formats.
 * This is a source-to-source transform for code SECTIONS, not macro expansion.
 */
(function (root) {
  'use strict';
  function collect(variables, defines) {
    const names = new Set();
    for (const [name, info] of Object.entries(variables || {})) {
      if (info && info.role === 'parameter' && info.type === 'String' && /^[A-Za-z_]\w*$/.test(name)) names.add(name);
    }
    for (const def of defines || []) {
      if (def && def.role === 'parameter' && def.type === 'String' && /^[A-Za-z_]\w*$/.test(def.name || '')) names.add(def.name);
    }
    return [...names];
  }
  function transform(source, parameterNames, excludedNames) {
    const text = String(source || '');
    const selected = new Set(parameterNames || []);
    for (const name of excludedNames || []) selected.delete(name);
    if (!text.trim() || selected.size === 0) return text;
    // maskNonCode is defined by parser.js; it blanks comments, strings and
    // character literals without changing offsets or newlines.
    if (typeof maskNonCode !== 'function') throw new Error('Не загружен C++-парсер для строковых параметров.');
    const masked = maskNonCode(text);
    const aliases = new Map();
    const replacements = [];
    const token = /[A-Za-z_]\w*/g;
    let match;
    while ((match = token.exec(masked))) {
      const name = match[0];
      if (!selected.has(name)) continue;
      const pos = match.index;
      // Do not touch preprocessor directives or an object's/namespace's field.
      const lineStart = masked.lastIndexOf('\n', pos - 1) + 1;
      if (/^\s*#/.test(masked.slice(lineStart, pos))) continue;
      const before = masked.slice(0, pos).trimEnd();
      if (before.endsWith('.') || before.endsWith('->') || before.endsWith('::')) continue;
      if (!aliases.has(name)) {
        const stem = '__ino2ubi_string_' + name;
        let alias = stem, i = 2;
        while (new RegExp('\\b' + alias + '\\b').test(text) || [...aliases.values()].includes(alias)) alias = stem + '_' + i++;
        aliases.set(name, alias);
      }
      replacements.push({start:pos, end:pos + name.length, alias:aliases.get(name)});
    }
    if (!replacements.length) return text;
    let rendered = '', cursor = 0;
    for (const r of replacements) {
      rendered += text.slice(cursor, r.start) + r.alias;
      cursor = r.end;
    }
    rendered += text.slice(cursor);
    // A C++ String value is required here, rather than a raw FLProg parameter
    // expression (which can expand to e.g. "pool.ntp.org"). One snapshot per
    // execution is intentional: updated parameter values are read every loop.
    // The scoped block also prevents collisions when a block is used twice.
    const declarations = [...aliases].map(([name, alias]) => '  String ' + alias + ' = ' + name + ';').join('\n');
    return '{\n' + declarations + '\n' + rendered + '\n}';
  }
  root.ino2ubiStringParams = {collect, transform};
})(typeof window !== 'undefined' ? window : globalThis);
