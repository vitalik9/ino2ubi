'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const context = { console }; context.window = context;
context.ino2ubiProfessionalTemplate = '<template/>';
context.ino2ubiProfessional = { build(args) { return {xml:'<sixx/>',filename:'RemoteXY_NVS',hpp:'',dependencies:[],warnings:[]}; }};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','remotexy.js'),'utf8'), context);
const config=[254,1,0,1,0,0,0,1,0,0,1,0,1,0,42];
const source=`#define REMOTEXY_MODE__ESP32CORE_WIFI_CLOUD
#define REMOTEXY_CLOUD_SERVER "cloud.remotexy.com"
#define REMOTEXY_CLOUD_PORT 6376
#define REMOTEXY_CLOUD_TOKEN "test-token"
#define REMOTEXY_WIFI_SSID "secret-network"
#define REMOTEXY_WIFI_PASSWORD "secret-password"
#include <RemoteXY.h>
uint8_t const PROGMEM RemoteXY_CONF_PROGMEM[] = {${config.join(',')}};
struct {
// input variables
uint8_t switch_01;
// output variables
uint8_t led_01;
// other variable
uint8_t connect_flag;
} RemoteXY;`;
const res=context.buildRemoteXYUbi(source,'Preferences test');
assert.deepStrictEqual(Array.from(res.data.eeprom.savedFields),['switch_01']);
assert(res.state.global_includes.includes('#include <Preferences.h>'));
assert(!res.state.global_includes.includes('#include <EEPROM.h>'));
assert.deepStrictEqual(Array.from(res.exportedRemoteXYConfig), [254,1,0,1,0,0,0,0,0,1,0,42]);
assert(res.setupCode.includes('remoteXYBridgePrefs.begin("rxy-state", false)'));
assert(!res.setupCode.includes('RemoteXYEngine.initEeprom();'));
assert(res.setupCode.includes('remoteXYBridgePrefs.getBytes("f0", &remoteXYBridgeData.rxyField_switch_01, 1)'));
assert(res.loopCode.includes('memcmp(remoteXYBridgeSaved_0, &remoteXYBridgeData.rxyField_switch_01, 1)'));
assert(res.loopCode.includes('remoteXYBridgePrefs.putBytes("f0", &remoteXYBridgeData.rxyField_switch_01, 1)'));
assert(res.loopCode.includes('>= 1000UL'));
assert(!res.setupCode.includes('WiFi.begin('));
assert(!res.setupCode.includes('secret-network'));
assert(!res.setupCode.includes('secret-password'));
assert(res.setupCode.includes('addConnectionCloud'));
assert.strictEqual(res.variables.remoteXYCloudPort.role,'parameter');
assert(!res.state.variables.remoteXYCloudToken.default.includes('secret-password'));
const withoutSave = [...config]; withoutSave.splice(7,5,0,0); // zero descriptors, still 1-byte GUI
const plain=context.buildRemoteXYUbi(source.replace(config.join(','),withoutSave.join(',')),'No saved fields');
assert(!plain.state.global_includes.includes('#include <Preferences.h>'));
assert(!plain.setupCode.includes('remoteXYBridgePrefs'));
console.log('PASS RemoteXY NVS persistence and Cloud isolation');

// NotificationNet must retain the complex-field descriptor and its internal EEPROM
// initialization while removing only saved GUI descriptors.
const netConfig=[254,1,0,1,0,1,0,64,0,1,0,0,1,0,1,0,42];
const netSource=source.replace(config.join(','),netConfig.join(','))
  .replace('// other variable', '// complex variables\nRemoteXYType_NotificationNet push_01;\n// other variable');
const net=context.buildRemoteXYUbi(netSource,'Cloud notification and saved switch');
assert(net.state.global_includes.includes('#include <EEPROM.h>'));
assert(net.state.global_includes.indexOf('#include <EEPROM.h>') < net.state.global_includes.indexOf('#include <RemoteXY.h>'), 'EEPROM.h must precede RemoteXY.h to set REMOTEXY_HAS_EEPROM');
assert(net.state.extra_declarations[0].includes('#pragma pack(push, 1)'));
assert(net.state.extra_declarations[0].includes('#pragma pack(pop)'));
assert(!net.state.extra_declarations[0].includes('__attribute__((packed))')); 
assert(net.setupCode.includes('RemoteXYEngine.initEeprom();'));
assert(net.setupCode.indexOf('RemoteXYEngine.initEeprom()') < net.setupCode.indexOf('remoteXYBridgePrefs.getBytes'));
assert.deepStrictEqual(Array.from(net.exportedRemoteXYConfig), [254,1,0,1,0,1,0,64,0,0,0,1,0,42]);
assert(net.loopCode.includes('push_01.send()'));
assert(net.setupCode.includes('addConnectionCloud'));
console.log('PASS RemoteXY NotificationNet service EEPROM retained and GUI EEPROM removed');
