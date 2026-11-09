from pathlib import Path
from playwright.sync_api import sync_playwright
r=Path(__file__).resolve().parents[1]
src=(r/'tests/semena-two-instances-reference.ino').read_text()
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
 page=b.new_page(accept_downloads=True)
 errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 html=(r/'index.html').read_text()
 html=html[:html.index('<script src="constants.js?')]+'</body></html>'
 page.set_content(html)
 scripts=['constants.js','parser.js','string-params.js','number-literals.js','ble-support.js','basic-instance.js','generator.js','professional.js','professional-template-data.js','conversion-safety.js','runtime-safety.js','compat.js','esp32.js','avr.js','diagnostics.js','remotexy.js','roundtrip.js','app.js']
 for script in scripts:page.add_script_tag(content=(r/script).read_text())
 page.fill('#codeInput',src)
 page.click('#btnParse')
 print('parsed',page.locator('#status').inner_text())
 try:
  with page.expect_download(timeout=20000) as dl:page.click('#btnGenerate')
  file=dl.value
  xml=Path(file.path()).read_bytes().decode('utf-16')
  assert 'static Preferences prefs;' in xml
  assert 'auto semenaSaveSet' in xml
  assert 'auto semenaUpdateProgress' in xml
  assert 'CodeUserBlockFunction"' not in xml
  print('PASS actual 15-function Code Basic converted; built-in roundtrip accepted; download',file.suggested_filename)
  page.locator('#singleInstance').check()
  with page.expect_download(timeout=20000) as single_dl:page.click('#btnGenerate')
  single_xml=Path(single_dl.value.path()).read_bytes().decode('utf-16')
  assert 'sixx.name="notCanManyUse" sixx.type="True"' in single_xml
  assert 'CodeUserBlockFunction"' in single_xml
  print('PASS one-instance toggle: original global functions preserved; XML roundtrip accepted')
 except Exception as e:
  print('FAILED',str(e)[:180],page.locator('#status').inner_text(),page.locator('#roundtripReport').inner_text()[:2000]);raise
 assert not errors,errors
 b.close()
