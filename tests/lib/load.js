'use strict';
/* Shared test harness: loads the real browser scripts (the same list and order as index.html)
 * into a jsdom window so Code Professional generation (DOMParser/XMLSerializer) runs for real.
 * Dependencies live in tests/tools (npm install there). */
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.resolve(__dirname, '..', '..');
const tools = path.join(root, 'tests', 'tools', 'node_modules');
const { JSDOM } = require(path.join(tools, 'jsdom'));

function indexScripts() {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  return [...html.matchAll(/<script\s+src="([^"?]+)[^"]*"/g)].map(m => m[1]).filter(f => f !== 'app.js');
}
function loadWindow(files) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' });
  const ctx = dom.getInternalVMContext();
  for (const f of files)
    new vm.Script(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f }).runInContext(ctx);
  return dom.window;
}
/** Exactly what index.html ships to the browser. */
function loadProduction() { return loadWindow(indexScripts()); }

/** Mirrors app.js runChecks() so tests exercise the same validation path as the UI. */
function runChecks(win, code, parsed, enableInput, allowMultiple) {
  const compat = win.ino2ubiCompat, esp32 = win.ino2ubiEsp32;
  const conv = compat.validateConverterInput(code, parsed, enableInput, allowMultiple);
  const board = esp32.checkEsp32Core(code, parsed, '3.3.11');
  const api = win.ino2ubiFlprogApiAudit ? win.ino2ubiFlprogApiAudit.analyze(code) : { errors: [], warnings: [], infos: [] };
  const uniq = a => [...new Set(a)];
  return { errors: uniq([...conv.errors, ...board.errors, ...api.errors]),
           warnings: uniq([...conv.warnings, ...board.warnings, ...api.warnings]) };
}
/** Mirrors the btnGenerate handler of app.js. */
function exportBlock(win, code, { name = 'Test Block', enableInput = false, allowMultiple = true, state } = {}) {
  const parsed = state || win.parseArduinoCode(code);
  const checks = runChecks(win, code, parsed, enableInput, allowMultiple);
  if (checks.errors.length) return { checks, errors: checks.errors };
  const result = win.ino2ubiProfessional.build({
    template: win.ino2ubiProfessionalTemplate, name, description: '', state: parsed, source: code,
    enableInput, allowMultipleInstances: allowMultiple,
    setupCode: win.extractFunctionBody(code, 'setup'), loopCode: win.extractFunctionBody(code, 'loop'),
    additionalHeader: '', additionalHeaderFilename: ''
  });
  return { checks, errors: [], result, xml: result.xml, parsed };
}
module.exports = { root, loadWindow, loadProduction, indexScripts, runChecks, exportBlock };
