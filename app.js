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
  const diagnosticsEl = document.getElementById('esp32Diagnostics');
  const btnClear = document.getElementById('btnClear');
  const btnParse = document.getElementById('btnParse');
  const btnGenerate = document.getElementById('btnGenerate');
  const blockName = document.getElementById('blockName');
  const blockDesc = document.getElementById('blockDesc');
  const enableInput = document.getElementById('enableInput');
  const exportMode = document.getElementById('exportMode');
  const professionalSettings = document.getElementById('professionalSettings');
  // Professional uses the same source editor as Basic; no separate header input.

  const formatHelp = document.getElementById('formatHelp');
  function refreshExportMode() {
    const professional = exportMode.value === 'professional';
    professionalSettings.hidden = !professional;
    btnGenerate.textContent = professional ? 'Сгенерировать Code Professional .ubi' : 'Сгенерировать .ubi и скачать';
    formatHelp.textContent = professional ?
      'Code Professional: экспериментальный MultiBlock; скачивается один файл .ubi без ZIP. Проверьте импорт и компиляцию в FLProg 8.' :
      'Code Basic: сохранён прежний экспорт .ubi; проверяются только ошибки.';
  }
  exportMode.addEventListener('change', refreshExportMode);
  refreshExportMode();
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
    const board = esp32.checkEsp32Core2017(code, parsed);
    return {
      errors: [...new Set([...converter.errors, ...board.errors])],
      warnings: [] // Режим отображения только ошибок; проверки ошибок сохранены.
    };
  }

  function showEsp32Diagnostics(result, code) {
    diagnosticsEl.textContent = '';
    const issues = window.ino2ubiDiagnostics.enrich(code, { errors: result.errors || [], warnings: [] });
    diagnosticsEl.hidden = false;
    const heading = document.createElement('strong');
    heading.textContent = 'Проверка ino2ubi / ESP32 Core 2.0.17: ' +
      result.errors.length + ' ошибок';
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
      label.textContent = 'Ошибка: ' + issue.message;
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
        missing.textContent = 'Точную строку определить не удалось';
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
        const parsedRemote = window.parseRemoteXYWiFi(code); // Validate mode and format.
        result = remoteXYChecks(parsedRemote);
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
        exportMode.value = data.settings.exportMode === 'professional' ? 'professional' : 'basic';


        refreshExportMode();
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
      exportMode: exportMode.value
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
      try {
        const built = window.buildRemoteXYUbi(code, blockName.value.trim() || 'RemoteXY Greenhouse', { eepromOffset: remoteXYEepromOffset ? remoteXYEepromOffset.value : 0 });
        remoteXYMode = true;
        showRemoteXYEeprom(built.data);
        remoteXYPreview = {
          'setup()': { name: 'setup()', return_type: 'void', params: '(нет)', body: built.setupCode },
          'loop()': { name: 'loop()', return_type: 'void', params: '(нет)', body: built.loopCode }
        };
        parsedSource = code;
        state = {variables: built.variables, functions: {}, global_includes: [], defines: [], extra_declarations: [], static_declarations: []};
        if (!blockName.value.trim() || blockName.value === 'Custom Block') blockName.value = 'RemoteXY_Greenhouse';
        blockDesc.value = built.description;
        enableInput.checked = false;
        renderVariables();
        renderFunctions();
        showEsp32Diagnostics(remoteXYChecks(built.data), code);
        setStatus('RemoteXY (' + ({wifi:'Wi-Fi',ap:'точка доступа',cloud:'Cloud'}[built.data.connection.mode]) + '): прочитана конфигурация (' + built.data.bytes.length + ' байт), найдено ' +
          Object.values(built.variables).filter(v => v.role === 'input').length + ' вход(а) и ' +
          Object.values(built.variables).filter(v => v.role === 'output').length + ' выход(а). Нажмите «Сгенерировать .ubi».');
      } catch (e) {
        remoteXYMode = false; remoteXYPreview = null; parsedSource = null;
        showRemoteXYEeprom(null);
        state = { variables: {}, functions: {}, global_includes: [], defines: [], extra_declarations: [], static_declarations: [] };
        renderVariables(); renderFunctions();
        showEsp32Diagnostics({ errors: [e.message], warnings: [] }, code);
        setStatus(e.message, true);
      }
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
      if (result.leading_comment) blockDesc.value = result.leading_comment;
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

  function stringToUtf16LeBlob(str) {
    var len = str.length;
    var buf = new ArrayBuffer(2 + len * 2);
    var view = new DataView(buf);
    view.setUint16(0, 0xFEFF, true);
    for (var i = 0; i < len; i++) {
      view.setUint16(2 + i * 2, str.charCodeAt(i), true);
    }
    return new Blob([buf], { type: 'application/octet-stream' });
  }

  // «Парсить RemoteXY» вызывает разбор без экспорта. Файл скачивается исключительно через btnGenerate.
  var btnRemoteXY = document.getElementById('btnRemoteXY');
  if (btnRemoteXY) btnRemoteXY.addEventListener('click', function () {
    if (!/\bRemoteXY_CONF_PROGMEM\b/.test(codeInput.value)) {
      setStatus('Для режима RemoteXY вставьте полный Arduino-скетч с RemoteXY_CONF_PROGMEM.', true);
      return;
    }
    // Единый путь разбора; никаких downloadBlob() или build-only export здесь нет.
    btnParse.click();
  });

  btnGenerate.addEventListener('click', function () {
    var code = codeInput.value;
    if (!code.trim()) {
      setStatus('Вставьте код Arduino', true);
      return;
    }
    if (!parsedSource || parsedSource !== code) {
      setStatus('Исходный код изменился или ещё не разобран: нажмите «Парсить код».', true);
      return;
    }
    if (exportMode.value === 'professional') {
      if (remoteXYMode) {
        setStatus('RemoteXY в формате Code Professional пока не поддерживается; используйте Code Basic.', true);
        return;
      }
      const check = runChecks(code, state);
      showEsp32Diagnostics(check, code);
      if (check.errors.length) { setStatus('Исправьте ошибки перед экспортом.', true); return; }
      btnGenerate.disabled = true;
      setStatus('Генерация Code Professional…');
      Promise.resolve(window.ino2ubiProfessionalTemplate).then(function (template) {
        if (!template) throw new Error('Шаблон Code Professional не загружен.');
        const result = window.ino2ubiProfessional.build({
          template, name:blockName.value.trim()||'Custom Block', description:blockDesc.value,
          state, source:code, enableInput:enableInput.checked,
          setupCode: window.extractFunctionBody(code,'setup'),
          loopCode: window.extractFunctionBody(code,'loop'),
          additionalHeader:'', additionalHeaderFilename:''
        });
        const integrity = compat.inspectGeneratedXml(result.xml);
        if (!integrity.valid) throw new Error('Повреждены SIXX-ссылки: ' + JSON.stringify(integrity));
        if (result.hpp) {
          throw new Error('Блоку требуется собственная библиотека .hpp; прямой экспорт одного .ubi невозможен без неё.');
        }
        const blob = new Blob([window.ino2ubiProfessional.utf16le(result.xml.replace(/\r?\n/g,'\r\n'))], {type:'application/octet-stream'});
        downloadBlob(blob, result.filename + '.ubi');
        setStatus('Создан Code Professional .ubi.'+
          (result.dependencies.length?' Используемые внешние библиотеки (проверьте их наличие в FLProg): '+result.dependencies.join(', ')+'.':'')+
          ' Проверьте импорт и компиляцию в FLProg 8.');
      }).catch(function (e) {
        setStatus('Ошибка Code Professional: '+e.message,true);
        showEsp32Diagnostics({errors: [e.message],warnings: []},code);
      }).finally(function () {btnGenerate.disabled=false;});
      return;
    }
    if (remoteXYMode) {
      try {
        const aliases = {};
        Object.entries(state.variables || {}).forEach(function ([key, info]) { aliases[key] = info.alias || key; });
        const built = window.buildRemoteXYUbi(code, blockName.value.trim() || 'RemoteXY_Greenhouse', {
          aliases, description: blockDesc.value,
          eepromOffset: remoteXYEepromOffset ? remoteXYEepromOffset.value : 0
        });
        const integrity = compat.inspectGeneratedXml(built.xml);
        if (!integrity.valid) throw new Error('Повреждены XML-ссылки: ' + JSON.stringify(integrity));
        const doc = new DOMParser().parseFromString(built.xml, 'application/xml');
        if (doc.querySelector('parsererror')) throw new Error('Недопустимый XML RemoteXY.');
        const blob = stringToUtf16LeBlob(built.xml.replace(/\r?\n/g, '\r\n'));
        downloadBlob(blob, (built.name || 'RemoteXY').replace(/[^A-Za-z0-9_-]/g, '_') + '.ubi');
        setStatus('Экспериментальный RemoteXY .ubi создан; проверьте импорт и компиляцию в FLProg 8.');
      } catch (e) {
        setStatus(e.message, true);
        showEsp32Diagnostics({errors: [e.message], warnings: []}, code);
      }
      return;
    }
    const check = runChecks(code, state);
    showEsp32Diagnostics(check, code);
    if (check.errors.length) {
      setStatus('Исправьте перед генерацией: ' + check.errors.join(' '), true);
      return;
    }
    setStatus('Генерация…');
    try {
      const aliases = {};
      Object.entries(state.variables || {}).forEach(function ([name, info]) {
        if (info.alias && info.alias !== name && (info.role === 'input' || info.role === 'output'))
          aliases[name] = info.alias;
      });
      const setupCode = compat.replaceCodeIdentifiers(window.extractFunctionBody(code, 'setup'), aliases);
      const loopCode = compat.replaceCodeIdentifiers(window.extractFunctionBody(code, 'loop'), aliases);
      const functionsForExport = {};
      Object.entries(state.functions || {}).forEach(function ([key, info]) {
        functionsForExport[key] = Object.assign({}, info, {
          body: compat.replaceCodeIdentifiers(info.body || '', aliases)
        });
      });
      var name = blockName.value.trim() || 'Custom Block';
      var desc = (blockDesc.value || '').trim() || 'Автоматически сгенерированный блок';
      var xml = window.createUbiXmlSixx(
        name,
        desc,
        state.variables,
        functionsForExport,
        state.global_includes,
        state.defines,
        state.extra_declarations,
        state.static_declarations,
        setupCode,
        loopCode,
        enableInput.checked
      );
      const integrity = compat.inspectGeneratedXml(xml);
      if (!integrity.valid) throw new Error('Повреждённые ссылки SIXX: ' + JSON.stringify(integrity));
      // DOMParser checks nesting and entity escaping in addition to SIXX references.
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      if (doc.querySelector('parsererror')) throw new Error('Файл .ubi содержит недопустимый XML.');
      const blob = stringToUtf16LeBlob(xml.replace(/\r?\n/g, '\r\n'));
      const filename = (name || 'block').replace(/[^A-Za-z0-9_-]/g, '_') + '.ubi';
      downloadBlob(blob, filename);
      setStatus('Сохранён .ubi (' + integrity.objects + ' объектов SIXX).' +
        ' Проверьте импорт и компиляцию в установленном FLProg 8.');
    } catch (e) {
      showEsp32Diagnostics({ errors: ['Ошибка генерации .ubi: ' + e.message], warnings: [] }, code);
      setStatus('Ошибка генерации: ' + e.message, true);
    }
  });

  modalEdit.querySelector('.modal-backdrop').addEventListener('click', function () {
    modalEdit.hidden = true;
  });

  var modalHelp = document.getElementById('modalHelp');
  var btnHelp = document.getElementById('btnHelp');
  var modalHelpClose = document.getElementById('modalHelpClose');
  if (btnHelp && modalHelp) {
    btnHelp.addEventListener('click', function () { modalHelp.hidden = false; });
    if (modalHelpClose) modalHelpClose.addEventListener('click', function () { modalHelp.hidden = true; });
    var helpBackdrop = modalHelp.querySelector('.modal-backdrop');
    if (helpBackdrop) helpBackdrop.addEventListener('click', function () { modalHelp.hidden = true; });
  }

  // Версия для расширения: PWA service worker не регистрируется.
})();
