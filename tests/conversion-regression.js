'use strict';
/* Conversion-safety regression: every scenario runs through the PRODUCTION bundle (index.html script
 * order) in jsdom, the same validation the UI performs, followed by the real Code Professional export,
 * an XML integrity check and a C++ grammar check of the generated code.
 * Run: node tests/conversion-regression.js */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const L = require('./lib/load.js');
const U = require('./lib/ubi.js');

(async () => {
  // number-literals.js is a stand-alone unit under test here (it is not part of the Professional bundle).
  const win = L.loadWindow([...L.indexScripts(), 'number-literals.js']);
  let checked = 0;
  const check = (src, multi = true) => {
    const parsed = win.parseArduinoCode(src);
    return { parsed, ...L.runChecks(win, src, parsed, false, multi) };
  };
  function expectError(src, id, multi = true) {
    const r = check(src, multi);
    assert(r.errors.some(m => m.includes('[' + id + ']')), `Missing ${id}:\n${r.errors.join('\n')}`);
    const diag = win.ino2ubiDiagnostics.enrich(src, { errors: r.errors });
    assert(diag.some(d => d.message.includes('[' + id + ']') && d.line != null && d.snippet != null), `Source line missing for ${id}`);
    checked++;
  }
  async function good(src, opts = {}) {
    const r = L.exportBlock(win, src, opts);
    assert.deepStrictEqual(r.errors, [], `Unexpected errors: ${r.errors.join('\n')}`);
    assert(win.ino2ubiCompat.inspectGeneratedXml(r.xml).valid, 'SIXX references');
    const ubi = U.parseUbi(win, r.xml);
    const syntax = await U.cppSyntax(U.translationUnit(ubi));
    assert(syntax.ok, 'Generated C++ is not syntactically valid: ' + JSON.stringify(syntax.problems));
    checked += 3;
    return { ...r, ubi, sections: ubi.sections('display') };
  }
  const base = '/* Basic */\nbool inReady = false; // in\nbool outReady = false; // out\nvoid setup() {}\nvoid loop() { outReady = inReady; }';
  const withGlobal = text => base.replace('void setup()', text + '\nvoid setup()');
  const withLoop = text => base.replace('void loop() { outReady = inReady; }', text);

  await good(base);
  await good(base.replace('/* Basic */', '/* Documentation: \n #ifdef OFF \n #endif \n */'));

  // --- Conditional compilation (#ifdef) -------------------------------------------------------
  // Outside functions the generator would keep both branches and lose the condition: blocked, with a line.
  expectError(withGlobal('#ifdef ESP32'), 'CPP-CONDITION');
  expectError(withGlobal('#if defined(ESP32)\n#endif'), 'CPP-CONDITION');
  expectError(withGlobal('#ifndef FOO\n#define FOO\n#endif'), 'CPP-CONDITION');
  expectError(withGlobal('#ifdef ESP32'), 'CPP-CONDITION', false); // the block is wrong in both modes
  // Inside a function body the directives are copied verbatim (A-05): accepted with a review warning.
  {
    const src = withLoop('void loop() {\n#ifdef ESP32\n  outReady = inReady;\n#else\n  outReady = false;\n#endif\n}');
    const r = await good(src);
    assert(r.checks.warnings.some(w => w.includes('Условная компиляция')), 'in-function conditional must warn');
    assert(/#ifdef ESP32[\s\S]*#else[\s\S]*#endif/.test(r.sections.loop), 'directives must reach the generated loop verbatim:\n' + r.sections.loop);
    checked += 2;
  }

  // --- Macros, defaults, function pointers, unnamed parameters (relaxed for Professional) -------
  expectError(withGlobal('#define BROKEN 1 + \\\n  2'), 'CPP-MULTILINE');
  {
    const r = await good(withGlobal('#define ADD(x) ((x)+1)')); // C4: one-line function-like macro kept as the original directive
    assert(r.sections.declare.includes('#define ADD(x) ((x)+1)'), r.sections.declare);
    assert(r.checks.warnings.some(w => w.includes('Функциональный макрос')));
    const d = await good(withGlobal('int add(int a, int b=2) { return a+b; }')); // A-01: default stays only in the prototype
    assert(d.sections.declare.includes('int add_<UID>(int a, int b=2);'), d.sections.declare);
    assert(d.sections.declare.includes('int add_<UID>(int a, int b) {'), d.sections.declare);
    assert(d.checks.warnings.some(w => w.includes('параметры по умолчанию')));
    const f = await good(withGlobal('int apply(void (*fn)(int)) { return 0; }'));
    assert(f.checks.warnings.some(w => w.includes('требующие ручной проверки')));
    const u = await good(withGlobal('int compute(int) { return 1; }'));
    assert(u.sections.declare.includes('int compute_<UID>(int)'), u.sections.declare);
    checked += 7;
  }

  // --- Name collisions and reserved names -----------------------------------------------------
  expectError(withGlobal('int inReady(int a) { return a; }'), 'NAME-COLLISION');
  expectError(withGlobal('#define outReady value'), 'NAME-COLLISION');
  expectError(withGlobal('bool __ino2ubi_string_inReady = false; // variable'), 'NAME-RESERVED');

  // --- Initialisation inside loop() -----------------------------------------------------------
  expectError(withLoop('void loop() { BLEDevice::init(""); outReady = inReady; }'), 'INIT-LOOP');
  expectError(withLoop('void loop() { esp_now_init(); outReady = inReady; }'), 'INIT-LOOP');
  // A one-shot initialisation guarded by a state flag is legitimate.
  // (the flag is declared before setup(): a declaration between setup() and loop() is refused by the parser guard)
  await good(withGlobal('bool started=false; // variable').replace('void loop() { outReady = inReady; }', 'void loop() { if (!started) { esp_now_init(); started=true; } outReady=inReady; }'), { allowMultiple: false });

  // --- Callbacks touching FLProg contacts -----------------------------------------------------
  expectError(withGlobal('void onReceived(const uint8_t* mac, const uint8_t* data, int len) { outReady = true; }').replace('void setup() {}', 'void setup() { esp_now_register_recv_cb(onReceived); }'), 'CALLBACK-SCOPE');
  expectError(withGlobal('void onWifi(WiFiEvent_t e) { if (inReady) {} }').replace('void setup() {}', 'void setup() { WiFi.onEvent(onWifi); }'), 'CALLBACK-SCOPE');
  await good('/* Event */\nbool outReady = false; // out\nbool eventSeen = false; // variable\nvoid recv(const esp_now_recv_info_t* info, const uint8_t* buf, int len) { eventSeen = true; } /* Core 3.3.11 signature */\nvoid setup() { esp_now_register_recv_cb(recv); }\nvoid loop() { outReady = eventSeen; }', { allowMultiple: false });

  expectError(withGlobal('\x01'), 'XML-CHAR');

  // --- Declaration order (H3): dependent initialisers keep their source order ------------------
  {
    const r = await good(withGlobal('int threshold=2; // variable\nstatic int twice = threshold * 2; // variable'), { allowMultiple: false });
    const decl = r.sections.declare;
    assert(decl.indexOf('threshold_<UID> = 2') >= 0 && decl.indexOf('threshold_<UID> = 2') < decl.indexOf('static int twice'), decl);
    const a = await good(withGlobal('int threshold=2; // variable\nint table[2] = {threshold, 3}; // variable'), { allowMultiple: false });
    assert(a.sections.declare.indexOf('threshold_<UID> = 2') < a.sections.declare.indexOf('int table_<UID>[2]'), a.sections.declare);
    checked += 2;
    // Simple static globals are now UUID-isolated in multi mode.
    assert(!check(withGlobal('int threshold=2; // variable\nstatic int twice = threshold * 2; // variable'), true).errors.some(m => m.includes('Глобальная static')));
    // Primitive arrays are isolated per instance now: no error, and the initializer keeps its source order.
    assert(!check(withGlobal('int threshold=2; // variable\nint table[2] = {threshold, 3}; // variable'), true).errors.some(m => m.includes('Глобальный массив')));
    const multiArr = await good(withGlobal('int threshold=2; // variable\nint table[2] = {threshold, 3}; // variable'), { allowMultiple: true });
    assert(multiArr.sections.declare.includes('int table_<UID>[2] = {threshold_<UID>, 3};'), multiArr.sections.declare);
    checked += 3;
  }

  // --- requiresSingleInstance helper ----------------------------------------------------------
  const safety = win.ino2ubiConversionSafety;
  assert(safety.requiresSingleInstance('void setup(){esp_now_init();}', { ble_callbacks: [] }));
  assert(safety.requiresSingleInstance('void setup(){WiFi.begin("a","b");}', { ble_callbacks: [] }));
  assert(!safety.requiresSingleInstance(base, { ble_callbacks: [] }));
  assert(safety.requiresSingleInstance('void setup(){Wire.begin();}', { ble_callbacks: [] }));
  assert(safety.requiresSingleInstance('void setup(){SPI.begin();}', { ble_callbacks: [] }));
  checked += 5;

  // --- Numeric / bool / char / float parameters: no silent fallback to zero/false ---------------
  for (const [declaration, text] of [['bool P = maybe; // par', 'bool допускает только'], ['float P = 1/2; // par', 'конечное числовое значение'], ["char P = 'AB'; // par", 'Некорректное целочисленное']]) {
    const src = '/* Params */\n' + declaration + '\nvoid setup() {}\nvoid loop() {}';
    const r = check(src);
    assert(r.errors.some(e => e.includes(text)), declaration + ': ' + r.errors.join('; '));
    const diag = win.ino2ubiDiagnostics.enrich(src, { errors: r.errors }).find(d => d.message.includes(text));
    assert(diag && diag.line === 2, 'parameter error must point at its declaration line');
    assert(L.exportBlock(win, src).errors.length > 0, 'export must be blocked');
    checked += 3;
  }
  const n = win.ino2ubiNumberLiterals;
  assert.strictEqual(n.normalizeValue("'A'", 'char', 'esp32', 'C'), '65');
  assert.strictEqual(n.normalizeValue("'\\n'", 'char', 'esp32', 'C'), '10');
  assert.strictEqual(n.normalizeValue('1.25F', 'float', 'esp32', 'F'), '1.25');
  assert.strictEqual(n.normalizeValue('true', 'bool', 'esp32', 'B'), '1');
  checked += 4;

  // --- XML escaping and numeric defaults in the real .ubi -------------------------------------
  {
    const src = '/* String and XML */\nString P = "alpha&beta"; // par\nbool Enabled = true; // par\nchar Letter = \'A\'; // par\nfloat Ratio = 1.25F; // par\nvoid setup() {}\nvoid loop() { if (Enabled) { String x = P; } }';
    const r = await good(src);
    assert(r.xml.includes('alpha&amp;beta'), 'ampersand must be escaped');
    assert(r.xml.includes('>65</sixx.object>'), 'char default must be numeric');
    assert(r.xml.includes('>1.25</sixx.object>'), 'float suffix must be stripped');
    checked += 3;
  }

  // --- BLE class sketch: no BLE support in Code Professional => explicit rejection ---------------
  {
    const reference = fs.readFileSync(path.join(__dirname, 'ble_presence_reference.ino'), 'utf8');
    const r = check(reference);
    assert(r.errors.some(m => m.includes('enum/struct/class/union')), 'class declarations must be diagnosed, not dropped');
    assert(L.exportBlock(win, reference).errors.length > 0);
    checked += 2;
  }
  console.log(`PASS conversion regression: ${checked} checks`);
})().catch(error => { console.error(error); process.exit(1); });
