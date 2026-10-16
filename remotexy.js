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
  function cxxString(literal, title) {
    if (!/^"(?:\\.|[^"\\])*"$/.test(literal || '')) fail('неверная строка ' + title + '.');
    try {
      const value = JSON.parse(literal);
      if (!value || value.length > 256 || /[\r\n\0]/.test(value)) fail('неверное значение ' + title + '.');
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
      if (!/^[A-Za-z0-9.-]+$/.test(host)) fail('Cloud: некорректное имя сервера.');
      const token = cxxString(tokenLiteral, 'Cloud Token');
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
  function inspectEepromConfig(bytes) {
    // RemoteXY library 4.1.11, CRemoteXYGui constructor: 0xFE config
    // has CVL(2), EepromCount(2), 3 bytes per saved field, CL(2), GUI bytes.
    // The 0xFF (V19) format does not have EEPROM descriptors.
    if (bytes[0] !== 254) return { descriptors: [], savedFields: [], protocol: 'legacy' };
    if (bytes.length < 11) fail('неполный заголовок новой конфигурации RemoteXY.');
    const complexCount = bytes[5] | (bytes[6] << 8);
    if (complexCount) fail('в конфигурации RemoteXY есть сложные переменные: их формат пока не поддерживается безопасным импортом EEPROM.');
    const count = bytes[7] | (bytes[8] << 8);
    const end = 9 + count * 3;
    if (count > 1024 || end + 2 > bytes.length) fail('повреждён раздел EEPROM в конфигурации RemoteXY.');
    const descriptors = [];
    for (let i = 9; i < end; i += 3) {
      const offset = bytes[i] | ((bytes[i + 2] & 0x3f) << 8);
      const size = bytes[i + 1] | ((bytes[i + 2] & 0xc0) << 2);
      if (!size) fail('EEPROM: обнаружено поле нулевого размера.');
      descriptors.push({ offset, size });
    }
    const guiSize = bytes[end] | (bytes[end + 1] << 8);
    if (end + 2 + guiSize !== bytes.length) fail('повреждена конфигурация RemoteXY: длина GUI или EEPROM не совпадает с массивом.');
    return { descriptors, savedFields: [], protocol: 'extended' };
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
    const eeprom = inspectEepromConfig(bytes);
    const struct = source.match(/\bstruct\s*\{([\s\S]*?)\}\s*RemoteXY\s*;/);
    if (!struct) fail('не найдена структура ... RemoteXY;');
    const sections = { input: [], output: [], other: [] };
    let section = null;
    for (const line of struct[1].split(/\r?\n/)) {
      if (/\/\/\s*input\s+variables/i.test(line)) { section = 'input'; continue; }
      if (/\/\/\s*output\s+variables/i.test(line)) { section = 'output'; continue; }
      if (/\/\/\s*other\s+variable/i.test(line)) { section = 'other'; continue; }
      // Editor-generated comments may use // or /* ... */.  Retain them for
      // conservative binary-control classification, not for C++ declarations.
      const comment = ((line.match(/\/\/(.*)$/) || [])[1] || '') + ' ' +
        Array.from(line.matchAll(/\/\*([\s\S]*?)\*\//g), m => m[1]).join(' ');
      const decl = line.replace(/\/\/.*$/, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
      if (!decl) continue;
      const scalar = decl.match(/^(float|uint8_t|int8_t|int16_t|uint16_t|int32_t|uint32_t)\s+([A-Za-z_]\w*)\s*;$/);
      const stringField = decl.match(/^char\s+([A-Za-z_]\w*)\s*\[\s*(\d+)\s*\]\s*;$/);
      if (!section || (!scalar && !stringField)) fail('неподдерживаемое поле интерфейса: ' + decl + ' (поддерживаются числа и char[N], но не вложенные структуры и произвольные массивы).');
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
    if (!sections.input.length && !sections.output.length) fail('не найдены переменные графического интерфейса.');
    const connectField = sections.other.find(f => f.name === 'connect_flag');
    if (connectField && connectField.type !== 'uint8_t') fail('поле connect_flag должно иметь тип uint8_t.');
    const names = [...sections.input, ...sections.output, ...sections.other].map(f => f.name);
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
    const eepromRequired = data.eeprom.requiredSize > 0;
    const offsetValue = options.eepromOffset === undefined || options.eepromOffset === '' ? 0 : Number(options.eepromOffset);
    if (!Number.isInteger(offsetValue) || offsetValue < 0 || offsetValue > 4096 - data.eeprom.requiredSize)
      fail('смещение EEPROM должно быть целым числом от 0 до ' + (4096 - data.eeprom.requiredSize) + '.');
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
    data.sections.input.forEach(f => add(f, 'output'));
    data.sections.output.forEach(f => add(f, 'input'));
    const hasConnectFlag = data.sections.other.some(f => f.name === 'connect_flag');
    if (hasConnectFlag) vars.connected = { type: 'bool', role: 'output', alias: 'connected', default: 'false', position: order++ };
    // Packed structure is critical to RemoteXY protocol byte layout.
    const all = [...data.sections.input, ...data.sections.output, ...data.sections.other];
    const fields = all.map(f => '  ' + f.type + ' ' + f.name + (f.kind === 'text' ? '[' + f.length + ']' : '') + ';').join('\n');
    const packDecl = 'struct __attribute__((packed)) {\n' + fields + '\n} remoteXYBridgeData;';
    const decl = [packDecl];
    const staticDecls = [
      'const uint8_t PROGMEM remoteXYBridgeConf[' + data.bytes.length + '] = {' + data.bytes.join(',') + '};'
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
      '  uint8_t hasInternet() override { return ' + (connection.mode === 'cloud' ? 'configured()' : '0') + '; }\n' +
      '  CRemoteXYServer *createServer(uint16_t port) override { return new CRemoteXYServer_WiFi(this, port); }\n' +
      '  CRemoteXYClient *newClient() override { return new CRemoteXYClient_WiFi(); }\n' +
      '};\n' +
      'CRemoteXYGui *remoteXYBridgeGui = RemoteXYEngine.addGui(remoteXYBridgeConf, &remoteXYBridgeData' +
        (connection.access ? ', ' + JSON.stringify(connection.access) : '') + ');\n' +
      (connection.mode === 'cloud' ?
        'remoteXYBridgeGui->addConnectionCloud(new CRemoteXYNet_FLProgExistingWiFi(), ' +
          JSON.stringify(connection.host) + ', ' + connection.port + ', ' + JSON.stringify(connection.token) + ');' :
        'remoteXYBridgeGui->addConnectionServer(new CRemoteXYNet_FLProgExistingWiFi(), ' + connection.port + ');');
    const eepromSetup = eepromRequired ?
      '\nRemoteXYEngine.setEepromOffset(' + offsetValue + ');' +
      '\nEEPROM.begin(' + offsetValue + ' + RemoteXYEngine.getEepromSize());' +
      '\nRemoteXYEngine.initEeprom();' : '';
    const fullSetup = setup + eepromSetup;
    const loop = ['RemoteXYEngine.handler();'];
    // A UI text array is not a C++ String. Copy safely with explicit bounds
    // and preserve the library's packed field width; never retype its struct.
    data.sections.input.forEach(f => {
      if (f.kind === 'text') {
        loop.push('{ char rxText[' + (f.length + 1) + ']; memcpy(rxText, remoteXYBridgeData.' + f.name + ', ' + f.length + '); rxText[' + f.length + '] = \'\\0\'; ' + f.name + ' = String(rxText); }');
      } else if (f.kind === 'binary') {
        loop.push(f.name + ' = remoteXYBridgeData.' + f.name + ' != 0;');
      } else {
        loop.push(f.name + ' = remoteXYBridgeData.' + f.name + ';');
      }
    });
    data.sections.output.forEach(f => {
      if (f.kind === 'text') {
        // toCharArray() bounds writes, including the trailing NUL; an UTF-8
        // boundary check avoids splitting a multibyte character on truncation.
        loop.push('{ String rxText = String(' + f.name + '); size_t rxLen = rxText.length();' +
          ' if (rxLen >= ' + f.length + ') { rxLen = ' + (f.length - 1) + ';' +
          ' while (rxLen > 0 && ((uint8_t)rxText[rxLen] & 0xC0) == 0x80) --rxLen; }' +
          ' memcpy(remoteXYBridgeData.' + f.name + ', rxText.c_str(), rxLen);' +
          ' remoteXYBridgeData.' + f.name + '[rxLen] = \'\\0\'; }');
      } else if (f.kind === 'binary') {
        loop.push('remoteXYBridgeData.' + f.name + ' = ' + f.name + ' ? 1 : 0;');
      } else {
        loop.push('remoteXYBridgeData.' + f.name + ' = ' + f.name + ';');
      }
    });
    if (hasConnectFlag) loop.push('connected = remoteXYBridgeData.connect_flag != 0;');
    const modeInfo = connection.mode === 'ap' ?
      'Точка доступа (Access Point), которую запускает FLProg; RemoteXY слушает порт ' + connection.port + '. Режим AP только, не AP+STA.' :
      connection.mode === 'cloud' ?
      'Облако RemoteXY: ' + connection.host + ':' + connection.port + '; токен берётся из исходного кода и включается в .ubi (держите файл в безопасности). FLProg подключает ESP32 к интернету.' :
      'Wi-Fi через роутер: FLProg подключает ESP32, RemoteXY слушает TCP-порт ' + connection.port + '.';
    const description = 'RemoteXY — ' + name + '\n' +
      'ESP32 / Arduino Core 2.0.17 / RemoteXY 4.1.11. Режим: ' + modeInfo + '\n' +
      'Данные от телефона = выходы FLProg, данные на телефон = входы FLProg.\n' +
      'Кнопки/переключатели = Bool, числовые поля = соответствующий числовой тип, текст char[N] = String (не более N-1 байт UTF-8). Неопознанные Byte остаются Byte.\n' +
      'Только один такой блок RemoteXY в проекте. Не переключает режим автоматически, не запускает WiFi.begin(), WiFi.mode(), WiFi.softAP().\n' +
      'SSID и пароль из исходника игнорируются и в .ubi НЕ сохраняются. Интерфейс может требовать PRO-лицензию RemoteXY.' +
      (eepromRequired ? '\nEEPROM: сохраняются только ' + data.eeprom.savedFields.join(', ') + '; смещение ' + offsetValue +
        '. Используется EEPROM.begin(); другие блоки FLProg с EEPROM требуют согласования адресов и единой инициализации.' :
        '\nEEPROM: в конфигурации нет полей с признаком сохранения; EEPROM не подключается.');
    const blockName = String(name || 'RemoteXY Greenhouse');
    const outputDescription = typeof options.description === 'string' && options.description.trim()
      ? options.description.trim() : description;
    const xml = root.createUbiXmlSixx(blockName, outputDescription, vars, {},
      ['#include <WiFi.h>', ...(eepromRequired ? ['#include <EEPROM.h>'] : []), '#include <RemoteXY.h>', '#include <string.h>'], [], decl, staticDecls,
      fullSetup, loop.join('\n'), false, { singleInstance: true });
    return { xml, data, variables: vars, description: outputDescription, name: blockName,
      setupCode: fullSetup, loopCode: loop.join('\n') };
  }
  root.parseRemoteXYWiFi = readRemoteXY;
  root.buildRemoteXYUbi = buildRemoteXYUbi;
})(typeof window !== 'undefined' ? window : globalThis);
