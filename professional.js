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
  // FIX30: check declared numeric ranges before serializing editable FLProg fields.
  // ESP32 Arduino: integer/long/unsigned long are 32-bit, uint8_t/16_t/32_t are fixed width.
  const INTEGRAL_RANGES = Object.freeze({
    'byte': [0n, 255n], 'uint8_t': [0n, 255n],
    'int16_t': [-32768n, 32767n], 'uint16_t': [0n, 65535n],
    'int': [-2147483648n, 2147483647n],
    'long': [-2147483648n, 2147483647n],
    'int32_t': [-2147483648n, 2147483647n],
    'unsigned long': [0n, 4294967295n], 'uint32_t': [0n, 4294967295n]
  });
  function validateParameterDefault(name, info) {
    const type = String(info.type || '');
    const raw = String(info.default == null ? (type === 'String' ? '' : '0') : info.default).trim();
    if (type === 'bool' || type === 'boolean') {
      if (!/^(?:true|false|0|1)$/i.test(raw))
        throw new Error('Параметр ' + name + ': bool допускает только true, false, 0 или 1 (получено: ' + raw + ').');
      return /^(?:true|1)$/i.test(raw) ? 'true' : 'false';
    }
    if (type === 'float' || type === 'double') {
      const value = raw.replace(/[fF]$/, '');
      if (!value || !Number.isFinite(Number(value)) || !/^[+-]?(?:(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)$/.test(value))
        throw new Error('Параметр ' + name + ': ожидается конечное числовое значение, получено ' + raw + '.');
      return value;
    }
    if (type === 'String') return raw.replace(/^['"]|['"]$/g, '');
    if (type === 'char') return normalizeCppIntegerDefault(raw, name); // signedness of char is target-dependent
    const value = normalizeCppIntegerDefault(raw, name);
    const range = INTEGRAL_RANGES[type];
    if (range && (BigInt(value) < range[0] || BigInt(value) > range[1]))
      throw new Error('Параметр ' + name + ' (' + type + '): значение ' + raw + ' вне диапазона ' + range[0] + '..' + range[1] + '.');
    return value;
  }
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
  // A-11: transliterate Cyrillic so a block named «Мой датчик» is not exported as «__________.ubi».
  const CYR = {'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'ts','ч':'ch','ш':'sh','щ':'sch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya'};
  function translit(text) {
    return String(text).replace(/[А-Яа-яЁё]/g, ch => {
      const low = CYR[ch.toLowerCase()] || '';
      return ch === ch.toLowerCase() ? low : low.charAt(0).toUpperCase() + low.slice(1);
    });
  }
  function sanitizeName(name) {
    return translit(String(name || 'Custom_Block')).replace(/[^A-Za-z0-9_\-]/g, '_').slice(0,90) || 'Custom_Block';
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
    const userIO = new Map(), userParams = new Map(), userVars = new Set(), userFunctions = new Set();
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
      const value = validateParameterDefault(name, info);
      const isBoolean=info.type==='bool' || info.type==='boolean';
      const numberType=info.type==='String'?'String':info.type==='float'||info.type==='double'?'Float':'SmallInteger';
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
      const symbols=Array.from(new Set([...userIO.keys(),...userParams.keys(),...userVars,...userFunctions]));
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
        // Helper functions, like instance-local state, must be unique in each
        // FLProg block instance. The native UUID tag is expanded by FLProg.
        // Only rewrite actual function names (definition/call), never a field
        // named identically in an object, a namespace member, or a string.
        const prev=masked.slice(0,match.index).trimEnd();
        // A helper identifier can denote either a direct call (helper(x)) or
        // a function value (runCallback(x, helper), &helper, assignment).
        // In all these cases it must refer to the CURRENT FLProg instance.
        // Do not rewrite object members or namespace-qualified names.
        const memberAccess=/(?:\.|->|::)$/.test(prev);
        const instanceFunction=userFunctions.has(key) && !memberAccess;
        const instanceVariable=userVars.has(key) && !memberAccess;
        if (memberAccess) {
          items.appendChild(plain(key));
        } else if (instanceFunction || instanceVariable) {
          items.appendChild(plain(key+'_'));
          items.appendChild(uuidTag(currentInstance));
        } else if (userIO.has(key) || userParams.has(key)) {
          items.appendChild(newTag(userIO.get(key)||userParams.get(key),userIO.has(key)));
        } else {
          items.appendChild(plain(key));
        }
        cursor=match.index+key.length;
      }
      items.appendChild(plain(source.slice(cursor)));
    }
    function codePart(instance, sectionName, position, codeName, source) {
      if (!String(source || '').trim()) return;
      // FIX29: FLProg concatenates code fragments from adjacent instances
      // verbatim. A terminal newline prevents `}NextStatement` and, more
      // importantly, prevents a trailing // comment from swallowing the
      // first statement of the next instance. No C++ expression is rewritten.
      source=String(source).replace(/\s+$/, '')+'\n';
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
    return {doc,object,core,ard,required,child,refId,add,inputOutput,parameter,codePart,updateDescription,addVar:n=>userVars.add(n),addFunction:n=>userFunctions.add(n)};
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
    // FIX14: FLProg parameter tags can expand to string literals, not String objects.
    const stringParams=window.ino2ubiStringParams.collect(state.variables, state.defines);
    const numericParams=window.ino2ubiStringParams.collectNumeric(state.variables, state.defines);
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
    const defines=(state.defines||[]).map(d=>d.role==='parameter'?{name:d.name,role:'parameter',type:d.type||'String',default:d.value,alias:d.alias||d.name}:d);
    // FIX30: a #define and a declared C++ variable with the same identifier
    // cannot silently be interpreted as two different FLProg sources.
    // Reject collisions before writing any .ubi XML.
    const defineNames = new Set();
    for (const d of defines) {
      if (!safeIdentifier(d.name || '')) throw new Error('Недопустимое имя #define: ' + String(d.name));
      if (defineNames.has(d.name)) throw new Error('Повторное объявление #define: ' + d.name);
      defineNames.add(d.name);
      if (Object.prototype.hasOwnProperty.call(variables, d.name))
        throw new Error('Конфликт имени ' + d.name + ': одновременно переменная и #define. Устраните конфликт в исходном Arduino-коде.');
    }
    for (const p of defines) if (p.role==='parameter') b.parameter(inst,p.name,p);
    // Keep ordinary helper functions inside UBI: a separate header is NOT required.
    const helpers=helperDefinitions(state);
    // Register all helper names before emitting any section so calls in setup,
    // loop and other helpers use the same per-instance FLProg UUID.
    // C++ overloads share the same suffixed name, retaining overload resolution.
    for (const [key, fn] of helpers) {
      const helperName=fn.name||key;
      if (!safeIdentifier(helperName))
        throw new Error('Недопустимое имя вспомогательной функции: '+helperName);
      if (variables[helperName] || defines.some(d=>d.name===helperName))
        throw new Error('Имя функции конфликтует с переменной или параметром: '+helperName);
      b.addFunction(helperName);
    }
    // FIX39: constructor-initialized library objects are parsed as
    // extra_declarations, not scalar state.variables. They must nevertheless
    // receive FLProg's per-instance UUID in BOTH their declaration and uses.
    // Only accept a straightforward global `Type name(args);` declaration;
    // never guess inside templates, function prototypes, or arbitrary C++.
    // A-02: returns ALL object names of one declaration. Supported shapes:
    //   Type a(args);   Type a{args};   Type a = expr;   Type a;
    //   and comma lists of those (Type a(1), b(2);). Pointers, references,
    //   arrays and anything else yield [] (such shapes are blocked by
    //   compat.js diagnostics instead of being exported without UUID).
    function constructorObjectNames(declaration) {
      const line=String(declaration||'').trim();
      const match=line.match(/^([A-Za-z_]\w*(?:::[A-Za-z_]\w*)*)\s+([^;]+);$/);
      if (!match) return [];
      const type=match[1];
      // String is a C++ class with real constructors, although it is also a
      // supported FLProg scalar type; keep it. Other primitives are excluded.
      if ((RECOGNIZED.has(type) && type !== 'String') ||
          /^(?:void|auto|size_t|const|unsigned|signed|static|extern|typedef|using|struct|class|enum|union|template|return|volatile)$/.test(type)) return [];
      const parts=typeof splitTopLevel==='function'?splitTopLevel(match[2],','):[match[2]];
      const names=[];
      for (const part of parts) {
        const pm=part.trim().match(/^([A-Za-z_]\w*)\s*(?:(\(([\s\S]*)\))|(\{[\s\S]*\})|(=[\s\S]*))?$/);
        if (!pm) return [];
        // `Type foo();` is a function prototype, not an object.
        if (pm[2] && !String(pm[3]).trim()) return [];
        names.push(pm[1]);
      }
      // A prototype of a helper function must never be tagged as an object.
      if (names.length===1 && helpers.some(([key,f])=>(f.name||key)===names[0])) return [];
      return names;
    }
    const constructorObjects=new Set();
    for (const decl of state.extra_declarations||[]) {
      const raw=typeof decl==='string'?decl:(decl.code||decl.text||'');
      for (const objectName of constructorObjectNames(raw)) {
        if (constructorObjects.has(objectName) || variables[objectName] ||
            defines.some(d=>d.name===objectName) ||
            helpers.some(([key,f])=>(f.name||key)===objectName))
          throw new Error('Дублирование имени объекта библиотеки: '+objectName);
        constructorObjects.add(objectName);
        b.addVar(objectName);
      }
    }
    const includesFromSource=externalIncludes(state).map(s=>s.match(/"([^"]+)"/)[1]);
    const providedName=String(options.additionalHeaderFilename||'').trim();
    const headerName=providedName && /^(?!\.)[\w.-]+\.hpp?$/i.test(providedName) ? providedName : sanitizeName(name)+'.hpp';
    const provided=String(options.additionalHeader||'').trim();
    const hpp=provided ? provided+'\n' : '';
    const ownHpp=Boolean(hpp);
    // Never manufacture headers just because a helper function exists.
    const internal=helpers;
    const includes=(state.global_includes||[]).join('\n');
    const defineLines=(state.defines||[]).filter(d=>d.role!=='parameter').map(d=>d.raw || ('#define '+d.name+' '+(d.value||''))).join('\n');
    // FIX18: Defensive guard for a FLProg 9.8.0 Professional crash at
    // Arduino.DeclaringElement>>declaringTypeString.  The crash occurred while
    // processing an imported MQTT block with constructor-initialized global
    // library objects.  Without an exported failing UBI we cannot identify
    // which SIXX field is invalid; refuse this unverified declaration shape
    // rather than knowingly creating a block that can crash FLProg.
    const unsafeCtorObjects=Object.entries(variables).filter(([n,v])=>
      v && v.role==='variable' &&
      /^[A-Za-z_]\w*(?:::[A-Za-z_]\w*)*$/.test(String(v.type||'')) &&
      !RECOGNIZED.has(v.type) &&
      /^\s*\(.*\)\s*$/.test(String(v.default||''))
    );
    if (unsafeCtorObjects.length) {
      const names=unsafeCtorObjects.map(([n,v])=>v.type+' '+n).join(', ');
      throw new Error('Code Professional: неподтверждённые объявления объектов с конструктором ('+names+'). FLProg 9.8.0 может аварийно завершиться (#declaringString). Экспорт остановлен для защиты проекта. Требуется проверенный образец Professional .ubi с такими объектами.');
    }
    // FIX19 (diagnostic): a PubSubClient transport is bound in setup(), not in a
    // global constructor initializer. This preserves the PubSubClient API and
    // avoids passing a cross-object constructor call through FLProg's declare
    // section. This is NOT a generalized transformation for unknown C++ types.
    const pubsubClientBindings=[];
    // FIX19 avoids silently skipping constructor-like extra declarations.
    // Known PubSubClient(Client&) is rewritten below. Other custom ctor types
    // remain unchanged because a generic fallback can silently alter behavior.
    const extraLines=(state.extra_declarations||[]).map(x=>{
      const line=typeof x==='string'?x:(x.code||x.text||'');
      const proto=line.trim().match(/^[\w\s:*&<>]+?\s+([A-Za-z_]\w*)\s*\([^;{}]*\)\s*;$/);
      if (proto && helpers.some(([key,f])=>(f.name||key)===proto[1])) return '';
      const ctor=line.trim().match(/^PubSubClient\s+([A-Za-z_]\w*)\s*\(\s*([A-Za-z_]\w*)\s*\)\s*;$/);
      if (!ctor) return line;
      pubsubClientBindings.push(ctor[1]+'.setClient('+ctor[2]+');');
      return 'PubSubClient '+ctor[1]+';';
    });
    const staticLines=(state.static_declarations||[]).map(x=>typeof x==='string'?x:(x.code||x.text||''));
    const variableEntries=Object.entries(variables).filter(([,v])=>v.role==='variable');
    const variableLines=new Map(variableEntries.map(([n,v])=>[n,(v.qualifiers ? v.qualifiers+' ' : '')+v.type+' '+n+(v.default!=null?' = '+v.default:'')+';']));
    // H3: Keep the original relative order of constructor objects, static declarations
    // and instance variables. FLProg concatenates all instances into one C++ TU;
    // changing the order can break constructor arguments and global initialization.
    // Metadata is derived by the parser from source positions, not from JS object iteration.
    function orderedGlobalDeclarations() {
      const order=state.declaration_order;
      if (!Array.isArray(order) || !order.length) {
        // Legacy projects without source-order metadata are deliberately rejected
        // when they mix constructor declarations and variables: guessing order is unsafe.
        if (extraLines.some(Boolean) && variableLines.size)
          throw new Error('H3: старый проект не содержит порядок глобальных объявлений. Повторите «Парсить код» перед экспортом.');
        return [...extraLines,...staticLines,...variableLines.values()].filter(Boolean).join('\n');
      }
      const placedVariables=new Set(), placedExtra=new Set(), placedStatic=new Set();
      const lines=[];
      for (const entry of [...order].sort((a,b)=>a.position-b.position)) {
        if (entry.kind==='variable' && variableLines.has(entry.name)) {
          if (placedVariables.has(entry.name)) throw new Error('H3: повторное глобальное объявление '+entry.name);
          lines.push(variableLines.get(entry.name)); placedVariables.add(entry.name);
        } else if (entry.kind==='extra' && extraLines[entry.index] !== undefined) {
          if (placedExtra.has(entry.index)) throw new Error('H3: повторный элемент extra '+entry.index);
          lines.push(extraLines[entry.index]); placedExtra.add(entry.index);
        } else if (entry.kind==='static' && staticLines[entry.index] !== undefined) {
          if (placedStatic.has(entry.index)) throw new Error('H3: повторный элемент static '+entry.index);
          lines.push(staticLines[entry.index]); placedStatic.add(entry.index);
        }
      }
      // Any newly-added variable has no source position. Appending it is safe
      // only when no other initializers depend on the new declaration.
      for (const [name,line] of variableLines) if (!placedVariables.has(name)) {
        if (extraLines.some(x=>x && new RegExp('\\b'+name+'\\b').test(x)))
          throw new Error('H3: объект зависит от добавленной переменной '+name+' без позиции в исходнике. Перепарсите скетч.');
        lines.push(line);
      }
      for (let i=0;i<extraLines.length;i++) if (!placedExtra.has(i))
        throw new Error('H3: отсутствует позиция исходного объявления extra #'+i+'. Перепарсите скетч.');
      for (let i=0;i<staticLines.length;i++) if (!placedStatic.has(i))
        throw new Error('H3: отсутствует позиция исходного объявления static #'+i+'. Перепарсите скетч.');
      return lines.filter(Boolean).join('\n');
    }
    const globalDecl=orderedGlobalDeclarations();
    const headerInc=ownHpp && !includesFromSource.includes(headerName)?'#include "'+headerName+'"\n':'';
    // FIX20 (diagnostic): emit helper functions in the SAME declare code-part.
    // FLProg 9.8.0 crashes at Arduino.DeclaringElement>>declaringTypeString
    // with one extra function-section code part in the MQTT Professional UBI.
    // Removing the separate function-section part tests this hypothesis while
    // retaining full helper bodies and all generated parameter/variable tags.
    // A-01: Arduino IDE generates prototypes automatically; the generated
    // declare section does not. Emit a prototype for every helper before any
    // definition so forward and mutual references compile. Default arguments
    // are kept only in the prototype (C++ forbids repeating them).
    function splitDefaults(paramsText) {
      const text=String(paramsText||'');
      if (typeof splitTopLevel!=='function' || typeof findParameterDefault!=='function') return {proto:text,def:text};
      const protoParts=[], defParts=[];
      for (const part of splitTopLevel(text,',')) {
        const pos=findParameterDefault(part);
        protoParts.push(part.trim());
        defParts.push(pos===-1?part.trim():part.slice(0,pos).trim());
      }
      return {proto:protoParts.join(', '),def:defParts.join(', ')};
    }
    const helperSignatures=internal.map(([fn,f])=>{
      const p=splitDefaults(f.parameters||f.params||'');
      const head=(f.return_type||f.returnType||'void')+' '+(f.name||fn);
      return {fn,f,prototype:head+'('+p.proto+');',definition:head+'('+p.def+')'};
    });
    const helperPrototypes=helperSignatures.map(s=>s.prototype).join('\n');
    const helperBodies=helperSignatures.map(({fn,f,definition})=>{
      const excluded=(f.parsed_params||[]).map(p=>p.name);
      const body=window.ino2ubiStringParams.transform(f.body||'',stringParams,excluded,numericParams);
      return definition+' {\n'+body+'\n}';
    }).join('\n\n');
    const helperText=[helperPrototypes,helperBodies].filter(Boolean).join('\n\n');
    b.codePart(inst,'declare','stop','Библиотеки, объявления и функции',
      [includes,headerInc,defineLines,globalDecl,helperText].filter(Boolean).join('\n\n'));
    const setup=[...pubsubClientBindings,
      window.ino2ubiStringParams.transform(options.setupCode||'',stringParams,[],numericParams)
    ].filter(Boolean).join('\n');
    let loop=window.ino2ubiStringParams.transform(options.loopCode||'',stringParams,[],numericParams);
    if (options.enableInput) loop='if (En) {\n'+loop+'\n}';
    b.codePart(inst,'setup','stop','Инициализация','{\n'+setup+'\n}');
    b.codePart(inst,'loop','stop','Основной цикл','{\n'+loop+'\n}');
    // FLProg uses *logical* SmallInteger IDs to identify library blocks and their
    // nested components. The SIXX object ids/idrefs above are serialization-local
    // and must remain untouched. Template logical IDs must NOT be exported verbatim.
    // Regenerate all logical IDs once, after construction, and update the editor's
    // expandElements references to keep the internal graph consistent.
    const logicalNodes=Array.from(b.doc.getElementsByTagName('sixx.object')).filter(el=>
      el.getAttribute(nameAttr)==='id' && el.getAttribute('sixx.type')==='SmallInteger');
    const used=new Set();
    const map=new Map();
    function freshLogicalId() {
      // A-12: cryptographically random where available (Math.random is only a fallback).
      // The numeric range is unchanged: FLProg stores these as SmallInteger logical IDs.
      let id;
      do {
        let r;
        if (root.crypto && root.crypto.getRandomValues) r=root.crypto.getRandomValues(new Uint32Array(1))[0]%150000000;
        else r=Math.floor(Math.random()*150000000);
        id=String(100000000+r);
      } while (used.has(id));
      used.add(id);
      return id;
    }
    for (const el of logicalNodes) {
      const oldId=el.textContent.trim();
      if (!/^\d+$/.test(oldId)) throw new Error('Некорректный внутренний ID Professional-блока.');
      const newId=freshLogicalId();
      if (map.has(oldId)) throw new Error('В образце повторяется внутренний ID: '+oldId);
      map.set(oldId,newId);
      el.textContent=newId;
    }
    for (const el of b.doc.getElementsByTagName('sixx.object')) {
      if (el.getAttribute('sixx.type')!=='UserCodeMiltiBlockEditorPositiomStore') continue;
      const expanded=child(el,'expandElements');
      if (!expanded) continue;
      for (const ref of expanded.children) {
        const replacement=map.get(ref.textContent.trim());
        if (replacement) ref.textContent=replacement;
      }
    }
    // FIX18: check every serialized type reference has an actual definition.
    const allNodes=Array.from(b.doc.getElementsByTagName('sixx.object'));
    const allIds=new Set(allNodes.map(x=>x.getAttribute(idAttr)).filter(Boolean));
    const unresolved=allNodes.filter(x=>x.getAttribute(refAttr) && !allIds.has(x.getAttribute(refAttr)));
    if (unresolved.length) throw new Error('Code Professional: отсутствует SIXX-объект для ссылки '+unresolved[0].getAttribute(refAttr));
    const typedNodes=allNodes.filter(x=>x.getAttribute('sixx.type')==='UserCodeMultiBlockInputOutput' || x.getAttribute('sixx.type')==='UserCodeMultiBlockStandartParametr');
    for (const el of typedNodes) {
      const dt=child(el,'type');
      if (!dt || (!dt.getAttribute('sixx.type') && !dt.getAttribute(refAttr)))
        throw new Error('Code Professional: у контакта или параметра отсутствует ссылка на тип данных.');
    }
    const xml=new XMLSerializer().serializeToString(b.doc);
    const checked=new DOMParser().parseFromString(xml,'application/xml');
    ensureXml(checked);
    auditProfessionalStructure(checked);
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
    // FIX32: detect source-header dependencies using the supplied archive's
    // filename inventory; never rewrite or silently remove source #include lines.
    const libraryAudit = window.ino2ubiLibraryAudit
      ? window.ino2ubiLibraryAudit.analyze(state.global_includes || [])
      : {includes:[],groups:{flprog:[],rt_hw:[],other:[]},warnings:[]};
    const libraryGroups = libraryAudit.groups;
    const dependencyWarnings = libraryAudit.warnings;
    if (hpp && !/^(?!\.)[A-Za-z_][A-Za-z0-9_.-]*\.hpp?$/i.test(headerName)) throw new Error('Недопустимое имя заголовочного файла.');
    return {xml,hpp,headerName: hpp?headerName:null,dependencies:[...new Set(unmatched)],
      libraryGroups, libraryAudit:libraryAudit.includes, warnings:dependencyWarnings,
      filename:sanitizeName(name)};
  }
  // Structural audit based on actual Code Professional candidate UBI exports.
  // It validates the SIXX object graph without rewriting the working FIX24 code sections.
  function auditProfessionalStructure(doc) {
    ensureXml(doc);
    const root=doc.documentElement;
    const main=required(root,'mainBlock');
    const instances=required(required(main,'blockInstancesLibrary'),'items');
    const blocks=children(instances,'UserCodeMultiBlockBlockInstance');
    if (blocks.length!==1) throw new Error('Code Professional: ожидается ровно один экземпляр блока.');
    const inst=blocks[0];
    const nodes=Array.from(doc.getElementsByTagName('sixx.object'));
    const ids=new Map();
    for (const node of nodes) {
      const id=node.getAttribute(idAttr);
      if (id!==null) {
        if (ids.has(id)) throw new Error('Code Professional: повторяется sixx.id '+id);
        ids.set(id,node);
      }
    }
    for (const node of nodes) {
      const ref=node.getAttribute(refAttr);
      if (ref!==null && !ids.has(ref))
        throw new Error('Code Professional: отсутствует объект sixx.idref '+ref);
    }
    const ioList=[];
    for (const libName of ['inputsLibrary','outputsLibrary']) {
      const items=required(required(inst,libName),'items');
      for (const entry of Array.from(items.children)) {
        const node=entry.getAttribute(refAttr)?ids.get(entry.getAttribute(refAttr)):entry;
        if (node.getAttribute('sixx.type')!=='UserCodeMultiBlockInputOutput')
          throw new Error('Code Professional: недопустимый объект в '+libName);
        ioList.push(node);
      }
    }
    for (const node of ioList) {
      const type=child(node,'type');
      if (!type || (!type.getAttribute('sixx.type') && !type.getAttribute(refAttr)))
        throw new Error('Code Professional: отсутствует тип контакта.');
    }
    let parts=0;
    const codeData=required(inst,'codeData');
    for (const sectionName of ['declare','setup','loop','function']) {
      const section=required(codeData,sectionName+'Section');
      const positions=sectionName==='function'?['code']:['start','stop',...(sectionName==='loop'?['insept']:[])];
      for (const pos of positions) {
        const holder=child(section,pos+'Part');
        if (!holder) {
          if (pos==='insept') continue; // not every FLProg template uses the insertion slot
          throw new Error('Code Professional: отсутствует '+sectionName+'.'+pos+'Part');
        }
        const items=required(holder,'items');
        for (const part of children(items,'UserCodeMultiBlockCodePartsInstance')) {
          parts++;
          const sectionValue=required(part,'section').textContent;
          const positionValue=required(part,'position').textContent;
          if (sectionValue!==sectionName || positionValue!==(pos==='code'?'stop':pos))
            throw new Error('Code Professional: несоответствие метаданных секции '+sectionName+'.'+pos);
          const codeText=required(part,'codeText');
          if (codeText.getAttribute('sixx.type')!=='OrderedCollection')
            throw new Error('Code Professional: повреждён codeText.');
          for (const edit of Array.from(codeText.children)) {
            if (edit.getAttribute('sixx.type')!=='UserCodeMultiBlockEditorCodeObject')
              throw new Error('Code Professional: недопустимый объект кода.');
            const kind=required(edit,'type').textContent;
            if (kind!=='plainText' && kind!=='codeTag')
              throw new Error('Code Professional: неизвестный тип объекта кода '+kind);
            const val=required(edit,'value');
            if (kind==='plainText' && val.getAttribute('sixx.type')!=='String')
              throw new Error('Code Professional: повреждён текст программы.');
            if (kind==='codeTag' && !val.getAttribute('sixx.type') && !val.getAttribute(refAttr))
              throw new Error('Code Professional: повреждён тег программы.');
          }
        }
      }
    }
    if (!parts) throw new Error('Code Professional: отсутствуют секции C++ кода.');
    return {parts,contacts:ioList.length,objects:ids.size};
  }
  function utf16le(s) {
    const v=new Uint8Array(2+s.length*2); v[0]=255;v[1]=254;
    for(let i=0;i<s.length;i++){const n=s.charCodeAt(i);v[2+2*i]=n&255;v[3+2*i]=n>>>8;}return v;
  }
  root.ino2ubiProfessional={build,utf16le}; // A-13: unused crc32/zipFiles removed
})(window);
