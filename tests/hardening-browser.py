import re, subprocess
from pathlib import Path
from xml.etree import ElementTree as ET
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
html=(root/'index.html').read_text()
scripts=re.findall(r'<script\s+src="([^"?]+)',html)
html=re.sub(r'<script\s+src="[^"]+"\s*>\s*</script>','',html)

def child(n,name):
 return next((e for e in n if e.get('sixx.name')==name),None)
def render(xml):
 tree=ET.fromstring(xml)
 sections={}
 for part in tree.iter('sixx.object'):
  if part.get('sixx.type')!='UserCodeMultiBlockCodePartsInstance':continue
  name=child(part,'codeName')
  if name is None:continue
  code=child(part,'codeText');output=''
  for part2 in code:
   typ=child(part2,'type'); val=child(part2,'value')
   if typ is None or val is None:continue
   if typ.text=='plainText': output+=val.text or ''
   elif typ.text=='codeTag':
    if val.get('sixx.type','').endswith('UUIDTag'):output+='_UID'
    else:output+='TAG'
  sections[name.text]=output
 return sections

checks=[]
def check(ok,label):
 checks.append((bool(ok),label));print('PASS' if ok else 'FAIL',label)

with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 page=b.new_page();page.set_content(html)
 for f in scripts:page.add_script_tag(content=(root/f).read_text())
 sketches=[
 ('global-static','static int counter = 0;\nvoid setup() {}\nvoid loop(){counter++;}',True),
 ('static-array','static int buffer[3]={0};\nvoid setup() {}\nvoid loop(){buffer[0]++;}',True),
 ('local-static','void setup() {}\nvoid loop(){static uint32_t last=0; last++;}',True),
 ('class-block','class Foo { public: int x; };\nvoid setup() {}\nvoid loop(){}',False),
 ('static-object','static String name="abc";\nvoid setup() {}\nvoid loop(){}',False)
 ]
 for title,source,accept in sketches:
  result=page.evaluate('''(source) => { const parsed=parseArduinoCode(source); const checks=ino2ubiCompat.validateConverterInput(source,parsed,false,true); if(checks.errors.length)return {errors:checks.errors}; try {const r=ino2ubiProfessional.build({template:ino2ubiProfessionalTemplate,name:'Test',description:'',state:parsed,source,enableInput:false,allowMultipleInstances:true,setupCode:extractFunctionBody(source,'setup'),loopCode:extractFunctionBody(source,'loop'),additionalHeader:'',additionalHeaderFilename:''});return {xml:r.xml};}catch(e){return {errors:[String(e)]};} }''',source)
  check(('xml' in result)==accept,title+' export '+str(result.get('errors',''))[:140])
  if 'xml' not in result: continue
  sections=render(result['xml']);
  decl=next((v for k,v in sections.items() if 'объявления' in k), '')
  loop=next((v for k,v in sections.items() if 'Основной' in k), '')
  name={'global-static':'counter','static-array':'buffer','local-static':'last'}[title]
  check((name+'__UID') in (decl+loop), title+' UUID on '+name)
  code='''#include <cstdint>\nvoid setup(){}\nvoid loop(){\n'''
  a=decl.replace('_UID','_A');bb=decl.replace('_UID','_B');la=loop.replace('_UID','_A');lb=loop.replace('_UID','_B')
  code='#include <cstdint>\n'+a+'\n'+bb+'\nvoid setup(){}\nvoid loop(){\n'+la+'\n'+lb+'\n}\n'
  res=subprocess.run(['g++','-std=c++17','-x','c++','-fsyntax-only','-'],input=code,text=True,capture_output=True)
  check(res.returncode==0,title+' two instances g++ '+res.stderr[:150])

 for resource,body in [('GPIO ISR','attachInterrupt(digitalPinToInterrupt(4), isr, CHANGE);'),('FreeRTOS','xTaskCreate(task, "task", 1024, nullptr, 1, nullptr);'),('ESP timer','esp_timer_create(&args, &handle);')]:
  source='void setup() { '+body+' }\nvoid loop() {}'
  report=page.evaluate('''(source) => ino2ubiCompat.validateConverterInput(source,parseArduinoCode(source),false,true)''',source)
  check(any('MULTI-RESOURCE' in w for w in report['warnings']),resource+' multi-instance warning')
 # A static class object remains permitted in single-instance mode (multi-only diagnostic).
 src='static String name="abc";\nvoid setup() {}\nvoid loop() {}'
 single=page.evaluate('''(source) => { const parsed=parseArduinoCode(source); const checks=ino2ubiCompat.validateConverterInput(source,parsed,false,false); if(checks.errors.length)return checks.errors; try {ino2ubiProfessional.build({template:ino2ubiProfessionalTemplate,name:'Test',description:'',state:parsed,source,enableInput:false,allowMultipleInstances:false,setupCode:extractFunctionBody(source,'setup'),loopCode:extractFunctionBody(source,'loop'),additionalHeader:'',additionalHeaderFilename:''});return [];}catch(e){return [String(e)]}}''',src)
 check(not single,'single-instance static String compatibility: '+str(single))
 b.close()
print('TOTAL',sum(ok for ok,_ in checks),'/',len(checks))
if not all(ok for ok,_ in checks):raise SystemExit(1)
