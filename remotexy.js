/* RemoteXY 4.1.11 (FLProg-managed station/AP; local, AP, or cloud as source specifies) to CodeUserBlock .ubi adapter.
 * Keeps the native packed RemoteXY protocol layout intact, but maps recognized
 * binary GUI controls to FLProg Bool and bounded char[] GUI text to String.
 * Unknown byte-valued controls remain Byte; unsupported types fail closed.
 */
(function (root) {
  'use strict';
  function fail(message) { throw new Error('RemoteXY: ' + message); }
  function extractSetting(source, name, defaultValue) {
    const found = source.match(new RegExp('^\\s*#define\\s+' + name + '\\s+("(?:[^"\\\\]|\\\\.)*"|\\d+)\\s*(?:\\/\\/.*)?$', 'm'));
    return found ? found[1] : defaultValue;
  }
  // Parse only active directives / API calls. Never auto-switch between network modes.
  function withoutComments(source) {
    return source.replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g,
      (all, literal) => literal || all.replace(/[^\r\n]/g, ' '));
  }
  function cxxString(literal, title, allowEmpty = false) {
    if (!/^"(?:\\.|[^"\\])*"$/.test(literal || '')) fail('неверная строка ' + title + '.');
    try {
      const value = JSON.parse(literal);
      if (value.length > 256 || /[\r\n\0]/.test(value)) fail('неверное значение ' + title + '.');
      return value;
    } catch (error) { fail('строка ' + title + ' должна быть обычной строкой в двойных кавычках.'); }
  }
  function readConnection(source) {
    const clean = withoutComments(source);
    const definitions = Array.from(clean.matchAll(/^\s*#define\s+(REMOTEXY_MODE__\w+)\b[^\r\n]*$/gm), m => m[1]);
    if (definitions.length > 1) fail('задано несколько режимов REMOTEXY_MODE__: оставьте ровно один.');
    const modeByMacro = /^REMOTEXY_MODE__(?:WIFI|ESP32CORE_WIFI|ESP8266CORE_ESP8266WIFI|ESP8266WIFI_LIB)$/;
    const apByMacro = /^REMOTEXY_MODE__(?:WIFI_POINT|ESP32CORE_WIFI_POINT|ESP8266CORE_ESP8266WIFI_POINT|ESP8266WIFI_LIB_POINT|ESP8266WIFIPOINT_LIB)$/;
    const cloudByMacro = /^REMOTEXY_MODE__(?:WIFI_CLOUD|ESP32CORE_WIFI_CLOUD|ESP8266CORE_ESP8266WIFI_CLOUD|ESP8266WIFI_LIB_CLOUD)$/;
    let mode = null;
    if (definitions.length) {
      mode = modeByMacro.test(definitions[0]) ? 'wifi' : apByMacro.test(definitions[0]) ? 'ap' : cloudByMacro.test(definitions[0]) ? 'cloud' : null;
      if (!mode) fail('режим ' + definitions[0] + ' пока не поддерживается (только Wi-Fi, Wi-Fi точка доступа, Wi-Fi Cloud).');
    } else {
      // Current RemoteXY editor may emit direct CRemoteXYNet constructors without #define mode.
      const hasPoint = /\bnew\s+CRemoteXYNet_WiFiPoint\s*\(/.test(clean);
      const hasStation = /\bnew\s+CRemoteXYNet_WiFi\s*\(/.test(clean);
      const hasCloud = /\baddConnectionCloud\s*\(/.test(clean);
      const hasServer = /\baddConnectionServer\s*\(/.test(clean);
      if (hasPoint && !hasStation && hasServer && !hasCloud) mode = 'ap';
      else if (hasStation && !hasPoint && hasCloud && !hasServer) mode = 'cloud';
      else if (hasStation && !hasPoint && hasServer && !hasCloud) mode = 'wifi';
      else fail('не удалось однозначно определить сетевой режим. Поддерживаются RemoteXY Wi-Fi, Wi-Fi Point и Wi-Fi Cloud.');
    }
    const accessPassword = extractSetting(clean, 'REMOTEXY_ACCESS_PASSWORD', null);
    const access = accessPassword ? cxxString(accessPassword, 'REMOTEXY_ACCESS_PASSWORD') : null;
    if (mode === 'cloud') {
      let hostLiteral = extractSetting(clean, 'REMOTEXY_CLOUD_SERVER', null);
      let portLiteral = extractSetting(clean, 'REMOTEXY_CLOUD_PORT', null);
      let tokenLiteral = extractSetting(clean, 'REMOTEXY_CLOUD_TOKEN', null);
      // New editor code: gui->addConnectionCloud(net, "host", 6376, "token").
      if (!hostLiteral || !portLiteral || !tokenLiteral) {
        const call = clean.match(/\baddConnectionCloud\s*\(\s*[A-Za-z_]\w*\s*,\s*("(?:\\.|[^"\\])*"|REMOTEXY_CLOUD_SERVER)\s*,\s*(\d+|REMOTEXY_CLOUD_PORT)\s*,\s*("(?:\\.|[^"\\])*"|REMOTEXY_CLOUD_TOKEN)\s*\)/);
        if (!call) fail('Cloud: не найдены адрес сервера, порт и токен из исходного кода RemoteXY.');
        hostLiteral = hostLiteral || (call[1] === 'REMOTEXY_CLOUD_SERVER' ? null : call[1]);
        portLiteral = portLiteral || (call[2] === 'REMOTEXY_CLOUD_PORT' ? null : call[2]);
        tokenLiteral = tokenLiteral || (call[3] === 'REMOTEXY_CLOUD_TOKEN' ? null : call[3]);
      }
      if (!hostLiteral || !portLiteral || !tokenLiteral)
        fail('Cloud: необходимы REMOTEXY_CLOUD_SERVER, REMOTEXY_CLOUD_PORT и REMOTEXY_CLOUD_TOKEN.');
      const host = cxxString(hostLiteral, 'Cloud server');
      if (host && !/^[A-Za-z0-9.-]+$/.test(host)) fail('Cloud: некорректное имя сервера.');
      const token = cxxString(tokenLiteral, 'Cloud Token', true);
      const port = Number(portLiteral);
      if (!Number.isInteger(port) || port < 1 || port > 65535) fail('Cloud: неверный порт.');
      return { mode, port, host, token, access };
    }
    let portLiteral = extractSetting(clean, 'REMOTEXY_SERVER_PORT', null);
    if (!portLiteral) {
      const call = clean.match(/\baddConnectionServer\s*\(\s*[A-Za-z_]\w*\s*,\s*(\d+)\s*\)/);
      if (!call) fail('не найден TCP-порт RemoteXY для выбранного режима.');
      portLiteral = call[1];
    }
    const port = Number(portLiteral);
    if (!Number.isInteger(port) || port < 1 || port > 65535) fail('неверный TCP-порт RemoteXY.');
    return { mode, port, access };
  }
  function inspectEepromConfig(bytes, complexFields = []) {
    // RemoteXY library 4.1.11, CRemoteXYGui constructor: 0xFE config
    // has CVL(2), EepromCount(2), 3 bytes per saved field, CL(2), GUI bytes.
    // The 0xFF (V19) format does not have EEPROM descriptors.
    if (bytes[0] !== 254) return { descriptors: [], savedFields: [], protocol: 'legacy', descriptorStart: -1, descriptorEnd: -1 };
    if (bytes.length < 11) fail('неполный заголовок новой конфигурации RemoteXY.');
    const complexCount = bytes[5] | (bytes[6] << 8);
    if (complexCount !== complexFields.length)
      fail('число сложных переменных в конфигурации (' + complexCount + ') не совпадает с исходной структурой (' + complexFields.length + ').');
    // Version 0xFE: descriptors follow the complex-variable declarations in order.
    // RealTime has no descriptor; Terminal and Notification heap types consume two bytes.
    let cursor = 7;
    for (const field of complexFields) {
      const descriptorSize = /^(RemoteXYType_(?:RealTime|RealTimeNet))$/.test(field.type) ? 0 : 2;
      if (cursor + descriptorSize + 4 > bytes.length)
        fail('обрезан дескриптор сложной переменной ' + field.name + '.');
      if (descriptorSize) {
        field.heapBytes = (bytes[cursor] | (bytes[cursor + 1] << 8)) << 4;
        if (field.heapBytes < 32 || field.heapBytes > 65520)
          fail('недопустимый размер буфера сложной переменной ' + field.name + '.');
      }
      cursor += descriptorSize;
    }
    if (cursor + 4 > bytes.length) fail('неполный заголовок EEPROM.');
    const count = bytes[cursor] | (bytes[cursor + 1] << 8);
    const end = cursor + 2 + count * 3;
    if (count > 1024 || end + 2 > bytes.length) fail('повреждён раздел EEPROM в конфигурации RemoteXY.');
    const descriptors = [];
    for (let i = cursor + 2; i < end; i += 3) {
      const offset = bytes[i] | ((bytes[i + 2] & 0x3f) << 8);
      const size = bytes[i + 1] | ((bytes[i + 2] & 0xc0) << 2);
      if (!size) fail('EEPROM: обнаружено поле нулевого размера.');
      descriptors.push({ offset, size });
    }
    const guiSize = bytes[end] | (bytes[end + 1] << 8);
    if (end + 2 + guiSize !== bytes.length) fail('повреждена конфигурация RemoteXY: длина GUI или EEPROM не совпадает с массивом.');
    return { descriptors, savedFields: [], protocol: 'extended', descriptorStart: cursor, descriptorEnd: end }; 
  }
  function readRemoteXY(source) {
    const connection = readConnection(source);
    if (!/#include\s*<RemoteXY\.h>/.test(source)) fail('не найден #include <RemoteXY.h>.');
    // The official RemoteXY editor may insert a line comment immediately
    // after '=', before the opening '{':
    // uint8_t const PROGMEM RemoteXY_CONF_PROGMEM[] = // 300 bytes V19
    //   {255, ...};
    // Permit whitespace and C/C++ comments in that specific gap, while
    // keeping the declaration and byte initializer strictly validated.
    const confMatch = source.match(/\buint8_t\s+const\s+PROGMEM\s+RemoteXY_CONF_PROGMEM\s*\[\s*\]\s*=\s*(?:(?:\/\/[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/)\s*)*\{([\s\S]*?)\}\s*;/);
    if (!confMatch) fail('не найден массив RemoteXY_CONF_PROGMEM формата uint8_t const PROGMEM []. Проверьте, что вставлен полный Arduino-скетч с массивом и его байтами.');
    const numText = confMatch[1].replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ' ').trim();
    if (!/^\s*\d+\s*(?:,\s*\d+\s*)*,?\s*$/.test(numText)) fail('массив интерфейса должен содержать только числа от 0 до 255.');
    const bytes = numText.split(',').map(x => x.trim()).filter(Boolean).map(Number);
    if (bytes.length < 10 || bytes.some(v => !Number.isInteger(v) || v < 0 || v > 255)) fail('неверные байты конфигурации.');
    const expectedConfigLength = bytes[0] === 255 ? (7 + bytes[5] + bytes[6] * 256) : null;
    if (expectedConfigLength !== null && bytes.length !== expectedConfigLength)
      fail('повреждена конфигурация: массив содержит ' + bytes.length + ' байт, а заголовок требует ' + expectedConfigLength + '. Вставьте исходный массив целиком.');
    if (bytes[0] !== 254 && bytes[0] !== 255)
      fail('неподдерживаемая версия конфигурации RemoteXY: ' + bytes[0] + '.');
    // EEPROM and complex-variable descriptors are validated after struct parsing.
    const struct = source.match(/\bstruct\s*\{([\s\S]*?)\}\s*RemoteXY\s*;/);
    if (!struct) fail('не найдена структура ... RemoteXY;');
    const sections = { input: [], output: [], other: [], complex: [] };
    let section = null;
    for (const line of struct[1].split(/\r?\n/)) {
      if (/\/\/\s*input\s+variables/i.test(line)) { section = 'input'; continue; }
      if (/\/\/\s*output\s+variables/i.test(line)) { section = 'output'; continue; }
      if (/\/\/\s*other\s+variable/i.test(line)) { section = 'other'; continue; }
      if (/\/\/\s*complex\s+variables?/i.test(line)) { section = 'complex'; continue; }
      // Editor-generated comments may use // or /* ... */.  Retain them for
      // conservative binary-control classification, not for C++ declarations.
      const comment = ((line.match(/\/\/(.*)$/) || [])[1] || '') + ' ' +
        Array.from(line.matchAll(/\/\*([\s\S]*?)\*\//g), m => m[1]).join(' ');
      const decl = line.replace(/\/\/.*$/, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
      if (!decl) continue;
      const scalar = decl.match(/^(float|uint8_t|int8_t|int16_t|uint16_t|int32_t|uint32_t)\s+([A-Za-z_]\w*)\s*;$/);
      const stringField = decl.match(/^char\s+([A-Za-z_]\w*)\s*\[\s*(\d+)\s*\]\s*;$/);
      const complexField = decl.match(/^(RemoteXYType_(?:Terminal|Notification|NotificationNet|RealTime|RealTimeNet))\s+([A-Za-z_]\w*)\s*;$/);
      if (!section || (!scalar && !stringField && !complexField)) fail('неподдерживаемое поле интерфейса: ' + decl + ' (поддерживаются числа, char[N] и известные типы RemoteXYType_*, но не вложенные структуры и произвольные массивы).');
      if (complexField) {
        if (section !== 'complex') fail('сложная переменная ' + complexField[2] + ' должна быть в разделе complex variables.');
        sections.complex.push({ type: complexField[1], name: complexField[2], kind: 'complex' });
        continue;
      }
      if (section === 'complex') fail('некорректное поле в разделе complex variables: ' + decl + '.');
      if (stringField) {
        const length = Number(stringField[2]);
        if (!Number.isSafeInteger(length) || length < 2 || length > 512)
          fail('размер текста ' + stringField[1] + '[' + stringField[2] + '] должен быть от 2 до 512 байт.');
        sections[section].push({ type: 'char', name: stringField[1], length, kind: 'text' });
        continue;
      }
      const type = scalar[1], name = scalar[2];
      // Never infer Bool solely from uint8_t: selectors and indicators can
      // have three states (0..2) or numeric values (0..255).
      const lastRange = comment.match(/\b0\s*(?:to|до|\.\.)\s*(\d+)/i);
      const isMultiState = lastRange && Number(lastRange[1]) > 1;
      const binaryName = /^(?:button|btn|switch|toggle|checkbox|check_box)(?:_|[A-Z0-9]|$)/i.test(name);
      const binaryComment = /(?:button\s+pressed|switch\s+(?:on|off)|кнопк|переключател)/i.test(comment);
      const kind = type === 'uint8_t' && section === 'input' &&
        !isMultiState && (binaryName || binaryComment) ? 'binary' : 'numeric';
      sections[section].push({ type, name, kind });
    }
    if (!sections.input.length && !sections.output.length && !sections.complex.length) fail('не найдены переменные графического интерфейса.');
    const connectField = sections.other.find(f => f.name === 'connect_flag');
    if (connectField && connectField.type !== 'uint8_t') fail('поле connect_flag должно иметь тип uint8_t.');
    const names = [...sections.input, ...sections.output, ...sections.other, ...sections.complex].map(f => f.name);
    if (new Set(names).size !== names.length) fail('повторяющиеся имена полей.');
    if (names.includes('connected')) fail('имя connected зарезервировано под системный выход подключения.');
    // For RemoteXY config formats 254/255, bytes 1..4 encode the packed input
    // and output sizes. Reject a GUI definition with mismatched fields before
    // creating a potentially out-of-bounds protocol binding.
    const fieldBytes = f => f.kind === 'text' ? f.length :
      (f.type === 'float' || /32_t$/.test(f.type)) ? 4 : /16_t$/.test(f.type) ? 2 : 1;
    if (bytes[0] === 254 || bytes[0] === 255) {
      const confInput = bytes[1] + bytes[2] * 256;
      const confOutput = bytes[3] + bytes[4] * 256;
      const structInput = sections.input.reduce((n, f) => n + fieldBytes(f), 0);
      const structOutput = sections.output.reduce((n, f) => n + fieldBytes(f), 0);
      if (confInput !== structInput || confOutput !== structOutput)
        fail('размеры полей структуры не совпадают с конфигурацией интерфейса: входы ' + structInput + '/' + confInput + ' байт, выходы ' + structOutput + '/' + confOutput + ' байт. Вставьте полный неизменённый скетч RemoteXY.');
    }

    const eeprom = inspectEepromConfig(bytes, sections.complex);
    // The library maps EEPROM descriptors to packed INPUT field offsets.
    // Match whole fields only. Guessing by comments or names could corrupt data.
    if (eeprom.descriptors.length) {
      let position = 0;
      const fields = new Map();
      for (const field of sections.input) {
        fields.set(position + ':' + fieldBytes(field), field);
        position += fieldBytes(field);
      }
      const savedNames = new Set();
      for (const descriptor of eeprom.descriptors) {
        if (descriptor.offset + descriptor.size > position)
          fail('EEPROM: сохранённое поле выходит за границы входных данных RemoteXY.');
        const field = fields.get(descriptor.offset + ':' + descriptor.size);
        if (!field || savedNames.has(field.name))
          fail('EEPROM: размер или положение сохранённого поля не соответствует целому полю структуры RemoteXY.');
        savedNames.add(field.name);
        field.savedToEeprom = true;
        eeprom.savedFields.push(field.name);
      }
    }
    eeprom.requiredSize = eeprom.descriptors.length ?
      2 + eeprom.descriptors.reduce((sum, d) => sum + d.size, 0) : 0;
    if (eeprom.requiredSize > 4096)
      fail('EEPROM: требуется более 4096 байт; такой размер для ESP32 в этом режиме не поддерживается.');

    // Wi-Fi credentials are intentionally ignored: FLProg owns connection and AP mode.
    return { bytes, sections, port: connection.port, connection, eeprom };
  }
  function buildRemoteXYUbi(source, name, options = {}) {
    const data = readRemoteXY(source);
    const internetNotifications = data.sections.complex.some(f => f.type === 'RemoteXYType_NotificationNet');
    if (internetNotifications && data.connection.mode === 'ap')
      fail('уведомления через Интернет требуют Wi-Fi с доступом в Интернет; точка доступа FLProg не предоставляет его автоматически.');
    // Saved GUI descriptors are removed from the exported config; only the
    // RemoteXY internal notification service can require vendor EEPROM.
    const eepromRequired = internetNotifications;
    const offsetValue = options.eepromOffset === undefined || options.eepromOffset === '' ? 0 : Number(options.eepromOffset);
    if (!Number.isInteger(offsetValue) || offsetValue < 0 || offsetValue > 4096)
      fail('смещение EEPROM должно быть целым числом от 0 до ' + 4096 + '.');
    const vars = {};
    let order = 0;
    // Phone input -> FLProg output; phone output -> FLProg input.
    function add(f, role) {
      const type = f.kind === 'text' ? 'String' : f.kind === 'binary' ? 'bool' :
        f.type === 'uint8_t' ? 'byte' : f.type === 'int8_t' ? 'int' : f.type;
      const requestedAlias = options.aliases && options.aliases[f.name];
      const alias = typeof requestedAlias === 'string' && requestedAlias.trim() ? requestedAlias.trim() : f.name;
      vars[f.name] = { type, role, alias, default: type === 'String' ? '""' :
        type === 'bool' ? 'false' : type === 'float' ? '0.0' : '0',
        position: order++, remoteXYKind: f.kind, remoteXYType: f.type, savedToEeprom: !!f.savedToEeprom };
    }
    // FLProg manages Wi-Fi association through a separate network block.
    // Only Cloud endpoint settings belong to this RemoteXY block.
    if (data.connection.mode === 'cloud') {
      vars.remoteXYCloudServer = { type: 'String', role: 'parameter', alias: 'Cloud server', default: data.connection.host, position: order++ };
      vars.remoteXYCloudPort = { type: 'uint16_t', role: 'parameter', alias: 'Cloud port', default: String(data.connection.port), position: order++ };
      vars.remoteXYCloudToken = { type: 'String', role: 'parameter', alias: 'Cloud token', default: data.connection.token, position: order++ };
    }
    data.sections.input.forEach(f => add(f, 'output'));
    // Optional two-way synchronization: FLProg/web clients submit a new value
    // on the rising edge of <field>_apply; no continuous overwrite of phone input.
    const bidirectional = options.bidirectional === true;
    if (bidirectional) {
      const reservedNames = new Set([...data.sections.input, ...data.sections.output, ...data.sections.complex, ...data.sections.other].map(f => f.name));
      for (const f of data.sections.input) {
        for (const suffix of ['_set', '_apply']) {
          if (reservedNames.has(f.name + suffix)) fail('RemoteXY: конфликт имени контакта ' + f.name + suffix);
        }
        add({name: f.name + '_set', kind: f.kind, type: f.type, length: f.length}, 'input');
        add({name: f.name + '_apply', kind: 'binary', type: 'uint8_t'}, 'input');
      }
    }
    data.sections.output.forEach(f => add(f, 'input'));
    // FLProg signals are external to the native packed RemoteXY struct.
    // A rising edge sends one message; keeping the input HIGH cannot spam the queue.
    for (const field of data.sections.complex) {
      if (/^RemoteXYType_(?:Notification|NotificationNet|Terminal)$/.test(field.type)) {
        add({name: field.name + '_send', kind: 'binary', type: 'uint8_t'}, 'input');
        add({name: field.name + '_text', kind: 'text', type: 'char'}, 'input');
      } else if (/^RemoteXYType_RealTime(?:Net)?$/.test(field.type)) {
        add({name: field.name + '_utc', kind: 'numeric', type: 'uint32_t'}, 'output');
        add({name: field.name + '_valid', kind: 'binary', type: 'uint8_t'}, 'output');
      }
    }
    // Persist only the fields explicitly marked "Save to EEPROM" in the
    // RemoteXY configuration. Preferences is the authoritative restore store
    // for these GUI values; the vendor EEPROM implementation remains enabled
    // for its notification/board-ID service data.
    const nvsFields = data.sections.input.filter(f => f.savedToEeprom);
    const nvsEnabled = nvsFields.length > 0;
    const nvsFieldSize = f => f.kind === 'text' ? f.length :
      (f.type === 'float' || /32_t$/.test(f.type)) ? 4 : /16_t$/.test(f.type) ? 2 : 1;
    // Include config bytes + field shape to prevent restoring unrelated GUI
    // schemas over the same NVS namespace after reprogramming.
    let nvsSignature = 2166136261;
    for (const b of data.bytes) nvsSignature = Math.imul(nvsSignature ^ b, 16777619) >>> 0;
    for (const f of nvsFields) {
      for (const c of (f.name + ':' + f.type + ':' + nvsFieldSize(f)))
        nvsSignature = Math.imul(nvsSignature ^ c.charCodeAt(0), 16777619) >>> 0;
    }
    // Keys f0, f1 etc. meet ESP-IDF NVS's 15-byte limit.
    if (nvsFields.length > 256) fail('Preferences: слишком много сохраняемых полей (максимум 256).');
    const hasConnectFlag = data.sections.other.some(f => f.name === 'connect_flag');
    if (hasConnectFlag) vars.connected = { type: 'bool', role: 'output', alias: 'connected', default: 'false', position: order++ };
    // Packed structure is critical to RemoteXY protocol byte layout.
    const all = [...data.sections.input, ...data.sections.output, ...data.sections.complex, ...data.sections.other];
    // Keep protocol fields distinct from FLProg contacts. The Professional XML
    // tokeniser substitutes contact names even within C++ struct declarations.
    // A distinct member name preserves the binary layout and avoids corruption.
    const nativeMember = name => 'rxyField_' + name;
    const fields = all.map(f => '  ' + f.type + ' ' + nativeMember(f.name) + (f.kind === 'text' ? '[' + f.length + ']' : '') + ';').join('\n');
    const packDecl = '#pragma pack(push, 1)\nstruct {\n' + fields + '\n} remoteXYBridgeData;\n#pragma pack(pop)';
    const decl = [packDecl];
    // RemoteXY 0xFE config stores saved-input descriptors after complex-field
    // descriptors. The generator first reads the original descriptors to know
    // which fields belong in NVS, then emits a configuration with zero GUI
    // EEPROM descriptors. The protocol header, GUI bytes and complex-variable
    // descriptors stay unchanged (especially NotificationNet).
    let exportedBytes = data.bytes;
    if (nvsEnabled) {
      if (data.eeprom.protocol !== 'extended' || data.eeprom.descriptorStart < 0)
        fail('Preferences: настройки сохранения требуют конфигурацию RemoteXY 0xFE.');
      exportedBytes = [
        ...data.bytes.slice(0, data.eeprom.descriptorStart),
        0, 0, // number of GUI fields saved by the RemoteXY EEPROM engine
        ...data.bytes.slice(data.eeprom.descriptorEnd)
      ];
    }
    const staticDecls = [
      'const uint8_t PROGMEM remoteXYBridgeConf[' + exportedBytes.length + '] = {' + exportedBytes.join(',') + '};'
    ];
    // Use RemoteXY 4.1.11 network interfaces without WiFi.begin/mode/disconnect.
    // Only the exact connection mode selected by the input code is generated.
    const connection = data.connection;
    const availability = connection.mode === 'ap' ?
      'WiFi.getMode() == WIFI_AP && WiFi.softAPIP() != IPAddress(0, 0, 0, 0)' :
      'WiFi.status() == WL_CONNECTED';
    const setup = 'class CRemoteXYNet_FLProgExistingWiFi : public CRemoteXYNet {\n' +
      'public:\n' +
      '  uint8_t configured() override { return (' + availability + ') ? 1 : 0; }\n' +
      '  uint8_t hasInternet() override { return ' + (connection.mode !== 'ap' ? 'configured()' : '0') + '; }\n' +
      '  CRemoteXYServer *createServer(uint16_t port) override { return new CRemoteXYServer_WiFi(this, port); }\n' +
      '  CRemoteXYClient *newClient() override { return new CRemoteXYClient_WiFi(); }\n' +
      '};\n' +
      'CRemoteXYGui *remoteXYBridgeGui = RemoteXYEngine.addGui(remoteXYBridgeConf, &remoteXYBridgeData' +
        (connection.access ? ', ' + JSON.stringify(connection.access) : '') + ');\n' +
      (connection.mode === 'cloud' ?
        // Keep persistent storage if the RemoteXY library retains string pointers.
        'static String remoteXYBridgeCloudServerStorage;\n' +
        'static String remoteXYBridgeCloudTokenStorage;\n' +
        'remoteXYBridgeCloudServerStorage = remoteXYCloudServer;\n' +
        'remoteXYBridgeCloudTokenStorage = remoteXYCloudToken;\n' +
        'if (remoteXYBridgeCloudServerStorage.length() && remoteXYBridgeCloudTokenStorage.length() && ' +
        'remoteXYCloudPort > 0) {\n' +
        'remoteXYBridgeGui->addConnectionCloud(new CRemoteXYNet_FLProgExistingWiFi(), ' +
          'remoteXYBridgeCloudServerStorage.c_str(), (uint16_t)remoteXYCloudPort, remoteXYBridgeCloudTokenStorage.c_str());\n}' :
        'remoteXYBridgeGui->addConnectionServer(new CRemoteXYNet_FLProgExistingWiFi(), ' + connection.port + ');');
    if (nvsEnabled) {
      // GUI EEPROM descriptors were removed, so only NVS restores UI fields.
      staticDecls.push('Preferences remoteXYBridgePrefs;');
      staticDecls.push('bool remoteXYBridgePrefsReady = false;');
      staticDecls.push('bool remoteXYBridgePrefsDirty = false;');
      staticDecls.push('uint32_t remoteXYBridgePrefsChanged = 0;');
      for (let i = 0; i < nvsFields.length; i++) {
        const f = nvsFields[i];
        staticDecls.push('uint8_t remoteXYBridgeSaved_' + i + '[' + nvsFieldSize(f) + '] = {0};');
        staticDecls.push('bool remoteXYBridgeFieldDirty_' + i + ' = false;');
      }
    }
    const eepromSetup = eepromRequired ?
      '\nRemoteXYEngine.setEepromOffset(' + offsetValue + ');' +
      '\nEEPROM.begin(' + offsetValue + ' + RemoteXYEngine.getEepromSize());' +
      '\nRemoteXYEngine.initEeprom();' : '';
    let nvsSetup = '';
    if (nvsEnabled) {
      // 'rxy-state' is separate from other FLProg NVS namespaces.
      nvsSetup = '\nremoteXYBridgePrefsReady = remoteXYBridgePrefs.begin("rxy-state", false);' +
        '\nif (remoteXYBridgePrefsReady) {' +
        '\n  const uint32_t remoteXYBridgeSchema = ' + nvsSignature + 'UL;' +
        '\n  bool remoteXYBridgeSchemaValid = remoteXYBridgePrefs.getUInt("schema", 0) == remoteXYBridgeSchema;' +
        '\n  if (!remoteXYBridgeSchemaValid) {' +
        // Clear stale values only from this dedicated namespace.
        '\n    remoteXYBridgePrefs.clear();' +
        '\n    remoteXYBridgePrefs.putUInt("schema", remoteXYBridgeSchema);' +
        '\n  }';
      for (let i = 0; i < nvsFields.length; i++) {
        const f = nvsFields[i], size = nvsFieldSize(f), ref = 'remoteXYBridgeData.' + nativeMember(f.name);
        nvsSetup += '\n  if (remoteXYBridgeSchemaValid && remoteXYBridgePrefs.getBytesLength("f' + i + '") == ' + size + ') {' +
          '\n    remoteXYBridgePrefs.getBytes("f' + i + '", &' + ref + ', ' + size + ');' +
          '\n  }' +
          '\n  memcpy(remoteXYBridgeSaved_' + i + ', &' + ref + ', ' + size + ');';
      }
      nvsSetup += '\n}';
    }
    const fullSetup = setup + eepromSetup + nvsSetup;
    const loop = ['RemoteXYEngine.handler();'];
    if (bidirectional) {
      for (const f of data.sections.input) {
        const trigger = f.name + '_apply';
        const setValue = f.name + '_set';
        const member = 'remoteXYBridgeData.' + nativeMember(f.name);
        const previous = 'remoteXYBridgePrevApply_' + f.name;
        staticDecls.push('bool ' + previous + ' = false;');
        if (f.kind === 'text') {
          // RemoteXY char array has fixed width. Leave NUL termination and
          // avoid chopping UTF-8 inside a multibyte codepoint.
          loop.push('if (' + trigger + ' && !' + previous + ') { String rxValue = String(' + setValue + ');' +
            ' size_t rxLen = rxValue.length(); if (rxLen >= ' + f.length + ') {' +
            ' rxLen = ' + (f.length - 1) + '; while (rxLen > 0 && ((uint8_t)rxValue[rxLen] & 0xC0) == 0x80) --rxLen; }' +
            ' memset(' + member + ', 0, ' + f.length + '); memcpy(' + member + ', rxValue.c_str(), rxLen); }');
        } else if (f.kind === 'binary') {
          loop.push('if (' + trigger + ' && !' + previous + ') ' + member + ' = ' + setValue + ' ? 1 : 0;');
        } else {
          loop.push('if (' + trigger + ' && !' + previous + ') ' + member + ' = ' + setValue + ';');
        }
        loop.push(previous + ' = ' + trigger + ';');
      }
    }
    for (const field of data.sections.complex) {
      if (/^RemoteXYType_(?:Notification|NotificationNet|Terminal)$/.test(field.type)) {
        const trigger = field.name + '_send';
        const text = field.name + '_text';
        staticDecls.push('bool remoteXYBridgePrev_' + field.name + ' = false;');
        loop.push('if (' + trigger + ' && !remoteXYBridgePrev_' + field.name + ') {' +
          ' remoteXYBridgeData.' + nativeMember(field.name) + '.print(String(' + text + '));' +
          ' remoteXYBridgeData.' + nativeMember(field.name) + '.send(); }');
        loop.push('remoteXYBridgePrev_' + field.name + ' = ' + trigger + ';');
      } else if (/^RemoteXYType_RealTime(?:Net)?$/.test(field.type)) {
        loop.push('{ int64_t rxTime = remoteXYBridgeData.' + nativeMember(field.name) + '.getUtcTimeStamp();' +
          ' ' + field.name + '_valid = (rxTime > 0);' +
          ' ' + field.name + '_utc = rxTime > 0 ? (uint32_t)(rxTime / 1000) : 0; }');
      }
    }
    if (nvsEnabled) {
      // The handler may mutate fields as a result of a phone connection.
      // Coalesce rapid UI edits into one NVS write batch after 1000 ms.
      loop.push('if (remoteXYBridgePrefsReady) {');
      for (let i = 0; i < nvsFields.length; i++) {
        const f = nvsFields[i], size = nvsFieldSize(f), ref = 'remoteXYBridgeData.' + nativeMember(f.name);
        loop.push('  if (memcmp(remoteXYBridgeSaved_' + i + ', &' + ref + ', ' + size + ') != 0) {' +
          ' remoteXYBridgePrefsDirty = true; remoteXYBridgeFieldDirty_' + i + ' = true; remoteXYBridgePrefsChanged = millis();' +
          ' memcpy(remoteXYBridgeSaved_' + i + ', &' + ref + ', ' + size + '); }');
      }
      loop.push('  if (remoteXYBridgePrefsDirty && (uint32_t)(millis() - remoteXYBridgePrefsChanged) >= 1000UL) {');
      loop.push('    bool remoteXYBridgeWritten = true;');
      for (let i = 0; i < nvsFields.length; i++) {
        const f = nvsFields[i], size = nvsFieldSize(f), ref = 'remoteXYBridgeData.' + nativeMember(f.name);
        loop.push('    if (remoteXYBridgeFieldDirty_' + i + ') {' +
          ' if (remoteXYBridgePrefs.putBytes("f' + i + '", &' + ref + ', ' + size + ') == ' + size + ')' +
          ' remoteXYBridgeFieldDirty_' + i + ' = false; else remoteXYBridgeWritten = false; }');
      }
      loop.push('    if (remoteXYBridgeWritten) remoteXYBridgePrefsDirty = false;');
      loop.push('  }');
      loop.push('}');
    }
    // A UI text array is not a C++ String. Copy safely with explicit bounds
    // and preserve the library's packed field width; never retype its struct.
    data.sections.input.forEach(f => {
      if (f.kind === 'text') {
        loop.push('{ char rxText[' + (f.length + 1) + ']; memcpy(rxText, remoteXYBridgeData.' + nativeMember(f.name) + ', ' + f.length + '); rxText[' + f.length + '] = \'\\0\'; ' + f.name + ' = String(rxText); }');
      } else if (f.kind === 'binary') {
        loop.push(f.name + ' = remoteXYBridgeData.' + nativeMember(f.name) + ' != 0;');
      } else {
        loop.push(f.name + ' = remoteXYBridgeData.' + nativeMember(f.name) + ';');
      }
    });
    data.sections.output.forEach(f => {
      if (f.kind === 'text') {
        // toCharArray() bounds writes, including the trailing NUL; an UTF-8
        // boundary check avoids splitting a multibyte character on truncation.
        loop.push('{ String rxText = String(' + f.name + '); size_t rxLen = rxText.length();' +
          ' if (rxLen >= ' + f.length + ') { rxLen = ' + (f.length - 1) + ';' +
          ' while (rxLen > 0 && ((uint8_t)rxText[rxLen] & 0xC0) == 0x80) --rxLen; }' +
          ' memcpy(remoteXYBridgeData.' + nativeMember(f.name) + ', rxText.c_str(), rxLen);' +
          ' remoteXYBridgeData.' + nativeMember(f.name) + '[rxLen] = \'\\0\'; }');
      } else if (f.kind === 'binary') {
        loop.push('remoteXYBridgeData.' + nativeMember(f.name) + ' = ' + f.name + ' ? 1 : 0;');
      } else {
        loop.push('remoteXYBridgeData.' + nativeMember(f.name) + ' = ' + f.name + ';');
      }
    });
    if (hasConnectFlag) loop.push('connected = remoteXYBridgeData.rxyField_connect_flag != 0;');
    const modeInfo = connection.mode === 'ap' ?
      'Точка доступа (Access Point), которую запускает FLProg; RemoteXY слушает порт ' + connection.port + '. Режим AP только, не AP+STA.' :
      connection.mode === 'cloud' ?
      'Облако RemoteXY: сервер, порт и токен редактируются в параметрах блока FLProg. Wi-Fi подключает отдельный блок FLProg.' :
      'Wi-Fi через роутер: FLProg подключает ESP32, RemoteXY слушает TCP-порт ' + connection.port + '.';
    const description = 'RemoteXY — ' + name + '\n' +
      'ESP32 / Arduino Core 2.0.17 / RemoteXY 4.1.11. Режим: ' + modeInfo + '\n' +
      'Данные от телефона = выходы FLProg, данные на телефон = входы FLProg.\n' +
      (bidirectional ? 'Двустороннее управление: для каждого поля входы имя_set и имя_apply (фронт 0->1); имя — выход текущего значения. Изменение телефона и FLProg отражается в общем состоянии и Preferences.\n' : '') +
      'Кнопки/переключатели = Bool, числовые поля = соответствующий числовой тип, текст char[N] = String (не более N-1 байт UTF-8). Неопознанные Byte остаются Byte.\n' +
      'Notification/Terminal: входы имя_send (импульс по фронту) и имя_text (String); Time: выходы имя_utc (Unix, секунды, uint32) и имя_valid.\n' +
      'Только один такой блок RemoteXY в проекте. Не переключает режим автоматически, не запускает WiFi.begin(), WiFi.mode(), WiFi.softAP().\n' +
      'Wi-Fi подключает отдельный блок FLProg; имя сети и пароль из исходника не импортируются и в .ubi НЕ сохраняются. Cloud server/port/token задаются как параметры готового блока. Уведомления требуют RemoteXY PRO; интернет-уведомления сохраняют служебные данные в EEPROM и требуют доступного интернета.' +
      (nvsEnabled ? '\nPreferences (NVS): восстанавливаются поля ' + nvsFields.map(f => f.name).join(', ') + '. Пространство rxy-state, схема ' + nvsSignature + ', запись через 1 секунду после последнего изменения. При обновлении конфигурации значения сбрасываются.' : '\nPreferences (NVS): в конфигурации нет полей, помеченных Save to EEPROM; сохранять нечего.') +
      (eepromRequired ? '\nEEPROM: сохранённые поля ' + (data.eeprom.savedFields.join(', ') || '(системные ключи уведомлений)') + '; смещение ' + offsetValue +
        '. GUI-дескрипторы EEPROM удалены из экспортируемой конфигурации: пользовательские значения записываются только в Preferences. EEPROM оставлен только для внутренних данных NotificationNet. Другие блоки FLProg с EEPROM требуют согласования адресов.' :
        '\nEEPROM: пользовательские данные не записываются; без NotificationNet EEPROM не подключается.');
    const blockName = String(name || 'RemoteXY Greenhouse');
    const outputDescription = typeof options.description === 'string' && options.description.trim()
      ? options.description.trim() : description;
    // Code Professional only. The old Code Basic generator is deliberately not used.
    // Wi-Fi ownership remains with FLProg, and a RemoteXY block is single-instance.
    const state = {
      variables: vars, functions: {},
      global_includes: ['#include <WiFi.h>', ...(eepromRequired ? ['#include <EEPROM.h>'] : []), ...(nvsEnabled ? ['#include <Preferences.h>'] : []),
        '#include <RemoteXY.h>', '#include <string.h>'],
      defines: [], extra_declarations: decl, static_declarations: staticDecls,
      declaration_order: []
    };
    if (!root.ino2ubiProfessional || !root.ino2ubiProfessionalTemplate)
      fail('генератор Code Professional или шаблон не загружен.');
    const result = root.ino2ubiProfessional.build({
      template: root.ino2ubiProfessionalTemplate,
      name: blockName, description: outputDescription, state, source: '',
      setupCode: fullSetup, loopCode: loop.join('\n'),
      enableInput: false, allowMultipleInstances: false,
      additionalHeader: '', additionalHeaderFilename: ''
    });
    if (result.hpp) fail('Code Professional запросил внешний заголовок.');
    return { ...result, data, variables: vars, state, description: outputDescription,
      name: blockName, setupCode: fullSetup, loopCode: loop.join('\n'), exportedRemoteXYConfig: exportedBytes };
  }
  root.parseRemoteXYWiFi = readRemoteXY;
  root.buildRemoteXYUbi = buildRemoteXYUbi;
})(typeof window !== 'undefined' ? window : globalThis);
