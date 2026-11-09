'use strict';
const assert=require('assert'), fs=require('fs'), vm=require('vm'), path=require('path');
const root=path.resolve(__dirname,'..');
const ctx={window:{},crypto:require('crypto').webcrypto,console};
vm.createContext(ctx);
for (const file of ['constants.js','parser.js','string-params.js','number-literals.js','ble-support.js','basic-instance.js','generator.js','conversion-safety.js','compat.js'])
 vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx,{filename:file});
const api=ctx.window;
const src=`#include <Arduino.h>
#include <Preferences.h>
bool inStart = false; // in
float outAccum = 0.0f; // out
int count = 0; // variable
Preferences prefs;
bool good(float x) { return x > 0; }
void save() { prefs.begin("test",false); prefs.putFloat("n",outAccum); prefs.end(); }
void add(float x) { if(good(x)) { count++; outAccum+=x; save(); } }
void setup() { count=0; }
void loop() { if(inStart) add(1.0f); }`;
const p=api.parseArduinoCode(src);
assert.strictEqual(Object.keys(p.functions).length,3);
assert(p.extra_declarations.some(s=>s.includes('Preferences prefs;')));
const prepared=api.ino2ubiBasicInstance.prepare(p.functions,p.extra_declarations,api.extractFunctionBody(src,'setup'),api.extractFunctionBody(src,'loop'),{singleInstance:false});
assert(prepared.isolated);
assert.strictEqual(Object.keys(prepared.functions).length,0);
assert(prepared.loop.includes('static Preferences prefs;'));
assert(prepared.loop.indexOf('auto good')<prepared.loop.indexOf('auto add'));
assert(prepared.loop.indexOf('auto save')<prepared.loop.indexOf('auto add'));
assert(prepared.setup.startsWith('{'));
const xml=api.createUbiXmlSixx('Two','',p.variables,p.functions,p.global_includes,p.defines,p.extra_declarations,p.static_declarations,api.extractFunctionBody(src,'setup'),api.extractFunctionBody(src,'loop'),false,{singleInstance:false});
assert(!xml.includes('sixx.type="CodeUserBlockFunction"'));
assert(xml.includes('static Preferences prefs;'));
assert(api.ino2ubiCompat.inspectGeneratedXml(xml).valid);
const ctor='GyverNTC therm(0,10000,3435,25,10000);';
const ctorParsed=api.ino2ubiBasicInstance.prepare({},[ctor],'','out=therm.getTempAverage();',{singleInstance:false});
assert(!ctorParsed.loop.includes('static '+ctor));
assert(ctorParsed.extraDeclarations.includes(ctor));
assert.throws(()=>api.ino2ubiBasicInstance.prepare({f:{name:'f',return_type:'void',params:'',body:'f();'}},[],'','f();',{singleInstance:false}),/рекурсивная/);
assert.throws(()=>api.ino2ubiBasicInstance.prepare({},['Preferences prefs;'],'prefs.begin("x",true);','',{singleInstance:false}),/setup/);
assert.throws(()=>api.ino2ubiBasicInstance.prepare({},['char *ptr;'],'','',{singleInstance:false}),/неподдерживаемое/);
assert.throws(()=>api.ino2ubiBasicInstance.prepare({cb:{name:'cb',return_type:'void',params:'',body:''}},[],'client.setCallback(cb);','',{singleInstance:false}),/callback/);
console.log('PASS Basic two-instance: helper dependency ordering, local objects, SIXX, guarded unsupported cases');
fs.writeFileSync('/mnt/data/ino2ubi_basic_multi_sample.xml',xml);
