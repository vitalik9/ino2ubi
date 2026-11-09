'use strict';
const fs=require('fs'), path=require('path'), vm=require('vm'), assert=require('assert');
const root=path.resolve(__dirname,'..');
const ctx={window:{},crypto:require('crypto').webcrypto, console}; ctx.window.window=ctx.window; vm.createContext(ctx);
for(const file of ['constants.js','parser.js','string-params.js','number-literals.js','ble-support.js','generator.js','conversion-safety.js','runtime-safety.js','compat.js'])
  vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx,{filename:file});
let checks=0;
function audit(src) {let parsed=ctx.window.parseArduinoCode(src); return {parsed,issues:ctx.window.ino2ubiCompat.validateConverterInput(src,parsed,false,'esp32').errors};}
const suffix='\nvoid setup() {}\nvoid loop() {}';
for(const source of [
  'char* name = "abc";', 'uint8_t* buf;', 'int *ptr = nullptr;',
  'volatile bool flag = false;', 'const int N = 5;',
  'unsigned long long big = 5000000000ULL;', 'long long big = 5000000000LL;',
  'unsigned int cnt = 0; // out', 'size_t count = 0; // par: Счетчик',
  'uint64_t big = 0; // variable', 'int8_t a = 0; // in'
]) {
  const {issues}=audit(source+suffix);
  assert(issues.length>0,`Declaration was silently accepted: ${source}`); checks++;
}
for (const source of ['void loop(){ while(true){} }','void loop(){ while(1){} }','void loop(){ for(;;){} }']) {
  const issues=audit('void setup(){}\n'+source).issues;
  assert(issues.some(x=>x.includes('бесконечный цикл')),source+': '+issues);checks++;
}
{
 const src='bool ok = false; // out\nvoid setup(void){}\nvoid loop(void){ok=true;}';
 const r=audit(src);assert.strictEqual(r.issues.length,0,r.issues.join('; '));
 assert.strictEqual(ctx.window.extractFunctionBody(src,'loop'),'ok=true;');checks++;
}
{
 const src='std::array<int, 3> arr;\nvoid setup(){}\nvoid loop(){}';
 const p=audit(src).parsed;assert(p.extra_declarations.some(x=>x.includes('std::array<int, 3> arr')),JSON.stringify(p));checks++;
}
console.log('PASS audit fixes: '+checks+' cases');
