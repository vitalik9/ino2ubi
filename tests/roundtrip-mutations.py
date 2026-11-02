from playwright.sync_api import sync_playwright
from pathlib import Path
r=Path(__file__).resolve().parents[1]
files=['constants.js','parser.js','string-params.js','number-literals.js','ble-support.js','generator.js','professional.js','professional-template-data.js','conversion-safety.js','runtime-safety.js','compat.js','esp32.js','avr.js','diagnostics.js','remotexy.js','roundtrip.js']
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
 page=b.new_page()
 page.set_content('<html><body></body></html>')
 for f in files:page.add_script_tag(content=(r/f).read_text('utf-8'))
 result=page.evaluate('''() => {
    const code = `#include <Arduino.h>\nbool inReady = false; // in\nbool outReady = false; // out\nunsigned long HoldTimeMs = 60000UL; // par\nint twice(int a) { return a * 2; }\nvoid setup(){ outReady=false; }\nvoid loop(){ outReady=inReady; }`;
    const state=window.parseArduinoCode(code);
    const xml=window.createUbiXmlSixx('example','desc',state.variables,state.functions,state.global_includes,
      state.defines,state.extra_declarations,state.static_declarations,
      window.extractFunctionBody(code,'setup'),window.extractFunctionBody(code,'loop'),false,{targetBoard:'esp32'});
    const check=xml => window.ino2ubiRoundtrip.compareBasic(xml,code,state,false);
    const tamper=(mutator)=>{const doc=new DOMParser().parseFromString(xml,'application/xml');
      const nodes=[...doc.getElementsByTagName('sixx.object')];
      const named=(n,t)=>[...n.children].find(e=>e.getAttribute('sixx.name')===t);
      mutator({doc,nodes,named});return new XMLSerializer().serializeToString(doc);};
    const cases={};
    cases.original=check(xml).errors;
    cases.loopMissing=check(tamper(({nodes,named})=>{
      const node=nodes.find(x=>x.getAttribute('sixx.name')==='loopCodePart');
      const ref=named(node,'code').getAttribute('sixx.idref');
      nodes.find(x=>x.getAttribute('sixx.id')===ref).textContent='outReady=false;';
    })).errors;
    cases.parameterLost=check(tamper(({nodes})=>{
      const n=nodes.find(x=>x.getAttribute('sixx.name')==='numberDefaultValue' && x.textContent==='60000');n.textContent='0';
    })).errors;
    cases.functionMissing=check(tamper(({nodes})=>{
      const el=nodes.find(x=>x.getAttribute('sixx.type')==='CodeUserBlockFunction');el.remove();
    })).errors;
    cases.pinWrongType=check(tamper(({nodes,named})=>{
      const obj=nodes.find(x=>x.getAttribute('sixx.type')==='UniversalBlockInputOutput');
      named(obj,'type').setAttribute('sixx.type','StringDataType');
    })).errors;
    cases.includeMissing=check(tamper(({nodes})=>{
      const el=nodes.find(x=>x.getAttribute('sixx.type')==='CodeUserBlockDeclareDefineBlock');el.remove();
    })).errors;
    return cases;
  }''')
 for name,errors in result.items():
  print(name, len(errors), errors[:2])
  assert len(errors)==(0 if name=='original' else len(errors))
  if name!='original':assert errors, name
 b.close()
