"""Regression: FLProg Professional helper functions tagged per instance, parameter types preserved."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import xml.etree.ElementTree as ET
r=Path(__file__).resolve().parents[1]
scripts=['constants.js','parser.js','string-params.js','number-literals.js','ble-support.js','generator.js','professional.js','professional-template-data.js','conversion-safety.js','runtime-safety.js','compat.js','esp32.js','avr.js','diagnostics.js','remotexy.js','roundtrip.js','app.js']
src='''#include <Arduino.h>
#include <Preferences.h>
bool inEnable = false; // in
unsigned long outCounter = 0UL; // out
unsigned long StepValue = 1UL; // par: Step
unsigned long testCounter = 0UL; // variable
Preferences testPrefs;
bool testCanIncrement() { return testCounter <= (0xFFFFFFFFUL - StepValue); }
void testIncrement() { if(testCanIncrement()) testCounter += StepValue; }
void testUpdateOutputs() { outCounter = testCounter; }
void setup() { testCounter = 0UL; }
void loop() { if(inEnable) { testIncrement(); testUpdateOutputs(); } }
'''
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
 page=b.new_page(accept_downloads=True)
 html=(r/'index.html').read_text()
 html=html[:html.index('<script src="constants.js?')]+'</body></html>'
 page.set_content(html)
 for script in scripts:page.add_script_tag(content=(r/script).read_text())
 page.select_option('#exportMode','professional')
 page.fill('#codeInput',src)
 page.click('#btnParse')
 with page.expect_download(timeout=14000) as dl:page.click('#btnGenerate')
 content=Path(dl.value.path()).read_bytes(); xml=content.decode('utf-16')
 ET.fromstring(xml)
 # One tag for each definition and call; testCanIncrement has internal cross-function call.
 for function in ('testCanIncrement','testIncrement','testUpdateOutputs'):
  assert xml.count(function+'_')>=2,(function,xml.count(function+'_'))
 assert xml.count('UserCodeMultiBlockUseInCodeUUIDTag')>=10
 assert 'unsigned long __ino2ubi_numeric_StepValue' in xml, 'Parameter snapshot changed unsigned long to int'
 assert 'auto __ino2ubi_numeric_StepValue' not in xml
 assert 'testCounter_' in xml
 print('PASS Professional helper function UUID, cross-calls, unsigned long parameter, XML parser')
 b.close()
