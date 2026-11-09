/* Basic multi-instance isolation: scoped helper lambdas and per-instance objects.
 * Conservative: reject constructs that cannot be preserved without an FLProg export reference.
 */
(function(root){
 'use strict';
 const word=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const call=(s,n)=>new RegExp('(^|[^.>:\\w])'+word(n)+'\\s*\\(').test(s);
 function prepare(functions, extras, setup, loop, opts={}) {
  const entries=Object.entries(functions||{});
  if (opts.singleInstance)
   return {setup,loop,functions,extraDeclarations:extras||[],isolated:false,scopedObjects:[]};
  const names=entries.map(([key,f])=>f.name||key);
  if(new Set(names).size!==names.length)
   throw Error('Code Basic: перегрузка/дублирование функций требует режима «один экземпляр».');
  for(const [key,f] of entries){
   if(!/^(?:void|bool|char|int|unsigned(?:\s+int)?|long|unsigned\s+long|float|double|String|uint(?:8|16|32)_t|int(?:8|16|32)_t)$/.test((f.return_type||'void').trim()))
    throw Error('Code Basic: функция '+key+' имеет неподдерживаемый для локальной изоляции возвращаемый тип.');
   if(/\b(?:noexcept|template|co_await|goto)\b/.test(f.body||''))
    throw Error('Code Basic: функция '+key+' требует ручной проверки области видимости.');
  }
  // A helper used as a callback/function pointer cannot become a capturing lambda.
  // Keep this path explicit rather than generating C++ that compiles only sometimes.
  for (const n of names) {
    const ref=new RegExp('\\b'+word(n)+'\\b(?!\\s*\\()', 'g');
    const usages=[setup,loop,...entries.map(([,f])=>f.body||'')];
    if(usages.some(text=>ref.test(text)))
      throw Error('Code Basic: функция '+n+' передаётся как указатель/callback либо используется без вызова; для нескольких экземпляров нужна отдельная реализация.');
  }
  const deps=new Map();
  entries.forEach(([key,f])=>{
   const name=f.name||key;
   const calls=names.filter(n=>call(f.body||'',n));
   if(calls.includes(name))throw Error('Code Basic: рекурсивная функция '+name+' требует ограничения «один экземпляр».');
   deps.set(name,calls);
  });
  const visited=new Set(), visiting=new Set(), sorted=[];
  const lookup=new Map(entries.map(([key,f])=>[f.name||key,f]));
  function visit(n){
   if(visiting.has(n))throw Error('Code Basic: взаимная рекурсия функций не поддерживается для нескольких экземпляров.');
   if(visited.has(n))return;
   visiting.add(n);(deps.get(n)||[]).forEach(visit);visiting.delete(n);visited.add(n);sorted.push(n);
  }
  names.forEach(visit);
  const objects=[],rest=[];
  for(const lineRaw of extras||[]){
   const line=String(lineRaw||'').trim();
   const m=line.match(/^([A-Za-z_]\w*(?:::\w+)*)\s+([A-Za-z_]\w*)\s*(\([^;]*\))?\s*;$/);
   if(m && m[1]==='Preferences'){
    if(call(setup,m[2]) || new RegExp('\\b'+word(m[2])+'\\b').test(setup))
     throw Error('Code Basic: объект '+m[2]+' используется в setup(), нужен проверенный способ общего доступа между setup и loop.');
    objects.push({name:m[2],line:'static '+line});
   } else if(m && m[1]==='GyverNTC') {
    // FLProg Code Basic has demonstrated safe instance suffixing of this constructor object.
    rest.push(lineRaw);
   } else rest.push(lineRaw);
  }
  // Unclassified global declarations may be shared across instances; fail closed.
  const unknown=rest.filter(line=>!/^GyverNTC\s+\w+\s*\([^;]*\)\s*;\s*$/.test(String(line).trim()));
  if(unknown.length)
   throw Error('Code Basic: неподдерживаемое глобальное объявление для нескольких экземпляров: '+String(unknown[0]).slice(0,90));
  const lambdaBlock=sorted.map(n=>{
   const f=lookup.get(n);
   const params=(f.params||'').trim();
   return 'auto '+n+' = [&]('+params+') -> '+(f.return_type||'void')+' {\n'+(f.body||'')+'\n};';
  }).join('\n');
  function scope(code,includeObjects,includeHelpers){
   const pre=[includeObjects?objects.map(x=>x.line).join('\n'):'',includeHelpers?lambdaBlock:''].filter(Boolean).join('\n');
   return '{\n'+(pre?pre+'\n':'')+code+'\n}';
  }
  // Always create a lexical scope for each Basic block to isolate local declarations.
  // If setup uses helper functions and any helper accesses loop-only objects, this is unsafe.
  const setupCalls=names.some(n=>call(setup,n));
  if(setupCalls && entries.some(([,f])=>/\bstatic\b/.test(f.body||'')))
   throw Error('Code Basic: функция со static-состоянием используется при инициализации; перенос между setup и loop нельзя подтвердить.');
  if(setupCalls && objects.length)
   throw Error('Code Basic: функция из setup() использует объект состояния loop(); требуется один экземпляр или переработка блока.');
  return {
   setup:scope(setup,false,setupCalls),
   loop:scope(loop,true,true),
   functions:{},extraDeclarations:rest,isolated:true,scopedObjects:objects
  };
 }
 root.ino2ubiBasicInstance={prepare};
})(typeof window!=='undefined'?window:globalThis);
