/**
 * Константы ino2ubi — конвертер Arduino в блоки FLProg
 */
const VERSION = '2.16-RC2-AUDIT-FIX-H3-CANDIDATE-CORE3311';
/** Дата последнего обновления (подставляется автоматически при push в main) */
const LAST_UPDATED = '2026-11-13T22:00:00+02:00';

const PRIMITIVE_TYPES = new Set([
  'int', 'long', 'unsigned long', 'bool', 'boolean', 'float', 'double',
  'byte', 'char', 'String', 'uint8_t', 'int16_t', 'uint16_t', 'int32_t', 'uint32_t'
]);

const TYPE_MAPPING = {
  'int': 'IntegerDataType',
  'long': 'LongDataType',
  'unsigned long': 'LongDataType',
  'bool': 'BooleanDataType',
  'boolean': 'BooleanDataType',
  'float': 'FloatDataType',
  'double': 'FloatDataType',
  'byte': 'ByteDataType',
  'char': 'CharDataType',
  'String': 'StringDataType',
  'uint8_t': 'ByteDataType',
  'int16_t': 'IntegerDataType',
  'uint16_t': 'IntegerDataType',
  'int32_t': 'LongDataType',
  'uint32_t': 'LongDataType'
};

function getTypeClassName(varType) {
  return TYPE_MAPPING[varType] || 'IntegerDataType';
}


// FIX22: FLProg SIXX numeric defaults are numbers, not C++ source literals.
// Accept ordinary Arduino/C++ integral literals, strip legal U/L/LL suffixes,
// and keep values exact (reject expressions and integers beyond JS safe range).
function normalizeCppIntegerDefault(raw, parameterName) {
  const source = String(raw == null ? '' : raw).trim();
  const m = /^([+-]?)(0[xX][0-9a-fA-F]+|0[bB][01]+|(?:0[0-7]+|[1-9][0-9]*|0))((?:[uU](?:[lL]{1,2})?|[lL]{1,2}[uU]?))?$/.exec(source);
  if (!m) throw new Error('Некорректное целочисленное значение параметра ' + parameterName + ': ' + source);
  const suffix = (m[3] || '').toLowerCase();
  if (suffix && !/^(?:u|ul|ull|l|ll|lu|llu)$/.test(suffix)) {
    throw new Error('Некорректное целочисленное значение параметра ' + parameterName + ': ' + source);
  }
  let value;
  try {
    const digits = m[2];
    value = /^0[0-7]+$/.test(digits) ? BigInt('0o' + digits.slice(1)) : BigInt(digits);
  } catch (_) {
    throw new Error('Некорректное целочисленное значение параметра ' + parameterName + ': ' + source);
  }
  if (m[1] === '-') value = -value;
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error('Целочисленное значение параметра ' + parameterName + ' выходит за безопасный диапазон: ' + source);
  }
  return value.toString();
}
