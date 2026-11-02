/* Numeric C++ literals in // par: validate against target types, store decimal in SIXX.
 * Retain the original literal (e.g. 60000UL) in the user's Arduino sketch.
 */
(function (root) {
  'use strict';
  const decimalLimits = {
    byte: [0n,255n], uint8_t: [0n,255n],
    int16_t: [-32768n,32767n], uint16_t: [0n,65535n],
    int32_t: [-2147483648n,2147483647n], uint32_t: [0n,4294967295n],
    long: [-2147483648n,2147483647n],
    'unsigned long': [0n,4294967295n],
    char: [-128n,127n]
  };
  const integerTypes = new Set([...Object.keys(decimalLimits), 'int']);
  const skipTypes = new Set(['String','bool','boolean','float','double']);
  function parseInteger(raw) {
    const source = String(raw ?? '').trim();
    // A C++ integral literal with optional sign and legal unsigned/long suffix.
    // Prevent expressions being silently changed into a numeric value.
    const match = /^([+-]?)(0[xX][0-9a-fA-F']+|0[bB][01']+|0[0-7']*|[1-9][0-9']*)([uUlL]*)$/.exec(source);
    if (!match) throw new Error('ожидался целочисленный литерал C++ (например 60000UL)');
    const suffix = match[3];
    if (suffix && !/^(?:[uU](?:[lL]|ll|LL)?|(?:[lL]|ll|LL)[uU]?)$/.test(suffix)) {
      throw new Error('недопустимый суффикс: ' + suffix);
    }
    const digits = match[2];
    // C++14 separators must occur strictly between digits.
    if (digits.includes("'")) {
      const allowed = /^0[xX][0-9a-fA-F]+(?:'[0-9a-fA-F]+)*$|^0[bB][01]+(?:'[01]+)*$|^(?:0[0-7]*|[1-9][0-9]*)(?:'[0-9]+)*$/;
      if (!allowed.test(digits)) throw new Error('недопустимые разделители цифр');
    }
    const clean = digits.replace(/'/g, '');
    let value;
    if (/^0[xX]/.test(clean)) value = BigInt(clean);
    else if (/^0[bB]/.test(clean)) value = BigInt(clean);
    else if (/^0[0-7]+$/.test(clean)) value = BigInt('0o' + clean.slice(1));
    else value = BigInt(clean);
    return match[1] === '-' ? -value : value;
  }
  function parseCharacterLiteral(raw) {
    const source=String(raw||'').trim();
    if (!/^'(?:\\.|[^'\\])'$/.test(source) && !/^'\\(?:x[0-9a-fA-F]{1,2}|[0-7]{1,3})'$/.test(source))
      throw new Error('ожидался одиночный символьный литерал char');
    const inner=source.slice(1,-1);
    if (inner[0] !== '\\') return BigInt(inner.codePointAt(0));
    if (/^\\x[0-9a-fA-F]{1,2}$/.test(inner)) return BigInt('0x'+inner.slice(2));
    if (/^\\[0-7]{1,3}$/.test(inner)) return BigInt('0o'+inner.slice(1));
    const escapes={'n':10,'r':13,'t':9,'0':0,'\\':92,"'":39,'"':34,'a':7,'b':8,'f':12,'v':11};
    if (!Object.prototype.hasOwnProperty.call(escapes,inner[1])) throw new Error('неподдерживаемая escape-последовательность char');
    return BigInt(escapes[inner[1]]);
  }
  function normalizeBoolean(raw,name) {
    const value=String(raw??'false').trim();
    if (/^(?:true|1)$/i.test(value)) return '1';
    if (/^(?:false|0)$/i.test(value)) return '0';
    throw new Error('Некорректное логическое значение параметра '+name+': '+value+'. Допустимо true, false, 1 или 0.');
  }
  function normalizeFloat(raw,name) {
    const value=String(raw??'0').trim();
    if (!/^[+-]?(?:(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)[fF]?$/.test(value))
      throw new Error('Некорректное вещественное значение параметра '+name+': '+value+'. Ожидался конечный числовой литерал.');
    const number=Number(value.replace(/[fF]$/,''));
    if (!Number.isFinite(number)) throw new Error('Некорректное вещественное значение параметра '+name+': '+value+'. Переполнение.');
    return value.replace(/[fF]$/,'');
  }
  function normalizeInteger(raw, type, board, name) {
    const display = String(raw ?? '').trim();
    const actualType = String(type || '').trim();
    try {
      const value = actualType === 'char' && display.startsWith("'") ? parseCharacterLiteral(display) : parseInteger(display);
      let bounds = actualType === 'int'
        ? (board && board !== 'esp32' ? [-32768n,32767n] : [-2147483648n,2147483647n])
        : decimalLimits[actualType];
      if (!bounds) throw new Error('неподдерживаемый целочисленный тип ' + actualType);
      if (value < bounds[0] || value > bounds[1]) {
        throw new Error('выход за диапазон ' + actualType + ' (' + bounds[0] + '…' + bounds[1] + ')');
      }
      return value.toString(10);
    } catch (error) {
      throw new Error('Некорректное целочисленное значение параметра ' +
        (name || '(без имени)') + ': ' + display + '. ' + error.message);
    }
  }
  function normalizeValue(raw, type, board, name) {
    if (integerTypes.has(type)) return normalizeInteger(raw, type, board, name);
    if (type === 'bool' || type === 'boolean') return normalizeBoolean(raw,name);
    if (type === 'float' || type === 'double') return normalizeFloat(raw,name);
    return String(raw ?? '');
  }
  function validateParameters(parsed, board) {
    const errors = [];
    const items = Object.entries((parsed && parsed.variables) || {})
      .filter(([,info]) => info && info.role === 'parameter')
      .map(([name, info]) => ({name, info}));
    for (const d of (parsed && parsed.defines) || []) {
      if (d.role === 'parameter' && !items.some(x => x.name === d.name))
        items.push({name:d.name,info:{type:d.type || 'String',default:d.value}});
    }
    for (const {name,info} of items) {
      const type = String(info.type || '').trim();
      if (!integerTypes.has(type) && !['bool','boolean','float','double'].includes(type)) continue;
      const raw = info.default == null || String(info.default).trim() === '' ? '0' : info.default;
      try { normalizeValue(raw,type,board,name); }
      catch (err) { errors.push(err.message); }
    }
    return errors;
  }
  root.ino2ubiNumberLiterals = {parseInteger,parseCharacterLiteral,normalizeBoolean,normalizeFloat,normalizeInteger,normalizeValue,validateParameters};
})(typeof window !== 'undefined' ? window : globalThis);
