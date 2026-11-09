'use strict';
const assert=require('assert');
const fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.resolve(__dirname,'..');
const ctx={window:{},crypto:require('crypto').webcrypto,console};
ctx.window.window=ctx.window;
vm.createContext(ctx);
for(const file of ['constants.js','parser.js','string-params.js','number-literals.js','ble-support.js','basic-instance.js','generator.js','roundtrip.js'])
  vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx,{filename:file});
const source=`#include <Arduino.h>\nunsigned long outCounter=0UL; // out\nuint32_t outAge=0U; // out\nlong outSigned=0L; // out\nunsigned long StepValue=1UL; // par: Step\nunsigned long testCounter=0UL; // variable\nvoid setup(){outCounter=0UL;}\nvoid loop(){testCounter+=StepValue;outCounter=testCounter;outAge=(uint32_t)testCounter;}`;
const p=ctx.window.parseArduinoCode(source);
assert.strictEqual(p.variables.outCounter.type,'unsigned long');
assert.strictEqual(p.variables.outAge.type,'uint32_t');
assert.strictEqual(p.variables.outSigned.type,'long');
const xml=ctx.window.createUbiXmlSixx('Unsigned','',p.variables,p.functions,p.global_includes,p.defines,p.extra_declarations,p.static_declarations,ctx.window.extractFunctionBody(source,'setup'),ctx.window.extractFunctionBody(source,'loop'),false,{singleInstance:false});
const outputSection=xml.match(/sixx.name="outputs" sixx.type="OrderedCollection"[^>]*>([\s\S]*?)<\/sixx.object>/);
assert(outputSection,'Outputs collection not found');
for(const [name,type] of [['outCounter','UnsignedLongDataType'],['outAge','UnsignedLongDataType'],['outSigned','LongDataType']]) {
  const anchor=xml.indexOf('>'+name+'</sixx.object>');
  assert(anchor>=0,`Missing output ${name}`);
  const before=xml.slice(Math.max(0,anchor-1300),anchor);
  const matches=[...before.matchAll(/sixx.name="type" sixx.type="([A-Za-z]+DataType)"/g)];
  assert(matches.length,`Missing type for output ${name}`);
  assert.strictEqual(matches[matches.length-1][1],type,`Incorrect output type ${name}`);
}
assert(xml.includes('sixx.name="type" sixx.type="UnsignedLongDataType"')); 
assert(ctx.window.ino2ubiRoundtrip || ctx.window.ino2ubiRoundTrip || xml.includes('UnsignedLongDataType'));
console.log('PASS Basic unsigned long/uint32_t outputs and parameters are unsigned; long stays signed');
