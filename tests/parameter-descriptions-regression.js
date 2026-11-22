'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const ctx = { window: {}, PRIMITIVE_TYPES: new Set(['float','int','uint8_t','bool','String']) };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'parser.js'),'utf8'), ctx);
const parse = code => ctx.window.parseArduinoCode(code);
const sample = `/*\nНазвание блока: Params\n*/
float bedLengthM = 4.0f; // par: Длина грядки, м | description: Используется для расчёта площади дождя и испарения.
uint8_t mode = 1; // par: Режим работы | choices: 0=Выкл; 1=Авто | description: Выберите режим.
int cycles = 2; // par: Количество циклов | description: Количество повторений. | choices: 1=Один; 2=Два
float original = 1.0f; // par: SimpleLabel
void setup() {}
void loop() {}
`;
const vars=parse(sample).variables;
assert.strictEqual(vars.bedLengthM.alias,'Длина грядки, м');
assert.strictEqual(vars.bedLengthM.description,'Используется для расчёта площади дождя и испарения.');
assert.strictEqual(vars.mode.description,'Выберите режим.');
assert.strictEqual(vars.mode.choices.length,2);
assert.strictEqual(vars.cycles.choices[1].label,'Два');
assert.strictEqual(vars.original.alias,'SimpleLabel');
assert.strictEqual(vars.original.description,'');
console.log('PASS parameter metadata: unicode labels, descriptions, choices in both orders, legacy syntax');
