'use strict';
// Regression for a real RemoteXY V21 GUI: EditTime + Notification + RealTimeNet.
// The Cloud token is deliberately a nonfunctional fixture value.
const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path');
const ctx = {console}; ctx.window = ctx;
ctx.ino2ubiProfessionalTemplate = '<template/>';
ctx.ino2ubiProfessional = {build(args) {
  assert(args.state.extra_declarations.some(s=>s.includes('rxyField_editTime_01_hour')));
  assert(args.state.extra_declarations.some(s=>s.includes('rxyField_editTime_01_minute')));
  assert(args.state.extra_declarations.some(s=>s.includes('RemoteXYType_Notification rxyField_notification_01')));
  assert(args.state.extra_declarations.some(s=>s.includes('RemoteXYType_RealTimeNet rxyField_realTime_01')));
  assert(!args.state.extra_declarations.some(s=>/\seditTime_01_hour\s*;/.test(s)));
  assert(args.loopCode.includes('editTime_01_hour = remoteXYBridgeData.rxyField_editTime_01_hour;'));
  assert(args.loopCode.includes('editTime_01_minute = remoteXYBridgeData.rxyField_editTime_01_minute;'));
  assert(args.loopCode.includes('remoteXYBridgeData.rxyField_notification_01.send()'));
  assert(args.loopCode.includes('remoteXYBridgeData.rxyField_realTime_01.getUtcTimeStamp()'));
  assert(args.setupCode.includes('addConnectionCloud'));
  assert(!args.setupCode.includes('WiFi.begin('));
  assert(!args.setupCode.includes('remoteXYCloudPort <= 65535'));
  return {xml:'<sixx/>',filename:'V21',hpp:''};
}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','remotexy.js'),'utf8'),ctx);
const conf=[254,2,0,0,0,2,0,8,0,0,0,38,0,21,0,0,0,0,31,1,106,200,1,1,3,0,194,14,49,20,20,0,1,26,31,13,10,24,40,10,77,6,94,26,193,21,93,20,20,6,1];
assert.strictEqual(conf.length,51);
const source=`#define REMOTEXY_MODE__WIFI_CLOUD
#include <WiFi.h>
#define REMOTEXY_WIFI_SSID "YOUR_SSID"
#define REMOTEXY_WIFI_PASSWORD "YOUR_PASS"
#define REMOTEXY_CLOUD_SERVER "cloud.remotexy.com"
#define REMOTEXY_CLOUD_PORT 6376
#define REMOTEXY_CLOUD_TOKEN "FIXTURE_DO_NOT_USE"
#include <RemoteXY.h>
#pragma pack(push,1)
uint8_t const PROGMEM RemoteXY_CONF_PROGMEM[] = {${conf.join(',')}};
struct {
 // input variables
 uint8_t editTime_01_hour;
 uint8_t editTime_01_minute;
 // complex variables
 RemoteXYType_Notification notification_01;
 RemoteXYType_RealTimeNet realTime_01;
} RemoteXY;
#pragma pack(pop)`;
const parsed=ctx.parseRemoteXYWiFi(source);
assert.strictEqual(parsed.bytes.length,51);
assert.strictEqual(parsed.sections.input.length,2);
assert.strictEqual(parsed.sections.complex.length,2);
const built=ctx.buildRemoteXYUbi(source,'RemoteXY Edit Time');
assert.strictEqual(built.exportedRemoteXYConfig.length,51);
assert(built.state.extra_declarations[0].includes('#pragma pack(push, 1)'));
assert(built.state.extra_declarations[0].includes('#pragma pack(pop)'));
assert(!built.state.extra_declarations[0].includes('__attribute__((packed))'));
assert(!built.state.global_includes.includes('#include <EEPROM.h>'), 'ordinary Notification should not initialize service EEPROM');
assert.strictEqual(built.variables.editTime_01_hour.role,'output');
assert.strictEqual(built.variables.editTime_01_minute.role,'output');
assert.strictEqual(built.variables.realTime_01_utc.role,'output');
assert.strictEqual(built.variables.notification_01_send.role,'input');
assert(!built.state.extra_declarations[0].includes('FIXTURE_DO_NOT_USE'));
console.log('PASS RemoteXY V21 EditTime + Notification + RealTimeNet (51 bytes)');
