'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const root=path.resolve(__dirname,'..');
const ctx={window:{},crypto:require('crypto').webcrypto,console};
ctx.window.window=ctx.window;
vm.createContext(ctx);
for (const filename of ['constants.js','parser.js','string-params.js','number-literals.js','ble-support.js','generator.js','conversion-safety.js','runtime-safety.js','compat.js','diagnostics.js'])
  vm.runInContext(fs.readFileSync(path.join(root,filename),'utf8'),ctx,{filename});
const api=ctx.window;
const basic='bool inGo=false; // in\nbool outReady=false; // out\nvoid setup() {}\nvoid loop() { outReady=inGo; }';
let tests=0;
function check(source){const parsed=api.parseArduinoCode(source);
  const runtime=api.ino2ubiRuntimeSafety.inspect(source,parsed,{board:'esp32'});
  const converter=api.ino2ubiCompat.validateConverterInput(source,parsed,false,'esp32');
  assert.equal(runtime.errors.length,0);
  for(const w of runtime.warnings){
    assert(converter.warnings.includes(w),'Runtime warnings must surface through converter');
    const d=api.ino2ubiDiagnostics.enrich(source,{warnings:[w]});
    assert.equal(d[0].severity,'warning');
    assert(d[0].line !== null,'Missing warning source location: '+w);
  }
  return runtime.warnings;
}
function expect(source,id){const warnings=check(source);assert(warnings.some(x=>x.includes('['+id+']')),`Missing ${id}: ${warnings.join('\n')}`);tests++;}
function clean(source){const warnings=check(source);assert.equal(warnings.length,0,`Unexpected warning: ${warnings.join('\n')}`);tests++;}
const replace=(old,newText)=>basic.replace(old,newText);
clean(basic);
clean(replace('void loop() { outReady=inGo; }','void loop() { // delay(200) & millis()==100 should be ignored\n const char* text="WiFi.begin(\"ssid\")"; delay(1); outReady=inGo; }'));
expect(replace('void loop() { outReady=inGo; }','void loop() { delay(500); outReady=inGo; }'),'BLOCKING-DELAY');
expect(replace('void loop() { outReady=inGo; }','void loop() { delay(duration); outReady=inGo; }'),'BLOCKING-DELAY');
expect(replace('void loop() { outReady=inGo; }','void loop() { String content = client.readStringUntil(10); outReady=inGo; }'),'BLOCKING-IO');
expect(replace('void loop() { outReady=inGo; }','void loop() { if (millis() > lastTime + timeout) outReady=true; }'),'TIMER-WRAP');
expect(replace('void loop() { outReady=inGo; }','void loop() { if (millis() == next) outReady=true; }'),'TIMER-EQUALITY');
expect(replace('void loop() { outReady=inGo; }','void loop() { uint32_t started=millis(); if (millis()-started>500) outReady=true; }'),'TIMER-RESET');
clean(replace('void loop() { outReady=inGo; }','void loop() { static uint32_t started=millis(); if (millis()-started>500) outReady=true; }'));
expect(replace('void loop() { outReady=inGo; }','void loop() { WiFi.begin(ssid, password); }'),'RESOURCE-REINIT');
clean(replace('void loop() { outReady=inGo; }','void loop() { if (!ready) { WiFi.begin(ssid, password); } }'));
expect(replace('void setup() {}','void setup() { BLEDevice::init(""); BLEDevice::init(""); }'),'RESOURCE-DUPLICATE');
expect(replace('void setup() {}','void setup() { pinMode(2, INPUT); pinMode(2, OUTPUT); }'),'GPIO-MODE');
expect(replace('void setup() {}','uint16_t started=millis();\nvoid setup() {}'),'TIMER-WIDTH');
expect(replace('void loop() { outReady=inGo; }','void loop() { pulseIn(2,HIGH); }'),'BLOCKING-IO');
expect(replace('void setup() {}','void setup() { while (WiFi.status() != WL_CONNECTED) { delay(50); } }'),'BUSY-WAIT');
expect(replace('void loop() { outReady=inGo; }','void loop() { mqtt.connect("broker"); outReady=inGo; }'),'BLOCKING-IO');
expect(replace('void setup() {}','void onRecv(const uint8_t* mac, const uint8_t* msg, int len) { delay(20); }\nvoid setup() { esp_now_register_recv_cb(onRecv); }'),'CALLBACK-BLOCK');
// Existing verified BLE code must still parse and stay free of conversion-blocking errors.
const ble=fs.readFileSync(path.join(__dirname,'ble_presence_reference.ino'),'utf8');
const bleParsed=api.parseArduinoCode(ble);
const bleValidation=api.ino2ubiCompat.validateConverterInput(ble,bleParsed,false,'esp32');
assert.deepEqual(bleValidation.errors,[]);
const bleWarnings=check(ble);
assert(!bleWarnings.some(w=>/\[RESOURCE-REINIT\]|\[CALLBACK-BLOCK\]/.test(w)),`BLE wrongly flagged: ${bleWarnings}`);
tests++;
console.log(`PASS runtime safety: ${tests} scenarios; BLE compatibility preserved`);
