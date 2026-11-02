/* Regression tests for C++ numeric parameter literals. */
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
const api=ctx.window, n=api.ino2ubiNumberLiterals;
const valid=[
  ['60000UL','unsigned long','60000'],
  ['123U','unsigned long','123'],['123uL','unsigned long','123'],
  ['42L','long','42'],['42lU','unsigned long','42'],
  ['42ULL','unsigned long','42'],['42llu','unsigned long','42'],
  ['0xFFu','byte','255'],['0b1010U','int','10'],['077UL','int','63'],
  ["60'000UL",'unsigned long','60000'],['4294967295UL','unsigned long','4294967295'],
  ['-32768','int16_t','-32768'],['65535U','uint16_t','65535'],
  ['-1L','long','-1'],['0','uint8_t','0']
];
for (const [literal,type,value] of valid) {
  assert.strictEqual(n.normalizeInteger(literal,type,'esp32','test'),value,`${literal} -> ${value}`);
}
const invalid=[
  ['4294967296UL','unsigned long'],['-1','unsigned long'],
  ['256U','uint8_t'],['65536U','uint16_t'],['32768','int16_t'],
  ['2147483648','long'],['-2147483649','long'],
  ['60000FL','unsigned long'],['60000ULUL','unsigned long'],
  ['12.5F','int'],['1 + 2','int'],['0xGGU','int'],['089','int'],
  ["60''000UL",'unsigned long']
];
for(const [literal,type] of invalid) {
  assert.throws(()=>n.normalizeInteger(literal,type,'esp32','test'), /Некорректное целочисленное значение параметра test/,literal);
}
assert.strictEqual(n.normalizeInteger('32767','int','nano','I'),'32767');
assert.throws(()=>n.normalizeInteger('32768','int','nano','I'), /диапазон int/);
assert.strictEqual(n.normalizeInteger('32768','int','esp32','I'),'32768');
const source=fs.readFileSync(path.join(dir,'tests/ble_presence_reference.ino'),'utf8').replace(
  'unsigned long HoldTimeMs = 60000;', 'unsigned long HoldTimeMs = 60000UL;'
);
assert(/60000UL;\s*\/\/ par/.test(source),'BLE fixture has HoldTimeMs parameter');
const p=api.parseArduinoCode(source);
assert.strictEqual(p.variables.HoldTimeMs.default,'60000UL');
assert.strictEqual(api.ino2ubiCompat.validateConverterInput(source,p,false,'esp32').errors.length,0);
const xml=api.createUbiXmlSixx('BLE-Numeric','test',p.variables,p.functions,p.global_includes,p.defines,p.extra_declarations,p.static_declarations,
  api.extractFunctionBody(source,'setup'),api.extractFunctionBody(source,'loop'),false,{singleInstance:true,bleCallbacks:p.ble_callbacks,targetBoard:'esp32'});
assert(api.ino2ubiCompat.inspectGeneratedXml(xml).valid,'Basic XML references valid');
assert(xml.includes('sixx.name="numberDefaultValue" sixx.type="SmallInteger" sixx.env="Core" >60000</sixx.object>'),'Basic XML stores 60000');
assert(!xml.includes('numberDefaultValue" sixx.type="SmallInteger" sixx.env="Core" >60000UL'),'Basic must strip suffix');
// Standalone numeric test with no BLE and an integer parameter that exceeds target range.
const overflow=source.replace('60000UL','4294967296UL');
const parsedOverflow=api.parseArduinoCode(overflow);
const errors=api.ino2ubiCompat.validateConverterInput(overflow,parsedOverflow,false,'esp32').errors;
assert(errors.some(e=>e.includes('HoldTimeMs')&&e.includes('4294967296UL')));
const issues=api.ino2ubiDiagnostics.enrich(overflow,{errors});
const expectedLine=overflow.slice(0,overflow.indexOf('unsigned long HoldTimeMs =')).split('\n').length;
assert(issues.some(i=>i.message.includes('HoldTimeMs')&&i.line===expectedLine), 'report source line');
assert.throws(()=>api.createUbiXmlSixx('BAD','bad',parsedOverflow.variables,parsedOverflow.functions,parsedOverflow.global_includes,parsedOverflow.defines,
  parsedOverflow.extra_declarations,parsedOverflow.static_declarations,api.extractFunctionBody(overflow,'setup'),api.extractFunctionBody(overflow,'loop'),false,
  {singleInstance:true,bleCallbacks:parsedOverflow.ble_callbacks,targetBoard:'esp32'}),/HoldTimeMs/);
console.log(`PASS numeric regression: ${valid.length} valid, ${invalid.length} invalid, AVR/ESP32 bounds, Basic XML and diagnostic source line`);
