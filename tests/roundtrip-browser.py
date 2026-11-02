from playwright.sync_api import sync_playwright
from pathlib import Path
r=Path(__file__).resolve().parents[1]
files=['constants.js','parser.js','string-params.js','number-literals.js','ble-support.js','generator.js','professional.js','professional-template-data.js','conversion-safety.js','runtime-safety.js','compat.js','esp32.js','avr.js','diagnostics.js','remotexy.js','roundtrip.js','app.js']
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
 page=b.new_page(accept_downloads=True)
 exceptions=[]
 page.on('pageerror',lambda e:exceptions.append(str(e)))
 html=(r/'index.html').read_text(encoding='utf8')
 # Static page with scripts injected from disk to avoid blocked file:// navigation
 html=html[:html.index('<script src="constants.js?')] + '</body></html>'
 page.set_content(html)
 for f in files:page.add_script_tag(content=(r/f).read_text(encoding='utf8'))
 print('loaded',page.evaluate('typeof window.ino2ubiRoundtrip'),exceptions[:2])
 sample='''/* Example */
bool inReady = false; // in
bool outReady = false; // out
unsigned long HoldTimeMs = 60000UL; // par
int value = 1; // variable
int helper(int x){ return x+value; }
void setup(){ value = 2; }
void loop(){ outReady = inReady && helper(value)>0; }'''
 page.fill('#codeInput',sample)
 page.click('#btnParse')
 print('parsed status',page.locator('#status').inner_text(),'diag',page.locator('#esp32Diagnostics').inner_text()[:300])
 try:
  with page.expect_download(timeout=7000) as dl: page.click('#btnGenerate')
  download=dl.value
  print('DOWNLOADED',download.suggested_filename, page.locator('#roundtripReport').inner_text()[:1100])
 except Exception as e:
  print('GENERATE ERROR',str(e)[:200],page.locator('#status').inner_text(),page.locator('#roundtripReport').inner_text()[:2000])
 print('page errors:',exceptions[:5])
 # BLE regression: generated code, callback and captured state must survive.
 ble=(r/'tests/ble_presence_reference.ino').read_text(encoding='utf8')
 page.fill('#codeInput',ble)
 page.click('#btnParse')
 try:
  with page.expect_download(timeout=9000) as dl:page.click('#btnGenerate')
  print('BLE DOWNLOADED',dl.value.suggested_filename,page.locator('#roundtripReport').inner_text()[:500])
 except Exception as e:
  print('BLE ERROR',str(e)[:100],page.locator('#status').inner_text(),page.locator('#roundtripReport').inner_text()[:1500])
 # Professional experimental path is checked independently.
 page.select_option('#exportMode','professional')
 page.fill('#codeInput',sample)
 page.click('#btnParse')
 try:
  with page.expect_download(timeout=9000) as dl:page.click('#btnGenerate')
  print('PRO DOWNLOADED',dl.value.suggested_filename,page.locator('#roundtripReport').inner_text()[:800])
 except Exception as e:
  print('PRO ERROR',str(e)[:150],page.locator('#status').inner_text(),page.locator('#roundtripReport').inner_text()[:1000])
 print('page errors:',exceptions[:5])
 b.close()
