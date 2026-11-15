"""FLProg 9.8.6: local curTm must be UUID-tagged in both instances."""
import re
import subprocess
from pathlib import Path
import xml.etree.ElementTree as ET
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
code='''/* Название блока: LocalUidRegression */
#include <Arduino.h>
bool inPulse = false; // in
bool outPulse = false; // out
uint32_t eventTime[32] = {0};
void setup() { uint32_t startedAt = millis(); outPulse = false; }
void loop() {
  uint32_t curTm = millis();
  if (inPulse) eventTime[0] = curTm;
  outPulse = (curTm - eventTime[0]) > 100;
}
'''
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page(accept_downloads=True)
    html=(root/'index.html').read_text()
    html=html[:re.search(r'<script\b',html).start()]+'</body></html>'
    page.set_content(html)
    for script in ['constants.js','parser.js','string-params.js','flprog-header-catalog.js','library-audit.js','flprog-api-audit.js','professional.js','professional-template-data.js','compat.js','esp32.js','diagnostics.js','app.js']:
        page.add_script_tag(content=(root/script).read_text(encoding='utf-8'))
    page.fill('#codeInput',code)
    page.click('#btnParse')
    status=page.locator('#status').inner_text()
    print('PARSE:',status)
    page.locator('#allowMultipleInstances').set_checked(True)
    with page.expect_download(timeout=15000) as d:
        page.click('#btnGenerate')
    xml=Path(d.value.path()).read_bytes().decode('utf-16')
    rootxml=ET.fromstring(xml)
    # Code is stored in alternating XML plain-text fragments and UUID code tags.
    all_plain='\n'.join((e.text or '') for e in rootxml.iter() if e.attrib.get('sixx.type')=='String')
    assert 'curTm_' in all_plain, 'curTm declaration/calls lack per-instance suffix'
    def parts(node):
        output=[]
        for piece in node:
            t=next((c.text for c in piece if c.attrib.get('sixx.name')=='type'),None)
            val=next((c for c in piece if c.attrib.get('sixx.name')=='value'),None)
            if t=='plainText': output.append(val.text or '')
            elif t=='codeTag':
                if val is not None and val.attrib.get('sixx.type')=='UserCodeMultiBlockUseInCodeUUIDTag':output.append('<UID>')
                else: output.append('<CONTACT>')
        return ''.join(output)
    codeparts=[parts(n) for n in rootxml.iter() if n.attrib.get('sixx.name')=='codeText']
    loop=next(c for c in codeparts if 'curTm_' in c)
    setup=next(c for c in codeparts if 'startedAt_' in c)
    assert loop.count('curTm_<UID>')==3, repr(loop)
    assert 'uint32_t curTm_<UID> = millis();' in loop, repr(loop)
    assert 'startedAt_<UID>' in setup, repr(setup)
    assert 'startedAt_' in all_plain, 'Setup local lacks per-instance suffix'
    assert 'eventTime_' in all_plain, 'global array lost suffix'
    assert 'uint32_t curTm = millis()' not in all_plain, 'unscoped local declaration remains'
    assert xml.count('UserCodeMultiBlockUseInCodeUUIDTag')>=3, 'missing native UUID tags'
    # Simulate FLProg flattening adjacent blocks into a shared loop scope.
    def flatten(fragment, uid):
        fragment=fragment.strip()
        assert fragment.startswith('{') and fragment.endswith('}')
        return fragment[1:-1].replace('<UID>', uid).replace('<CONTACT>', 'inPulse')
    body=flatten(loop,'_1') + '\n' + flatten(loop,'_2')
    source=("#include <cstdint>\nuint32_t millis() { return 100; }\n"
            "bool inPulse = false;\nuint32_t eventTime__1[32] = {};\n"
            "uint32_t eventTime__2[32] = {};\nvoid loop() {\n"
            + body + "\n}\n")
    result=subprocess.run(['g++','-std=c++17','-fsyntax-only','-x','c++','-'],
                          input=source,text=True,capture_output=True)
    assert result.returncode==0,result.stderr+'\n'+source
    print('PASS UUID LOCAL VARIABLES AND TWO INSTANCE G++ COMPILE')
    browser.close()
