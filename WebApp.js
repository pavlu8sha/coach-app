/** Веб-приложение для тренеров: группы дня, состав, сохранение отметок (включая индивидуальные и дополнительные). */

// Расписание: 1 = пн, 2 = вт, 3 = ср, 4 = чт, 5 = пт, 6 = сб, 0 = вс.
// Группы, которых здесь нет, показываются в любой день. Менять можно прямо тут.
var SCHEDULE = {
  'U7-A': [1, 3, 5], 'U7-B': [1, 3, 5],
  'U9-A': [1, 3, 5], 'U9-B': [1, 3, 5], 'U11': [1, 3, 5],
  'U10-A': [2, 4, 0], 'U10-B': [2, 4, 0],
  'U13-B': [2, 4, 6], 'U13-C': [2, 4, 6],
  'Ortachala U9': [2, 4, 6], 'Ortachala U12': [2, 4, 6],
  'U13-A': [1, 2, 4],
  'Isani': [1, 3, 5],
  'weekends': [6, 0]
};

function isScheduled_(group, dateStr) {
  var p = dateStr.split('-');
  var wd = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]))).getUTCDay();
  for (var k in SCHEDULE) {
    if (norm(k) === norm(group)) return SCHEDULE[k].indexOf(wd) >= 0;
  }
  return true;
}

// Группы, для которых в листе месяца есть блок (в порядке листа), с пометкой «по расписанию».
function appGroups(pin, dateStr) {
  checkPin_(pin);
  var d = parseDate(dateStr);
  var names = cacheGetBig_('cola_' + d.sheet);
  if (!names) {
    var sheet = sheetOf_(d.sheet);
    if (!sheet) throw new Error('Нет листа месяца ' + d.sheet + '. Сначала создайте его в таблице.');
    var seen = {};
    names = [];
    sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues().forEach(function (r) {
      var v = String(r[0]).trim();
      if (v && !seen[v]) { seen[v] = 1; names.push(v); }
    });
    cachePutBig_('cola_' + d.sheet, names, 120);
  }
  var known = {};
  regData_().players.forEach(function (p) {
    if (p.group && norm(p.status) === 'активен') known[norm(p.group)] = p.group;
  });
  var out = [];
  names.forEach(function (v) {
    var g = known[norm(v)];
    if (g && out.indexOf(g) < 0) out.push(g);
  });
  var res = out.map(function (g) { return { name: g, sched: isScheduled_(g, dateStr) }; });
  return res.concat(indGroups_(dateStr), extraGroups_(dateStr));
}

// Один запрос вместо двух: группы дня и состав выбранной группы.
function appAttInit(pin, dateStr, want, all) {
  var gs = appGroups(pin, dateStr);
  var shown = gs.filter(function (g) { return all || g.sched; });
  var pick = '';
  shown.forEach(function (g) { if (g.name === want) pick = g.name; });
  if (!pick && shown.length) pick = shown[0].name;
  return { groups: gs, group: pick, roster: pick ? appRoster(pin, pick, dateStr) : [] };
}

function appRoster(pin, group, dateStr) {
  checkPin_(pin);
  if (indIsGroup_(group)) return indRoster_(group, dateStr);
  if (extraIsGroup_(group)) return extraRoster_(dateStr);
  var roster = getRoster(group);
  var d = parseDate(dateStr);
  var sheet = sheetOf_(d.sheet);
  var block = sheet ? findBlock(sheet, group) : null;
  if (!block) return roster;
  var width = CONFIG.LAST_DATE_COL - CONFIG.FIRST_DATE_COL + 1;
  var hdr = sheet.getRange(block.headerRow, CONFIG.FIRST_DATE_COL, 1, width).getValues()[0];
  var col = -1;
  for (var c = 0; c < hdr.length; c++) {
    if (sameDay(hdr[c], d.day)) { col = CONFIG.FIRST_DATE_COL + c; break; }
  }
  if (col < 0) return roster;
  var n = block.lastRow - block.firstRow + 1;
  var names = sheet.getRange(block.firstRow, 2, n, 1).getValues();
  var vals = sheet.getRange(block.firstRow, col, n, 1).getValues();
  var byName = {}, rowsByName = {}, anyPresent = false;
  names.forEach(function (r, i) {
    var k = norm(r[0]);
    if (!k) return;
    var v = vals[i][0] === true;
    byName[k] = v;
    rowsByName[k] = (rowsByName[k] || 0) + 1;
    if (v) anyPresent = true;
  });
  // Ячейки отметок — чекбоксы: «ещё не отмечали» и «отсутствовал» в листе выглядят одинаково (FALSE).
  // Если в колонке есть хотя бы одна галочка, день отмечен: берём все значения листа (как раньше, и для ручных отметок).
  // Если галочек нет, отметку «не был» ставим только тем, у кого есть своя запись в журнале за эту группу и дату
  // (сопоставление по ID). Без записи ученик остаётся неотмеченным.
  var saved = anyPresent ? null : journalDay_(group, dateStr);
  if (!anyPresent && !Object.keys(saved).length) return roster;
  var inRoster = {};
  roster.forEach(function (p) { var k = norm(p.name); inRoster[k] = (inRoster[k] || 0) + 1; });
  roster.forEach(function (p) {
    var k = norm(p.name);
    // Одинаковые ФИ: в листе нет ID, поэтому чья отметка — не определить. Не подставляем, тренер отметит заново.
    if (inRoster[k] > 1 || rowsByName[k] > 1) return;
    if (!byName.hasOwnProperty(k)) return;
    if (saved && !saved.hasOwnProperty(String(p.id))) return;
    p.mark = byName[k] ? 'p' : 'a'; // значение берём из листа: если галочку потом сняли вручную, лист главнее журнала
  });
  return roster;
}

function appSave(pin, group, dateStr, marks) {
  checkPin_(pin);
  if (indIsGroup_(group)) return indSaveMarks_(pin, group, dateStr, marks);
  if (extraIsGroup_(group)) return extraSaveMarks_(pin, dateStr, marks);
  var d = parseDate(dateStr);
  var sheet = sheetOf_(d.sheet);
  var block = sheet ? findBlock(sheet, group) : null;
  var blockNames = [];
  if (block) {
    sheet.getRange(block.firstRow, 2, block.lastRow - block.firstRow + 1, 1).getValues()
      .forEach(function (r) { if (String(r[0]).trim()) blockNames.push(String(r[0]).trim()); });
  }
  var toSave = [], skippedMarks = [], skipped = [];
  marks.forEach(function (m) {
    var key = norm(m.name);
    var found = blockNames.some(function (b) { return norm(b) === key; });
    if (!found) {
      var lim = key.length >= 10 ? 2 : (key.length >= 6 ? 1 : 0);
      var similar = blockNames.filter(function (b) { return lev_(norm(b), key) <= lim; })[0];
      if (similar) {
        skippedMarks.push(m);
        skipped.push({ id: m.id, name: m.name, result: 'НЕ записано: в листе есть похожее имя «' + similar + '», проверьте написание' });
        return;
      }
    }
    toSave.push(m);
  });
  var report = saveAttendance(group, dateStr, toSave);
  report.results = report.results.concat(skipped);
  return report;
}

// Расстояние между строками (сколько правок отделяет одно написание от другого).
function lev_(a, b) {
  var m = a.length, n = b.length, i, j;
  if (Math.abs(m - n) > 2) return 99;
  var prev = [], cur;
  for (j = 0; j <= n; j++) prev[j] = j;
  for (i = 1; i <= m; i++) {
    cur = [i];
    for (j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}