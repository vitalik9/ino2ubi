"""Validate native FLProg instance UUID tags and source round-trip."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import re
r=Path(__file__).resolve().parents[1]
scripts=['constants.js','parser.js','string-params.js','number-literals.js','ble-support.js','generator.js','professional.js','professional-template-data.js','conversion-safety.js','runtime-safety.js','compat.js','esp32.js','avr.js','diagnostics.js','remotexy.js','roundtrip.js','app.js']
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page(accept_downloads=True)
    html=(r/'index.html').read_text()
    html=html[:html.index('<script src="constants.js?')]+'</body></html>'
    page.set_content(html)
    for script in scripts:page.add_script_tag(content=(r/script).read_text())
    src='''/* UIID test */
int counter = 1; // variable
static int retries = 0;
int readings[3] = {1,2,3};
void setup() { counter = 2; retries = 1; readings[0] = 3; }
void loop() { counter++; retries++; readings[1] = counter; }
'''
    data=page.evaluate('''src => {
      const state=window.parseArduinoCode(src);
      return {state, staticDeclarations:state.static_declarations};
    }''',src)
    state=data['state']
    assert state['variables'].get('counter'),str(data)
    page.select_option('#exportMode','professional')
    page.fill('#codeInput',src)
    page.click('#btnParse')
    try:
        with page.expect_download(timeout=7000) as dl:
            page.click('#btnGenerate')
    except Exception:
        print('STATUS',page.locator('#status').inner_text(), 'REPORT',page.locator('#roundtripReport').inner_text()[:1500])
        raise
    content=Path(dl.value.path()).read_bytes()
    xml=content.decode('utf-16')
    print('Roundtrip:',page.locator('#roundtripReport').inner_text()[:200])
    assert xml.count('UserCodeMultiBlockUseInCodeUUIDTag')>=5,xml.count('UserCodeMultiBlockUseInCodeUUIDTag')
    assert 'counter_' in xml
    if state['static_declarations']:
      assert 'retries_' in xml or 'readings_' in xml
    print('PASS native instance UUID tags:',xml.count('UserCodeMultiBlockUseInCodeUUIDTag'),'static:',state['static_declarations'])
    browser.close()
