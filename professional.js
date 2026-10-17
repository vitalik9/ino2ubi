/* Experimental FLProg Code Professional (UserCodeMultiBlock) generator.
 * Uses a trimmed, structurally authentic SHT3x template, not the Code Basic XML format.
 * All processing runs locally in the browser. */
(function (root) {
  'use strict';
  const XML_TYPE = 'sixx.object';
  const nameAttr = 'sixx.name', idAttr = 'sixx.id', refAttr = 'sixx.idref';
  const TYPE = {
    'bool':'BooleanDataType', 'boolean':'BooleanDataType',
    'byte':'ByteDataType', 'uint8_t':'ByteDataType',
    'char':'CharDataType', 'int':'IntegerDataType', 'int16_t':'IntegerDataType',
    'uint16_t':'IntegerDataType', 'long':'LongDataType','int32_t':'LongDataType',
    'unsigned long':'UnsignedLongDataType', 'uint32_t':'UnsignedLongDataType',
    'float':'FloatDataType', 'double':'FloatDataType', 'String':'StringDataType'
  };
  const RECOGNIZED = new Set(Object.keys(TYPE));
  function child(node, name) {
    return Array.from(node.children).find(n => n.getAttribute(nameAttr) === name) || null;
  }
  function required(node, name) {
    const x = child(node, name);
    if (!x) throw new Error('Нет секции FLProg: ' + name);
    return x;
  }
  function children(node, type) {
    return Array.from(node.children).filter(n => n.getAttribute('sixx.type') === type);
  }
  function textOf(node, name, value) {
    const n = required(node, name); n.textContent = String(value); return n;
  }
  function safeIdentifier(name) {
    return /^[A-Za-z_][A-Za-z_0-9]*$/.test(name);
  }
  function sanitizeName(name) {
    return String(name || 'Custom_Block').replace(/[^A-Za-z0-9_\-]/g, '_').slice(0,90) || 'Custom_Block';
  }
  function ensureXml(doc) {
    if (!doc || doc.querySelector('parsererror') || !doc.documentElement ||
      doc.documentElement.getAttribute('sixx.type') !== 'UserCodeMultiBlockBlockLibraryElement') {
      throw new Error('Образец Code Professional повреждён или недоступен.');
    }
  }
  function createBuilder(template) {
    const doc = new DOMParser().parseFromString(template, 'application/xml');
    ensureXml(doc);
    let next = Math.max(0, ...Array.from(doc.querySelectorAll('[sixx\\.id]')).map(n => Number(n.getAttribute(idAttr)) || 0)) + 1;
    const refId = () => String(next++);
    function object(name, type, env, value, identified) {
      const el = doc.createElement(XML_TYPE);
      if (identified !== false) el.setAttribute(idAttr, refId());
      if (name !== null && name !== undefined) el.setAttribute(nameAttr, name);
      if (type) el.setAttribute('sixx.type', type);
      if (env) el.setAttribute('sixx.env', env);
      if (value !== undefined && value !== null) el.textContent = String(value);
      return el;
    }
    function add(parent, name, type, env, value, identified) {
      const n=object(name,type,env,value,identified); if (parent) parent.appendChild(n);return n;
    }
    function core(parent,name,type,value,identified) {
      return add(parent,name,type,'Core',value,identified);
    }
    function ard(parent,name,type,identified) {
      return add(parent,name,type,'Arduino',undefined,identified);
    }
    function bool(parent,name,val) {
      return core(parent,name,val?'True':'False',undefined,false);
    }
    function linked(parent,name,target) {
      const n=object(name,null,null,null,false);
      n.setAttribute(refAttr, target.getAttribute(idAttr));parent.appendChild(n);return n;
    }
    function logicalId(parent) {
      core(parent,'id','SmallInteger',String(100000000 + Math.floor(Math.random()*150000000)));
    }
    const knownDataTypes = new Map();
    function dataType(parent,t) {
      const ty=TYPE[t];
      if (!ty) throw new Error('Тип ' + t + ' пока не поддерживается в Code Professional');
      // SIXX stores a datatype class once and shares it by reference, as in real FLProg exports.
      if (knownDataTypes.has(ty)) return linked(parent,'type',knownDataTypes.get(ty));
      const el=ard(parent,'type',ty+' class');
      const coll=core(el,'instanceCollection','OrderedCollection');
      ard(coll,null,ty);
      knownDataTypes.set(ty,el);
      return el;
    }
    function plain(text) {
      const n=ard(null,null,'UserCodeMultiBlockEditorCodeObject');
      core(n,'value','String',text);
      core(n,'type','Symbol','plainText');
      bool(n,'isComment',false);
      core(n,'keys','OrderedCollection');
      bool(n,'isTextConstant',false);
      return n;
    }
    const userIO = new Map(), userParams = new Map(), userVars = new Set();
    let currentInstance=null;
    function inputOutput(instance, name, info) {
      if (!safeIdentifier(name)) throw new Error('Неверное имя контакта C++: ' + name);
      const inputs = info.role === 'input';
      const lib=required(instance,inputs?'inputsLibrary':'outputsLibrary');
      const items=required(lib,'items');
      const io=ard(items,null,'UserCodeMultiBlockInputOutput');
      logicalId(io);
      bool(io,'isInput',inputs);
      core(io,'name','String',name);
      dataType(io,info.type);
      bool(io,'hasVariable',true);
      if (!inputs) {
        const code=core(io,'code','OrderedCollection');
        code.appendChild(plain(''));
      }
      core(io,'useInCodeTags','OrderedCollection');
      core(io,'conditionType','Symbol','none');
      core(io,'label','String',info.alias || name);
      bool(io,'conditionIsAvalible',true);
      userIO.set(name,io);
    }
    function parameter(instance,name,info) {
      if (!safeIdentifier(name)) throw new Error('Неверное имя параметра C++: ' + name);
      const items=required(required(instance,'instanceParametrsLibrary'),'items');
      const p=ard(items,null,'UserCodeMultiBlockStandartParametr');
      logicalId(p);
      core(p,'name','String',info.alias || name);
      core(p,'description','String','');
      core(p,'conditionType','Symbol','none');
      dataType(p,info.type);
      let value=info.default == null ? (info.type==='String' ? '' : '0') : String(info.default);
      if (info.type==='String') value=value.replace(/^['"]|['"]$/g,'');
      const isBoolean=info.type==='bool' || info.type==='boolean';
      const numberType=info.type==='String'?'String':info.type==='float'||info.type==='double'?'Float':'SmallInteger';
      if (numberType==='Float') {
        value=value.replace(/[fF]$/, '');
        if (!Number.isFinite(Number(value))) throw new Error('Некорректное значение float параметра '+name+': '+value);
      }
      if (numberType==='SmallInteger' && !isBoolean && !/^[+-]?\d+$/.test(value)) {
        throw new Error('Некорректное целочисленное значение параметра '+name+': '+value);
      }
      if (!isBoolean) {
        // As in working FLProg Professional UBI libraries: editable value input.
        const species=ard(p,'parametrSpecies','UserCodeMultiBlockInputFieldParametrSpecies');
        logicalId(species);
        core(species,'defaultValue',numberType,value);
      } else {
        // Boolean values remain a fixed True/False choice.
        const species=ard(p,'parametrSpecies','UserCodeMultiBlockRadioButtonParametrSpecies');
        logicalId(species);
        const choices=core(species,'choices','OrderedCollection');
        const normalized=/^(1|true)$/i.test(value);
        for (const yes of [true,false]) {
          const choice=ard(choices,null,'UserCodeMultiBlockComboBoxParametrSpeciesChoice');
          logicalId(choice);
          bool(choice,'isDefault',yes===normalized);
          core(choice,'text','String',yes?'True':'False');
          bool(choice,'value',yes);
        }
        const booleans=core(species,'booleanChoices','OrderedCollection');
        for (const yes of [true,false]) {
          const opt=ard(booleans,null,'UserCodeMultiBlockComboBoxParametrSpeciesChoice');
          logicalId(opt);bool(opt,'isDefault',yes===normalized);
          core(opt,'text','String',yes?'True':'False');bool(opt,'value',yes);
        }
      }
      bool(p,'isInsertWithoutBrackets',false);
      const viewItems=required(required(instance,'userDataParametrsView'),'items');
      const view=ard(viewItems,null,'UserCodeMultiBlockEditorUserDataViewTreeElement');
      logicalId(view);linked(view,'object',p);
      core(view,'altName','String','');
      userParams.set(name,p);
    }
    const embeddedCodeObjects = new Set();
    const emittedDataTypes = new Set();
    const firstTagForContact = new Map();
    function ensureTypeIsDefinedBeforeUse(target) {
      const node=child(target,'type');
      if (!node) return;
      const declaredId=node.getAttribute(idAttr);
      if (declaredId) {emittedDataTypes.add(declaredId);return;}
      const typeRef=node.getAttribute(refAttr);
      if (!typeRef || emittedDataTypes.has(typeRef)) return;
      const original=Array.from(knownDataTypes.values()).find(t=>t.getAttribute(idAttr)===typeRef);
      if (!original || !original.parentNode) throw new Error('Не найдено описание типа контакта или параметра.');
      const oldParent=original.parentNode;
      const ref=object('type',null,null,null,false);
      ref.setAttribute(refAttr,typeRef);
      oldParent.replaceChild(ref,original);
      target.replaceChild(original,node);
      emittedDataTypes.add(typeRef);
    }
    function connectCodeTagToObject(tag, target) {
      const oid=target.getAttribute(idAttr);
      if (!oid) throw new Error('Контакт или параметр без SIXX ID.');
      if (embeddedCodeObjects.has(oid)) {
        linked(tag,'object',target);
        return;
      }
      // A compiled Code Professional tag must OWN its first object definition.
      // Otherwise FLProg can deserialize its object as nil, then crash at #isInput.
      // Replace the definition in the instance library with an idref, exactly like
      // real SHT3x/NTC UBI examples. Subsequent tags share the existing definition.
      const holder=target.parentNode;
      if (!holder) throw new Error('Контакт или параметр не прикреплён к библиотеке блока.');
      ensureTypeIsDefinedBeforeUse(target);
      const ref=object(null,null,null,null,false);
      ref.setAttribute(refAttr,oid);
      holder.replaceChild(ref,target);
      target.setAttribute(nameAttr,'object');
      tag.appendChild(target);
      embeddedCodeObjects.add(oid);
    }
    function newTag(o,io) {
      const contactId=o.getAttribute(idAttr);
      const previous=io && firstTagForContact.get(contactId);
      const edit=ard(null,null,'UserCodeMultiBlockEditorCodeObject');
      if (previous) {
        // Reusing the same canonical tag keeps the code graph valid without
        // forward sixx.idref entries inside the first embedded contact.
        linked(edit,'value',previous);
      } else {
        const tag=ard(null,'value',io?'UserCodeMultiBlockUseInCodeInputOutputTag':'UserCodeMultiBlockUseInCodeStandartParametrTag');
        logicalId(tag);
        connectCodeTagToObject(tag,o);
        if (io) {
          firstTagForContact.set(contactId,tag);
          linked(required(o,'useInCodeTags'),null,tag);
        }
        edit.appendChild(tag);
      }
      core(edit,'type','Symbol','codeTag');
      bool(edit,'isComment',false);
      bool(edit,'isTextConstant',false);
      return edit;
    }
    function uuidTag(instance) {
      const tag=ard(null,'value','UserCodeMultiBlockUseInCodeUUIDTag');
      logicalId(tag);linked(tag,'object',instance);
      const edit=ard(null,null,'UserCodeMultiBlockEditorCodeObject');
      edit.appendChild(tag);core(edit,'type','Symbol','codeTag');
      bool(edit,'isComment',false);bool(edit,'isTextConstant',false);
      return edit;
    }
    function partsFromCode(text,items) {
      // Replace C++ identifiers by native FLProg references, without touching comments or literals.
      const symbols=Array.from(new Set([...userIO.keys(),...userParams.keys(),...userVars]));
      const source=String(text || '');
      if (!symbols.length) {items.appendChild(plain(source));return;}
      const regex=new RegExp('\\b('+symbols.sort((a,b)=>b.length-a.length).map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+')\\b','g');
      const masked=typeof maskNonCode==='function'?maskNonCode(source):source;
      let cursor=0, match;
      while ((match=regex.exec(masked))!==null) {
        // `maskComments` keeps literal strings but does not blank them: do not touch quoted strings.
        const before=source.slice(cursor,match.index);
        items.appendChild(plain(before));
        const key=match[0];
        if (userVars.has(key)) {
          items.appendChild(plain(key+'_'));
          items.appendChild(uuidTag(currentInstance));
        } else {
          items.appendChild(newTag(userIO.get(key)||userParams.get(key),userIO.has(key)));
        }
        cursor=match.index+key.length;
      }
      items.appendChild(plain(source.slice(cursor)));
    }
    function codePart(instance, sectionName, position, codeName, source) {
      if (!String(source || '').trim()) return;
      currentInstance=instance;
      const partData=required(instance,'codeData');
      const section=required(partData,sectionName+'Section');
      const holder=required(section,sectionName==='function'?'codePart':position+'Part');
      const items=required(holder,'items');
      const part=ard(items,null,'UserCodeMultiBlockCodePartsInstance');
      logicalId(part);
      const code=core(part,'codeText','OrderedCollection');
      partsFromCode(source,code);
      core(part,'conditionType','Symbol','none');
      core(part,'codeName','String',codeName);
      bool(part,'isCommon',false);bool(part,'isMain',false);
      core(part,'position','Symbol',position);
      core(part,'section','Symbol',sectionName);
      bool(part,'isNotViewInclude',false);
    }
    function updateDescription(instance,description) {
      const info=required(instance,'info');
      textOf(info,'string',description);
      const runs=required(info,'runs');
      const arr=required(runs,'runs');
      for (const c of Array.from(arr.children)) arr.removeChild(c);
      core(arr,null,'SmallInteger',description.length);
    }
    return {doc,object,core,ard,required,child,refId,add,inputOutput,parameter,codePart,updateDescription,addVar:n=>userVars.add(n)};
  }
  function helperDefinitions(state) {
    return Object.entries(state.functions||{}).filter(([name])=>name!=='setup' && name!=='loop');
  }
  // In the absence of a real class implementation, never invent one for an unknown #include.
  function makeHeader(name,functions) {
    const guard=('INO2UBI_'+sanitizeName(name).replace(/-/g,'_')+'_HPP').toUpperCase();
    const signatures=functions.map(([key,f]) => {
      const ret=f.return_type||f.returnType||'void';
      const fn=f.name||key;
      const params=f.parameters||f.params||'';
      if (!safeIdentifier(fn)) throw new Error('Недопустимое имя функции: '+fn);
      return {signature:ret+' '+fn+'('+params+')',body:f.body||''};
    });
    const declarations=signatures.map(f=>'inline '+f.signature+';').join('\n');
    const definitions=signatures.map(f=>'inline '+f.signature+' {\n'+f.body+'\n}').join('\n\n');
    return '#ifndef '+guard+'\n#define '+guard+'\n#include <Arduino.h>\n\n'+declarations+'\n\n'+definitions+'\n\n#endif // '+guard+'\n';
  }
  function externalIncludes(state) {
    return (state.global_includes||[]).filter(x=>/^\s*#include\s*"[^"]+\.hpp?"/.test(x));
  }
  // Deliberately exported as a factory to make validation explicit.
  function build(options) {
    const b=createBuilder(options.template);
    const main=required(b.doc.documentElement,'mainBlock');
    const instances=required(required(main,'blockInstancesLibrary'),'items');
    const inst=Array.from(instances.children).find(el=>el.getAttribute('sixx.type')==='UserCodeMultiBlockBlockInstance');
    if (!inst) throw new Error('Не найден экземпляр блока Code Professional.');
    const state=options.state || {};
    const name=String(options.name||'Custom Block').trim();
    const description=String(options.description||'').trim();
    textOf(required(main,'mainParametrs'),'folderName',name);
    textOf(inst,'name',name);
    textOf(inst,'label',name.slice(0,32));
    b.updateDescription(inst,description);
    const variables=Object.assign({},state.variables||{});
    if (options.enableInput) {
      if (variables.En && variables.En.role!=='input') throw new Error('En уже используется как переменная или параметр.');
      if (!variables.En) variables.En={role:'input',type:'boolean',alias:'En'};
    }
    for (const [n,v] of Object.entries(variables)) {
      if (v.role==='variable') b.addVar(n);
      if (['input','output'].includes(v.role)) b.inputOutput(inst,n,v);
      if (v.role==='parameter') b.parameter(inst,n,v);
    }
    const defines=(state.defines||[]).map(d=>d.role==='parameter'?{name:d.name,role:'parameter',type:d.type||'String',default:d.value}:d);
    for (const p of defines) if (p.role==='parameter' && !variables[p.name]) b.parameter(inst,p.name,p);
    // Keep ordinary helper functions inside UBI: a separate header is NOT required.
    const helpers=helperDefinitions(state);
    const includesFromSource=externalIncludes(state).map(s=>s.match(/"([^"]+)"/)[1]);
    const providedName=String(options.additionalHeaderFilename||'').trim();
    const headerName=providedName && /^(?!\.)[\w.-]+\.hpp?$/i.test(providedName) ? providedName : sanitizeName(name)+'.hpp';
    const provided=String(options.additionalHeader||'').trim();
    const hpp=provided ? provided+'\n' : '';
    const ownHpp=Boolean(hpp);
    // Never manufacture headers just because a helper function exists.
    const internal=helpers;
    const includes=(state.global_includes||[]).join('\n');
    const defineLines=(state.defines||[]).filter(d=>d.role!=='parameter').map(d=>'#define '+d.name+' '+(d.value||'')).join('\n');
    const declarations=(state.extra_declarations||[]).map(x=>typeof x==='string'?x:(x.code||x.text||'')).join('\n');
    const staticDecl=(state.static_declarations||[]).map(x=>typeof x==='string'?x:(x.code||x.text||'')).join('\n');
    let globalDecl=Object.entries(variables).filter(([,v])=>v.role==='variable').map(([n,v])=>v.type+' '+n+(v.default!=null?' = '+v.default:'')+';').join('\n');
    const headerInc=ownHpp && !includesFromSource.includes(headerName)?'#include "'+headerName+'"\n':'';
    b.codePart(inst,'declare','stop','Библиотеки и объявления',[includes,headerInc,defineLines,declarations,staticDecl,globalDecl].filter(Boolean).join('\n'));
    if (internal.length) {
      b.codePart(inst,'function','neitral','Функции, использующие контакты',internal.map(([fn,f])=>{
        return (f.return_type||f.returnType||'void')+' '+(f.name||fn)+'('+(f.parameters||f.params||'')+') {\n'+(f.body||'')+'\n}';
      }).join('\n\n'));
    }
    const setup=options.setupCode||'';
    let loop=options.loopCode||'';
    if (options.enableInput) loop='if (En) {\n'+loop+'\n}';
    b.codePart(inst,'setup','stop','Инициализация',setup);
    b.codePart(inst,'loop','stop','Основной цикл',loop);
    const xml=new XMLSerializer().serializeToString(b.doc);
    const checked=new DOMParser().parseFromString(xml,'application/xml');
    ensureXml(checked);
    // Do not export an unresolvable input/output tag: that crashed FLProg (#isInput).
    const compiledTags=Array.from(checked.getElementsByTagName('sixx.object')).filter(
      el=>el.getAttribute('sixx.type')==='UserCodeMultiBlockUseInCodeInputOutputTag' &&
      el.parentElement?.getAttribute('sixx.type')==='UserCodeMultiBlockEditorCodeObject');
    for (const tag of compiledTags) {
      const obj=child(tag,'object');
      if (!obj || (!obj.getAttribute('sixx.type') && !obj.getAttribute(refAttr)))
        throw new Error('Повреждена ссылка контакта Code Professional.');
    }
    const deps=includesFromSource;
    const unmatched=deps.filter(s=>!(hpp && s===headerName));
    if (hpp && !/^(?!\.)[A-Za-z_][A-Za-z0-9_.-]*\.hpp?$/i.test(headerName)) throw new Error('Недопустимое имя заголовочного файла.');
    return {xml,hpp,headerName: hpp?headerName:null,dependencies:[...new Set(unmatched)],
      warnings:[],
      filename:sanitizeName(name)};
  }
  function crc32(data) {
    let crc=0xFFFFFFFF;
    for(const v of data) {
      crc ^= v;
      for(let j=0;j<8;j++) crc=(crc>>>1) ^ ((crc&1)?0xEDB88320:0);
    }
    return (crc^0xFFFFFFFF)>>>0;
  }
  function zipFiles(files) {
    // Uncompressed ZIP keeps GitHub Pages independent of CDN/third-party libraries.
    const enc=new TextEncoder(), local=[], central=[];let offset=0;
    function le(v,n){const b=new Uint8Array(n);for(let j=0;j<n;j++)b[j]=(v>>>(8*j))&255;return b;}
    function concat(arr){const length=arr.reduce((s,x)=>s+x.length,0);const res=new Uint8Array(length);let o=0;for(const x of arr){res.set(x,o);o+=x.length;}return res;}
    for(const [file, content] of files){
      const fname=enc.encode(file), data=content instanceof Uint8Array?content:enc.encode(content),crc=crc32(data);
      const h=concat([le(0x04034b50,4),le(20,2),le(0x0800,2),le(0,2),le(0,2),le(0,2),le(crc,4),le(data.length,4),le(data.length,4),le(fname.length,2),le(0,2),fname]);
      local.push(h,data);
      central.push(concat([le(0x02014b50,4),le(20,2),le(20,2),le(0x0800,2),le(0,2),le(0,2),le(0,2),le(crc,4),le(data.length,4),le(data.length,4),le(fname.length,2),le(0,2),le(0,2),le(0,2),le(0,2),le(0,4),le(offset,4),fname]));
      offset+=h.length+data.length;
    }
    const dir=concat(central), end=concat([le(0x06054b50,4),le(0,2),le(0,2),le(files.length,2),le(files.length,2),le(dir.length,4),le(offset,4),le(0,2)]);
    return new Blob([...local,dir,end],{type:'application/zip'});
  }
  function utf16le(s) {
    const v=new Uint8Array(2+s.length*2); v[0]=255;v[1]=254;
    for(let i=0;i<s.length;i++){const n=s.charCodeAt(i);v[2+2*i]=n&255;v[3+2*i]=n>>>8;}return v;
  }
  root.ino2ubiProfessional={build,zipFiles,utf16le};
})(window);
