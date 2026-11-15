'use strict';
/* Helpers that look INSIDE a generated .ubi (SIXX XML) instead of grepping strings:
 *  - parseUbi():  isUseItOnce flag, contacts, parameters and the C++ of every code section,
 *                 with FLProg tags rendered either for display (<UID>, <IO:En>, <PAR:x>) or as
 *                 plain identifiers so the result is a syntactically valid translation unit;
 *  - cppSyntax(): real C++ grammar check (tree-sitter-cpp, WebAssembly) of that translation unit;
 *  - topLevelNames(): names declared at file scope, to prove that several instances can coexist.
 * There is no C++ compiler on the test machine, so this is a SYNTAX check: types, includes and
 * library APIs are not resolved. */
const path = require('path');
const { root } = require('./load.js');
const tools = path.join(root, 'tests', 'tools', 'node_modules');

const child = (node, name) => Array.from(node.children).find(n => n.getAttribute('sixx.name') === name) || null;

function parseUbi(win, xml) {
  const doc = new win.DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('XML is not well-formed');
  const all = Array.from(doc.getElementsByTagName('sixx.object'));
  const byId = new Map(all.filter(e => e.getAttribute('sixx.id')).map(e => [e.getAttribute('sixx.id'), e]));
  const resolve = e => (e && e.getAttribute('sixx.idref')) ? byId.get(e.getAttribute('sixx.idref')) : e;
  const inst = all.find(e => e.getAttribute('sixx.type') === 'UserCodeMultiBlockBlockInstance');
  const typeName = el => {
    const t = resolve(child(el, 'type'));
    return t ? String(t.getAttribute('sixx.type') || '').replace(/ class$/, '') : null;
  };
  const text = (el, n) => { const c = child(el, n); return c ? c.textContent : null; };
  const contacts = lib => Array.from(child(inst, lib).querySelector('[sixx\\.name="items"]').children)
    .map(resolve).map(e => ({ name: text(e, 'name'), label: text(e, 'label'), type: typeName(e) }));
  const params = [];
  for (const e of all) if (e.getAttribute('sixx.type') === 'UserCodeMultiBlockStandartParametr')
    params.push({ name: text(e, 'name'), type: typeName(e) });

  function render(codeText, mode) {
    let out = '';
    for (const piece of Array.from(codeText.children)) {
      const kind = text(piece, 'type');
      const value = child(piece, 'value');
      if (kind === 'plainText') { out += value.textContent; continue; }
      const tag = resolve(value), tagType = tag.getAttribute('sixx.type');
      const target = resolve(child(tag, 'object'));
      if (/UUIDTag$/.test(tagType)) out += mode === 'display' ? '<UID>' : '_UID';
      else if (/InputOutputTag$/.test(tagType)) out += mode === 'display' ? '<IO:' + text(target, 'name') + '>' : 'io_' + text(target, 'name');
      else if (/ParametrTag$/.test(tagType)) out += mode === 'display' ? '<PAR:' + text(target, 'name') + '>' : 'par_' + text(target, 'name');
      else throw new Error('Unknown code tag ' + tagType);
    }
    return out;
  }
  const codeData = child(inst, 'codeData');
  function section(name, mode = 'syntax') {
    const sec = child(codeData, name + 'Section');
    const parts = [];
    for (const holder of Array.from(sec.children))
      for (const items of Array.from(holder.children).filter(c => c.getAttribute('sixx.name') === 'items'))
        for (const part of Array.from(items.children).filter(c => c.getAttribute('sixx.type') === 'UserCodeMultiBlockCodePartsInstance'))
          parts.push(render(child(part, 'codeText'), mode));
    return parts.join('\n');
  }
  const flag = child(inst, 'isUseItOnce');
  return {
    doc, inst,
    isUseItOnce: flag.getAttribute('sixx.type') === 'True',
    isUseItOnceType: flag.getAttribute('sixx.type'),
    inputs: contacts('inputsLibrary'), outputs: contacts('outputsLibrary'), params,
    name: text(inst, 'name'),
    section,
    sections: mode => ({ declare: section('declare', mode), setup: section('setup', mode), loop: section('loop', mode), function: section('function', mode) })
  };
}

/** One translation unit as FLProg would assemble it for a given instance suffix. */
function translationUnit(ubi, uid = '_UID') {
  const s = ubi.sections('syntax');
  const u = t => t.split('_UID').join(uid);
  const text = u(s.declare) + '\n\n' + u(s.function) + '\nvoid __setup' + uid + '()\n' + u(s.setup) + '\nvoid __loop' + uid + '()\n' + u(s.loop) + '\n';
  // ESP-IDF/Arduino attribute macros are not part of the C++ grammar; the real preprocessor removes them.
  return text.replace(/\b(?:IRAM_ATTR|ICACHE_RAM_ATTR|DRAM_ATTR|RTC_DATA_ATTR|RTC_IRAM_ATTR|PROGMEM)\b/g, '');
}

let parserPromise = null;
function getParser() {
  if (!parserPromise) parserPromise = (async () => {
    const Parser = require(path.join(tools, 'web-tree-sitter'));
    await Parser.init();
    const lang = await Parser.Language.load(path.join(tools, 'tree-sitter-wasms', 'out', 'tree-sitter-cpp.wasm'));
    const parser = new Parser();
    parser.setLanguage(lang);
    return parser;
  })();
  return parserPromise;
}
async function cppSyntax(source) {
  const parser = await getParser();
  const tree = parser.parse(source);
  const problems = [];
  (function walk(n) {
    if (n.type === 'ERROR' || (typeof n.isMissing === 'function' ? n.isMissing() : n.isMissing)) problems.push({ line: n.startPosition.row + 1, text: source.split('\n')[n.startPosition.row].trim().slice(0, 120), kind: n.type });
    for (let i = 0; i < n.childCount; i++) walk(n.child(i));
  })(tree.rootNode);
  return { ok: problems.length === 0, problems, tree };
}
function declaredIn(node) {
  // identifiers introduced by a declaration/function definition at this level
  const names = [];
  const dig = d => {
    if (!d) return;
    if (d.type === 'identifier' || d.type === 'field_identifier') { names.push(d.text); return; }
    if (['init_declarator', 'array_declarator', 'pointer_declarator', 'reference_declarator', 'function_declarator', 'parenthesized_declarator'].includes(d.type))
      return dig(d.childForFieldName('declarator') || d.namedChild(0));
  };
  if (node.type === 'function_definition') dig(node.childForFieldName('declarator'));
  else if (node.type === 'declaration') {
    for (const f of node.childrenForFieldName('declarator')) dig(f);
  }
  return names;
}
async function topLevelNames(source) {
  const { tree } = await cppSyntax(source);
  const names = new Set();
  for (const n of tree.rootNode.namedChildren) for (const name of declaredIn(n)) names.add(name);
  return names;
}
module.exports = { parseUbi, translationUnit, cppSyntax, topLevelNames };
