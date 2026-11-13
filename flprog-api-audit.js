/* FIX33: source-backed, non-mutating API checks.
 * Reference: libraries.rar supplied by user. Static checks are NOT compilation.
 */
(function(root){
 'use strict';
 function mask(code){
  // Keep length/offsets, mask C++ comments and literals to avoid false positives.
  let out='',i=0,state='code';
  while(i<code.length){
   const c=code[i],n=code[i+1];
   if(state==='line'){if(c==='\n'){out+='\n';state='code';}else out+=' ';i++;continue;}
   if(state==='block'){if(c==='*'&&n==='/'){out+='  ';i+=2;state='code';}else{out+=c==='\n'?'\n':' ';i++;}continue;}
   if(state==='string'||state==='char'){if(c==='\\'){out+='  ';i+=Math.min(2,code.length-i);continue;}if((state==='string'&&c==='"')||(state==='char'&&c==="'"))state='code';out+=c==='\n'?'\n':' ';i++;continue;}
   if(c==='/'&&n==='/'){out+='  ';i+=2;state='line';continue;}
   if(c==='/'&&n==='*'){out+='  ';i+=2;state='block';continue;}
   if(c==='"'||c==="'"){state=c==='"'?'string':'char';out+=' ';i++;continue;}
   out+=c;i++;
  }
  return out;
 }
 function analyze(source){
  const original=String(source||''), clean=mask(original), warnings=[],errors=[],infos=[];
  const includes=new Set([...original.matchAll(/^\s*#\s*include\s*[<"]([^>"]+)[>"]/gm)].map(x=>x[1].toLowerCase()));
  function add(msg){if(!warnings.includes(msg))warnings.push(msg);}
  const hints=[
   {type:'FlprogHardwarePwmPin',header:'flprogHardwarePwm.h',library:'Flprog_HardwarePWM'},
   {type:'ModbusRTU',header:'flprogModbusRTU.h',library:'Flprog_Modbus'},
   {type:'ModbusTCP',header:'flprogModbusTCP.h',library:'Flprog_Modbus'}
  ];
  for(const t of hints){
    const typeRe=new RegExp('\\b'+t.type+'\\b');
    if(typeRe.test(clean)&&!includes.has(t.header.toLowerCase()))
      add('Используется '+t.type+', но нет явного #include <'+t.header+'> (архив: '+t.library+'). Проверьте транзитивные подключения в вашей версии FLProg.');
  }
  // Known signatures from public class declarations in the supplied sources.
  // Restrict method warnings to variables with a proven declared class type.
  const classes=[
   {type:'FlprogHardwarePwmPin',bad:{setDuty:'pwmWrite(uint16_t)',setDutyCycle:'pwmWrite(uint16_t)',setFrequency:'setMaxPwmValue(uint16_t) меняет число тиков, а не частоту таймера',begin:'конструктор FlprogHardwarePwmPin(pin, maxPwmValue) и tick()'}},
   {type:'ModbusRTU',bad:{setBaudRate:'setSpeedUart(uint32_t)',setBaud:'setSpeedUart(uint32_t)'}}
  ];
  for(const cls of classes){
   const declaration=new RegExp('\\b'+cls.type+'\\s+([A-Za-z_]\\w*)\\s*(?=[;=(])','g');
   let m;
   while((m=declaration.exec(clean))){
    const variable=m[1];
    for(const [method,replacement] of Object.entries(cls.bad)){
     const badCall=new RegExp('\\b'+variable+'\\s*\\.\\s*'+method+'\\s*\\(');
     if(badCall.test(clean))add(cls.type+' '+variable+'.'+method+'(): метод не объявлен в API предоставленной библиотеки. Проверьте '+replacement+'.');
    }
   }
  }
  // FIX35: interfaces verified against flprogESP32SystemHardwareTimer.h/.cpp.
  // The library exposes a single timer/ISR callback for all users of this API.
  const hwApi = /\b(?:initFlprogSystemTimer|setFlprogSystemTimerTickPeriod|getFlprogSystemTimerTickPeriod)\s*\(/;
  if (hwApi.test(clean)) {
    if (!includes.has('flprogsystemhardwaretimer.h'))
      add('Используется initFlprogSystemTimer()/API аппаратного таймера, но нет явного #include <flprogSystemHardwareTimer.h>. Проверьте подключение библиотеки Flprog_HardwareTimer.');
    infos.push('Flprog_HardwareTimer ESP32: один общий hw_timer_t и один callback; два экземпляра блока не получают два независимых таймера.');
    infos.push('Flprog_HardwareTimer: период задаётся в микросекундах, минимум 10 мкс; функция обратного вызова исполняется из ISR и должна быть ISR-safe.');
    // Global periodicity and replacement are NOT safe to infer as multi-instance ownership.
    const initCalls=[...clean.matchAll(/\binitFlprogSystemTimer\s*\(/g)];
    if (initCalls.length > 1)
      add('Несколько вызовов initFlprogSystemTimer(): библиотека хранит один общий обработчик; повторная инициализация заменяет callback. Нужен один владелец таймера.');
    // No function-pointer argument implies inability to register a real ISR callback.
    if (/\binitFlprogSystemTimer\s*\(\s*\)/.test(clean))
      add('initFlprogSystemTimer(): требуется один аргумент — указатель на ISR callback либо nullptr для остановки.');
    if (/\bsetFlprogSystemTimerTickPeriod\s*\(\s*\)/.test(clean))
      add('setFlprogSystemTimerTickPeriod(): необходим период в микросекундах.');
    const badPeriods=[...clean.matchAll(/\bsetFlprogSystemTimerTickPeriod\s*\(\s*(\d+)(?:[uUlL]*)\s*\)/g)];
    for(const item of badPeriods){
      const period=BigInt(item[1]);
      if(period>4294967295n) add('setFlprogSystemTimerTickPeriod('+item[1]+'): число превышает диапазон uint32_t, значение будет искажено при передаче.');
      else if(period<10n) add('setFlprogSystemTimerTickPeriod('+item[1]+'): библиотека ограничивает период минимумом 10 мкс.');
    }
    // Only direct bare function identifiers are checked. Pointers provided via
    // variables, qualified names, macros and external headers remain unjudged.
    const cbCalls=[...clean.matchAll(/\binitFlprogSystemTimer\s*\(\s*(&?)([A-Za-z_]\w*)\s*\)/g)];
    for(const cb of cbCalls){
      const name=cb[2];
      if(name==='nullptr'||name==='NULL') continue;
      const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      const declared=new RegExp('\\bvoid\\s+(?:IRAM_ATTR\\s+)?'+escaped+'\\s*\\(\\s*(?:void\\s*)?\\)').test(clean);
      if(!declared) add('initFlprogSystemTimer('+name+'): callback void '+name+'() не найден в исходном скетче; если он определён во внешнем заголовке, проверьте это вручную.');
    }
    infos.push('Предупреждение компилятора IRAM_ATTR о конфликте секций в flprogESP32SystemHardwareTimer.cpp относится к библиотеке, а не к коду .ubi; совместимость исполнения ISR требует проверки на оборудовании.');
  }
  if(/\bflprog\s*::\s*specialPoll\s*\(/.test(clean))
   add('flprog::specialPoll(): в заголовке flprogUtilites.h объявлен specialPool() (с одним l), проверьте название.');
  if(/\bFlprogHardwarePwmPin\b/.test(clean)) {
   infos.push('FlprogHardwarePwmPin: программный PWM с tick(); автоматический таймер в загруженной библиотеке реализован для STM32, на ESP32 требуется внешний источник периодических tick().');
   // A bare object only receives a useful PWM waveform when tick() is driven
   // periodically. Calls in external headers cannot be reliably inferred.
   const directObjects=[...clean.matchAll(/\bFlprogHardwarePwmPin\s+([A-Za-z_]\w*)\s*\(/g)];
   for(const obj of directObjects) {
     const name=obj[1];
     const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
     if(!new RegExp('\\b'+escaped+'\\s*\\.\\s*tick\\s*\\\(').test(clean))
       add('FlprogHardwarePwmPin '+name+': вызов tick() в скетче не найден; на ESP32 нужен периодический источник тактов для программного PWM (внешняя реализация требует ручной проверки).');
   }
  }
  // ModbusRTU declares pure virtual methods and cannot be constructed directly.
  // A pointer/reference to ModbusRTU remains valid; only direct object forms are flagged.
  if(/\bModbusRTU\s+[A-Za-z_]\w*\s*(?:[;=(])/.test(clean))
    add('ModbusRTU: абстрактный класс нельзя создать как объект; используйте конкретный ModbusMasterRTU или ModbusSlaveRTU с корректным конструктором и UART executor.');
  if(/\bModbusMasterRTU\b/.test(clean))
    infos.push('ModbusMasterRTU требует действительный FlprogAbstractUartExecutor*: nullptr допустим только для теста компиляции без begin()/pool()/setSpeedUart().');
  return {errors,warnings,infos};
 }
 root.ino2ubiFlprogApiAudit=Object.freeze({analyze});
})(typeof window!=='undefined'?window:globalThis);
