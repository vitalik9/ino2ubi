/**
 * ino2ubi Web — фронтенд для GitHub Pages (только браузер, без сервера)
 */
(function () {
  if (typeof VERSION !== 'undefined') {
    const el = document.getElementById('versionSpan');
    if (el) el.textContent = VERSION;
  }

  const lastUpdatedEl = document.getElementById('lastUpdatedSpan');
  if (lastUpdatedEl) {
    const source = (typeof LAST_UPDATED !== 'undefined' && LAST_UPDATED) ? LAST_UPDATED : document.lastModified;
    if (source) {
      const d = new Date(source);
      if (!isNaN(d.getTime())) {
        // Отображаем в часовом поясе пользователя с указанием зоны
        lastUpdatedEl.textContent = d.toLocaleString('ru-RU', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          timeZoneName: 'short'
        });
      } else {
        lastUpdatedEl.textContent = source;
      }
    }
  }

  const codeInput = document.getElementById('codeInput');
  const fileIno = document.getElementById('fileIno');
  const btnLoad = document.getElementById('btnLoad');
  const btnSaveProject = document.getElementById('btnSaveProject');
  const compat = window.ino2ubiCompat;
  const esp32 = window.ino2ubiEsp32;
  const btnCheckEsp32 = document.getElementById('btnCheckEsp32');
  const CORE_VERSION = '3.3.11'; // Единственный целевой ESP32 Arduino Core
  const diagnosticsEl = document.getElementById('esp32Diagnostics');
  const btnClear = document.getElementById('btnClear');
  const btnParse = document.getElementById('btnParse');
  const btnGenerate = document.getElementById('btnGenerate');
  const blockName = document.getElementById('blockName');
  const blockDesc = document.getElementById('blockDesc');
  // Take the displayed block name from the leading documentation, not the description field.
  function nameFromDescription(comment) {
    const match = String(comment || '').match(/^\s*(?:\*\s*)?Название\s+блока\s*:\s*(.+?)\s*$/im);
    if (!match) return '';
    const original = match[1].trim();
    // Keep the meaningful part of long Arduino identifiers without board suffixes.
    const clean = original.replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim()
      .replace(/\s+(?:ESP32|ESP8266|Arduino)(?:\s+Core)?$/i, '').trim();
    if (clean.length <= 24) return clean;
    return clean.slice(0, 24).replace(/\s+\S*$/, '').trim() || clean.slice(0, 24);
  }
  const enableInput = document.getElementById('enableInput');
  // Единственный формат экспорта — Code Professional.
  const formatHelp = document.getElementById('formatHelp');
  const remoteXYNotSupported = 'RemoteXY пока не поддерживается в Code Professional. Экспорт отключён.';
  const remoteXYEepromBox = document.getElementById('remoteXYEepromBox');
  const remoteXYEepromOffset = document.getElementById('remoteXYEepromOffset');
  const remoteXYEepromStatus = document.getElementById('remoteXYEepromStatus');
  function showRemoteXYEeprom(data) {
    if (!remoteXYEepromBox) return;
    const hasSaved = !!(data && data.eeprom && data.eeprom.requiredSize);
    remoteXYEepromBox.hidden = !data;
    const label = document.getElementById('remoteXYEepromOffsetLabel');
    if (label) label.hidden = !hasSaved;
    if (remoteXYEepromOffset) {
      remoteXYEepromOffset.hidden = !hasSaved;
      remoteXYEepromOffset.disabled = !hasSaved;
    }
    if (hasSaved) {
      remoteXYEepromOffset.max = String(4096 - data.eeprom.requiredSize);
      remoteXYEepromStatus.textContent = 'Сохраняемые поля: ' + data.eeprom.savedFields.join(', ') +
        '. Требуется ' + data.eeprom.requiredSize + ' байт EEPROM (без смещения).';
    } else if (data) {
      remoteXYEepromStatus.textContent = data.eeprom.protocol === 'legacy' ?
        'Старый формат RemoteXY V19: отметок EEPROM в массиве нет. Выберите «Сохранять в EEPROM» в редакторе для нужных полей и получите новый Arduino-код.' :
        'В этом интерфейсе RemoteXY нет полей с признаком «Сохранять в EEPROM». EEPROM не используется.';
    }
  }
  const varBody = document.getElementById('varBody');
  const funcBody = document.getElementById('funcBody');
  const statusEl = document.getElementById('status');
  const modalEdit = document.getElementById('modalEdit');
  const modalEditTitle = document.getElementById('modalEditTitle');
  const modalEditBody = document.getElementById('modalEditBody');
  const modalSave = document.getElementById('modalSave');
  const modalCancel = document.getElementById('modalCancel');

  let parsedSource = null;
  let remoteXYMode = false;
  let remoteXYPreview = null;
  let state = {
    variables: {},
    functions: {},
    global_includes: [],
    defines: [],
    extra_declarations: [],
    static_declarations: []
  };

  function setStatus(msg, isError) {
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('error', !!isError);
    statusEl.classList.toggle('success', !isError && !!msg);
  }

  // All checks are run on «Парсить код», manual check and before export.
  function runChecks(code, parsed) {
    const converter = compat.validateConverterInput(code, parsed, enableInput.checked);
    const board = esp32.checkEsp32Core(code, parsed, CORE_VERSION);
    const api = window.ino2ubiFlprogApiAudit ? window.ino2ubiFlprogApiAudit.analyze(code) : {errors:[],warnings:[],infos:[]};
    const headers = window.ino2ubiLibraryAudit ? window.ino2ubiLibraryAudit.analyze((parsed && parsed.global_includes) || []) : {warnings:[],infos:[]};
    return {
      errors: [...new Set([...converter.errors, ...board.errors, ...api.errors])],
      warnings: [...new Set([...converter.warnings, ...board.warnings, ...api.warnings, ...headers.warnings])],
      infos: [...new Set([...(api.infos || []), ...(headers.infos || [])])]
    };
  }

  function showEsp32Diagnostics(result, code) {
    diagnosticsEl.textContent = '';
    const issues = window.ino2ubiDiagnostics.enrich(code, { errors: result.errors || [], warnings: result.warnings || [], infos: result.infos || [] });
    diagnosticsEl.hidden = false;
    const heading = document.createElement('strong');
    heading.textContent = 'Проверка ino2ubi / ESP32 Core ' + CORE_VERSION + ': ' +
      result.errors.length + ' ошибок, ' + (result.warnings || []).length + ' предупреждений' +
      ((result.infos || []).length ? ', ' + result.infos.length + ' информационных сообщений' : '');
    diagnosticsEl.appendChild(heading);
    if (!issues.length) {
      const ok = document.createElement('p');
      ok.className = 'diagnostic-ok';
      ok.textContent = 'Известных несовместимостей не обнаружено. Это не заменяет компиляцию в FLProg.';
      diagnosticsEl.appendChild(ok);
      return;
    }
    const list = document.createElement('div');
    list.className = 'diagnostic-list';
    for (const issue of issues) {
      const item = document.createElement('div');
      item.className = 'diagnostic-item diagnostic-' + issue.severity;
      const label = document.createElement('div');
      label.className = 'diagnostic-message';
      label.textContent = (issue.severity === 'warning' ? 'Предупреждение: ' : (issue.severity === 'info' ? 'Информация: ' : 'Ошибка: ')) + issue.message;
      item.appendChild(label);
      if (issue.line !== null) {
        const jump = document.createElement('button');
        jump.type = 'button';
        jump.className = 'diagnostic-line';
        jump.textContent = 'Строка ' + issue.line + ' — перейти к коду';
        jump.addEventListener('click', () => {
          const text = codeInput.value;
          const starts = [...text.matchAll(/\n/g)];
          const start = issue.line <= 1 ? 0 : (starts[issue.line - 2]?.index ?? (text.length - 1)) + 1;
          const end = text.indexOf('\n', start);
          codeInput.focus();
          codeInput.setSelectionRange(start, end >= 0 ? end : text.length);
          const lineHeight = parseFloat(getComputedStyle(codeInput).lineHeight) || 20;
          codeInput.scrollTop = Math.max(0, (issue.line - 3) * lineHeight);
        });
        item.appendChild(jump);
        if (issue.snippet) {
          const snippet = document.createElement('code');
          snippet.className = 'diagnostic-snippet';
          snippet.textContent = issue.snippet;
          item.appendChild(snippet);
        }
      } else {
        const missing = document.createElement('span');
        missing.className = 'diagnostic-location-unknown';
        missing.textContent = issue.severity === 'info' ? 'Справочная информация — без привязки к строке' : 'Точную строку определить не удалось';
        item.appendChild(missing);
      }
      if (issue.advice) {
        const advice = document.createElement('p');
        advice.className = 'diagnostic-advice';
        advice.textContent = 'Как исправить: ' + issue.advice;
        item.appendChild(advice);
      }
      list.appendChild(item);
    }
    diagnosticsEl.appendChild(list);
  }

  function remoteXYChecks(data) {
    // Подсказки RemoteXY не показываются в режиме «только ошибки».
    return { errors: [], warnings: [] };
  }

  btnCheckEsp32.addEventListener('click', function () {
    const code = codeInput.value;
    if (!code.trim()) {
      showEsp32Diagnostics({ errors: ['Исходный код пуст.'], warnings: [] }, code);
      setStatus('Вставьте код ESP32.', true);
      return;
    }
    try {
      let result;
      if (/\bRemoteXY_CONF_PROGMEM\b/.test(code)) {
        result = { errors: [remoteXYNotSupported], warnings: [] };
      } else {
        const parsed = parsedSource === code ? state : window.parseArduinoCode(code);
        result = runChecks(code, parsed);
      }
      showEsp32Diagnostics(result, code);
      setStatus(result.errors.length ? 'Найдены ошибки ESP32/ino2ubi: ' + result.errors.length :
        'Проверка ESP32 и ino2ubi: ошибок нет',
        result.errors.length > 0);
    } catch (error) {
      showEsp32Diagnostics({ errors: ['Ошибка разбора: ' + error.message], warnings: [] }, code);
      setStatus('Ошибка разбора: ' + error.message, true);
    }
  });

  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
      document.querySelectorAll('.tab-content').forEach(function (c) { c.classList.remove('active'); });
      tab.classList.add('active');
      var id = 'tab' + tab.dataset.tab.charAt(0).toUpperCase() + tab.dataset.tab.slice(1);
      var content = document.getElementById(id);
      if (content) content.classList.add('active');
    });
  });

  btnLoad.addEventListener('click', function () { fileIno.click(); });
  fileIno.addEventListener('change', async function () {
    const file = fileIno.files[0];
    if (!file) return;
    try {
      const data = compat.openSourceFile(file.name, new Uint8Array(await file.arrayBuffer()));
      codeInput.value = data.code;
      if (data.kind === 'project') {
        remoteXYMode = false;
        remoteXYPreview = null;
        state = data.parsed;
        blockName.value = data.settings.blockName || 'Custom Block';
        blockDesc.value = data.settings.blockDescription || '';
        enableInput.checked = !!data.settings.enableInput;
        // Старые проекты открываются, но проверяются только под Core 3.3.11.
        parsedSource = data.code;
        if (/\bRemoteXY_CONF_PROGMEM\b/.test(data.code)) {
          const savedAliases = {};
          Object.entries(state.variables || {}).forEach(function ([key, v]) { savedAliases[key] = v.alias; });
          btnParse.click();
          // Restore only the editable RemoteXY pin labels.
          if (remoteXYMode) {
            Object.entries(savedAliases).forEach(function ([key, alias]) {
              if (state.variables[key] && typeof alias === 'string' && alias.trim()) state.variables[key].alias = alias;
            });
            renderVariables();
            if (data.settings.remoteXYEepromOffset != null && remoteXYEepromOffset) {
              remoteXYEepromOffset.value = String(data.settings.remoteXYEepromOffset);
              refreshRemoteXYEepromPreview();
            }
            blockDesc.value = data.settings.blockDescription || blockDesc.value;
          }
        } else {
          renderVariables();
          renderFunctions();
          const checks = runChecks(data.code, state);
          showEsp32Diagnostics(checks, data.code);
          setStatus('Открыт проект ino2ubi: ' + file.name + '. Ошибок: ' + checks.errors.length, checks.errors.length > 0);
        }
      } else {
        blockName.value = data.name || 'Custom Block';
        if (/\bRemoteXY_CONF_PROGMEM\b/.test(data.code)) {
          // Keep the existing RemoteXY import flow untouched.
          btnParse.click();
          if (!statusEl.classList.contains('error')) setStatus('Загружен и разобран RemoteXY: ' + file.name);
        } else {
          // Loading a normal Arduino source is NOT parsing it. Clear the
          // previous block so stale pins/functions cannot be exported.
          parsedSource = null;
          remoteXYMode = false;
          remoteXYPreview = null;
          showRemoteXYEeprom(null);
          state = { variables: {}, functions: {}, global_includes: [], defines: [], extra_declarations: [], static_declarations: [] };
          renderVariables();
          renderFunctions();
          diagnosticsEl.textContent = '';
          diagnosticsEl.hidden = true;
          blockDesc.value = 'Автоматически сгенерированный блок';
          setStatus('Исходник загружен: ' + file.name + '. Нажмите «Парсить код» для анализа.');
        }
      }
    } catch (error) {
      showEsp32Diagnostics({ errors: ['Ошибка открытия: ' + error.message], warnings: [] }, codeInput.value);
      setStatus('Ошибка открытия: ' + error.message, true);
    } finally { fileIno.value = ''; }
  });

  btnClear.addEventListener('click', function () {
    codeInput.value = '';
    parsedSource = null;
    remoteXYMode = false;
    remoteXYPreview = null;
    showRemoteXYEeprom(null);
    state = { variables: {}, functions: {}, global_includes: [], defines: [], extra_declarations: [], static_declarations: [] };
    renderVariables(); renderFunctions();
    diagnosticsEl.textContent = '';
    diagnosticsEl.hidden = true;
    setStatus('Очищено');
  });

  function downloadBlob(blob, filename) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  btnSaveProject.addEventListener('click', function () {
    if (!parsedSource || parsedSource !== codeInput.value) {
      setStatus('Сначала нажмите «Парсить код» (после изменений тоже).', true);
      return;
    }
    const project = compat.makeProject(codeInput.value, state, {
      blockName: blockName.value, blockDescription: blockDesc.value, enableInput: enableInput.checked,
      remoteXYEepromOffset: remoteXYMode && remoteXYEepromOffset ? remoteXYEepromOffset.value : '0',
      exportMode: 'professional', targetProfile: 'esp32-arduino-' + CORE_VERSION
    });
    const filename = (blockName.value || 'block').replace(/[^A-Za-z0-9_-]/g, '_') + '.i2u.json';
    downloadBlob(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json;charset=utf-8' }), filename);
    setStatus('Проект .i2u.json сохранён; роли и ручные изменения будут восстановлены при открытии.');
  });

  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }
  function escapeAttr(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderVariables() {
    varBody.innerHTML = '';
    var vars = state.variables || {};
    var defines = state.defines || [];
    Object.keys(vars).forEach(function (name) {
      var info = vars[name];
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + escapeHtml(info.name || name) + '</td><td>' + escapeHtml(info.type || '') + '</td><td>' + escapeHtml(info.role || 'variable') + '</td><td>' + escapeHtml(info.alias || name) + '</td><td>' + escapeHtml(info.default != null ? String(info.default) : '') + '</td>';
      tr.dataset.type = 'variable';
      tr.dataset.key = name;
      // При повторном открытии берём актуальное состояние переменной из state, а не захваченное в замыкании
      tr.addEventListener('dblclick', function () { openEditVariable(name, state.variables[name], tr); });
      varBody.appendChild(tr);
    });
    defines.forEach(function (d, idx) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + escapeHtml(d.name || '') + '</td><td>' + escapeHtml(d.type || 'String') + '</td><td>' + escapeHtml(d.role || 'global') + '</td><td>' + escapeHtml(d.name || '') + '</td><td>' + escapeHtml(d.value != null ? String(d.value) : '') + '</td>';
      tr.dataset.type = 'define';
      tr.dataset.key = String(idx);
      // Также для #define всегда читаем актуальные данные из state
      tr.addEventListener('dblclick', function () { openEditDefine(idx, state.defines[idx], tr); });
      varBody.appendChild(tr);
    });
  }

  function refreshRemoteXYEepromPreview() {
    if (!remoteXYMode || !remoteXYPreview || parsedSource !== codeInput.value) return;
    try {
      const built = window.buildRemoteXYUbi(codeInput.value, blockName.value.trim() || 'RemoteXY', {
        eepromOffset: remoteXYEepromOffset ? remoteXYEepromOffset.value : 0
      });
      remoteXYPreview['setup()'].body = built.setupCode;
      renderFunctions();
    } catch (error) {
      setStatus(error.message, true);
    }
  }
  if (remoteXYEepromOffset) remoteXYEepromOffset.addEventListener('input', refreshRemoteXYEepromPreview);

  function renderFunctions() {
    funcBody.innerHTML = '';
    // RemoteXY has no user helper functions in the supplied sketch. Show the
    // actual generated setup/loop code as read-only previews, not FLProg helpers.
    var funcs = remoteXYMode && remoteXYPreview ? remoteXYPreview : (state.functions || {});
    Object.keys(funcs).forEach(function (name) {
      var info = funcs[name];
      var bodyPreview = (info.body || '').length > 50 ? escapeHtml((info.body || '').slice(0, 50) + '…') : escapeHtml(info.body || '');
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + escapeHtml(info.name || name) + '</td><td>' + escapeHtml(info.return_type || 'void') + '</td><td>' + escapeHtml(info.params || '(нет)') + '</td><td title="' + escapeAttr(info.body || '') + '">' + bodyPreview + '</td>';
      tr.dataset.funcName = name;
      if (remoteXYMode) {
        tr.title = 'Просмотр кода RemoteXY; для изменения логики редактируйте исходный скетч';
      } else {
        // Обычные пользовательские функции редактируются без изменений.
        tr.addEventListener('dblclick', function () { openEditFunction(name, state.functions[name], tr); });
      }
      funcBody.appendChild(tr);
    });
  }

  btnParse.addEventListener('click', function () {
    var code = codeInput.value;
    if (!code.trim()) {
      showEsp32Diagnostics({ errors: ['Исходный код пуст.'], warnings: [] }, code);
      setStatus('Вставьте или загрузите код', true);
      return;
    }
    setStatus('Парсинг…');
    // Dedicated RemoteXY parser: these generated sketches require a packed
    // GUI structure and FLProg-owned Wi-Fi, not ordinary #define processing.
    if (/\bRemoteXY_CONF_PROGMEM\b/.test(code)) {
      remoteXYMode = false;
      parsedSource = null;
      setStatus(remoteXYNotSupported, true);
      return;
    }
    remoteXYMode = false;
    remoteXYPreview = null;
    showRemoteXYEeprom(null);
    try {
      var result = window.parseArduinoCode(code);
      state = {
        variables: result.variables || {},
        functions: result.functions || {},
        global_includes: result.global_includes || [],
        defines: result.defines || [],
        extra_declarations: result.extra_declarations || [],
        static_declarations: result.static_declarations || []
      };
      parsedSource = codeInput.value;
      if (result.leading_comment) {
        blockDesc.value = result.leading_comment;
        const extractedName = nameFromDescription(result.leading_comment);
        if (extractedName) blockName.value = extractedName;
      }
      renderVariables();
      renderFunctions();
      var v = Object.keys(state.variables).length;
      var f = Object.keys(state.functions).length;
      var inc = (state.global_includes || []).length;
      var def = (state.defines || []).length;
      const check = runChecks(code, state);
      showEsp32Diagnostics(check, code);
      setStatus('Найдено: переменных ' + v + ', функций ' + f + ', #include ' + inc + ', #define ' + def +
        '. Ошибок: ' + check.errors.length,
        check.errors.length > 0);
    } catch (e) {
      parsedSource = null;
      showEsp32Diagnostics({ errors: ['Ошибка разбора: ' + e.message], warnings: [] }, code);
      setStatus('Ошибка: ' + e.message, true);
    }
  });

  function openEditVariable(name, info, tr) {
    modalEditTitle.textContent = 'Переменная: ' + name;
    if (remoteXYMode) {
      // Direction/type/initial value are dictated by the packed RemoteXY GUI.
      // Only the label on the FLProg pin is customizable.
      modalEditBody.innerHTML = '<p class="hint">RemoteXY: тип и направление сигнала заданы интерфейсом телефона. Можно изменить только подпись контакта FLProg.</p>' +
        '<div class="form-row"><label>Псевдоним контакта FLProg</label><input type="text" id="editAlias" value="' + escapeAttr(info.alias || name) + '"></div>';
      modalEdit.hidden = false;
      modalSave.onclick = function () {
        var alias = document.getElementById('editAlias').value.trim();
        if (!alias) { setStatus('Псевдоним не может быть пустым', true); return; }
        if (Object.entries(state.variables).some(function ([key, v]) { return key !== name && v.alias === alias; })) {
          setStatus('Такой псевдоним уже используется другим контактом RemoteXY.', true); return;
        }
        state.variables[name].alias = alias;
        tr.cells[3].textContent = alias;
        modalEdit.hidden = true;
        setStatus('Псевдоним сохранён и будет использован при генерации .ubi.');
      };
      modalCancel.onclick = function () { modalEdit.hidden = true; };
      return;
    }
    var roleOpt = (info.role || '') === 'variable' ? 'selected' : '';
    var inputOpt = (info.role || '') === 'input' ? 'selected' : '';
    var outputOpt = (info.role || '') === 'output' ? 'selected' : '';
    var parOpt = (info.role || '') === 'parameter' ? 'selected' : '';
    modalEditBody.innerHTML = '<div class="form-row"><label>Роль</label><select id="editRole"><option value="variable" ' + roleOpt + '>variable</option><option value="input" ' + inputOpt + '>input</option><option value="output" ' + outputOpt + '>output</option><option value="parameter" ' + parOpt + '>parameter</option></select></div><div class="form-row"><label>Псевдоним</label><input type="text" id="editAlias" value="' + escapeAttr(info.alias || name) + '"></div><div class="form-row"><label>По умолчанию</label><input type="text" id="editDefault" value="' + escapeAttr(info.default != null ? String(info.default) : '') + '"></div>';
    modalEdit.hidden = false;
    modalSave.onclick = function () {
      var role = document.getElementById('editRole').value;
      var alias = document.getElementById('editAlias').value;
      var def = document.getElementById('editDefault').value.trim();
      // Псевдоним может содержать любые символы, в том числе пробелы и русские буквы
      if (!alias.trim()) { setStatus('Псевдоним не может быть пустым', true); return; }
      state.variables[name] = Object.assign({}, state.variables[name], { role: role, alias: alias, default: def || null });
      tr.cells[2].textContent = role;
      tr.cells[3].textContent = alias;
      tr.cells[4].textContent = def;
      modalEdit.hidden = true;
      setStatus('Сохранено');
    };
    modalCancel.onclick = function () { modalEdit.hidden = true; };
  }

  function openEditDefine(idx, d, tr) {
    modalEditTitle.textContent = '#define: ' + (d.name || '');
    var types = ['int', 'long', 'unsigned long', 'float', 'byte', 'char', 'String', 'bool', 'boolean'];
    var opts = types.map(function (t) { return '<option value="' + t + '"' + ((d.type || 'String') === t ? ' selected' : '') + '>' + t + '</option>'; }).join('');
    modalEditBody.innerHTML = '<div class="form-row"><label>Имя</label><input type="text" id="editDefineName" value="' + escapeAttr(d.name || '') + '"></div><div class="form-row"><label>Значение</label><input type="text" id="editDefineValue" value="' + escapeAttr(d.value != null ? String(d.value) : '') + '"></div><div class="form-row"><label>Тип</label><select id="editDefineType">' + opts + '</select></div><div class="form-row"><label>Роль</label><select id="editDefineRole"><option value="global"' + ((d.role || '') === 'global' ? ' selected' : '') + '>global</option><option value="parameter"' + ((d.role || '') === 'parameter' ? ' selected' : '') + '>parameter</option></select></div>';
    modalEdit.hidden = false;
    modalSave.onclick = function () {
      var name = document.getElementById('editDefineName').value.trim();
      var value = document.getElementById('editDefineValue').value.trim();
      var type = document.getElementById('editDefineType').value;
      var role = document.getElementById('editDefineRole').value;
      if (!name) { setStatus('Имя не может быть пустым', true); return; }
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) { setStatus('Имя: буквы, цифры, подчёркивание', true); return; }
      state.defines[idx] = { name: name, value: value, type: type, role: role, position: d.position };
      tr.cells[0].textContent = name;
      tr.cells[1].textContent = type;
      tr.cells[2].textContent = role;
      tr.cells[3].textContent = name;
      tr.cells[4].textContent = value;
      modalEdit.hidden = true;
      setStatus('Сохранено');
    };
    modalCancel.onclick = function () { modalEdit.hidden = true; };
  }

  function openEditFunction(name, info, tr) {
    modalEditTitle.textContent = 'Функция: ' + (info.name || name);
    modalEditBody.innerHTML = '<div class="form-row"><label>Тело функции</label><textarea id="editFuncBody">' + escapeAttr(info.body || '') + '</textarea></div>';
    modalEdit.hidden = false;
    modalSave.onclick = function () {
      var body = document.getElementById('editFuncBody').value;
      state.functions[name] = Object.assign({}, state.functions[name], { body: body });
      var preview = body.length > 50 ? body.slice(0, 50) + '…' : body;
      tr.cells[3].textContent = preview;
      tr.cells[3].title = body;
      modalEdit.hidden = true;
      setStatus('Сохранено');
    };
    modalCancel.onclick = function () { modalEdit.hidden = true; };
  }


  // FIX26: restore the Professional export click handler lost when Basic was removed.
  btnGenerate.addEventListener('click', function () {
    const code = codeInput.value;
    if (!code.trim()) {
      setStatus('Вставьте код Arduino.', true);
      return;
    }
    if (/\bRemoteXY_CONF_PROGMEM\b/.test(code)) {
      setStatus(remoteXYNotSupported, true);
      return;
    }
    if (parsedSource !== code) {
      setStatus('Сначала нажмите «Парсить код» (после изменений тоже).', true);
      return;
    }
    try {
      const check = runChecks(code, state);
      showEsp32Diagnostics(check, code);
      if (check.errors.length) {
        setStatus('Исправьте ошибки перед экспортом: ' + check.errors.join(' '), true);
        return;
      }
      const template = window.ino2ubiProfessionalTemplate;
      if (!template) throw new Error('Шаблон Code Professional не загружен.');
      if (!window.ino2ubiProfessional || !window.ino2ubiProfessional.build)
        throw new Error('Генератор Code Professional не загружен.');
      btnGenerate.disabled = true;
      setStatus('Генерация Code Professional…');
      const result = window.ino2ubiProfessional.build({
        template,
        name: blockName.value.trim() || 'Custom Block',
        description: blockDesc.value,
        state,
        source: code,
        enableInput: enableInput.checked,
        setupCode: window.extractFunctionBody(code, 'setup'),
        loopCode: window.extractFunctionBody(code, 'loop'),
        additionalHeader: '', additionalHeaderFilename: ''
      });
      const integrity = compat.inspectGeneratedXml(result.xml);
      if (!integrity.valid)
        throw new Error('Повреждены SIXX-ссылки: ' + JSON.stringify(integrity));
      if (result.hpp)
        throw new Error('Для блока требуется внешний заголовок .hpp; экспорт одного .ubi невозможен.');
      const bytes = window.ino2ubiProfessional.utf16le(result.xml.replace(/\r?\n/g, '\r\n'));
      downloadBlob(new Blob([bytes], { type: 'application/octet-stream' }), result.filename + '.ubi');
      setStatus('Файл ' + result.filename + '.ubi создан.' +
        (result.dependencies.length ? ' Проверьте локальные заголовки: ' + result.dependencies.join(', ') + '.' : '') +
        (result.warnings.length ? ' Зависимости: ' + result.warnings.join(' ') : '') +
        ' Проверьте импорт и компиляцию в FLProg.');
    } catch (e) {
      setStatus('Ошибка Code Professional: ' + e.message, true);
      showEsp32Diagnostics({ errors: [e.message], warnings: [] }, code);
    } finally {
      btnGenerate.disabled = false;
    }
  });

  // Версия для расширения: PWA service worker не регистрируется.
})();
