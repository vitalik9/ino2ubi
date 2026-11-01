/* Arduino AVR preflight. Errors only. Does not replace an AVR compilation. */
(function(root){
 'use strict';
 const boards={uno:{label:'Arduino Uno (ATmega328P)',flash:32256,sram:2048,eeprom:1024,pins:20,pwm:[3,5,6,9,10,11]},nano:{label:'Arduino Nano (ATmega328P)',flash:30720,sram:2048,eeprom:1024,pins:22,pwm:[3,5,6,9,10,11]},mega:{label:'Arduino Mega 2560 (ATmega2560)',flash:253952,sram:8192,eeprom:4096,pins:70,pwm:[2,3,4,5,6,7,8,9,10,11,12,13,44,45,46]}};
 function mask(src){
  const s=String(src||'');let out='',mode='code',escaped=false;
  for(let i=0;i<s.length;i++){
   const c=s[i],n=s[i+1];
   if(mode==='line'){if(c==='\n'){out+='\n';mode='code';}else out+=' ';continue;}
   if(mode==='block'){if(c==='*'&&n==='/'){out+='  ';i++;mode='code';}else out+= c==='\n'?'\n':' ';continue;}
   if(mode==='string'||mode==='char'){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c===(mode==='string'? '"':"'"))mode='code';out+=c==='\n'?'\n':' ';continue;}
   if(c==='/'&&n==='/'){out+='  ';i++;mode='line';continue;}
   if(c==='/'&&n==='*'){out+='  ';i++;mode='block';continue;}
   if(c==='"'||c==="'"){mode=c==='"'?'string':'char';out+=' ';continue;}
   out+=c;
  }
  return out;
 }
 function check(code,board){
  const errors=[],clean=mask(code),cfg=boards[board]||boards.uno;
  function add(msg){if(!errors.includes(msg))errors.push(msg);}
  const espHeaders=/#\s*include\s*[<"](?:WiFi|WiFiMulti|WebServer|ESPAsyncWebServer|AsyncTCP|ESPmDNS|esp_now|esp_wifi|esp_system|esp_timer|driver\/ledc|Preferences|BluetoothSerial|NimBLEDevice|esp_task_wdt)\.h[>"]/g;
  for(const m of String(code).matchAll(espHeaders))add('Библиотека '+m[0].trim()+' относится к ESP32 и не поддерживается выбранной Arduino AVR.');
  for(const api of ['ledcSetup','ledcAttachPin','ledcWrite','ledcAttach','esp_now_init','esp_now_send','esp_now_register_recv_cb','timerBegin','timerAlarmWrite','timerAlarmEnable','timerAttachInterrupt','xTaskCreatePinnedToCore','psramFound','ESP.restart']){
   if(new RegExp('\\b'+api.replace('.','\\.')+'\\s*\\(').test(clean))add('Вызов '+api+'() относится к ESP32 API и недоступен на Arduino AVR.');
  }
  if(/\b(?:WiFi|ESP|Preferences|BluetoothSerial|WebServer|HTTPClient)\s*\./.test(clean))add('Обнаружено использование API, характерного для ESP32; проверьте совместимость с Arduino AVR.');
  const maxDigital=board==='mega'?69:board==='nano'?21:19;
  const calls=/\b(?:pinMode|digitalRead|digitalWrite|analogWrite|analogRead)\s*\(\s*(\d+)\s*[,)]/g;
  let m;while((m=calls.exec(clean))){const pin=Number(m[1]);if(pin>maxDigital)add('GPIO '+pin+' недоступен на '+cfg.label+' (проверьте физическую нумерацию и A0–Ax).');}
  if(board!=='mega'&&/\bSerial[1-3]\s*\./.test(clean))add('Serial1/Serial2/Serial3 доступны на Mega 2560, но не на Uno/Nano ATmega328P.');
  if(board==='mega'&&/\b(?:PCICR|PCMSK[0-2])\b/.test(clean))add('PCINT-регистры ATmega328P нельзя напрямую переносить на Mega 2560 без проверки.');
  if(board==='mega'&&/\b(?:TCCR0[AB]|TCCR1[AB]|TCCR2[AB])\b/.test(clean)){} // timers vary; no blanket error
  return {errors,warnings:[]};
 }
 root.ino2ubiAVR={boards,check};
})(typeof window!=='undefined'?window:globalThis);
