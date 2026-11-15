"""UI and exported SIXX regression for FLProg multiple-instance checkbox."""
from pathlib import Path
import json
import xml.etree.ElementTree as ET
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
code='''#include <Arduino.h>
int counter = 0; // variable
bool outputValue = false; // out
void increment() { counter++; }
void setup() { counter = 0; }
void loop() { increment(); outputValue = (counter > 10); }
'''
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page(accept_downloads=True)
    html=(root/'index.html').read_text()
    html=html[:html.index('  <script src="constants.js"')]+'</body></html>'
    page.set_content(html)
    for src in ['constants.js','parser.js','string-params.js','flprog-header-catalog.js','library-audit.js','flprog-api-audit.js','professional.js','professional-template-data.js','compat.js','esp32.js','diagnostics.js','app.js']:
        page.add_script_tag(content=(root/src).read_text())
    page.fill('#codeInput',code)
    page.click('#btnParse')
    print('PARSE', page.locator('#status').inner_text())
    for enabled in [True,False]:
        page.locator('#allowMultipleInstances').set_checked(enabled)
        with page.expect_download(timeout=20000) as download:
            page.click('#btnGenerate')
        xml=Path(download.value.path()).read_bytes().decode('utf-16')
        tree=ET.fromstring(xml)
        flags=[node.attrib.get('sixx.type') for node in tree.iter() if node.attrib.get('sixx.name')=='isUseItOnce']
        assert flags==(['False'] if enabled else ['True']),flags
        assert 'increment_' in xml and 'counter_' in xml
        print('EXPORT',enabled,'flags',flags,'uuid',xml.count('UserCodeMultiBlockUseInCodeUUIDTag'))
    with page.expect_download() as download:
        page.click('#btnSaveProject')
    saved=json.loads(Path(download.value.path()).read_text())
    assert saved['settings']['allowMultipleInstances'] is False
    page.locator('#allowMultipleInstances').set_checked(True)
    page.locator('#fileIno').set_input_files({'name':'sample.i2u.json','mimeType':'application/json','buffer':json.dumps(saved).encode()})
    page.wait_for_function("document.getElementById('allowMultipleInstances').checked === false")
    assert not page.locator('#allowMultipleInstances').is_checked()
    print('PROJECT RESTORE',page.locator('#allowMultipleInstances').is_checked())
    # A static global is rejected for reusable blocks, but can be considered
    # when FLProg limits the block to one occurrence.
    static_code='static int counter = 0;\nvoid setup() {}\nvoid loop() { counter++; }'
    mode_issues=page.evaluate("""(src) => {
      const parsed=window.parseArduinoCode(src);
      return [true,false].map(mode=>window.ino2ubiCompat.validateConverterInput(src,parsed,false,mode).errors);
    }""",static_code)
    assert any('static' in msg for msg in mode_issues[0]),mode_issues
    assert not any('независимость экземпляров' in msg for msg in mode_issues[1]),mode_issues
    print('MODE-DEPENDENT VALIDATION',mode_issues)

    browser.close()
