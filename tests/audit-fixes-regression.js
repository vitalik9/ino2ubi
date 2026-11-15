'use strict';
/* Regression tests for the audit fixes (A-xx) and for qualifier handling (const / volatile).
 * Runs the production script bundle (index.html order) in jsdom: node tests/audit-fixes-regression.js */
const assert = require('assert');
const L = require('./lib/load.js');
const U = require('./lib/ubi.js');

(async () => {
  const win = L.loadProduction();
  let checks = 0;
  const suffix = '\nvoid setup() {}\nvoid loop() {}';
  const audit = (src, multi = true) => {
    const parsed = win.parseArduinoCode(src);
    return { parsed, issues: win.ino2ubiCompat.validateConverterInput(src, parsed, false, multi).errors };
  };

  // 1. Declarations the converter cannot represent must be REJECTED, never silently dropped.
  for (const source of [
    'char* name = "abc";', 'uint8_t* buf;', 'int *ptr = nullptr;',
    'unsigned long long big = 5000000000ULL;', 'long long big = 5000000000LL;',
    'unsigned int cnt = 0; // out', 'size_t count = 0; // par: Счетчик',
    'uint64_t big = 0; // variable', 'int8_t a = 0; // in'
  ]) {
    for (const multi of [true, false]) {
      const { issues } = audit(source + suffix, multi);
      assert(issues.length > 0, `Declaration was silently accepted (multi=${multi}): ${source}`);
      checks++;
    }
  }

  // 2. const / volatile globals ARE supported: the qualifier must survive into the generated C++
  //    (a lost `volatile` lets the compiler cache an ISR-shared flag). Every spelling is covered,
  //    including qualifiers written AFTER the type, which the parser used to drop silently.
  const qualified = [
    ['volatile bool flag = false;', 'volatile bool flag_<UID> = false;'],
    ['const int N = 5;', 'const int N_<UID> = 5;'],
    ['bool volatile flag = false;', 'volatile bool flag_<UID> = false;'],
    ['int const N = 5;', 'const int N_<UID> = 5;'],
    ['unsigned long volatile ticks = 0;', 'volatile unsigned long ticks_<UID> = 0;'],
    ['volatile unsigned long ticks = 0;', 'volatile unsigned long ticks_<UID> = 0;'],
    ['const volatile int status = 1;', 'const volatile int status_<UID> = 1;'],
    ['volatile  bool  spaced  =  true;', 'volatile bool spaced_<UID> = true;'],
    ['volatile int a = 1, b = 2;', 'volatile int a_<UID> = 1;\nvolatile int b_<UID> = 2;']
  ];
  for (const [declaration, expected] of qualified) {
    for (const multi of [true, false]) {
      const src = declaration + '\nint out1 = 0; // out\nvoid setup() {}\nvoid loop() { out1 = 1; }';
      const r = L.exportBlock(win, src, { allowMultiple: multi });
      assert.deepStrictEqual(r.errors, [], `${declaration} (multi=${multi}) must be accepted: ${r.errors.join('; ')}`);
      const ubi = U.parseUbi(win, r.xml);
      assert(ubi.sections('display').declare.includes(expected), `${declaration} -> expected "${expected}" in:\n${ubi.sections('display').declare}`);
      const syntax = await U.cppSyntax(U.translationUnit(ubi));
      assert(syntax.ok, `${declaration}: generated C++ is not syntactically valid: ${JSON.stringify(syntax.problems)}`);
      checks += 3;
    }
  }
  // 2b. A FLProg contact/parameter cannot carry const/volatile: rejected with a clear message.
  for (const role of ['in', 'out', 'par']) {
    for (const decl of ['volatile bool v = false;', 'bool volatile v = false;', 'const int v = 1;']) {
      const { issues } = audit(`${decl} // ${role}${suffix}`);
      assert(issues.some(m => m.includes('квалификаторы const/volatile/static')), `${decl} // ${role}: ${issues.join('; ')}`);
      checks++;
    }
  }

  // 3. Infinite loops are reported.
  for (const source of ['void loop(){ while(true){} }', 'void loop(){ while(1){} }', 'void loop(){ for(;;){} }']) {
    const compat = win.ino2ubiCompat;
    const full = 'void setup(){}\n' + source;
    const parsed = win.parseArduinoCode(full);
    const result = compat.validateConverterInput(full, parsed, false, true);
    const messages = [...result.errors, ...result.warnings];
    assert(messages.some(x => x.includes('бесконечный цикл') || x.includes('Бесконечный цикл') || x.includes('постоянное истинное')), source + ': ' + messages);
    checks++;
  }

  // 4. setup(void)/loop(void) are accepted and extracted.
  {
    const src = 'bool ok = false; // out\nvoid setup(void){}\nvoid loop(void){ok=true;}';
    const r = audit(src);
    assert.strictEqual(r.issues.length, 0, r.issues.join('; '));
    assert.strictEqual(win.extractFunctionBody(src, 'loop'), 'ok=true;');
    checks++;
  }
  // 5. Template objects are kept as declarations (not dropped).
  {
    const src = 'std::array<int, 3> arr;\nvoid setup(){}\nvoid loop(){}';
    const p = audit(src).parsed;
    assert(p.extra_declarations.some(x => x.includes('std::array<int, 3> arr')), JSON.stringify(p));
    checks++;
  }
  console.log('PASS audit fixes: ' + checks + ' checks');
})().catch(error => { console.error(error); process.exit(1); });
