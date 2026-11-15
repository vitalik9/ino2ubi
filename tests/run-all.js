'use strict';
/* Runs every test suite and prints an honest summary:  node tests/run-all.js
 *  - JS suites run in jsdom / Node (needs `npm install` inside tests/tools once);
 *  - the Python browser suites need Playwright + Chromium and are reported as SKIPPED when absent;
 *  - LEGACY suites exercise features that are not part of the shipped Code Professional bundle.
 *    They are still executed and still reported; they are never counted as passed. */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const LEGACY = {
  'ble-regression.js': 'BLE support (ble-support.js, ESP32 Core 2.0.17 BLEAdvertisedDeviceCallbacks) is not wired into the current parser/Code Professional generator; such sketches are refused with an explicit diagnostic instead (see conversion-regression.js).'
};
const dir = __dirname;
const rows = [];
const run = (cmd, args) => spawnSync(cmd, args, { cwd: path.dirname(dir), encoding: 'utf8', timeout: 600000 });

for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.js') && f !== 'run-all.js').sort()) {
  const r = run(process.execPath, [path.join('tests', file)]);
  const out = (r.stdout + r.stderr).trim().split('\n');
  const summary = out.filter(l => /^PASS/.test(l)).pop() || out.filter(l => l.trim() && !/^\s+at /.test(l)).slice(0, 3).join(' | ');
  rows.push({ file, status: r.status === 0 ? 'PASS' : (LEGACY[file] ? 'LEGACY-FAIL' : 'FAIL'), summary, note: LEGACY[file] });
}
const havePlaywright = run('python', ['-I', '-c', 'import playwright']).status === 0;
for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.py')).sort()) {
  if (!havePlaywright) { rows.push({ file, status: 'SKIPPED', summary: 'Playwright/Chromium is not installed' }); continue; }
  const r = run('python', ['-I', path.join('tests', file)]);
  rows.push({ file, status: r.status === 0 ? 'PASS' : 'FAIL', summary: (r.stdout + r.stderr).trim().split('\n').pop() });
}
for (const row of rows) console.log(row.status.padEnd(11), row.file.padEnd(38), row.summary + (row.note ? '\n' + ' '.repeat(50) + 'legacy: ' + row.note : ''));
const count = s => rows.filter(r => r.status === s).length;
console.log(`\nPASS ${count('PASS')}  FAIL ${count('FAIL')}  LEGACY-FAIL ${count('LEGACY-FAIL')}  SKIPPED ${count('SKIPPED')}  (suites: ${rows.length})`);
process.exit(count('FAIL') ? 1 : 0);
