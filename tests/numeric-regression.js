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
// Integer parameter defaults through the PRODUCTION pipeline (Code Professional, jsdom). The BLE sketch that
// used to carry HoldTimeMs is covered by the legacy BLE suite; the numeric behaviour is checked on a plain sketch.
const L=require('./lib/load.js'), UBI=require('./lib/ubi.js');
(async()=>{
  const win=L.loadProduction();
  const source='/* Hold */\nunsigned long HoldTimeMs = 60000UL; // par\nbool outOn = false; // out\nvoid setup() {}\nvoid loop() { outOn = HoldTimeMs > 100; }';
  const exported=L.exportBlock(win,source);
  assert.deepStrictEqual(exported.errors,[],exported.errors.join('; '));
  assert(win.ino2ubiCompat.inspectGeneratedXml(exported.xml).valid,'XML references valid');
  assert(/sixx\.name="defaultValue" sixx\.type="SmallInteger" sixx\.env="Core"\s*>60000<\/sixx\.object>/.test(exported.xml),'Professional XML stores 60000');
  assert(!/>60000UL</.test(exported.xml),'suffix must be stripped');
  assert.strictEqual(UBI.parseUbi(win,exported.xml).params.find(x=>x.name==='HoldTimeMs').type,'UnsignedLongDataType');
  // A parameter that exceeds the target range is rejected with the source line and blocks the export.
  const overflow=source.replace('60000UL','4294967296UL');
  const parsedOverflow=win.parseArduinoCode(overflow);
  const errors=L.runChecks(win,overflow,parsedOverflow,false,true).errors;
  assert(errors.some(e=>e.includes('HoldTimeMs')&&e.includes('4294967296UL')),errors.join('; '));
  const issues=win.ino2ubiDiagnostics.enrich(overflow,{errors});
  const expectedLine=overflow.slice(0,overflow.indexOf('unsigned long HoldTimeMs =')).split('\n').length;
  assert(issues.some(i=>i.message.includes('HoldTimeMs')&&i.line===expectedLine),'report source line');
  assert(L.exportBlock(win,overflow).errors.length>0,'export must be blocked');
  console.log(`PASS numeric regression: ${valid.length} valid, ${invalid.length} invalid, AVR/ESP32 bounds, Professional XML and diagnostic source line`);
})().catch(e=>{console.error(e);process.exit(1);});
