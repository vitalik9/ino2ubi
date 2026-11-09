"""Browser regression for UUID rewriting of native C++ method/member names."""
from pathlib import Path
from playwright.sync_api import sync_playwright
r=Path(__file__).resolve().parents[1]
scripts=['constants.js','parser.js','string-params.js','number-literals.js','ble-support.js','generator.js','professional.js','professional-template-data.js','conversion-safety.js','runtime-safety.js','compat.js','esp32.js','avr.js','diagnostics.js','remotexy.js','roundtrip.js','app.js']
src='''#include <BluetoothSerial.h>
#include <WiFi.h>
int mode = 1; // variable
int channel = 1; // variable
int h = 2; // variable
int length = 3; // variable
int status = 4; // variable
int size = 5; // variable
bool outReady = false; // out
String msg = ""; // variable
esp_now_peer_info_t peer;
void setup(){WiFi.mode(WIFI_STA); peer.channel = channel; peerPtr->channel = channel; Config::status(); outReady = (msg.length() > 0 || WiFi.status() || msg.size());}
void loop(){channel++;}
'''
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page(accept_downloads=True)
    html=(r/'index.html').read_text()
    html=html[:html.index('<script src="constants.js?')]+'</body></html>'
    page.set_content(html)
    for script in scripts: page.add_script_tag(content=(r/script).read_text())
    page.select_option('#exportMode','professional')
    page.fill('#codeInput',src)
    page.click('#btnParse')
    errors=page.evaluate('''() => window.ino2ubiCompat.validateConverterInput(document.querySelector('#codeInput').value,window.parseArduinoCode(document.querySelector('#codeInput').value),false,'esp32').errors''')
    assert not errors, errors
    with page.expect_download(timeout=12000) as dl:page.click('#btnGenerate')
    xml=Path(dl.value.path()).read_bytes().decode('utf-16')

    for literal in ['WiFi.mode(', '.channel = ', '-&gt;channel = ', 'Config::status()', '.length()', 'WiFi.status()', '.size()', '#include &lt;BluetoothSerial.h&gt;']:
        assert literal in xml, f'Missing original library/member token {literal}'
    for corrupt in ['WiFi.mode_', 'peer.channel_', 'peerPtr-&gt;channel_', 'Config::status_', 'msg.length_', 'WiFi.status_', 'msg.size_']:
        assert corrupt not in xml, f'Corrupted library/member token {corrupt}'
    assert 'UserCodeMultiBlockUseInCodeUUIDTag' in xml
    assert 'channel_' in xml
    print('PASS professional UUID member/include regression: 15 checks')
    browser.close()
