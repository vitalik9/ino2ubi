/* ino2ubi: independent post-export structural verification of actual SIXX XML.
 * It detects missing/altered serialized parts. It cannot prove equivalent runtime behavior.
 */
(function (root) {
  'use strict';
  const str = v => String(v == null ? '' : v);
  const attr = (el,n) => el ? el.getAttribute('sixx.'+n) : null;
  const kids = el => el ? Array.from(el.children || []).filter(x => x.tagName === 'sixx.object') : [];
  const named = (el,n) => kids(el).find(x => attr(x,'name') === n) || null;
  const byType = (el,t) => kids(el).filter(x => attr(x,'type') === t);
  const trim = v => str(v).replace(/\r\n?/g,'\n').split('\n').map(l=>l.trimEnd()).join('\n').trim();
  function report(mode) {
    return {mode, errors:[], warnings:[], verified:[], scope:'Структурная сверка содержимого SIXX, не эквивалентность работы на ESP32'};
  }
  function equal(r,label,expected,actual) {
    if (trim(expected) !== trim(actual)) r.errors.push(label+': содержимое отличается от исходного кода или было потеряно.');
    else r.verified.push(label);
  }
  function needed(r,label,ok) {
    if (!ok) r.errors.push(label+': отсутствует в .ubi.');
    else r.verified.push(label);
  }
  function readXml(xml,r) {
    if (typeof DOMParser !== 'function') throw new Error('Для сверки необходим XML DOMParser.');
    const doc = new DOMParser().parseFromString(xml,'application/xml');
    if (!doc.documentElement || doc.getElementsByTagName('parsererror').length)
      throw new Error('Сгенерированный .ubi не содержит корректный XML.');
    // A SIXX id may be emitted as a declaration and referred to by a separate idref.
    const ids = new Map();
    for(const el of Array.from(doc.getElementsByTagName('sixx.object'))) {
      const id=attr(el,'id');if(id) ids.set(id,el);
    }
    const deref=el => attr(el,'idref') ? (ids.get(attr(el,'idref'))||null) : el;
    const value=(el,n) => {const v=deref(named(el,n));return v ? v.textContent : null;};
    return {doc,root:doc.documentElement,deref,value};
  }
  function buildAliases(state) {
    const a={};
    for(const [name,v] of Object.entries(state.variables || {}))
      if(v.alias && v.alias!==name && (v.role==='input'||v.role==='output')) a[name]=v.alias;
    return a;
  }
  function getParts(source,state,enable,mode,forceSingle=false) {
    const strings=root.ino2ubiStringParams.collect(state.variables,state.defines);
    const nums=root.ino2ubiStringParams.collectNumeric(state.variables,state.defines);
    const ble=state.ble_callbacks||[];
    const snap=ble.length?root.ino2ubiBleSupport.snapshots(ble):'';
    const transform=(text,excluded=[])=>root.ino2ubiStringParams.transform(text,strings,excluded,nums);
    if(mode==='basic') {
      const aliases=buildAliases(state);
      const src=what=>root.ino2ubiCompat.replaceCodeIdentifiers(root.extractFunctionBody(source,what),aliases);
      let setup=src('setup');
      let loop=src('loop');
      let isolated=false;
      let scopedObjects=[];
      if(root.ino2ubiBasicInstance) {
        const funcs={};
        for(const [key,f] of Object.entries(state.functions||{}))
          funcs[key]=Object.assign({},f,{body:root.ino2ubiCompat.replaceCodeIdentifiers(f.body||'',aliases)});
        const once=forceSingle||root.ino2ubiConversionSafety.requiresSingleInstance(source,state);
        const result=root.ino2ubiBasicInstance.prepare(funcs,state.extra_declarations||[],setup,loop,{singleInstance:once});
        setup=result.setup;loop=result.loop;isolated=result.isolated;scopedObjects=result.scopedObjects;
      }
      setup=transform(snap?snap+'\n'+setup:setup);
      loop=transform(snap?snap+'\n'+loop:loop);
      if(enable)loop='if(En)\n{\n'+loop+'\n}';
      return {setup,loop,strings,nums,transform,aliases,isolated,scopedObjects};
    }
    let setup=transform([snap,root.extractFunctionBody(source,'setup')].filter(Boolean).join('\n'));
    let loop=transform([snap,root.extractFunctionBody(source,'loop')].filter(Boolean).join('\n'));
    if(enable)loop='if (En) {\n'+loop+'\n}';
    return {setup,loop,strings,nums,transform};
  }
  function compareBasic(xml, source, state, enable, board, forceSingle=false) {
    const r=report('Code Basic');
    try {
      const {root:top,deref,value}=readXml(xml,r);
      const main=deref(named(top,'typeClass'));
      if(!main || attr(main,'type')!=='CodeUserBlock') throw new Error('Не найден CodeUserBlock.');
      const parts=getParts(source,state,enable,'basic',forceSingle);
      const getCode=section=>{
        const parent=named(main,section+'CodePart');
        return parent ? value(parent,'code') : null;
      };
      const actualSetup=getCode('setup'),actualLoop=getCode('loop');
      if(actualSetup===null) r.errors.push('setup(): отсутствует секция.');
      else equal(r,'setup()',parts.setup,actualSetup);
      if(actualLoop===null) r.errors.push('loop(): отсутствует секция.');
      else equal(r,'loop()',parts.loop,actualLoop);
      const declarationPart=named(main,'declareCodePart');
      const declarationItems=named(declarationPart,'code');
      const declare=kids(declarationItems).map(x=>({type:attr(x,'type'),name:value(x,'name')||'',first:value(x,'firstPart')||'',last:value(x,'lastPart')||'',directive:value(x,'define')||''}));
      const allDecl=declare.map(d=>(d.directive ? d.directive+' '+d.name+' '+d.last : d.first+' '+d.name+d.last));
      const includes=(state.global_includes||[]).filter(x=>/^\s*#include\b/.test(x));
      for(const inc of includes)needed(r,'#include '+str(inc).replace(/^\s*#include\s*/,''),
        declare.some(d=>d.directive==='#include' && trim(d.name)===trim(inc.replace(/^\s*#include\s*/,''))));
      const actualIncludes=declare.filter(d=>d.directive==='#include').map(d=>trim(d.name));
      equal(r,'порядок #include',includes.map(x=>trim(x.replace(/^\s*#include\s*/,''))).join('\n'),actualIncludes.join('\n'));
      for(const def of state.defines||[])if(def.role!=='parameter')
        needed(r,'#define '+def.name,declare.some(d=>d.directive==='#define' && d.name===def.name && trim(d.last)===trim(def.value)));
      for(const line of [...(state.static_declarations||[]),...(state.extra_declarations||[]).filter(line => !parts.scopedObjects.some(obj => obj.name === (String(line).match(/^\s*\w+\s+(\w+)/)||[])[1]))]) {
        // For declarations with constructors the split into first/name/last is not stable;
        // compare token sequences without insignificant whitespace.
        const simplified=s=>trim(s).replace(/\s+/g,'').replace(/&amp;/g,'&');
        needed(r,'объявление '+str(line).slice(0,60),allDecl.some(s=>simplified(s)===simplified(line)));
      }
      const captured=new Set((state.ble_callbacks||[]).flatMap(c=>c.captured||[]));
      for(const [name,v] of Object.entries(state.variables||{}))if(v.role==='variable' && !captured.has(name)) {
        const d=declare.find(d=>d.type==='CodeUserBlockDeclareStandartBlock' && d.name===(v.alias||name));
        needed(r,'переменная '+name,!!d);
        if(d && trim(d.first)!==trim(v.type))r.errors.push('Тип переменной '+name+' изменился.');
        if(d && v.default && !trim(d.last).includes(trim(v.default)))r.errors.push('Инициализация '+name+' изменилась.');
      }
      for(const cb of state.ble_callbacks||[]) {
        const d=declare.find(d=>d.name===cb.objectName);
        needed(r,'BLE callback '+cb.objectName,!!d && d.first.includes('class '+cb.className));
        if(d)equal(r,'полный код BLE callback '+cb.className,
          root.ino2ubiBleSupport.build(cb,state.variables),d.first);
        if(d)for(const n of cb.captured||[])
          needed(r,'BLE состояние '+n,new RegExp('\\b'+n+'\\b').test(d.first));
      }
      // Pins are not source declarations anymore: they must be present as FLProg IO adaptors.
      for(const [role,section] of [['input','inputs'],['output','outputs']]){
        const io=named(main,section);
        const contacts=kids(io).map(a=>deref(named(a,'object'))).filter(Boolean);
        const contactNames=contacts.map(x=>value(x,'name'));
        for(const [name,v] of Object.entries(state.variables||{}))if(v.role===role){
          const obj=contacts.find(x=>value(x,'name')===(v.alias||name));
          needed(r,role+' '+name,!!obj);
          if(obj)needed(r,'тип '+role+' '+name,attr(named(obj,'type'),'type')===getTypeClassName(v.type));
        }
        if(role==='input' && enable)needed(r,'вход En',contactNames.includes('En'));
      }
      const paramParent=named(main,'parametrs');
      const params=kids(paramParent).map(a=>deref(named(a,'object'))).filter(Boolean);
      for(const [name,v] of Object.entries(state.variables||{}))if(v.role==='parameter') {
        const p=params.find(x=>value(x,'name')===name);
        needed(r,'параметр '+name,!!p);
        if(p){
          needed(r,'тип параметра '+name,attr(named(p,'type'),'type')===getTypeClassName(v.type));
          let expected=str(v.default|| (v.type==='String'?'':'0'));
          if(v.type==='String')expected=expected.replace(/^['"]|['"]$/g,'');
          else if(v.type==='bool'||v.type==='boolean')expected=root.ino2ubiNumberLiterals.normalizeBoolean(expected,name);
          else if(v.type==='float'||v.type==='double')expected=root.ino2ubiNumberLiterals.normalizeFloat(expected,name);
          else expected=root.ino2ubiNumberLiterals.normalizeValue(expected,v.type,board||'esp32',name);
          equal(r,'значение '+name,expected,value(p,v.type==='String'?'stringDefaultValue':'numberDefaultValue'));
        }
      }
      // Function signatures and bodies are read back from actual encoded SIXX nodes.
      const fParent=named(main,'functionCodePart');
      const fList=byType(named(fParent,'code'),'CodeUserBlockFunction');
      for(const [key,f] of Object.entries(parts.isolated?{}:(state.functions||{}))){
        const fn=fList.find(x=>value(named(x,'parsesFunctionName'),'name')===(f.name||key));
        needed(r,'функция '+(f.name||key),!!fn);
        if(!fn)continue;
        const proto=named(fn,'parsesFunctionName');
        equal(r,'возвращаемый тип '+(f.name||key),f.return_type||'void',value(proto,'declare'));
        const paramNodes=byType(named(proto,'parametrs'),'CodeUserBlockFunctionParametr');
        const expectedParams=f.parsed_params||[];
        needed(r,'число аргументов '+(f.name||key),paramNodes.length===expectedParams.length);
        expectedParams.forEach((p,i)=>{
          if(!paramNodes[i])return;
          equal(r,'аргумент '+(f.name||key)+' '+i,p.name,value(paramNodes[i],'name'));
          equal(r,'тип аргумента '+(f.name||key)+' '+i,p.type,value(paramNodes[i],'declare'));
        });
        const body=value(named(fn,'functionBody'),'string');
        if(body===null)r.errors.push('Тело функции '+(f.name||key)+' отсутствует.');
        else equal(r,'тело функции '+(f.name||key),parts.transform(f.body||'',expectedParams.map(x=>x.name)),body);
      }
      if(parts.isolated) needed(r,'изолированные функции не должны экспортироваться как глобальные',fList.length===0);
      r.warnings.push('Сверка сравнивает сохранённые секции .ubi; она не доказывает отсутствие ошибок времени выполнения или корректную сборку FLProg.');
    }catch(e){r.errors.push('Сверка Code Basic: '+e.message);}
    return r;
  }
  function compareProfessional(xml,source,state,enable) {
    const r=report('Code Professional');
    try {
      const {doc,root:top,deref,value}=readXml(xml,r);
      needed(r,'тип Professional',attr(top,'type')==='UserCodeMultiBlockBlockLibraryElement');
      const parts=getParts(source,state,enable,'professional');
      const nodes=Array.from(doc.getElementsByTagName('sixx.object'));
      const entries=nodes.filter(x=>attr(x,'type')==='UserCodeMultiBlockCodePartsInstance');
      const aliased={};
      for(const [name,v] of Object.entries(state.variables||{}))if(v.role==='parameter')aliased[v.alias||name]=name;
      function decodeCode(el) {
        const code=named(el,'codeText');
        if(!code)throw new Error('Code Professional: у секции отсутствует codeText.');
        let result='';
        for(const item of kids(code)){
          if(attr(item,'type')!=='UserCodeMultiBlockEditorCodeObject')
            throw new Error('Неизвестный редакторский объект Professional.');
          const type=value(item,'type');
          const val=deref(named(item,'value'));
          if(type==='plainText') {if(!val)throw new Error('Пустая ссылка на текст Professional.'); result+=val.textContent;continue;}
          if(type!=='codeTag'||!val)throw new Error('Неподдерживаемый тег Professional: '+type);
          if(attr(val,'type')==='UserCodeMultiBlockUseInCodeUUIDTag'){
            result+='__INO_UUID__';continue;
          }
          const obj=deref(named(val,'object'));
          if(!obj)throw new Error('Не найдена ссылка на параметр или контакт Professional.');
          const name=value(obj,'name');
          if(!name)throw new Error('Не найдено имя тега Professional.');
          result+=aliased[name]||name;
        }
        // User globals are stored as name_ + per-instance UUID-tag, not literal name.
        return result.replace(/\b([A-Za-z_]\w*)___INO_UUID__/g,'$1');
      }
      const embedded=entries.map(x=>({section:value(x,'section')||'',text:decodeCode(x)}));
      const section=label=>embedded.filter(x=>x.section===label);
      const declarations=section('declare'),setups=section('setup'),loops=section('loop');
      // The Professional exporter adds exactly one lexical scope per instance
      // to avoid local-variable collisions when FLProg combines code parts.
      // Ignore only this verified outer wrapper, never normalize arbitrary code.
      const unwrapInstanceScope=text=>{
        const t=trim(text);
        return t.startsWith('{\n') && t.endsWith('\n}') ? trim(t.slice(2,-2)) : t;
      };
      needed(r,'раздел declare',declarations.length>0);
      if(trim(parts.setup)){
        needed(r,'раздел setup',setups.length>0);
        if(setups.length)equal(r,'setup() Professional',parts.setup,unwrapInstanceScope(setups.map(x=>x.text).join('\n')));
      }
      if(trim(parts.loop)){
        needed(r,'раздел loop',loops.length>0);
        if(loops.length)equal(r,'loop() Professional',parts.loop,unwrapInstanceScope(loops.map(x=>x.text).join('\n')));
      }
      const declText=declarations.map(x=>x.text).join('\n');
      for(const inc of state.global_includes||[]) needed(r,'#include Professional '+inc,declText.includes(inc.trim()));
      for(const [name,fn] of Object.entries(state.functions||{})){
        const signature=(fn.return_type||fn.returnType||'void')+' '+(fn.name||name)+'('+(fn.parameters||fn.params||'')+')';
        needed(r,'сигнатура '+name,declText.includes(signature));
        const body=parts.transform(fn.body||'',(fn.parsed_params||[]).map(x=>x.name));
        needed(r,'тело '+name,declText.includes(body));
      }
      for(const cb of state.ble_callbacks||[])needed(r,'BLE class Professional '+cb.className,declText.includes('class '+cb.className));
      r.warnings.push('Сверены текст и теги setup/loop и ключевые объявления; внутренние зависимости шаблона Professional и семантика после генерации C++ в FLProg требуют отдельной проверки.');
    }catch(e){r.errors.push('Сверка Code Professional: '+e.message);}
    return r;
  }
  root.ino2ubiRoundtrip={compareBasic,compareProfessional};
})(typeof window!=='undefined' ? window : globalThis);
