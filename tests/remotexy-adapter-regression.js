'use strict';
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const context = { console };
context.window = context;
let passed = 0;
context.ino2ubiProfessionalTemplate = '<template/>';
context.ino2ubiProfessional = { build(args) {
  assert.strictEqual(args.allowMultipleInstances, false);
  assert.strictEqual(args.enableInput, false);
  assert(args.state.global_includes.includes('#include <RemoteXY.h>'));
  assert(args.setupCode.includes('RemoteXYEngine.addGui'));
  assert(args.loopCode.includes('RemoteXYEngine.handler()'));
  return {xml:'<sixx/>', filename:'RemoteXY_Test', hpp:'', dependencies:[], warnings:[]};
}};
vm.runInNewContext(fs.readFileSync(require('path').join(__dirname,'..','remotexy.js'),'utf8'), context);
const config=[255,1,0,1,0,3,0,1,2,3];
const source=`#define REMOTEXY_MODE__ESP32CORE_WIFI\n#define REMOTEXY_SERVER_PORT 6377\n#include <RemoteXY.h>\nuint8_t const PROGMEM RemoteXY_CONF_PROGMEM[] = {${config.join(',')}};\nstruct {\n // input variables\n uint8_t button_01;\n // output variables\n uint8_t led_01;\n // other variable\n uint8_t connect_flag;\n} RemoteXY;`;
const parsed=context.parseRemoteXYWiFi(source);
assert.strictEqual(parsed.connection.mode,'wifi'); passed++;
const output=context.buildRemoteXYUbi(source,'RemoteXY Test');
assert.strictEqual(output.variables.button_01.role,'output');
assert.strictEqual(output.variables.led_01.role,'input');
assert.strictEqual(output.variables.connected.role,'output');
assert(output.loopCode.includes('button_01 = remoteXYBridgeData.rxyField_button_01')); passed++;
assert.throws(()=>context.parseRemoteXYWiFi(source.replace('1,0,1,0','2,0,1,0')),/размеры полей/); passed++;
assert.throws(()=>context.parseRemoteXYWiFi(source.replace('6377','70000')),/порт/); passed++;

// Extended 0xFE format: one complex notification with a two-byte heap descriptor.
const extended=[254,1,0,1,0,1,0,64,0,0,0,1,0,42];
const complexSource=source.replace(config.join(','),extended.join(','))
  .replace(' // other variable', ' // complex variables\n RemoteXYType_Notification notification_01;\n // other variable');
const complex=context.parseRemoteXYWiFi(complexSource);
assert.strictEqual(complex.sections.complex.length,1);
assert.strictEqual(complex.sections.complex[0].heapBytes,1024); passed++;
const notification=context.buildRemoteXYUbi(complexSource,'Notifications');
assert.strictEqual(notification.variables.notification_01_send.role,'input');
assert.strictEqual(notification.variables.notification_01_text.type,'String');
assert(notification.loopCode.includes('rxyField_notification_01.print'));
assert(notification.loopCode.includes('rxyField_notification_01.send()'));
assert(notification.loopCode.includes('!remoteXYBridgePrev_notification_01')); passed++;
assert.throws(()=>context.parseRemoteXYWiFi(complexSource.replace('64,0,0,0,1,0','64,0,1,0,1,0')),/раздел EEPROM|поврежд|неполный|размер/); passed++;
const terminalSource=complexSource.replace('RemoteXYType_Notification notification_01','RemoteXYType_Terminal terminal_01');
const terminalOut=context.buildRemoteXYUbi(terminalSource,'Terminal');
assert.strictEqual(terminalOut.variables.terminal_01_send.role,'input');
assert(terminalOut.loopCode.includes('remoteXYBridgeData.rxyField_terminal_01.print')); passed++;
const netSource=complexSource.replace('RemoteXYType_Notification notification_01','RemoteXYType_NotificationNet notification_01');
const netOut=context.buildRemoteXYUbi(netSource,'Net notification');
assert(netOut.state.global_includes.includes('#include <EEPROM.h>'));
assert(netOut.setupCode.includes('RemoteXYEngine.getEepromSize()')); passed++;
const timeConf=[254,1,0,1,0,1,0,0,0,1,0,42];
const timeSource=source.replace(config.join(','),timeConf.join(','))
  .replace(' // other variable', ' // complex variables\n RemoteXYType_RealTime realTime_01;\n // other variable');
const timeOut=context.buildRemoteXYUbi(timeSource,'Time');
assert.strictEqual(timeOut.variables.realTime_01_utc.role,'output');
assert(timeOut.loopCode.includes('.getUtcTimeStamp()')); passed++;

console.log(`PASS RemoteXY adapter ${passed} cases`);
