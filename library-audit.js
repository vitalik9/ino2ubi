/* FIX32: non-destructive #include dependency diagnostics. */
(function(root){
  'use strict';
  const inventory = root.ino2ubiFlprogHeaders || [];
  const known = new Map();
  for (const [path, library] of inventory) {
    const key = path.toLowerCase();
    if (!known.has(key)) known.set(key, []);
    if (!known.get(key).includes(library)) known.get(key).push(library);
  }
  const byBasename = new Map();
  for (const [path, library] of inventory) {
    const key = path.split('/').pop().toLowerCase();
    if (!byBasename.has(key)) byBasename.set(key, []);
    if (!byBasename.get(key).includes(library)) byBasename.get(key).push(library);
  }
  const core = new Set(['Arduino.h','math.h','stdint.h','stdlib.h','stdio.h','string.h','stdint.h',
    'stdbool.h','limits.h','stddef.h','stdint.h','algorithm','vector','string','functional',
    'memory','array','utility','type_traits','map','set','limits','cmath','cstring',
    'Preferences.h','WiFi.h','WiFiClient.h','WiFiServer.h','WiFiUdp.h','WebServer.h',
    'HTTPClient.h','HTTPUpdate.h','ESPmDNS.h','Update.h','SPI.h','Wire.h','EEPROM.h',
    'FS.h','SPIFFS.h','LittleFS.h','SD.h','SD_MMC.h','ETH.h','esp_now.h','esp_wifi.h',
    'esp_system.h','esp_task_wdt.h','esp_timer.h','driver/ledc.h','driver/gpio.h',
    'driver/uart.h','freertos/FreeRTOS.h','freertos/task.h','freertos/semphr.h']);
  const blockGenerated = new Set(['Arduino.h','flprogUtilites.h']);
  function group(name,libs) {
    if (libs.some(x=>/^RT_HW/i.test(x))) return 'rt_hw';
    if (libs.some(x=>/^Flprog_/i.test(x)||/^FLProg_/i.test(x))) return 'flprog';
    return /^RT_HW/i.test(name)?'rt_hw':/^(?:flprog|FLProg)/i.test(name)?'flprog':'other';
  }
  function analyze(lines) {
    const includes=[]; const warnings=[]; const infos=[]; const duplicates=[];
    const seen = new Set();
    for (const line of lines||[]) {
      const m=String(line).match(/^\s*#\s*include\s*([<"])([^>"]+)[>"]/);
      if (!m) continue;
      const name=m[2].trim().replace(/\\/g,'/');
      const exact=known.get(name.toLowerCase())||[];
      const fallback=byBasename.get(name.split('/').pop().toLowerCase())||[];
      // Only exact path is definitive; basename match on nested paths is advisory.
      const libs=exact.length?exact:fallback;
      const duplicate=seen.has(name);
      seen.add(name);
      const supplied=blockGenerated.has(name);
      let status='unknown';
      if (core.has(name)) status='core';
      else if (exact.length===1) status='archive-match';
      else if (exact.length>1) status='ambiguous';
      else if (fallback.length) status='different-path';
      const info={name, library:libs.length===1?libs[0]:null, libraries:libs,
        group:group(name,libs),status,duplicate,suppliedByFlprog:supplied};
      includes.push(info);
      if (duplicate) duplicates.push(name);
      if (libs.length>1)
        warnings.push('Заголовок '+name+' встречается в нескольких библиотеках архива: '+libs.join(', ')+'. Проверьте выбор Arduino IDE.');
      else if (status==='different-path')
        warnings.push('Заголовок '+name+' найден в архиве только по имени, но с другим относительным путём. Проверьте #include и расположение файла.');
      else if (status==='unknown' && /^(?:flprog|FLProg|RT_HW)/i.test(name))
        warnings.push('Заголовок '+name+' отсутствует в каталоге загруженного архива; это не доказывает, что он отсутствует в FLProg.');
    }
    if (duplicates.length)
      warnings.push('Повторные #include: '+[...new Set(duplicates)].join(', ')+'. Конвертер сохраняет исходные директивы без изменений.');
    const groups={flprog:[],rt_hw:[],other:[]};
    for(const item of includes) groups[item.group].push(item.name);
    if(groups.rt_hw.length)
      infos.push('Используется RT_HW: автоматической замены на Flprog_* нет, нужны реальные API и тест сборки.');
    if(groups.flprog.length)
      infos.push('Заголовки Flprog_* сверены только по каталогу libraries.rar; совместимость с Core подтвердит компиляция.');
    if(includes.some(x=>x.suppliedByFlprog))
      infos.push('Arduino.h / flprogUtilites.h обычно уже подключаются FLProg; исходные #include оставлены без изменений.');
    return {includes,groups,warnings,infos};
  }
  root.ino2ubiLibraryAudit=Object.freeze({analyze});
})(window);
