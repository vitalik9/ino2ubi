'use strict';
/* Every sketch in examples/ and tests/*.ino goes through the production pipeline in all four
 * setting combinations. Invariants (not a hand-maintained table of results):
 *   - the pipeline never throws;
 *   - a sketch is either REFUSED with located diagnostics, or exported to a well-formed .ubi whose
 *     isUseItOnce / En input match the settings and whose C++ is syntactically valid;
 *   - a refusal never depends on En alone (En is only a wrapper around Loop).
 * Run: node tests/examples-regression.js */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const L = require('./lib/load.js');
const U = require('./lib/ubi.js');

(async () => {
  const win = L.loadProduction();
  const files = [
    ...fs.readdirSync(path.join(L.root, 'examples')).filter(f => f.endsWith('.ino')).map(f => path.join('examples', f)),
    ...fs.readdirSync(path.join(L.root, 'tests')).filter(f => f.endsWith('.ino')).map(f => path.join('tests', f))
  ];
  let exported = 0, refused = 0;
  for (const file of files) {
    const code = fs.readFileSync(path.join(L.root, file), 'utf8');
    const outcomeByMode = {};
    for (const multi of [true, false]) for (const en of [false, true]) {
      const tag = `${file} [multi=${multi}, En=${en}]`;
      let r;
      try { r = L.exportBlock(win, code, { enableInput: en, allowMultiple: multi }); }
      catch (error) { r = { errors: [error.message] }; } // a generator refusal (thrown message) is a refusal too
      if (r.errors.length) {
        refused++;
        const located = win.ino2ubiDiagnostics.enrich(code, { errors: r.errors });
        assert(located.every(d => d.message && typeof d.advice === 'string'), `${tag}: malformed diagnostics`);
      } else {
        exported++;
        const ubi = U.parseUbi(win, r.xml);
        assert.strictEqual(ubi.isUseItOnce, !multi, `${tag}: isUseItOnce`);
        assert.strictEqual(ubi.inputs.some(i => i.name === 'En'), en, `${tag}: En input`);
        assert(win.ino2ubiCompat.inspectGeneratedXml(r.xml).valid, `${tag}: SIXX references`);
        const syntax = await U.cppSyntax(U.translationUnit(ubi));
        assert(syntax.ok, `${tag}: C++ syntax ${JSON.stringify(syntax.problems)}`);
      }
      (outcomeByMode[multi] = outcomeByMode[multi] || {})[en] = !r.errors.length;
    }
    for (const multi of [true, false])
      assert.strictEqual(outcomeByMode[multi][false], outcomeByMode[multi][true], `${file}: En alone must not change acceptance (multi=${multi})`);
  }
  assert(exported > 0 && refused > 0, 'the corpus must contain both accepted and refused sketches');
  console.log(`PASS examples: ${files.length} sketches x 4 combinations -> ${exported} exported (valid C++), ${refused} refused with diagnostics`);
})().catch(error => { console.error(error); process.exit(1); });
