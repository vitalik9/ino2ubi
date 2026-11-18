'use strict';
/* ESP32 Arduino Core 2.0.17 preflight: valid standard-library code passes, Core 3.x-only API is rejected. */
const assert = require('assert');
const { loadProduction } = require('./lib/load');
const win = loadProduction();
const check = (code) => win.ino2ubiEsp32.checkEsp32Core(code, win.parseArduinoCode(code), '2.0.17');

const good = `#include <Arduino.h>
#include <WiFi.h>
#include <esp_now.h>
bool outOk = false; // out
void onRecv(const uint8_t* mac, const uint8_t* data, int len) { outOk = len > 0; }
void onSent(const uint8_t* mac, esp_now_send_status_t status) { }
void setup() {
  ledcSetup(0, 5000, 8); ledcAttachPin(2, 0); ledcWrite(0, 128);
  esp_task_wdt_init(10, true);
  esp_now_register_recv_cb(onRecv); esp_now_register_send_cb(onSent);
}
void loop() { }`;
const g = check(good);
assert.strictEqual(g.errors.length, 0, 'valid 2.0.17 code: ' + g.errors.join('; '));

for (const validCall of ['analogWrite(2, 5);', 'analogWriteResolution(8);', 'analogWriteFrequency(1000);', 'ledcChangeFrequency(0, 5000, 8);', 'SET_LOOP_TASK_STACK_SIZE(8192)']) {
  const r = check('#include <Arduino.h>\n' + (validCall.startsWith('SET_LOOP') ? validCall + '\nvoid setup() {}' : 'void setup() {' + validCall + '}') + '\nvoid loop() {}');
  assert.strictEqual(r.errors.length, 0, '2.0.17 standard API incorrectly rejected: ' + validCall + ' ' + r.errors.join('; '));
}
const bad = {
  'ledcAttach(2, 5000, 8);': /ledcAttach/,
  'rgbLedWrite(8, 1, 2, 3);': /rgbLedWrite/,
  'esp_task_wdt_config_t c;': /esp_task_wdt_config_t/,
  'esp_task_wdt_init(&c);': /esp_task_wdt_init/,
  'ledcSetup(2, 5000);': /ledcSetup/,
  'NetworkClient c;': /Network\*/,
  'auto t = timerBegin(1000000);': /timerBegin/
};
for (const [stmt, re] of Object.entries(bad)) {
  const r = check('#include <Arduino.h>\nvoid setup() { ' + stmt + ' }\nvoid loop() { }');
  assert.ok(r.errors.some(e => re.test(e)), 'expected error for ' + stmt + ', got ' + JSON.stringify(r.errors));
}
const badInc = check('#include <NetworkClient.h>\nvoid setup() { }\nvoid loop() { }');
assert.ok(badInc.errors.some(e => /NetworkClient\.h/.test(e)));
const badCb = check('#include <esp_now.h>\nvoid s(const esp_now_send_info_t* i, esp_now_send_status_t st) { }\nvoid setup() { esp_now_register_send_cb(s); }\nvoid loop() { }');
assert.ok(badCb.errors.length > 0);
assert.strictEqual(win.ino2ubiEsp32.target.core, '2.0.17');
console.log('PASS ESP32 Core 2.0.17 preflight: valid code accepted, ' + (Object.keys(bad).length + 2) + ' Core 3.x constructs rejected, default target 2.0.17');
