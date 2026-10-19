/** Воронка новых игроков: таблица «Новый родитель / игрок» (каждый ребёнок = столбец, шаги = строки). */
// Активные листы (записываются и участвуют в «Новых игроках»). Свойство FUNNEL_ACTIVE: имена через запятую.
// Остальные листы открываются только для просмотра (архив).
// Список — настройка funnel.activeSheets (Settings.js); пока её нет, работает свойство FUNNEL_ACTIVE, затем «Осень 2026».
function funnelActiveList_() { return settingGet_('funnel.activeSheets'); }
function funnelIsActive_(name) { return funnelActiveList_().indexOf(name) >= 0; }
var FUNNEL_GROUP_LABEL = 'Группа';  // строка с группой (не флажок)

var _funnelSS = null;   // файл воронки открываем один раз за запуск
function funnelSS_() {
  if (_funnelSS) return _funnelSS;
  var id = PropertiesService.getScriptProperties().getProperty('FUNNEL_ID');
  if (!id) throw new Error('Не задан FUNNEL_ID в свойствах скрипта');
  _funnelSS = SpreadsheetApp.openById(id);
  return _funnelSS;
}

function funnelRead_(sh) {
  var lr = sh.getLastRow(), lc = sh.getLastColumn();
  var res = { steps: [], stepRows: [], groupRow: 0, kids: [] };
  if (lr < 1 || lc < 2) return res;
  var v = sh.getRange(1, 1, lr, lc).getValues(), r, c;
  for (r = 1; r < lr; r++) {
    var lab = String(v[r][0]).trim();
    if (!lab) continue;
    if (lab === FUNNEL_GROUP_LABEL) res.groupRow = r + 1;
    else { res.steps.push(lab); res.stepRows.push(r + 1); }
  }
  for (c = 1; c < lc; c++) {
    var nm = String(v[0][c]).trim();
    if (!nm) continue;
    res.kids.push({
      col: c + 1,
      name: nm,
      group: res.groupRow ? String(v[res.groupRow - 1][c]).trim() : '',
      flags: res.stepRows.map(function (sr) { return v[sr - 1][c] === true; })
    });
  }
  return res;
}

// Данные листа для экрана: шаги, дети, воронка (сколько дошло до каждого шага), «зависшие».
function appFunnelData(pin, sheetName) {
  checkAdmin_(pin);
  var ss = funnelSS_();
  var names = ss.getSheets().map(function (s) { return s.getName(); });
  var firstActive = funnelActiveList_().filter(function (a) { return names.indexOf(a) >= 0; })[0];
  var name = names.indexOf(sheetName) >= 0 ? sheetName : (firstActive || names[0]);
  var d = funnelRead_(ss.getSheetByName(name));
  var counts = d.steps.map(function (s, i) {
    return d.kids.filter(function (k) { return k.flags[i]; }).length;
  });
  var iCame = d.steps.indexOf('Пришли на пробное'), iPaid = d.steps.indexOf('Оплатили абонемент');
  var stuck = (iCame >= 0 && iPaid >= 0)
    ? d.kids.filter(function (k) { return k.flags[iCame] && !k.flags[iPaid]; }).map(function (k) { return k.name; })
    : [];
  var groups = {};
  d.kids.forEach(function (k) { if (k.group) groups[k.group] = 1; });
  return {
    sheets: names.map(function (n) { return { name: n, active: funnelIsActive_(n) }; }),
    sheet: name, editable: funnelIsActive_(name),
    steps: d.steps, kids: d.kids, counts: counts, stuck: stuck,
    groups: Object.keys(groups).sort()
  };
}

function funnelCheckKid_(sh, col, name) {
  if (String(sh.getRange(1, col).getValue()).trim() !== String(name).trim())
    throw new Error('Таблица изменилась, обновите страницу');
}

