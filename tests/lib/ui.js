'use strict';
/* Drives the REAL index.html + app.js in jsdom (no browser is installed on the test machine):
 * types a sketch into the editor, ticks the two checkboxes, presses «Парсить код» / «Создать .ubi»
 * / «Сохранить проект», and captures the downloaded Blob. */
const path = require('path');
const { root } = require('./load.js');
const { JSDOM, ResourceLoader } = require(path.join(root, 'tests', 'tools', 'node_modules', 'jsdom'));

async function openApp() {
  const dom = await JSDOM.fromFile(path.join(root, 'index.html'), {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true
  });
  const win = dom.window;
  await new Promise(resolve => win.addEventListener('load', resolve));
  const downloads = [];
  win.URL.createObjectURL = blob => { downloads.push({ blob, name: null }); return 'blob:test-' + downloads.length; };
  win.URL.revokeObjectURL = () => {};
  // jsdom does not implement navigation/download: record the file name instead.
  win.HTMLAnchorElement.prototype.click = function () { const last = downloads[downloads.length - 1]; if (last && this.download) last.name = this.download; };
  const $ = id => win.document.getElementById(id);
  const readBlob = blob => new Promise((resolve, reject) => {
    const reader = new win.FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
  const api = {
    win, $, downloads,
    set code(text) { $('codeInput').value = text; },
    setBlockName(name) { $('blockName').value = name; },
    setEn(on) { const el = $('enableInput'); if (el.checked !== on) { el.checked = on; el.dispatchEvent(new win.Event('change', { bubbles: true })); } },
    setMultiple(on) { const el = $('allowMultipleInstances'); if (el.checked !== on) { el.checked = on; el.dispatchEvent(new win.Event('change', { bubbles: true })); } },
    parse() { $('btnParse').click(); },
    generate() { const before = downloads.length; $('btnGenerate').click(); return downloads.length > before ? downloads[downloads.length - 1] : null; },
    saveProject() { const before = downloads.length; $('btnSaveProject').click(); return downloads.length > before ? downloads[downloads.length - 1] : null; },
    status() { return { text: $('status').textContent, error: $('status').classList.contains('error') }; },
    diagnostics() { return $('esp32Diagnostics').textContent; },
    async readUbi(download) {
      const bytes = await readBlob(download.blob);
      if (bytes[0] !== 0xff || bytes[1] !== 0xfe) throw new Error('.ubi must start with a UTF-16LE BOM');
      return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    },
    async readText(download) { return new TextDecoder('utf-8').decode(await readBlob(download.blob)); },
    async openProjectFile(name, text) {
      const input = $('fileIno');
      const file = new win.File([text], name, { type: 'application/json' });
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new win.Event('change'));
      // app.js reads the file asynchronously: wait until the editor receives the saved code or an error status is shown.
      for (let i = 0; i < 100; i++) { await new Promise(r => setTimeout(r, 10)); if ($('status').textContent) break; }
    },
    close() { win.close(); }
  };
  return api;
}
module.exports = { openApp };
