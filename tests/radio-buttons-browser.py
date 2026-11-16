from pathlib import Path
import re,xml.etree.ElementTree as ET
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
code=(root/'examples/ModeSelectorDemo.ino').read_text()
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
 page=b.new_page(accept_downloads=True)
 errors=[]
 page.on('pageerror',lambda e: errors.append(str(e)))
 html=(root/'index.html').read_text()
 html=html[:re.search(r'<script\b',html).start()]+'</body></html>'
 page.set_content(html)
 for src in ['constants.js','parser.js','string-params.js','flprog-header-catalog.js','library-audit.js','flprog-api-audit.js','professional.js','professional-template-data.js','compat.js','esp32.js','diagnostics.js','app.js']:
  page.add_script_tag(content=(root/src).read_text())
 page.fill('#codeInput',code)
 page.click('#btnParse')
 print('parse',page.locator('#status').inner_text()[:280])
 with page.expect_download(timeout=20000) as dl:
  page.click('#btnGenerate')
 path=Path(dl.value.path());data=path.read_bytes(); out=Path(dl.value.path())
 tree=ET.fromstring(data.decode('utf-16'))
 types=[n.get('sixx.type') for n in tree.iter()]
 assert 'UserCodeMultiBlockRadioButtonParametrSpecies' in types
 assert 'UserCodeMultiBlockComboBoxParametrSpecies' not in types
 for species in tree.iter():
  if species.get('sixx.type')=='UserCodeMultiBlockRadioButtonParametrSpecies':
   children={n.get('sixx.name'):n for n in species}
   if 'choices' not in children or len(children['choices']) !=3: continue
   assert len(children['booleanChoices'])==2
   defaults=[]
   for ch in children['choices']:
    names={c.get('sixx.name'):c for c in ch}
    defaults.append(names['isDefault'].get('sixx.type'))
   assert defaults==['False','True','False'],defaults
   break
 else: raise AssertionError('radio options not found')
 print('Radio export',out,len(data),'bytes; js errors',errors)
 assert not errors
 b.close()
