/**
 * Генератор SIXX XML для FLProg (.ubi) — порт с Python
 */
function uuidv4() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function escapeHtml(s) {
  // XML needs no DOM and must work identically offline and in tests.
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeCodeForSixx(text) {
  let s = escapeHtml(text);
  s = s.replace(/\(/g, '&#40;').replace(/\)/g, '&#41;');
  s = s.replace(/,/g, '&#44;').replace(/%/g, '&#37;');
  return s;
}

// НЕ МЕНЯТЬ: используется для блока info; иначе FLProg зависает при открытии описания.
function escapeDescriptionForSixx(text) {
  let s = escapeHtml(text);
  s = s.replace(/,/g, '&#44;');
  return s;
}

// Убирает внешние кавычки из строкового значения (если они есть)
function removeStringQuotes(value) {
  if (typeof value !== 'string') return value;
  const s = value.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function findTopLevelEquals(str) {
  let paren = 0, bracket = 0, brace = 0;
  let inString = false, stringChar = '', escape = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
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
    if (ch === '=' && paren === 0 && bracket === 0 && brace === 0) return i;
  }
  return -1;
}

// Простой формат типа как в эталоне 11.ubi: только имя типа (без " class"), пустой объект — для входов/выходов
function createSixxDataTypeSimple(varType, typeId) {
  const typeClass = getTypeClassName(varType);
  return '\t\t\t\t<sixx.object sixx.id="' + typeId + '" sixx.name="type" sixx.type="' + typeClass + '" sixx.env="Arduino" >\n\t\t\t\t</sixx.object>\n';
}

// Формат типа параметра как в Пример_правильного_параметра.ubi: "TypeName class" + только instanceCollection (без color/colorSymbol)
function createSixxDataTypeParam(varType, typeId, nextId) {
  const typeClass = getTypeClassName(varType);
  const instanceCollId = nextId();
  const instanceId = nextId();
  let xml = '\t\t\t\t\t<sixx.object sixx.id="' + typeId + '" sixx.name="type" sixx.type="' + typeClass + ' class" sixx.env="Arduino" >\n';
  xml += '\t\t\t\t\t\t<sixx.object sixx.id="' + instanceCollId + '" sixx.name="instanceCollection" sixx.type="OrderedCollection" sixx.env="Core" >\n';
  xml += '\t\t\t\t\t\t\t<sixx.object sixx.id="' + instanceId + '" sixx.type="' + typeClass + '" sixx.env="Arduino" >\n';
  xml += '\t\t\t\t\t\t\t</sixx.object>\n';
  xml += '\t\t\t\t\t\t\t<sixx.object sixx.idref="' + instanceId + '" />\n';
  xml += '\t\t\t\t\t\t</sixx.object>\n';
  xml += '\t\t\t\t\t</sixx.object>\n';
  return xml;
}

function createUbiXmlSixx(
  blockName,
  blockDescription,
  variables,
  functions,
  globalIncludes,
  defines,
  extraDeclarations,
  staticDeclarations,
  setupCode,
  loopCode,
  enableInput = false,
  options = {}
) {
  setupCode = setupCode.split('\n').map(l => l.trimEnd()).join('\n');
  loopCode = loopCode.split('\n').map(l => l.trimEnd()).join('\n');
  if (enableInput) loopCode = 'if(En)\n{\n' + loopCode + '\n}';
  const loopCodeEncoded = escapeCodeForSixx(loopCode);
  const setupCodeEncoded = escapeCodeForSixx(setupCode);

  let currentId = 0;
  function nextId() {
    currentId++;
    return currentId;
  }

  const rootId = 0;
  const codeBlockId = nextId();
  const mainUuidId = nextId();
  const mainUuid = uuidv4();
  const blocksCollId = nextId();
  const labelId = nextId();
  const inputsCollId = nextId();

  const codeOrderPos = v => v.position !== undefined ? v.position : 999999999;

  let inputsXml = '';
  let inputsList = Object.entries(variables).filter(([, info]) => info.role === 'input');
  inputsList.sort((a, b) => codeOrderPos(a[1]) - codeOrderPos(b[1]));

  if (enableInput) {
    const enAdaptorId = nextId(), enObjId = nextId(), enTypeId = nextId();
    const enNameId = nextId(), enIdInObjId = nextId(), enCommentId = nextId(), enAdaptorUuidId = nextId();
    const enIdInObjUuid = uuidv4(), enAdaptorUuid = uuidv4();
    inputsXml += '\t\t\t<sixx.object sixx.id="' + enAdaptorId + '" sixx.type="InputsOutputsAdaptorForUserBlock" sixx.env="Arduino" >\n';
    inputsXml += '\t\t\t\t<sixx.object sixx.id="' + enObjId + '" sixx.name="object" sixx.type="UniversalBlockInputOutput" sixx.env="Arduino" >\n';
    inputsXml += '\t\t\t\t\t<sixx.object sixx.name="block" sixx.idref="' + codeBlockId + '" />\n';
    inputsXml += createSixxDataTypeSimple('boolean', enTypeId);
    inputsXml += '\t\t\t\t\t<sixx.object sixx.name="isInput" sixx.type="True" sixx.env="Core" />\n';
    inputsXml += '\t\t\t\t\t<sixx.object sixx.id="' + enNameId + '" sixx.name="name" sixx.type="String" sixx.env="Core" >En</sixx.object>\n';
    inputsXml += '\t\t\t\t\t<sixx.object sixx.name="isNot" sixx.type="False" sixx.env="Core" />\n';
    inputsXml += '\t\t\t\t\t<sixx.object sixx.id="' + enIdInObjId + '" sixx.name="id" sixx.type="String" sixx.env="Core" >' + enIdInObjUuid + '</sixx.object>\n';
    inputsXml += '\t\t\t\t</sixx.object>\n\t\t\t\t<sixx.object sixx.id="' + enCommentId + '" sixx.name="comment" sixx.type="String" sixx.env="Core" ></sixx.object>\n';
    inputsXml += '\t\t\t\t<sixx.object sixx.id="' + enAdaptorUuidId + '" sixx.name="id" sixx.type="String" sixx.env="Core" >' + enAdaptorUuid + '</sixx.object>\n';
    inputsXml += '\t\t\t</sixx.object>\n';
  }

  inputsList.forEach(([varName, varInfo]) => {
    const adaptorId = nextId(), objId = nextId(), typeId = nextId();
    const nameId = nextId(), idInObjId = nextId(), commentId = nextId(), adaptorUuidId = nextId();
    const idInObjUuid = uuidv4(), adaptorUuid = uuidv4();
    inputsXml += '\t\t\t<sixx.object sixx.id="' + adaptorId + '" sixx.type="InputsOutputsAdaptorForUserBlock" sixx.env="Arduino" >\n';
    inputsXml += '\t\t\t\t<sixx.object sixx.id="' + objId + '" sixx.name="object" sixx.type="UniversalBlockInputOutput" sixx.env="Arduino" >\n';
    inputsXml += '\t\t\t\t\t<sixx.object sixx.name="block" sixx.idref="' + codeBlockId + '" />\n';
    inputsXml += createSixxDataTypeSimple(varInfo.type, typeId);
    inputsXml += '\t\t\t\t\t<sixx.object sixx.name="isInput" sixx.type="True" sixx.env="Core" />\n';
    inputsXml += '\t\t\t\t\t<sixx.object sixx.id="' + nameId + '" sixx.name="name" sixx.type="String" sixx.env="Core" >' + escapeHtml(varInfo.alias || varName) + '</sixx.object>\n';
    inputsXml += '\t\t\t\t\t<sixx.object sixx.name="isNot" sixx.type="False" sixx.env="Core" />\n';
    inputsXml += '\t\t\t\t\t<sixx.object sixx.id="' + idInObjId + '" sixx.name="id" sixx.type="String" sixx.env="Core" >' + idInObjUuid + '</sixx.object>\n';
    inputsXml += '\t\t\t\t</sixx.object>\n\t\t\t\t<sixx.object sixx.id="' + commentId + '" sixx.name="comment" sixx.type="String" sixx.env="Core" ></sixx.object>\n';
    inputsXml += '\t\t\t\t<sixx.object sixx.id="' + adaptorUuidId + '" sixx.name="id" sixx.type="String" sixx.env="Core" >' + adaptorUuid + '</sixx.object>\n';
    inputsXml += '\t\t\t</sixx.object>\n';
  });

  const outputsCollId = nextId();
  let outputsXml = '';
  let outputsList = Object.entries(variables).filter(([, info]) => info.role === 'output');
  outputsList.sort((a, b) => codeOrderPos(a[1]) - codeOrderPos(b[1]));
  const idBase = 153438280;
  outputsList.forEach(([varName, varInfo], idx) => {
    const adaptorId = nextId(), objId = nextId(), idSourceId = nextId(), typeId = nextId();
    const nameId = nextId(), commentId = nextId(), uuidObjId = nextId(), outputUuid = uuidv4();
    outputsXml += '\t\t\t<sixx.object sixx.id="' + adaptorId + '" sixx.type="InputsOutputsAdaptorForUserBlock" sixx.env="Arduino" >\n';
    outputsXml += '\t\t\t\t<sixx.object sixx.id="' + objId + '" sixx.name="object" sixx.type="UniversalBlockInputOutput" sixx.env="Arduino" >\n';
    outputsXml += '\t\t\t\t\t<sixx.object sixx.id="' + idSourceId + '" sixx.name="id" sixx.type="SmallInteger" sixx.env="Core" >' + (idBase + idx * 1000) + '</sixx.object>\n';
    outputsXml += '\t\t\t\t\t<sixx.object sixx.name="block" sixx.idref="' + codeBlockId + '" />\n';
    outputsXml += createSixxDataTypeSimple(varInfo.type, typeId);
    outputsXml += '\t\t\t\t\t<sixx.object sixx.name="isInput" sixx.type="False" sixx.env="Core" />\n';
    outputsXml += '\t\t\t\t\t<sixx.object sixx.id="' + nameId + '" sixx.name="name" sixx.type="String" sixx.env="Core" >' + escapeHtml(varInfo.alias || varName) + '</sixx.object>\n';
    outputsXml += '\t\t\t\t\t<sixx.object sixx.name="isNot" sixx.type="False" sixx.env="Core" />\n';
    outputsXml += '\t\t\t\t\t<sixx.object sixx.name="nameCash" sixx.idref="' + nameId + '" />\n';
    outputsXml += '\t\t\t\t</sixx.object>\n\t\t\t\t<sixx.object sixx.id="' + commentId + '" sixx.name="comment" sixx.type="String" sixx.env="Core" ></sixx.object>\n';
    outputsXml += '\t\t\t\t<sixx.object sixx.id="' + uuidObjId + '" sixx.name="id" sixx.type="String" sixx.env="Core" >' + outputUuid + '</sixx.object>\n';
    outputsXml += '\t\t\t</sixx.object>\n';
  });

  const varsCollId = nextId(), nameStrId = nextId(), infoId = nextId(), infoStrId = nextId();
  const runsId = nextId(), runsArrId = nextId(), runsValId = nextId(), valuesArrId = nextId();
  const paramsCollId = nextId();
  let paramsXml = '';
  const paramsList = [];
  Object.entries(variables).forEach(([name, info]) => {
    if (info.role === 'parameter') paramsList.push({ pos: codeOrderPos(info), name, info });
  });
  (defines || []).forEach(d => {
    if (d.role === 'parameter') {
      paramsList.push({
        pos: d.position !== undefined ? d.position : 999999999,
        name: d.name,
        info: { type: d.type || 'String', alias: d.alias || d.name, default: d.value != null ? String(d.value) : '' }
      });
    }
  });
  paramsList.sort((a, b) => a.pos - b.pos);
  paramsList.forEach(({ name, info: varInfo }) => {
    const adaptorId = nextId(), paramId = nextId(), paramNameId = nextId(), paramTypeId = nextId();
    const defaultValId = nextId(), commentId = nextId(), uuidParamId = nextId(), uuidAdaptId = nextId();
    const paramUuid = uuidv4(), adaptUuid = uuidv4();
    let defaultVal = varInfo.type === 'String' ? (varInfo.default || '') : (varInfo.default || '0');
    if ((varInfo.type === 'bool' || varInfo.type === 'boolean') && ['true', '1'].includes(String(defaultVal).trim().toLowerCase())) defaultVal = '1';
    else if ((varInfo.type === 'bool' || varInfo.type === 'boolean')) defaultVal = '0';
    // Для строковых параметров убираем внешние кавычки
    if (varInfo.type === 'String') {
      defaultVal = removeStringQuotes(String(defaultVal));
    }
    paramsXml += '\t\t\t\t<sixx.object sixx.id="' + adaptorId + '" sixx.type="InputsOutputsAdaptorForUserBlock" sixx.env="Arduino" >\n';
    paramsXml += '\t\t\t\t\t<sixx.object sixx.id="' + paramId + '" sixx.name="object" sixx.type="UserBlockParametr" sixx.env="Arduino" >\n';
    paramsXml += '\t\t\t\t\t\t<sixx.object sixx.id="' + paramNameId + '" sixx.name="name" sixx.type="String" sixx.env="Core" >' + escapeHtml(varInfo.alias || name) + '</sixx.object>\n';
    // Тип параметра как у FLProg-блока: простой StringDataType без \"class\" и instanceCollection
    paramsXml += createSixxDataTypeSimple(varInfo.type, paramTypeId);
    paramsXml += '\t\t\t\t\t\t<sixx.object sixx.name="hasDefaultValue" sixx.type="True" sixx.env="Core" />\n';
    if (varInfo.type === 'String') {
      paramsXml += '\t\t\t\t\t\t<sixx.object sixx.id="' + defaultValId + '" sixx.name="stringDefaultValue" sixx.type="String" sixx.env="Core" >' + escapeHtml(defaultVal) + '</sixx.object>\n';
    } else {
      try {
        if (varInfo.type === 'float' || varInfo.type === 'double') {
          paramsXml += '\t\t\t\t\t\t<sixx.object sixx.id="' + defaultValId + '" sixx.name="numberDefaultValue" sixx.type="Float" sixx.env="Core" >' + escapeHtml(defaultVal) + '</sixx.object>\n';
        } else {
          paramsXml += '\t\t\t\t\t\t<sixx.object sixx.id="' + defaultValId + '" sixx.name="numberDefaultValue" sixx.type="SmallInteger" sixx.env="Core" >' + escapeHtml(defaultVal) + '</sixx.object>\n';
        }
      } catch (_) {
        paramsXml += '\t\t\t\t\t\t<sixx.object sixx.id="' + defaultValId + '" sixx.name="numberDefaultValue" sixx.type="SmallInteger" sixx.env="Core" >0</sixx.object>\n';
      }
    }
    paramsXml += '\t\t\t\t\t\t<sixx.object sixx.name="hasUpRange" sixx.type="False" sixx.env="Core" />\n';
    paramsXml += '\t\t\t\t\t\t<sixx.object sixx.name="hasDownRange" sixx.type="False" sixx.env="Core" />\n';
    paramsXml += '\t\t\t\t\t\t<sixx.object sixx.id="' + commentId + '" sixx.name="comment" sixx.type="String" sixx.env="Core" ></sixx.object>\n';
    paramsXml += '\t\t\t\t\t\t<sixx.object sixx.id="' + uuidParamId + '" sixx.name="id" sixx.type="String" sixx.env="Core" >' + paramUuid + '</sixx.object>\n';
    paramsXml += '\t\t\t\t\t</sixx.object>\n\t\t\t\t\t<sixx.object sixx.id="' + uuidAdaptId + '" sixx.name="id" sixx.type="String" sixx.env="Core" >' + adaptUuid + '</sixx.object>\n';
    paramsXml += '\t\t\t\t</sixx.object>\n';
  });

  const loopPartId = nextId(), loopCodeId = nextId();
  const setupPartId = nextId(), setupCodeId = nextId();
  const declarePartId = nextId(), declareCollId = nextId();
  let declareXml = '';
  const varsList = Object.entries(variables).filter(([, info]) => info.role === 'variable');

  (globalIncludes || []).forEach(inc => {
    const line = (inc || '').trim();
    if (!line.startsWith('#include')) return;
    const rest = line.slice(8).trim();
    const declId = nextId(), defineId = nextId(), nameId = nextId();
    declareXml += '\t\t\t\t\t<sixx.object sixx.id="' + declId + '" sixx.type="CodeUserBlockDeclareDefineBlock" sixx.env="Arduino" >\n';
    declareXml += '\t\t\t\t\t\t<sixx.object sixx.id="' + defineId + '" sixx.name="define" sixx.type="String" sixx.env="Core" >&#35;include</sixx.object>\n';
    declareXml += '\t\t\t\t\t\t<sixx.object sixx.id="' + nameId + '" sixx.name="name" sixx.type="String" sixx.env="Core" >' + escapeHtml(rest) + '</sixx.object>\n';
    declareXml += '\t\t\t\t\t</sixx.object>\n';
  });

  (defines || []).forEach(d => {
    if (d.role === 'parameter') return;
    const declId = nextId(), defineId = nextId(), nameId = nextId(), lastPartId = nextId();
    const dName = String(d.name || '').trim();
    let dValue = String(d.value || '').trim();
    // Для обычного #define сохраняем кавычки: макрос должен оставаться C++ выражением.
    declareXml += '\t\t\t\t\t<sixx.object sixx.id="' + declId + '" sixx.type="CodeUserBlockDeclareDefineBlock" sixx.env="Arduino" >\n';
    declareXml += '\t\t\t\t\t\t<sixx.object sixx.id="' + defineId + '" sixx.name="define" sixx.type="String" sixx.env="Core" >&#35;define</sixx.object>\n';
    declareXml += '\t\t\t\t\t\t<sixx.object sixx.id="' + nameId + '" sixx.name="name" sixx.type="String" sixx.env="Core" >' + escapeHtml(dName) + '</sixx.object>\n';
    declareXml += '\t\t\t\t\t\t<sixx.object sixx.id="' + lastPartId + '" sixx.name="lastPart" sixx.type="String" sixx.env="Core" >' + escapeHtml(dValue) + '</sixx.object>\n';
    declareXml += '\t\t\t\t\t</sixx.object>\n';
  });

  (staticDeclarations || []).forEach(lineRaw => {
    const line = (lineRaw || '').trim();
    if (!line.endsWith(';')) return;
    const stmt = line.slice(0, -1).trim();
    // Contains both static variables and C array declarations (including
    // non-static arrays); the latter must not be exported as scalar FLProg pins.
    // Preserve the last identifier (variable name), not the first identifier
    // after optional qualifiers (which may be `static` or `volatile`).
    const eqPos = findTopLevelEquals(stmt);
    const left = (eqPos >= 0 ? stmt.slice(0, eqPos) : stmt).trim();
    const m = left.match(/\b([A-Za-z_][A-Za-z0-9_]*)\s*(\[[^\]]*\])?\s*$/);
    if (!m) return;
    const firstPart = left.slice(0, m.index).trim();
    const namePart = m[1];
    const arraySuffix = m[2] || '';
    const value = eqPos >= 0 ? stmt.slice(eqPos + 1).trim() : '';
    const lastPart = arraySuffix + (eqPos >= 0 ? ' = ' + escapeCodeForSixx(value) : '') + ';';
    const declId = nextId(), declNameId = nextId(), declLastId = nextId(), declFirstId = nextId();
    declareXml += '\t\t\t\t\t<sixx.object sixx.id="' + declId + '" sixx.type="CodeUserBlockDeclareStandartBlock" sixx.env="Arduino" >\n';
    declareXml += '\t\t\t\t\t\t<sixx.object sixx.id="' + declNameId + '" sixx.name="name" sixx.type="String" sixx.env="Core" >' + escapeHtml(namePart) + '</sixx.object>\n';
    declareXml += '\t\t\t\t\t\t<sixx.object sixx.id="' + declLastId + '" sixx.name="lastPart" sixx.type="String" sixx.env="Core" >' + lastPart + '</sixx.object>\n';
    declareXml += '\t\t\t\t\t\t<sixx.object sixx.id="' + declFirstId + '" sixx.name="firstPart" sixx.type="String" sixx.env="Core" >' + escapeHtml(firstPart) + '</sixx.object>\n';
    declareXml += '\t\t\t\t\t</sixx.object>\n';
  });

  (extraDeclarations || []).forEach(lineRaw => {
    const line = (lineRaw || '').trim();
    if (!line.endsWith(';')) return;
    const stmt = line.slice(0, -1).trim();
    const declId = nextId(), declNameId = nextId(), declLastId = nextId(), declFirstId = nextId();
    let firstPart, namePart, lastPart;
    const eqPos = findTopLevelEquals(stmt);
    if (eqPos >= 0) {
      const leftSide = stmt.slice(0, eqPos).trim();
      const valueSide = stmt.slice(eqPos + 1).trim();
      const nameMatch = leftSide.match(/\b([A-Za-z_][A-Za-z0-9_]*)\s*$/);
      namePart = nameMatch ? nameMatch[1] : '';
      firstPart = nameMatch ? leftSide.slice(0, nameMatch.index).trim() : leftSide;
      lastPart = '= ' + escapeCodeForSixx(valueSide) + ';';
    } else {
      // Обычный случай: ищем имя в конце выражения (varName; / objName;)
      let nameMatch = stmt.match(/\b([A-Za-z_][A-Za-z0-9_]*)\s*$/);
      if (nameMatch) {
        namePart = nameMatch[1];
        firstPart = stmt.slice(0, nameMatch.index).trim();
        lastPart = ';';
      } else {
        // Особый случай: объявления объектов вида "Type Name(args...);"
        // Например: U8G2_ST7920_128X64_1_HW_SPI u8g2(U8G2_R0, /* CS=*/ 10, /* reset=*/ 8);
        const ctorMatch = stmt.match(/^\s*([A-Za-z_][A-Za-z0-9_:<>]*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
        if (ctorMatch) {
          const typeName = ctorMatch[1];
          const varName = ctorMatch[2];
          namePart = varName;
          firstPart = typeName;
          // Остаток вместе с аргументами конструктора
          const rest = stmt.slice(ctorMatch[0].length - 1).trim(); // начинаем с '('
          lastPart = rest ? escapeCodeForSixx(rest) + ';' : ';';
        } else {
          // Фолбэк: не смогли выделить имя — отдаём всё выражение в lastPart
          namePart = '';
          firstPart = '';
          lastPart = escapeCodeForSixx(stmt) + ';';
        }
      }
    }
    declareXml += '\t\t\t\t\t<sixx.object sixx.id="' + declId + '" sixx.type="CodeUserBlockDeclareStandartBlock" sixx.env="Arduino" >\n';
    declareXml += '\t\t\t\t\t\t<sixx.object sixx.id="' + declNameId + '" sixx.name="name" sixx.type="String" sixx.env="Core" >' + escapeHtml(namePart) + '</sixx.object>\n';
    declareXml += '\t\t\t\t\t\t<sixx.object sixx.id="' + declLastId + '" sixx.name="lastPart" sixx.type="String" sixx.env="Core" >' + lastPart + '</sixx.object>\n';
    declareXml += '\t\t\t\t\t\t<sixx.object sixx.id="' + declFirstId + '" sixx.name="firstPart" sixx.type="String" sixx.env="Core" >' + escapeHtml(firstPart) + '</sixx.object>\n';
    declareXml += '\t\t\t\t\t</sixx.object>\n';
  });

  varsList.forEach(([varName, varInfo]) => {
    const declId = nextId(), declNameId = nextId(), declLastId = nextId(), declFirstId = nextId();
    let defaultVal = varInfo.default;
    // Внутренние переменные C++ должны сохранять кавычки строковых литералов.
    const lastPart = defaultVal ? '= ' + escapeCodeForSixx(String(defaultVal).trim()) + ';' : ';';
    declareXml += '\t\t\t\t\t<sixx.object sixx.id="' + declId + '" sixx.type="CodeUserBlockDeclareStandartBlock" sixx.env="Arduino" >\n';
    declareXml += '\t\t\t\t\t\t<sixx.object sixx.id="' + declNameId + '" sixx.name="name" sixx.type="String" sixx.env="Core" >' + escapeHtml((varInfo.alias || varName || '').trim()) + '</sixx.object>\n';
    declareXml += '\t\t\t\t\t\t<sixx.object sixx.id="' + declLastId + '" sixx.name="lastPart" sixx.type="String" sixx.env="Core" >' + lastPart + '</sixx.object>\n';
    declareXml += '\t\t\t\t\t\t<sixx.object sixx.id="' + declFirstId + '" sixx.name="firstPart" sixx.type="String" sixx.env="Core" >' + escapeHtml((varInfo.type || '').trim()) + '</sixx.object>\n';
    declareXml += '\t\t\t\t\t</sixx.object>\n';
  });

  const funcPartId = nextId(), funcCollId = nextId();
  let functionsXml = '';
  Object.entries(functions || {}).forEach(([funcName, funcInfo]) => {
    const funcId = nextId(), funcBodyId = nextId(), funcBodyStringId = nextId();
    const funcRunsId = nextId(), funcRunsArrayId = nextId(), funcRunsLengthId = nextId();
    const funcRunsValuesId = nextId(), funcProtoId = nextId(), funcRetTypeId = nextId();
    const funcNameId = nextId(), funcParamsCollId = nextId();
    const body = (funcInfo.body || '').split('\n').map(l => l.trimEnd()).join('\n');
    const bodyEncoded = escapeCodeForSixx(body);
    functionsXml += '\t\t\t\t\t<sixx.object sixx.id="' + funcId + '" sixx.type="CodeUserBlockFunction" sixx.env="Arduino" >\n';
    functionsXml += '\t\t\t\t\t\t<sixx.object sixx.id="' + funcBodyId + '" sixx.name="functionBody" sixx.type="Text" sixx.env="Core" >\n';
    functionsXml += '\t\t\t\t\t\t\t<sixx.object sixx.id="' + funcBodyStringId + '" sixx.name="string" sixx.type="String" sixx.env="Core" >' + bodyEncoded + '</sixx.object>\n';
    functionsXml += '\t\t\t\t\t\t\t<sixx.object sixx.id="' + funcRunsId + '" sixx.name="runs" sixx.type="RunArray" sixx.env="Core" >\n';
    functionsXml += '\t\t\t\t\t\t\t\t<sixx.object sixx.id="' + funcRunsArrayId + '" sixx.name="runs" sixx.type="Array" sixx.env="Core" >\n';
    functionsXml += '\t\t\t\t\t\t\t\t\t<sixx.object sixx.id="' + funcRunsLengthId + '" sixx.type="SmallInteger" sixx.env="Core" >' + body.length + '</sixx.object>\n';
    functionsXml += '\t\t\t\t\t\t\t\t</sixx.object>\n';
    functionsXml += '\t\t\t\t\t\t\t\t<sixx.object sixx.id="' + funcRunsValuesId + '" sixx.name="values" sixx.type="Array" sixx.env="Core" >\n';
    functionsXml += '\t\t\t\t\t\t\t\t\t<sixx.object sixx.type="UndefinedObject" sixx.env="Core" />\n';
    functionsXml += '\t\t\t\t\t\t\t\t</sixx.object>\n';
    functionsXml += '\t\t\t\t\t\t\t</sixx.object>\n';
    functionsXml += '\t\t\t\t\t\t</sixx.object>\n';
    functionsXml += '\t\t\t\t\t<sixx.object sixx.id="' + funcProtoId + '" sixx.name="parsesFunctionName" sixx.type="CodeUserBlockFunctionName" sixx.env="Arduino" >\n';
    functionsXml += '\t\t\t\t\t\t<sixx.object sixx.id="' + funcRetTypeId + '" sixx.name="declare" sixx.type="String" sixx.env="Core" >' + escapeHtml(funcInfo.return_type || 'void') + '</sixx.object>\n';
    functionsXml += '\t\t\t\t\t\t<sixx.object sixx.id="' + funcNameId + '" sixx.name="name" sixx.type="String" sixx.env="Core" >' + escapeHtml(funcInfo.name || funcName) + '</sixx.object>\n';
    functionsXml += '\t\t\t\t\t\t<sixx.object sixx.id="' + funcParamsCollId + '" sixx.name="parametrs" sixx.type="OrderedCollection" sixx.env="Core" >\n';
    (funcInfo.parsed_params || []).forEach(param => {
      const fparamId = nextId(), fparamTypeId = nextId(), fparamNameId = nextId();
      functionsXml += '\t\t\t\t\t\t\t<sixx.object sixx.id="' + fparamId + '" sixx.type="CodeUserBlockFunctionParametr" sixx.env="Arduino" >\n';
      functionsXml += '\t\t\t\t\t\t\t\t<sixx.object sixx.id="' + fparamTypeId + '" sixx.name="declare" sixx.type="String" sixx.env="Core" >' + escapeHtml(param.type || '') + '</sixx.object>\n';
      functionsXml += '\t\t\t\t\t\t\t\t<sixx.object sixx.id="' + fparamNameId + '" sixx.name="name" sixx.type="String" sixx.env="Core" >' + escapeHtml(param.name || '') + '</sixx.object>\n';
      functionsXml += '\t\t\t\t\t\t\t</sixx.object>\n';
    });
    functionsXml += '\t\t\t\t\t\t</sixx.object>\n\t\t\t\t\t</sixx.object>\n\t\t\t\t\t</sixx.object>\n';
  });

  const libsId = nextId();

  let xml = '<sixx.object sixx.id="' + rootId + '" sixx.type="BlocksLibraryElement" sixx.env="Arduino" >\n';
  xml += '\t<sixx.object sixx.id="' + codeBlockId + '" sixx.name="typeClass" sixx.type="CodeUserBlock" sixx.env="Arduino" >\n';
  xml += '\t\t<sixx.object sixx.id="' + blocksCollId + '" sixx.name="blocks" sixx.type="OrderedCollection" sixx.env="Core" ></sixx.object>\n';
  xml += '\t\t<sixx.object sixx.id="' + labelId + '" sixx.name="label" sixx.type="String" sixx.env="Core" >' + escapeHtml(blockName) + '</sixx.object>\n';
  xml += inputsXml
    ? '\t\t<sixx.object sixx.id="' + inputsCollId + '" sixx.name="inputs" sixx.type="OrderedCollection" sixx.env="Core" >\n' + inputsXml + '\t\t</sixx.object>\n'
    : '\t\t<sixx.object sixx.id="' + inputsCollId + '" sixx.name="inputs" sixx.type="OrderedCollection" sixx.env="Core" ></sixx.object>\n';
  xml += outputsXml
    ? '\t\t<sixx.object sixx.id="' + outputsCollId + '" sixx.name="outputs" sixx.type="OrderedCollection" sixx.env="Core" >\n' + outputsXml + '\t\t</sixx.object>\n'
    : '\t\t<sixx.object sixx.id="' + outputsCollId + '" sixx.name="outputs" sixx.type="OrderedCollection" sixx.env="Core" ></sixx.object>\n';
  xml += '\t\t<sixx.object sixx.id="' + varsCollId + '" sixx.name="variables" sixx.type="OrderedCollection" sixx.env="Core" ></sixx.object>\n';
  xml += '\t\t<sixx.object sixx.id="' + mainUuidId + '" sixx.name="id" sixx.type="String" sixx.env="Core" >' + mainUuid + '</sixx.object>\n';
  xml += '\t\t<sixx.object sixx.id="' + nameStrId + '" sixx.name="name" sixx.type="String" sixx.env="Core" >' + escapeHtml(blockName) + '</sixx.object>\n';
  // НЕ МЕНЯТЬ: runsLength должен быть длиной строки описания, иначе FLProg зависает при открытии описания.
  const descriptionEscaped = escapeDescriptionForSixx(blockDescription);
  const runsLength = descriptionEscaped.length;
  xml += '\t\t<sixx.object sixx.id="' + infoId + '" sixx.name="info" sixx.type="Text" sixx.env="Core" >\n';
  xml += '\t\t\t<sixx.object sixx.id="' + infoStrId + '" sixx.name="string" sixx.type="String" sixx.env="Core" >' + descriptionEscaped + '</sixx.object>\n';
  xml += '\t\t\t<sixx.object sixx.id="' + runsId + '" sixx.name="runs" sixx.type="RunArray" sixx.env="Core" >\n';
  xml += '\t\t\t\t<sixx.object sixx.id="' + runsArrId + '" sixx.name="runs" sixx.type="Array" sixx.env="Core" >\n';
  xml += '\t\t\t\t\t<sixx.object sixx.id="' + runsValId + '" sixx.type="SmallInteger" sixx.env="Core" >' + runsLength + '</sixx.object>\n';
  xml += '\t\t\t\t</sixx.object>\n\t\t\t\t<sixx.object sixx.id="' + valuesArrId + '" sixx.name="values" sixx.type="Array" sixx.env="Core" >\n';
  xml += '\t\t\t\t\t<sixx.object sixx.type="UndefinedObject" sixx.env="Core" />\n';
  xml += '\t\t\t\t</sixx.object>\n\t\t\t</sixx.object>\n\t\t</sixx.object>\n';
  xml += paramsXml
    ? '\t\t<sixx.object sixx.id="' + paramsCollId + '" sixx.name="parametrs" sixx.type="OrderedCollection" sixx.env="Core" >\n' + paramsXml + '\t\t</sixx.object>\n'
    : '\t\t<sixx.object sixx.id="' + paramsCollId + '" sixx.name="parametrs" sixx.type="OrderedCollection" sixx.env="Core" ></sixx.object>\n';
  /* Объекты с текстом кода — отдельно; loop/setup ссылаются на них через idref (как в эталоне .ubi) */
  xml += '\t\t<sixx.object sixx.id="' + loopCodeId + '" sixx.name="code" sixx.type="String" sixx.env="Core" >' + loopCodeEncoded + '</sixx.object>\n';
  xml += '\t\t<sixx.object sixx.id="' + setupCodeId + '" sixx.name="code" sixx.type="String" sixx.env="Core" >' + setupCodeEncoded + '</sixx.object>\n';
  xml += '\t\t<sixx.object sixx.id="' + loopPartId + '" sixx.name="loopCodePart" sixx.type="CodeUserBlockLoopCodePart" sixx.env="Arduino" >\n';
  xml += '\t\t\t<sixx.object sixx.name="code" sixx.idref="' + loopCodeId + '" />\n';
  xml += '\t\t</sixx.object>\n';
  xml += '\t\t<sixx.object sixx.id="' + setupPartId + '" sixx.name="setupCodePart" sixx.type="CodeUserBlockSetupCodePart" sixx.env="Arduino" >\n';
  xml += '\t\t\t<sixx.object sixx.name="code" sixx.idref="' + setupCodeId + '" />\n';
  xml += '\t\t</sixx.object>\n';
  xml += '\t\t<sixx.object sixx.id="' + declarePartId + '" sixx.name="declareCodePart" sixx.type="CodeUserBlockDeclareCodePart" sixx.env="Arduino" >\n';
  xml += '\t\t\t<sixx.object sixx.id="' + declareCollId + '" sixx.name="code" sixx.type="OrderedCollection" sixx.env="Core" >\n' + declareXml + '\t\t\t</sixx.object>\n';
  xml += '\t\t</sixx.object>\n';
  xml += '\t\t<sixx.object sixx.id="' + funcPartId + '" sixx.name="functionCodePart" sixx.type="CodeUserBlockFunctuinCodePart" sixx.env="Arduino" >\n';
  xml += '\t\t\t<sixx.object sixx.id="' + funcCollId + '" sixx.name="code" sixx.type="OrderedCollection" sixx.env="Core" >\n' + functionsXml + '\t\t\t</sixx.object>\n';
  xml += '\t\t</sixx.object>\n';
  xml += '\t\t<sixx.object sixx.id="' + libsId + '" sixx.name="userLibraries" sixx.type="OrderedCollection" sixx.env="Core" ></sixx.object>\n';
  xml += '\t\t<sixx.object sixx.name="notCanManyUse" sixx.type="' + (options.singleInstance ? 'True' : 'False') + '" sixx.env="Core" />\n';
  xml += '\t</sixx.object>\n</sixx.object>\n';
  return xml;
}

if (typeof window !== 'undefined') {
  window.createUbiXmlSixx = createUbiXmlSixx;
}
