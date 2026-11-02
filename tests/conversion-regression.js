/* Run with node tests/conversion-regression.js; checks both diagnostics and Basic export. */
'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const root=path.resolve(__dirname,'..');
const ctx={window:{},crypto:require('crypto').webcrypto,console};
ctx.window.window=ctx.window;
vm.createContext(ctx);
for(const filename of ['constants.js','parser.js','string-params.js','number-literals.js','ble-support.js',
  'generator.js','conversion-safety.js','compat.js','diagnostics.js'])
  vm.runInContext(fs.readFileSync(path.join(root,filename),'utf8'),ctx,{filename});
const api=ctx.window;
let checked=0;
function run(src){const parsed=api.parseArduinoCode(src);return {parsed,errors:api.ino2ubiCompat.validateConverterInput(src,parsed,false,'esp32').errors};}
function expect(src,id){const r=run(src);assert(r.errors.some(m=>m.includes('['+id+']')),`Missing ${id}:\n${r.errors.join('\n')}`);
  const diag=api.ino2ubiDiagnostics.enrich(src,{errors:r.errors});
  assert(diag.some(d=>d.message.includes('['+id+']') && d.line!=null),`Source line missing for ${id}`);
  checked++;
}
function good(src){const r=run(src);assert.strictEqual(r.errors.length,0,`Unexpected errors: ${r.errors.join('\n')}`);
  const xml=api.createUbiXmlSixx('Audit','XML < & " \' test',r.parsed.variables,r.parsed.functions,r.parsed.global_includes,
     r.parsed.defines,r.parsed.extra_declarations,r.parsed.static_declarations,
     api.extractFunctionBody(src,'setup'),api.extractFunctionBody(src,'loop'),false,
     {bleCallbacks:r.parsed.ble_callbacks,targetBoard:'esp32',singleInstance:api.ino2ubiConversionSafety.requiresSingleInstance(src,r.parsed)});
  assert(api.ino2ubiCompat.inspectGeneratedXml(xml).valid); checked++;return xml;
}
const base='/* Basic */\nbool inReady = false; // in\nbool outReady = false; // out\nvoid setup() {}\nvoid loop() { outReady = inReady; }';
good(base);
good(base.replace('/* Basic */', '/* Documentation: \n #ifdef OFF \n #endif \n */'));
expect(base.replace('void setup()', '#ifdef ESP32\nvoid setup()'),'CPP-CONDITION');
expect(base.replace('void setup()', '#if defined(ESP32)\n#endif\nvoid setup()'),'CPP-CONDITION');
expect(base.replace('void setup()', '#define ADD(x) ((x)+1)\nvoid setup()'),'CPP-MACRO');
expect(base.replace('void setup()', '#define BROKEN 1 + \\\n  2\nvoid setup()'),'CPP-MULTILINE');
expect(base.replace('void setup()', 'int add(int a, int b=2) { return a+b; }\nvoid setup()'),'CPP-DEFAULT');
expect(base.replace('void setup()', 'int apply(void (*fn)(int)) { return 0; }\nvoid setup()'),'CPP-FUNCTION');
expect(base.replace('void setup()', 'int compute(int) { return 1; }\nvoid setup()'),'CPP-ARGUMENT');
expect(base.replace('void setup()', 'int inReady(int a) { return a; }\nvoid setup()'),'NAME-COLLISION');
expect(base.replace('void setup()', '#define outReady value\nvoid setup()'),'NAME-COLLISION');
expect(base.replace('void setup()', 'bool __ino2ubi_string_inReady = false; // variable\nvoid setup()'),'NAME-RESERVED');
expect(base.replace('void loop() { outReady = inReady; }','void loop() { BLEDevice::init(""); outReady = inReady; }'),'INIT-LOOP');
expect(base.replace('void loop() { outReady = inReady; }','void loop() { esp_now_init(); outReady = inReady; }'),'INIT-LOOP');
// Legitimate one-shot initialization guarded by a state flag must not be blanket-rejected.
good(base.replace('void loop() { outReady = inReady; }','bool started=false; // variable\nvoid loop() { if (!started) { esp_now_init(); started=true; } outReady=inReady; }'));
expect(base.replace('void setup()', 'void onReceived(const uint8_t* mac, const uint8_t* data, int len) { outReady = true; }\nvoid setup()').replace('void setup() {}','void setup() { esp_now_register_recv_cb(onReceived); }'),'CALLBACK-SCOPE');
expect(base.replace('void setup()', 'void onWifi(WiFiEvent_t e) { if (inReady) {} }\nvoid setup()').replace('void setup() {}','void setup() { WiFi.onEvent(onWifi); }'),'CALLBACK-SCOPE');
expect(base.replace('void setup()', '\x01\nvoid setup()'),'XML-CHAR');
expect(base.replace('void setup()', 'int threshold=2; // variable\nstatic int twice = threshold * 2; // variable\nvoid setup()'),'GLOBAL-ORDER');
expect(base.replace('void setup()', 'int threshold=2; // variable\nint table[2] = {threshold, 3}; // variable\nvoid setup()'),'GLOBAL-ORDER');
// Positive checks for valid callbacks that do NOT use FLProg pins.
good('/* Event */\nbool outReady = false; // out\nbool eventSeen = false; // variable\nvoid recv(const uint8_t* mac, const uint8_t* buf, int len) { eventSeen = true; }\nvoid setup() { esp_now_register_recv_cb(recv); }\nvoid loop() { outReady = eventSeen; }');
assert(api.ino2ubiConversionSafety.requiresSingleInstance('void setup(){esp_now_init();}',{ble_callbacks:[]}));checked++;
assert(api.ino2ubiConversionSafety.requiresSingleInstance('void setup(){WiFi.begin("a","b");}',{ble_callbacks:[]}));checked++;
assert(!api.ino2ubiConversionSafety.requiresSingleInstance(base,{ble_callbacks:[]}));checked++;
assert(api.ino2ubiConversionSafety.requiresSingleInstance('void setup(){Wire.begin();}',{ble_callbacks:[]}));checked++;
assert(api.ino2ubiConversionSafety.requiresSingleInstance('void setup(){SPI.begin();}',{ble_callbacks:[]}));checked++;
// Numeric and bool/char/float edge cases: no silent fallback to zero/false.
for(const entry of [['bool P = maybe; // par','Некорректное логическое'],['float P = 1/2; // par','Некорректное вещественное'],['char P = \'AB\'; // par','Некорректное целочисленное']]){
 const src='/* Params */\n'+entry[0]+'\nvoid setup() {}\nvoid loop() {}';
 assert(run(src).errors.some(e=>e.includes(entry[1])));checked++;
}
assert.strictEqual(api.ino2ubiNumberLiterals.normalizeValue("'A'",'char','esp32','C'),'65');checked++;
assert.strictEqual(api.ino2ubiNumberLiterals.normalizeValue("'\\n'",'char','esp32','C'),'10');checked++;
assert.strictEqual(api.ino2ubiNumberLiterals.normalizeValue('1.25F','float','esp32','F'),'1.25');checked++;
assert.strictEqual(api.ino2ubiNumberLiterals.normalizeValue('true','bool','esp32','B'),'1');checked++;
const xml=good('/* String and XML */\nString P = "alpha&beta"; // par\nbool Enabled = true; // par\nchar Letter = \'A\'; // par\nfloat Ratio = 1.25F; // par\nvoid setup() {}\nvoid loop() { if (Enabled) { String x = P; } }');
assert(xml.includes('alpha&amp;beta'));assert(xml.includes('>65</sixx.object>'));
const reference=fs.readFileSync(path.join(__dirname,'ble_presence_reference.ino'),'utf8');
good(reference);
console.log(`PASS conversion regression: ${checked} cases`);
