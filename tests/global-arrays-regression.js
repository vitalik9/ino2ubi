'use strict';
/* Global primitive arrays with several instances of one block, plus the «multiple use» default.
 * Run: node tests/global-arrays-regression.js
 *  - the .ubi is exported through the real UI in both modes and parsed back;
 *  - two instances are assembled the way FLProg does (UUID tag -> different suffix) and the result is
 *    checked with a real C++ grammar: every array name is declared once per instance, with the
 *    original type, size and initial values, and every read/write uses the instance's own array;
 *  - unsupported constructions keep a clear diagnostic. */
const assert = require('assert');
const { openApp } = require('./lib/ui.js');
const L = require('./lib/load.js');
const U = require('./lib/ubi.js');

let checks = 0;
const ok = (c, m) => { assert(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const SKETCH = `#include <Arduino.h>
bool inReady = false; // in
int outSum = 0; // out
int values[10] = {0};
float temperatures[5];
bool states[8];
const int table[3] = {1, 2, 3};
int a = 1, extra[3];
int sumValues() {
  int s = 0;
  for (int i = 0; i < 10; i++) s += values[i];
  return s;
}
void setup() { temperatures[0] = 1.5; states[7] = true; extra[2] = 4; }
void loop() {
  values[0] = values[0] + 1;
  values[9] = table[2];
  if (inReady && states[7]) outSum = sumValues() + (int)temperatures[0] + extra[2];
}
`;

(async () => {
  const win = L.loadProduction();
  const analyse = (src, multi, en = false) => L.runChecks(win, src, win.parseArduinoCode(src), en, multi);

  // ---- no false diagnostics for the supported constructions, in both modes
  for (const multi of [true, false]) {
    const r = analyse(SKETCH, multi);
    eq(r.errors, [], `supported arrays, multi=${multi}: errors`);
    ok(!r.warnings.some(w => /массив/i.test(w)), `supported arrays, multi=${multi}: warnings ${r.warnings.join(' | ')}`);
  }

  // ---- export through the UI in all four combinations; two instances in one translation unit
  for (const en of [false, true]) for (const multi of [true, false]) {
    const tag = `[En=${en}, multi=${multi}]`;
    const ui = await openApp();
    ui.code = SKETCH; ui.parse(); ui.setEn(en); ui.setMultiple(multi);
    const d = ui.generate();
    ok(d, `${tag} export. ${JSON.stringify(ui.status())}\n${ui.diagnostics()}`);
    const ubi = U.parseUbi(win, await ui.readUbi(d));
    eq(ubi.isUseItOnce, !multi, `${tag} isUseItOnce`);
    const display = ubi.sections('display').declare;
    for (const decl of ['int values_<UID>[10] = {0};', 'float temperatures_<UID>[5];', 'bool states_<UID>[8];',
      'const int table_<UID>[3] = {1, 2, 3};', 'int extra_<UID>[3];'])
      ok(display.includes(decl), `${tag} declaration "${decl}" in:\n${display}`);
    ok(ubi.sections('display').loop.includes('values_<UID>[0] = values_<UID>[0] + 1;'), `${tag} loop write/read`);
    ok(ubi.sections('display').setup.includes('temperatures_<UID>[0] = 1.5;'), `${tag} setup write`);

    // two instances of the same block: FLProg expands the UUID tag differently for each (name + '_' + uid)
    const one = U.translationUnit(ubi, '_AAA'), two = U.translationUnit(ubi, '_BBB');
    const both = one + '\n' + two;
    const syntax = await U.cppSyntax(both);
    ok(syntax.ok, `${tag} two instances must be valid C++: ${JSON.stringify(syntax.problems.slice(0, 3))}`);
    const names = [...await U.topLevelNames(both)];
    for (const base of ['values', 'temperatures', 'states', 'table', 'extra']) {
      ok(names.includes(base + '__AAA') && names.includes(base + '__BBB'), `${tag} ${base} is declared for each instance`);
      ok(!names.includes(base), `${tag} no un-suffixed global "${base}" survives`);
    }
    // each declared name exactly once across both instances -> no redefinition
    const declared = [];
    for (const n of (await U.cppSyntax(both)).tree.rootNode.namedChildren) if (n.type === 'declaration') declared.push(n.text);
    for (const base of ['values', 'temperatures', 'states', 'table', 'extra'])
      for (const sfx of ['__AAA', '__BBB'])
        eq(declared.filter(t => new RegExp('\\b' + base + sfx + '\\s*\\[').test(t)).length, 1, `${tag} ${base}${sfx} declared once`);
    // instance A code never touches B's arrays and vice versa
    ok(!/_BBB/.test(one) && !/_AAA/.test(two), `${tag} instances are isolated`);
    // helper reads the instance's own array
    ok(one.includes('s += values__AAA[i];') && two.includes('s += values__BBB[i];'), `${tag} helper uses own array`);
    ui.close();
  }

  // ---- saved project keeps the arrays and settings
  {
    const ui = await openApp();
    ui.code = SKETCH; ui.parse(); ui.setMultiple(true);
    const text = await ui.readText(ui.saveProject());
    const ui2 = await openApp();
    await ui2.openProjectFile('arrays.i2u.json', text);
    eq(ui2.$('allowMultipleInstances').checked, true, 'saved value true is restored');
    ok(ui2.generate(), 'restored project exports: ' + JSON.stringify(ui2.status()));
    ui.close(); ui2.close();
  }

  // ---- unsupported constructions keep a clear diagnostic
  const base = 'bool inReady = false; // in\nbool outReady = false; // out\n';
  const sk = (decl, extra = '') => `${base}${decl}\nvoid setup() {}\nvoid loop() { outReady = inReady; ${extra} }\n`;
  const blocked = [
    ['Servo servos[2];', true, 'Глобальный массив'],               // object array
    ['int bad[] = {1, 2};', false, 'размер явным положительным'],    // size must be a literal
    ['#define N 4\nint bad[N];', false, 'числовой макрос'],           // numeric macro as size
    ['int dup[2];\nint dup[3];', true, 'Конфликт имени массива'],     // duplicate
    ['int arr[2];\nint arr = 1;', true, 'Конфликт имени массива'],    // array vs variable
    ['int* ptrs[2];', false, 'указатель'],                           // array of pointers
    ['int64_t big[2];', false, 'Неподдерживаемый глобальный тип']
  ];
  for (const [decl, multiOnly, text] of blocked) {
    const m = analyse(sk(decl), true);
    ok(m.errors.some(e => e.includes(text)), `multi: "${decl}" must be diagnosed (${text}); got ${m.errors.join(' | ')}`);
    if (!multiOnly) ok(analyse(sk(decl), false).errors.some(e => e.includes(text)), `single: "${decl}" must be diagnosed (${text})`);
  }
  // En name clash with an array stays detected
  ok(analyse(sk('int En[2];'), true, true).errors.some(e => /En/.test(e)), 'array named En with En enabled');

  // generator-level guard: a hand-edited state cannot smuggle a name clash
  {
    const src = sk('int arr[2];\nint arr = 1;');
    const parsed = win.parseArduinoCode(src);
    let threw = false;
    try { L.exportBlock(win, src, { allowMultiple: true, state: parsed }); } catch (e) { threw = true; }
    ok(threw || L.exportBlock(win, src, { allowMultiple: true, state: parsed }).errors.length, 'array/variable clash never exports');
  }

  // ---- defaults of the «multiple use» checkbox
  {
    const ui = await openApp();
    eq(ui.$('allowMultipleInstances').checked, false, 'new project: unchecked');
    ui.setMultiple(true); ui.$('btnClear').click();
    eq(ui.$('allowMultipleInstances').checked, false, 'after clear: unchecked');
    ui.close();
  }
  eq(win.ino2ubiCompat.restoreSettings({}).allowMultipleInstances, false, 'old project without the field');
  eq(win.ino2ubiCompat.restoreSettings({ allowMultipleInstances: true }).allowMultipleInstances, true, 'saved true');
  eq(win.ino2ubiCompat.restoreSettings({ allowMultipleInstances: false }).allowMultipleInstances, false, 'saved false');

  console.log(`PASS global arrays: ${checks} checks (isolation of two instances in 4 En/multi combinations, diagnostics, defaults)`);
})().catch(e => { console.error(e); process.exit(1); });