function funnelLocked_(fn) {
  if (CONFIG.DRY_RUN) throw new Error('Пробный режим: в таблицу воронки ничего не записано.');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// Поставить/снять флажок шага у ребёнка (только активный лист).
function appFunnelSet(pin, sheetName, col, name, stepIdx, val) {
  checkAdmin_(pin);
  if (!funnelIsActive_(sheetName)) throw new Error('Архивный лист доступен только для просмотра');
  return funnelLocked_(function () {
    var sh = funnelSS_().getSheetByName(sheetName), d = funnelRead_(sh);
    funnelCheckKid_(sh, Number(col), name);
    var row = d.stepRows[Number(stepIdx)];
    if (!row) throw new Error('Нет такого шага');
    sh.getRange(row, Number(col)).setValue(!!val);
    return { ok: true };
  });
}

// Изменить группу ребёнка.
function appFunnelGroup(pin, sheetName, col, name, group) {
  checkAdmin_(pin);
  if (!funnelIsActive_(sheetName)) throw new Error('Архивный лист доступен только для просмотра');
  return funnelLocked_(function () {
    var sh = funnelSS_().getSheetByName(sheetName), d = funnelRead_(sh);
    funnelCheckKid_(sh, Number(col), name);
    if (!d.groupRow) throw new Error('В листе нет строки «Группа»');
    sh.getRange(d.groupRow, Number(col)).setValue(String(group || '').trim());
    return { ok: true };
  });
}

// Новый ребёнок = новый столбец в активном листе (все шаги пустые).
function appFunnelAdd(pin, name, group, sheetName) {
  checkAdmin_(pin);
  var target = String(sheetName || funnelActiveList_()[0]);
  if (!funnelIsActive_(target)) throw new Error('Архивный лист доступен только для просмотра');
  name = String(name || '').trim();
  if (!name) throw new Error('Введите имя ребёнка');
  return funnelLocked_(function () {
    var sh = funnelSS_().getSheetByName(target);
    if (!sh) throw new Error('Нет листа «' + target + '»');
    var d = funnelRead_(sh);
    if (d.kids.some(function (k) { return norm(k.name) === norm(name); })) throw new Error('Такой ребёнок уже есть в списке');
    var last = sh.getLastColumn(), lr = sh.getLastRow();
    if (sh.getMaxColumns() < last + 1) sh.insertColumnAfter(last);
    var src = sh.getRange(1, last, lr, 1), dst = sh.getRange(1, last + 1, lr, 1);
    src.copyTo(dst, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    src.copyTo(dst, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
    var vals = dst.getValues();                      // одна запись вместо цикла setValue
    vals[0][0] = name;
    d.stepRows.forEach(function (r) { vals[r - 1][0] = false; });
    if (d.groupRow) vals[d.groupRow - 1][0] = String(group || '').trim();
    dst.setValues(vals);
    return { ok: true, col: last + 1, name: name };
  });
}

// Проверка чтения: запустите вручную и посмотрите журнал.
function funnelTest() {
  funnelSS_().getSheets().forEach(function (s) {
    var d = funnelRead_(s);
    Logger.log(s.getName() + ': детей ' + d.kids.length + ', шагов ' + d.steps.length + ' (' + d.steps.join(' | ') + '), строка группы: ' + d.groupRow);
  });
}

// Дети из активных листов воронки, которых ещё нет в реестре (для формы «Новый игрок»). Без дублей по имени.
function appFunnelCandidates(pin) {
  checkAdmin_(pin);
  var have = {};
  regData_().players.forEach(function (p) { have[norm(p.name)] = 1; });
  var reads = funnelActiveList_().map(function (sn) {
    var sh = funnelSS_().getSheetByName(sn);
    return sh ? funnelRead_(sh) : null;
  }).filter(Boolean);
  reads.forEach(function (d) {
    var i = d.steps.indexOf('Зарегистрировались в клубе');
    if (i >= 0) d.kids.forEach(function (k) { if (k.flags[i]) have[norm(k.name)] = 1; });
  });
  var seen = {}, out = [];
  reads.forEach(function (d) {
    var iGo = d.steps.indexOf('Решили ходить');
    d.kids.forEach(function (k) {
      var key = norm(k.name);
      if (have[key]) return;
      if (!seen[key]) { seen[key] = { name: k.name, group: k.group, go: false }; out.push(seen[key]); }
      if (!seen[key].group && k.group) seen[key].group = k.group;
      if (iGo >= 0 && k.flags[iGo]) seen[key].go = true;
    });
  });
  return out.sort(function (a, b) { return (b.go ? 1 : 0) - (a.go ? 1 : 0); })
    .map(function (x) { return { name: x.name, group: x.group }; });
}

// После добавления игрока в реестр: отметить в воронке (во всех активных листах) «Зарегистрировались» и «Добавились в группу».
function funnelMarkRegistered_(funnelName, group) {
  if (CONFIG.DRY_RUN) return false;
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var name = String(funnelName).trim(), found = false;
    funnelActiveList_().forEach(function (sn) {
      var sh = funnelSS_().getSheetByName(sn);
      if (!sh) return;
      var d = funnelRead_(sh);
      var kid = d.kids.filter(function (k) { return k.name === name; })[0];
      if (!kid) return;
      found = true;
      ['Зарегистрировались в клубе', 'Добавились в группу'].forEach(function (lab) {
        var i = d.steps.indexOf(lab);
        if (i >= 0) sh.getRange(d.stepRows[i], kid.col).setValue(true);
      });
      if (d.groupRow && group) sh.getRange(d.groupRow, kid.col).setValue(group);
    });
    return found;
  } finally { lock.releaseLock(); }
}