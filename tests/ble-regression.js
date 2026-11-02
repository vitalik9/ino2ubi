/* Regression tests: run `node tests/ble-regression.js` from repository root. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const dir = path.resolve(__dirname, '..');
const ctx = {window:{}, crypto:require('crypto').webcrypto, console};
ctx.window.window = ctx.window;
vm.createContext(ctx);
for (const f of ['constants.js','parser.js','string-params.js','number-literals.js','ble-support.js','generator.js','conversion-safety.js','compat.js','diagnostics.js']) {
  vm.runInContext(fs.readFileSync(path.join(dir,f),'utf8'),ctx,{filename:f});
}
const api=ctx.window;
function parse(src) {return api.parseArduinoCode(src);}
function check(src,p) {return api.ino2ubiCompat.validateConverterInput(src,p,false).errors;}
function basic(src,p) {
  return api.createUbiXmlSixx('BLE Test','test',p.variables,p.functions,p.global_includes,p.defines,p.extra_declarations,p.static_declarations,
    api.extractFunctionBody(src,'setup'),api.extractFunctionBody(src,'loop'),false,{singleInstance:!!p.ble_callbacks.length,bleCallbacks:p.ble_callbacks});
}
const reference=fs.readFileSync(path.join(__dirname,'ble_presence_reference.ino'),'utf8');
let parsed=parse(reference);
assert.strictEqual(parsed.ble_callbacks.length,1);
assert.strictEqual(parsed.ble_issues.length,0,JSON.stringify(parsed.ble_issues));
assert.strictEqual(check(reference,parsed).length,0);
assert.strictEqual(parsed.extra_declarations.length,0,'Class cannot be duplicated as a separate declaration');
assert.strictEqual(Array.from(parsed.ble_callbacks[0].captured).join(','), ['blePresenceScanAllowed','blePresenceSeen1','blePresenceSeen2','blePresenceLast1','blePresenceLast2'].join(','));
let xml=basic(reference,parsed);
assert(api.ino2ubiCompat.inspectGeneratedXml(xml).valid);
assert.strictEqual((xml.match(/class BLEPresenceAdvertisedCallbacks/g)||[]).length,1);
assert(xml.indexOf('bool blePresenceScanAllowed')<xml.indexOf('class BLEPresenceAdvertisedCallbacks'));
assert(xml.includes('blePresenceCallbacks</sixx.object>'));
assert(xml.includes('__ino2ubi_ble_param_MacDevice1'));
assert(xml.includes('notCanManyUse" sixx.type="True"'));
assert(!xml.includes('sixx.name="name" sixx.type="String" sixx.env="Core" ></sixx.object>\n\t\t\t\t\t\t<sixx.object sixx.id='), 'No empty BLE class declarations');
// Invalid old string conversions inside a supported callback are rewritten.
const legacy=reference.replace('String address = device.getAddress().toString().c_str();',
  'std::string address = device.getAddress().toString();');
parsed=parse(legacy);
assert.strictEqual(check(legacy,parsed).length,0);
xml=basic(legacy,parsed);
assert(xml.includes('String address = device.getAddress().toString().c_str();'));
assert(!xml.includes('std::string address = device.getAddress().toString();'));
// Illegal string literal .c_str in callback is rewritten.
const lit=reference.replace('address.equalsIgnoreCase(MacDevice1)', 'strcasecmp(address.c_str(), "02:00:00:00:00:01".c_str()) == 0');
parsed=parse(lit);
assert.strictEqual(check(lit,parsed).length,0);
xml=basic(lit,parsed);
assert(xml.includes('&quot;02:00:00:00:00:01&quot;'));
assert(!xml.includes('&quot;02:00:00:00:00:01&quot;.c_str()'));
// Accidental direct access to string parameters outside classes is blocked.
const badParam=reference.replace('void setup() {','const char* x = MacDevice1.c_str();\nvoid setup() {');
parsed=parse(badParam);
assert(check(badParam,parsed).some(e=>e.includes('BLE/String: глобальное выражение MacDevice1')));
assert(api.ino2ubiDiagnostics.enrich(badParam,{errors:check(badParam,parsed)}).some(e=>e.line!=null));
// A String parameter used in setup/loop is handled by string-params.js and must not be blocked.
const validParamInLoop=reference.replace('void loop() {','void loop() {\n  const char* x = MacDevice1.c_str();');
parsed=parse(validParamInLoop);
assert(!check(validParamInLoop,parsed).some(e=>e.includes('BLE/String')));
assert(basic(validParamInLoop,parsed).includes('__ino2ubi_string_MacDevice1.c_str'));
// Legacy global scanner without declaration must not be exported silently.
const badScanner=reference.replace('BLEScan *scanner = BLEDevice::getScan();', 'blePresenceScanner = BLEDevice::getScan();');
parsed=parse(badScanner);
assert(check(badScanner,parsed).some(e=>e.includes('BLE/scanner:')));
// Unsupported class: exact diagnostic, no silent omission.
const custom=reference.replace('class BLEPresenceAdvertisedCallbacks : public BLEAdvertisedDeviceCallbacks',
  'class BLEPresenceAdvertisedCallbacks : public SomethingElse');
parsed=parse(custom);
assert(check(custom,parsed).some(e=>e.includes('BLE/class:')));
const customIssues=api.ino2ubiDiagnostics.enrich(custom,{errors:check(custom,parsed)});
assert(customIssues.some(i=>i.message.includes('неподдерживаемый')&&Number.isInteger(i.line)));
// Bad literal .c_str outside supported callback is blocked with exact location.
const badLiteral=reference.replace('void loop() {', 'void loop() {\n  auto x = "02:00:00:00:00:01".c_str();');
parsed=parse(badLiteral);
assert(check(badLiteral,parsed).some(e=>e.includes('BLE/String: вызов .c_str()')));
// Class after setup has exact line diagnostic.
const late='void setup() {}\nclass Late : public BLEAdvertisedDeviceCallbacks {};\nLate a;\nvoid loop() {}';
parsed=parse(late);
assert(check(late,parsed).some(e=>e.includes('BLE/class: определение класса после')));
assert(api.ino2ubiDiagnostics.enrich(late,{errors:check(late,parsed)}).some(i=>i.line===2));
// Ordinary sketches remain supported; no invented callback errors.
const normal='/* Basic */\nbool inEnable = false; // in\nbool outFlag = false; // out\nvoid setup() {}\nvoid loop() { outFlag = inEnable; }';
parsed=parse(normal);
assert.strictEqual(parsed.ble_callbacks.length,0);
assert.strictEqual(check(normal,parsed).length,0);
assert(api.ino2ubiCompat.inspectGeneratedXml(basic(normal,parsed)).valid);
console.log('PASS BLE regression: 11 cases + SIXX integrity');
