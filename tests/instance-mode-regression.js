'use strict';
/* The two block settings of the UI and their four combinations:
 *   «Использовать блок несколько раз в одном проекте»  -> isUseItOnce  (checked: False, unchecked: True)
 *   «Вход En (условие выполнения кода в Loop: if(En))» -> boolean input En + if(En) around Loop only
 * Everything is driven through the REAL index.html/app.js (jsdom), then the generated .ubi is parsed
 * back and its C++ is checked with a real C++ grammar. Run: node tests/instance-mode-regression.js */
const assert = require('assert');
const { openApp } = require('./lib/ui.js');
const L = require('./lib/load.js');
const U = require('./lib/ubi.js');

const SKETCH = `/* Название блока: Matrix Demo */
#include <Arduino.h>
#define BLOCK_TAG "demo"
bool inReady = false; // in
int outValue = 0; // out
int gain = 3; // par
volatile int counter = 0;
const int LIMIT = 10;
String label = "abc"; // variable
int twice(int v) { return v * 2; }
void setup() { counter = 0; }
void loop() {
  static int calls = 0;
  calls++;
  if (inReady) counter += gain;
  outValue = twice(counter) + LIMIT + calls;
}
`;

let checks = 0;
const ok = (cond, message) => { assert(cond, message); checks++; };
const eq = (a, b, message) => { assert.deepStrictEqual(a, b, message); checks++; };

async function exportViaUi(ui, code, { en, multi }) {
  ui.code = code; ui.parse(); ui.setEn(en); ui.setMultiple(multi);
  const download = ui.generate();
  return download ? { download, xml: await ui.readUbi(download) } : null;
}

