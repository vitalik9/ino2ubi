'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const context = {window: {}, crypto: require('node:crypto').webcrypto, console};
context.window.window = context.window;
vm.createContext(context);
for (const name of ['constants.js','parser.js','string-params.js','number-literals.js','ble-support.js','generator.js','conversion-safety.js','runtime-safety.js','compat.js','esp32.js','diagnostics.js'])
  vm.runInContext(fs.readFileSync(path.join(root, name), 'utf8'), context, {filename: name});
const api = context.window;
let tests = 0;
function analyze(code) {
  const parsed = api.parseArduinoCode(code);
  const converter = api.ino2ubiCompat.validateConverterInput(code, parsed, false, 'esp32');
  const board = api.ino2ubiEsp32.checkEsp32Core2017(code, parsed);
  const result = {
    errors: [...new Set([...converter.errors, ...board.errors])],
    warnings: [...new Set([...converter.warnings, ...board.warnings])]
  };
  const original = api.ino2ubiDiagnostics.enrich(code, result);
  const shown = api.ino2ubiDiagnostics.forDisplay(code, original);
  return {result, original, shown};
}
function assertionsForHTTP(code, expectedRaw, expectedDisplayed) {
  const {result, original, shown} = analyze(code);
  assert.equal(result.errors.length, 0, result.errors.join('\n'));
  assert.equal(result.warnings.length, expectedRaw, JSON.stringify(result.warnings));
  assert.equal(shown.filter(i=>i.severity==='warning').length, expectedDisplayed, JSON.stringify(shown));
  assert.equal(original.filter(i=>i.severity==='warning').length, expectedRaw, 'Do not mutate analyzer results');
  for (const issue of shown) {
    assert(issue.line != null, issue.message);
    assert(issue.snippet != null, issue.message);
  }
  tests++;
  return {result, shown};
}
const pad = Array(231).fill('// spacer').join('\n') + '\n';
const program = pad + `#include <HTTPClient.h>
HTTPClient http;
void setup() {}
void loop() {
  String payload = "example";
  int httpCode = http.POST(payload);
  if (httpCode > 0) {
    String response = http.getString();
  }
}
`;
const test1 = assertionsForHTTP(program, 4, 2);
assert.equal(test1.shown[0].line, 237);
assert.equal(test1.shown[1].line, 239);
assert(test1.shown.some(i=>i.message.includes('http.POST()')));
assert(test1.shown.some(i=>i.message.includes('http.getString()')));
assert(!test1.shown.some(i=>i.message.includes('BLOCKING-IO')));
assert(!test1.shown.some(i=>i.message.includes('Несколько потенциально')));
tests++;
// A generic blocking call on an adjacent line must still be visible.
const withPulse = program.replace('  int httpCode = http.POST(payload);', '  int wait = pulseIn(2, HIGH);\n  int httpCode = http.POST(payload);');
const pulse = analyze(withPulse);
assert(pulse.shown.some(i=>i.message.includes('BLOCKING-IO') && i.line===237), JSON.stringify(pulse.shown));
assert(pulse.shown.some(i=>i.message.includes('http.POST()')));
tests++;
// Even if a second blocking operation is on the same line, the first one
// must not be hidden just because a concrete HTTP warning is also present.
const sameLine = program.replace('  int httpCode = http.POST(payload);', '  int wait = pulseIn(2, HIGH); int httpCode = http.POST(payload);');
const mixed = analyze(sameLine);
assert(mixed.shown.some(i=>i.message.includes('BLOCKING-IO')), JSON.stringify(mixed.shown));
tests++;
// Warnings about just one HTTP method should not be discarded.
const one = program.replace('    String response = http.getString();', '    String response = "OK";');
assertionsForHTTP(one, 2, 1);
// No generic call warning exists in a helper function; keep the concrete warning.
const helper = program.replace('  int httpCode = http.POST(payload);', '  int httpCode = 200;').replace('    String response = http.getString();', '    String response = "OK";').replace('void setup() {}', 'void setup() {}\nvoid sendData() { http.POST("hi"); }');
const helperIssues = analyze(helper);
assert.equal(helperIssues.shown.filter(i => i.message.includes('Сетевой вызов')).length, 1);
tests++;
// No changes to errors and general timer / GPIO warnings.
const general = analyze('bool outActive=false; // out\nvoid setup(){pinMode(2,OUTPUT);pinMode(2,INPUT);}\nvoid loop(){if(millis()==42) outActive=true;}');
assert.equal(general.shown.length, general.original.length);
assert.deepEqual(general.shown.map(i => i.message), general.original.map(i => i.message));
tests++;
console.log(`PASS diagnostics display: ${tests} scenarios, original HTTP warnings 4 -> visible 2`);
