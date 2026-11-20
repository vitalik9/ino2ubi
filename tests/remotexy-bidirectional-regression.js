'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ctx = { console }; ctx.window=ctx;
ctx.ino2ubiProfessionalTemplate='<template/>';
ctx.ino2ubiProfessional={build(args){return {xml:'<sixx/>',filename:'rxy',hpp:'',dependencies:[],warnings:[]};}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','remotexy.js'),'utf8'),ctx);
const src=`#define REMOTEXY_MODE__WIFI_CLOUD
#define REMOTEXY_CLOUD_SERVER "cloud.remotexy.com"
#define REMOTEXY_CLOUD_PORT 6376
#define REMOTEXY_CLOUD_TOKEN "test-token"
#include <RemoteXY.h>
uint8_t const PROGMEM RemoteXY_CONF_PROGMEM[] = {254,11,0,0,0,2,0,8,0,0,0,77,0,21,0,0,0,0,31,1,106,200,1,1,6,0,194,14,49,20,20,0,1,26,31,13,10,24,40,10,77,6,94,26,193,44,49,20,20,6,1,7,60,23,40,10,110,64,2,26,2,2,7,6,86,40,10,110,64,2,26,2,2,2,56,80,44,22,0,2,26,31,31,79,78,0,79,70,70,0};
struct {
// input variables
uint8_t editTime_01_hour;
uint8_t editTime_01_minute;
float edit_01;
float edit_02;
uint8_t switch_01;
// complex variables
RemoteXYType_Notification notification_01;
RemoteXYType_RealTimeNet realTime_01;
} RemoteXY;`;
const b=ctx.buildRemoteXYUbi(src,'two-way',{bidirectional:true});
assert.equal(b.variables.switch_01.role,'output');
assert.equal(b.variables.switch_01_set.role,'input');
assert.equal(b.variables.switch_01_set.type,'bool');
assert.equal(b.variables.switch_01_apply.role,'input');
assert.equal(b.variables.edit_01_set.type,'float');
assert.equal(b.variables.editTime_01_hour_set.type,'byte');
assert(b.loopCode.includes('if (switch_01_apply && !remoteXYBridgePrevApply_switch_01) remoteXYBridgeData.rxyField_switch_01 = switch_01_set ? 1 : 0;'));
assert(b.loopCode.indexOf('RemoteXYEngine.handler()') < b.loopCode.indexOf('if (switch_01_apply'));
assert(b.loopCode.includes('remoteXYBridgePrevApply_switch_01 = switch_01_apply;'));
assert(b.loopCode.includes('edit_01 = remoteXYBridgeData.rxyField_edit_01;'));
assert(b.setupCode.includes('addConnectionCloud'));
assert.equal(b.exportedRemoteXYConfig.length,90);
const old=ctx.buildRemoteXYUbi(src,'old');
assert(!('switch_01_set' in old.variables));
assert(!old.loopCode.includes('remoteXYBridgePrevApply_switch_01'));
const smallConfig=[254,1,0,1,0,0,0,1,0,0,1,0,1,0,42];
const savedSrc=`#define REMOTEXY_MODE__WIFI_CLOUD
#define REMOTEXY_CLOUD_SERVER "cloud.remotexy.com"
#define REMOTEXY_CLOUD_PORT 6376
#define REMOTEXY_CLOUD_TOKEN "test-token"
#include <RemoteXY.h>
uint8_t const PROGMEM RemoteXY_CONF_PROGMEM[] = {${smallConfig.join(',')}};
struct {
// input variables
uint8_t switch_01;
// output variables
uint8_t led_01;
// other variable
uint8_t connect_flag;
} RemoteXY;`;
const saved=ctx.buildRemoteXYUbi(savedSrc,'two-way NVS',{bidirectional:true});
assert(saved.state.global_includes.includes('#include <Preferences.h>'));
assert(saved.setupCode.includes('remoteXYBridgePrefs.getBytes("f0"'));
assert(saved.loopCode.indexOf('if (switch_01_apply') < saved.loopCode.indexOf('if (remoteXYBridgePrefsReady)'));
assert(saved.loopCode.includes('remoteXYBridgePrefs.putBytes("f0"'));
console.log('PASS RemoteXY bidirectional NVS writes follow local Apply');
console.log('PASS RemoteXY bidirectional Apply edge, shared state, NVS, Cloud, legacy mode');