(async () => {
  const win = L.loadProduction(); // for parseUbi (DOMParser) and direct validator calls
  // roundtrip.js (not shipped in the UI) re-reads the .ubi and compares it with the sketch.
  const winRT = L.loadWindow([...L.indexScripts(), 'number-literals.js', 'ble-support.js', 'basic-instance.js', 'roundtrip.js']);

  // ===================== 1. The four combinations, through the UI =====================
  for (const en of [false, true]) for (const multi of [true, false]) {
    const tag = `[En=${en}, multi=${multi}]`;
    const ui = await openApp();
    const out = await exportViaUi(ui, SKETCH, { en, multi });
    ok(out, `${tag} export must succeed. Status: ${JSON.stringify(ui.status())}\n${ui.diagnostics()}`);
    ok(out.download.name === 'Matrix_Demo.ubi', `${tag} file name ${out.download.name}`);
    const ubi = U.parseUbi(win, out.xml);

    // -- instance mode
    eq(ubi.isUseItOnce, !multi, `${tag} isUseItOnce`);
    ok(ubi.isUseItOnceType === (multi ? 'False' : 'True'), `${tag} sixx.type of isUseItOnce is ${ubi.isUseItOnceType}`);
    ok(win.ino2ubiCompat.inspectGeneratedXml(out.xml).valid, `${tag} SIXX ids/idrefs`);
    const roundtrip = winRT.ino2ubiRoundtrip.compareProfessional(out.xml, SKETCH, winRT.parseArduinoCode(SKETCH), en);
    ok(roundtrip.errors.length === 0, `${tag} .ubi vs source round-trip: ${Array.from(roundtrip.errors).join('; ')}`);

    // -- En input
    const inputNames = ubi.inputs.map(i => i.name);
    eq(inputNames.filter(n => n === 'En').length, en ? 1 : 0, `${tag} number of En inputs`);
    eq(inputNames, en ? ['inReady', 'En'] : ['inReady'], `${tag} inputs`);
    if (en) eq(ubi.inputs.find(i => i.name === 'En').type, 'BooleanDataType', `${tag} En must be boolean`);
    ok(!ubi.outputs.some(o => o.name === 'En') && !ubi.params.some(p => p.name === 'En'), `${tag} En only as an input`);
    const code = ubi.sections('display');
    if (en) {
      ok(/^\{\nif \(<IO:En>\) \{\n[\s\S]*\n\}\n\}\s*$/.test(code.loop), `${tag} Loop must be wrapped in if(En):\n${code.loop}`);
      ok(code.loop.indexOf('calls++') > code.loop.indexOf('<IO:En>'), `${tag} user loop code is INSIDE if(En)`);
      eq(code.loop.split('<IO:En>').length - 1, 1, `${tag} En is tested exactly once`);
    } else {
      ok(!code.loop.includes('<IO:En>') && !/\bif \(En\)/.test(code.loop), `${tag} no En condition without the checkbox`);
    }
    ok(!code.setup.includes('<IO:En>') && !/\bEn\b/.test(code.setup), `${tag} Setup must not depend on En`);
    ok(!code.declare.includes('<IO:En>') && !/\bEn\b/.test(code.declare), `${tag} declare must not mention En`);
    ok(/counter_<UID>\s*=\s*0;/.test(code.setup), `${tag} setup code present`);

    // -- generated C++ is valid and per-instance
    const unit = U.translationUnit(ubi);
    const syntax = await U.cppSyntax(unit);
    ok(syntax.ok, `${tag} C++ syntax: ${JSON.stringify(syntax.problems)}\n${unit}`);
    ok(code.declare.includes('volatile int counter_<UID> = 0;') && code.declare.includes('const int LIMIT_<UID> = 10;'), `${tag} qualifiers kept:\n${code.declare}`);
    ok(code.declare.includes('String label_<UID> = "abc";'), `${tag} String variable`);
    ok(code.declare.includes('int twice_<UID>(int v);') && /int twice_<UID>\(int v\) \{/.test(code.declare), `${tag} helper has prototype + definition`);
    ok(code.loop.includes('static int calls = 0;'), `${tag} local static stays inside the block scope`);
    ok(code.declare.includes('#define BLOCK_TAG "demo"'), `${tag} #define preserved`);
    ok(/#include <Arduino\.h>/.test(code.declare), `${tag} #include preserved`);

    // -- two instances of the same block must coexist in one generated sketch
    const names = [...await U.topLevelNames(unit)].filter(n => !n.startsWith('__'));
    ok(names.length >= 3 && names.every(n => n.endsWith('_UID')), `${tag} every global name carries the instance UUID: ${names}`);
    const two = U.translationUnit(ubi, '_A1') + '\n' + U.translationUnit(ubi, '_B2');
    ok((await U.cppSyntax(two)).ok, `${tag} two instances: syntax`);
    const namesTwo = [...await U.topLevelNames(two)];
    eq(namesTwo.length, new Set(namesTwo).size, `${tag} two instances: duplicate names`);
    ui.close();
  }
  // The coexistence check must be able to fail: the same UUID twice is detected.
  {
    const ui = await openApp();
    const out = await exportViaUi(ui, SKETCH, { en: false, multi: true });
    const ubi = U.parseUbi(win, out.xml);
    const clash = U.translationUnit(ubi, '_SAME') + '\n' + U.translationUnit(ubi, '_SAME');
    const names = [...(await U.cppSyntax(clash)).tree.rootNode.namedChildren].flatMap(n => n.type === 'declaration' ? [n.text] : []);
    ok(names.some(t => t.includes('counter__SAME')) && names.filter(t => t.includes('counter__SAME')).length === 2, 'negative control: duplicate declarations are visible');
    ui.close();
  }

  // ===================== 2. Diagnostics depend on the mode =====================
  const base = 'bool inReady = false; // in\nbool outReady = false; // out\n';
  const sketch = (decl, setup = '', loop = 'outReady = inReady;') => `${base}${decl}\nvoid setup() { ${setup} }\nvoid loop() { ${loop} }\n`;
  const analyse = (src, multi, en = false) => L.runChecks(win, src, win.parseArduinoCode(src), en, multi);
  const MULTI_ONLY = [ // declarations that only break INDEPENDENCE of instances
    ['static int total = 0;', 'Глобальная static-переменная'],
    ['static volatile int total = 0;', 'Глобальная static-переменная'],
    ['Servo servos[2];', 'Глобальный массив'], // object arrays are still refused; primitive arrays are isolated (global-arrays-regression.js)
    ['std::array<int, 3> arr;', 'Шаблонный глобальный объект'],
    ['Preferences prefs;', 'Объект без аргументов конструктора'],
    ['Servo s1, s2;', 'Объект без аргументов конструктора'],
    ['constexpr int N = 5;', 'не получит UUID экземпляра']
  ];
  for (const [decl, text] of MULTI_ONLY) {
    const src = sketch(decl);
    const multi = analyse(src, true);
    ok(multi.errors.some(e => e.includes(text)), `multi: "${decl}" must be diagnosed (${text}); got ${multi.errors.join(' | ')}`);
    const single = analyse(src, false);
    eq(single.errors, [], `single: "${decl}" must be accepted without independence errors`);
    // ...and the single-instance export really is valid C++.
    const exported = L.exportBlock(win, src, { allowMultiple: false });
    eq(exported.errors, [], `single export of "${decl}"`);
    const ubi = U.parseUbi(win, exported.xml);
    ok((await U.cppSyntax(U.translationUnit(ubi))).ok, `single: "${decl}" generated C++ must be syntactically valid`);
    ok(ubi.isUseItOnce === true, 'single mode flag');
  }
  const ALWAYS_BLOCKED = [ // not representable at all, in either mode
    ['int* ptr = nullptr;', 'указатель'], ['hw_timer_t* timer = NULL;', 'указатель'],
    ['enum State { A, B };', 'enum/struct/class/union'], ['struct Point { int x; };', 'enum/struct/class/union'],
    ['unsigned long long big = 5ULL;', 'Неподдерживаемый глобальный тип']
  ];
  for (const [decl, text] of ALWAYS_BLOCKED)
    for (const multi of [true, false])
      ok(analyse(sketch(decl), multi).errors.some(e => e.includes(text)), `"${decl}" must be blocked (multi=${multi})`);

  // Exclusive hardware: only the multi-instance mode warns, and the warning says what to do.
  for (const [call, what] of [['Wire.begin();', 'I2C'], ['SPI.begin();', 'SPI'], ['Serial.begin(115200);', 'Serial'], ['esp_now_init();', 'ESP-NOW'],
    ['WiFi.begin("a","b");', 'Wi-Fi'], ['BLEDevice::init("x");', 'BLE'], ['EEPROM.begin(64);', 'EEPROM'], ['ledcAttach(2, 5000, 8);', 'LEDC']]) {
    const src = sketch('', call);
    const multi = analyse(src, true), single = analyse(src, false);
    const hit = multi.warnings.find(w => w.includes('[MULTI-RESOURCE]'));
    ok(hit && hit.includes(what) && hit.includes('снимите галочку'), `${call}: multi-instance warning with advice, got ${multi.warnings.join(' | ')}`);
    ok(!single.warnings.some(w => w.includes('[MULTI-RESOURCE]') || w.includes('экземпляр')), `${call}: no instance warnings in single mode: ${single.warnings.join(' | ')}`);
    eq(multi.errors.filter(e => /экземпляр/.test(e)), [], `${call}: a warning, not an error`);
    const located = win.ino2ubiDiagnostics.enrich(src, { warnings: [hit] })[0];
    ok(located.line === 4, `${call}: MULTI-RESOURCE warning points at line ${located.line}`);
  }
  // Code written for several instances is accepted by the one-instance mode with no instance-related noise.
  {
    const single = analyse(SKETCH, false), multi = analyse(SKETCH, true);
    eq(single.errors, [], 'SKETCH single errors');
    eq(multi.errors, [], 'SKETCH multi errors');
    ok(!single.warnings.some(w => /экземпляр|MULTI/.test(w)), 'SKETCH single warnings: ' + single.warnings.join(' | '));
  }

  // ===================== 3. En checkbox: collisions and compatibility =====================
  const withEn = (src, multi = true) => L.runChecks(win, src, win.parseArduinoCode(src), true, multi);
  for (const [name, src] of [
    ['input named En', 'bool En = false; // in\nbool outReady = false; // out\nvoid setup(){}\nvoid loop(){ outReady = En; }'],
    ['variable named En', 'bool En = false;\nbool outReady = false; // out\nvoid setup(){}\nvoid loop(){ outReady = En; }'],
    ['output named En', 'bool En = false; // out\nvoid setup(){}\nvoid loop(){ En = true; }'],
    ['parameter named En', 'int En = 1; // par\nbool outReady = false; // out\nvoid setup(){}\nvoid loop(){ outReady = En; }'],
    ['#define En', '#define En "x"\nbool outReady = false; // out\nvoid setup(){}\nvoid loop(){ outReady = true; }'],
    ['function En', 'bool outReady = false; // out\nint En(int a){ return a; }\nvoid setup(){}\nvoid loop(){ outReady = En(1); }'],
    ['alias En', 'bool inGo = false; // in: En\nbool outReady = false; // out\nvoid setup(){}\nvoid loop(){ outReady = inGo; }']
  ]) {
    for (const multi of [true, false]) {
      const r = withEn(src, multi);
      ok(r.errors.some(e => /En/.test(e)), `En + ${name} (multi=${multi}) must be refused, got: ${r.errors.join(' | ')}`);
      ok(L.exportBlock(win, src, { enableInput: true, allowMultiple: multi }).errors.length > 0, `En + ${name}: export must be blocked`);
    }
  }
  // Without the checkbox the same identifier is an ordinary name (no false alarm, En untouched).
  eq(analyse('bool En = false; // in\nbool outReady = false; // out\nvoid setup(){}\nvoid loop(){ outReady = En; }', true).errors, [], 'a user input En is fine without the checkbox');
  {
    // Loop that declares its own locals / uses braces: the wrapper must stay balanced and valid.
    const src = base + 'void setup() { int s = 1; }\nvoid loop() { int local = 5; if (inReady) { local++; } outReady = local > 5; }\n';
    for (const multi of [true, false]) {
      const r = L.exportBlock(win, src, { enableInput: true, allowMultiple: multi });
      eq(r.errors, [], 'En balanced');
      const ubi = U.parseUbi(win, r.xml);
      ok((await U.cppSyntax(U.translationUnit(ubi))).ok, 'En wrapper valid C++');
      ok(/int local = 5;/.test(ubi.sections('display').loop) && !/\bint s = 1/.test(ubi.sections('display').loop.replace(/int local/g, '')), 'loop/setup bodies stay separate');
      eq(ubi.isUseItOnce, !multi, 'flag with En');
    }
  }

  // ===================== 4. Persistence of both settings =====================
  for (const en of [false, true]) for (const multi of [true, false]) {
    const tag = `[save/restore En=${en}, multi=${multi}]`;
    const ui = await openApp();
    ui.code = SKETCH; ui.parse(); ui.setEn(en); ui.setMultiple(multi);
    const saved = ui.saveProject();
    ok(saved && /\.i2u\.json$/.test(saved.name), `${tag} project downloaded: ${saved && saved.name}`);
    const text = await ui.readText(saved);
    const json = JSON.parse(text);
    eq([json.settings.enableInput, json.settings.allowMultipleInstances], [en, multi], `${tag} stored settings`);
    ui.close();

    const ui2 = await openApp(); // fresh session, defaults: En off, multiple off
    ui2.setMultiple(!multi); ui2.setEn(!en);
    await ui2.openProjectFile('p.i2u.json', text);
    eq([ui2.$('enableInput').checked, ui2.$('allowMultipleInstances').checked], [en, multi], `${tag} checkboxes after opening. Status: ${JSON.stringify(ui2.status())}`);
    ok(ui2.$('codeInput').value === SKETCH, `${tag} code restored`);
    // the restored project exports with the restored settings
    const d = ui2.generate();
    ok(d, `${tag} restored project exports. ${JSON.stringify(ui2.status())}`);
    const ubi = U.parseUbi(win, await ui2.readUbi(d));
    eq([ubi.isUseItOnce, ubi.inputs.some(i => i.name === 'En')], [!multi, en], `${tag} exported flags after restore`);
    ui2.close();
  }
  { // legacy project without the field: checkbox must be OFF (single instance, the new default), En off
    const legacy = win.ino2ubiCompat.makeProject(SKETCH, win.parseArduinoCode(SKETCH), { blockName: 'Old' });
    delete legacy.settings.allowMultipleInstances; delete legacy.settings.enableInput;
    const restored = win.ino2ubiCompat.restoreSettings(legacy.settings);
    eq([restored.allowMultipleInstances, restored.enableInput], [false, false], 'old project without settings');
    eq(win.ino2ubiCompat.restoreSettings(undefined).allowMultipleInstances, false, 'no settings object at all');
    const ui = await openApp();
    ui.setMultiple(true); ui.setEn(true);
    await ui.openProjectFile('old.i2u.json', JSON.stringify(legacy));
    eq([ui.$('enableInput').checked, ui.$('allowMultipleInstances').checked], [false, false], 'old project through the UI');
    ui.close();
  }
  { // switching a checkbox re-runs diagnostics immediately (before export)
    const ui = await openApp();
    ui.code = sketch('static int total = 0;'); ui.setMultiple(true); ui.parse();
    ok(ui.status().error && /static/.test(ui.diagnostics()), 'multi: static is an error right after parsing');
    ui.setMultiple(false);
    ok(!ui.status().error && !/static/.test(ui.diagnostics().replace(/Известных/g, '')), 'unchecking the box clears the independence error: ' + ui.status().text);
    ok(ui.generate(), 'single: static sketch exports');
    ui.setMultiple(true);
    ok(ui.status().error, 'checking the box brings the error back');
    ok(!ui.generate(), 'multi: export of the static sketch is blocked');
    ui.close();
  }
  { // clearing resets to the defaults
    const ui = await openApp();
    eq(ui.$('allowMultipleInstances').checked, false, 'new project: checkbox is off by default');
    ui.setEn(true); ui.setMultiple(true);
    ui.$('btnClear').click();
    eq([ui.$('enableInput').checked, ui.$('allowMultipleInstances').checked], [false, false], 'defaults after «Очистить»');
    ui.close();
  }

  console.log(`PASS instance-mode / En matrix: ${checks} checks (4 combinations x UI export, .ubi inspection, C++ grammar, persistence)`);
})().catch(error => { console.error(error); process.exit(1); });
