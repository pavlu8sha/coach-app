/**
 * FC KICKSTART: перенос отметок посещаемости в лист месяца (версия 2).
 *
 * ТЕСТИРОВАТЬ ТОЛЬКО НА КОПИИ ТАБЛИЦЫ.
 * Сейчас запись включена (DRY_RUN = false). Чтобы только посмотреть план без записи,
 * поставьте DRY_RUN = true.
 *
 * Что делает saveAttendance_(группа, дата, отметки):
 *  1. открывает лист месяца (дата 2026-10-05 -> лист "10.26");
 *  2. находит блок группы по названию в столбце A (до строки "ИТОГ ГРУППЫ");
 *  3. находит столбец даты в шапке блока (C:T); если даты нет, берёт первую
 *     пустую ячейку шапки и вписывает дату (в ячейке видно число дня);
 *  4. находит строку ребёнка по ФИ; если ребёнка нет, вписывает ФИ в первую
 *     свободную строку блока; если места нет, ничего не пишет и сообщает;
 *  5. ставит только TRUE/FALSE в ячейку даты. Ячейки с формулами не трогает,
 *     служебный блок AA:AL не трогает, ничего не удаляет.
 */

var CONFIG = {
  DRY_RUN: false,                 // true = только показать план; false = писать
  REGISTRY_SHEET: 'РЕЕСТР ИГРОКОВ',
  LOG_SHEET: 'ЖУРНАЛ ПРИЛОЖЕНИЯ', // создаётся только при реальной записи
  FIRST_DATE_COL: 3,             // столбец C
  LAST_DATE_COL: 20,             // столбец T
  END_MARKER: 'ИТОГ ГРУППЫ'
};

function norm(s) {
  return String(s === null || s === undefined ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
}

// Список активных игроков группы: основная группа или «Доп. программы» (столбец H).
function getRoster_(group) {
  var sh = sheetOf_(CONFIG.REGISTRY_SHEET);
  var rows = sh.getRange(4, 1, Math.max(sh.getLastRow() - 3, 1), 8).getValues();
  var g = norm(group), out = [];
  rows.forEach(function (r) {
    if (!r[0] || norm(r[4]) !== 'активен') return;
    var inGroup = norm(r[2]) === g;
    if (!inGroup) {
      inGroup = [r[7]].some(function (cell) {
      return String(cell || '').split(',').some(function (x) { return norm(x) === g; });
      });
    }
    if (inGroup) out.push({ id: r[0], name: String(r[1]).trim() });
  });
  return out;
}

function parseDate(dateStr) { // 'YYYY-MM-DD'
  var p = dateStr.split('-');
  return { sheet: p[1] + '.' + p[0].slice(2), day: Number(p[2]) };
}

// Дата в виде числа таблицы (дни от 30.12.1899), не зависит от часового пояса.
function serialOf(dateStr) {
  var p = dateStr.split('-');
  return Math.round((Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])) - Date.UTC(1899, 11, 30)) / 86400000);
}

// Число дня из значения ячейки шапки (число, дата или пусто).
function dayOf(v) {
  if (v === '' || v === null || v === undefined) return null;
  if (v instanceof Date) {
    return Number(Utilities.formatDate(v, attSS_().getSpreadsheetTimeZone(), 'd'));
  }
  var n = Number(v);
  if (isNaN(n)) return null;
  if (n > 31) return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000).getUTCDate();
  return n;
}

function sameDay(v, day) {
  return dayOf(v) === day;
}

var _blockMemo = {}; // живёт в пределах одного запуска: границы блока за это время не меняются
function findBlock(sheet, group) {
  var key = sheet.getSheetId() + '|' + norm(group);
  if (_blockMemo.hasOwnProperty(key)) return _blockMemo[key];
  var colA = sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 1), 1).getValues().map(function (r) { return r[0]; });
  var title = -1, end = -1, i, res = null;
  for (i = 0; i < colA.length; i++) {
    if (norm(colA[i]) === norm(group)) { title = i; break; }
  }
  if (title >= 0) {
    for (i = title + 2; i < colA.length; i++) {
      if (norm(colA[i]) === norm(CONFIG.END_MARKER)) { end = i; break; }
    }
    if (end >= 0) res = { headerRow: title + 2, firstRow: title + 3, lastRow: end };
  }
  _blockMemo[key] = res;
  return res;
}

/**
 * marks: [{id: 'KS-0006', name: 'Фамилия Имя', present: true}, ...]
 * Возвращает отчёт: что записано и что не удалось (по каждому ребёнку).
 */
function saveAttendance_(group, dateStr, marks) {
  if (CONFIG.DRY_RUN) return saveAttendanceCore_(group, dateStr, marks);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return saveAttendanceCore_(group, dateStr, marks); } finally { lock.releaseLock(); }
}

function saveAttendanceCore_(group, dateStr, marks) {
  var ss = attSS_();
  var d = parseDate(dateStr);
  var report = { dryRun: CONFIG.DRY_RUN, sheet: d.sheet, group: group, date: dateStr, results: [] };

  function failAll(msg) {
    marks.forEach(function (m) { report.results.push({ id: m.id, name: m.name, result: 'НЕ записано: ' + msg }); });
    logResults_(report, marks);
    return report;
  }

  // Одинаковые ФИ: в листе месяца нет ID, строку ребёнка ищем по ФИ. Если два ребёнка с одним ФИ,
  // отметки попали бы в одну строку и затёрли друг друга, поэтому такие отметки не пишем.
  var markCount = {};
  marks.forEach(function (m) { var k = norm(m.name); markCount[k] = (markCount[k] || 0) + 1; });
  var dupMarks = marks.filter(function (m) { return markCount[norm(m.name)] > 1; });
  marks = marks.filter(function (m) { return markCount[norm(m.name)] === 1; });
  dupMarks.forEach(function (m) {
    report.results.push({ id: m.id, name: m.name, result: 'НЕ записано: в группе несколько игроков с ФИ «' + m.name + '», отметьте их вручную в таблице' });
  });

  var sheet = ss.getSheetByName(d.sheet);
  if (!sheet) return failAll('нет листа месяца ' + d.sheet);
  var block = findBlock(sheet, group);
  if (!block) return failAll('нет блока группы ' + group);

  // Колонка даты
  var width = CONFIG.LAST_DATE_COL - CONFIG.FIRST_DATE_COL + 1;
  var hdr = sheet.getRange(block.headerRow, CONFIG.FIRST_DATE_COL, 1, width).getValues()[0];
  var dateCol = -1, writeDate = false, c;
  for (c = 0; c < hdr.length; c++) {
    if (sameDay(hdr[c], d.day)) { dateCol = CONFIG.FIRST_DATE_COL + c; break; }
  }
  if (dateCol < 0) {
    for (c = 0; c < hdr.length; c++) {
      if (hdr[c] === '') { dateCol = CONFIG.FIRST_DATE_COL + c; writeDate = true; break; }
    }
  }
  if (dateCol < 0) return failAll('в шапке блока нет свободной колонки для даты');

  // Не хватает свободных строк — вставляем их внутрь блока (перед последней строкой),
  // чтобы итоговые формулы группы их захватили. Формат и формулы берём со строки выше.
  var nowN = block.lastRow - block.firstRow + 1;
  var nowNames = sheet.getRange(block.firstRow, 2, nowN, 1).getValues().map(function (r) { return norm(r[0]); });
  var nowFree = nowNames.filter(function (x) { return x === ''; }).length;
  var nowSet = {};
  nowNames.forEach(function (x) { if (x) nowSet[x] = true; });
  var missing = marks.filter(function (m) { return !nowSet[norm(m.name)]; }).length;
  var extra = missing - nowFree;
  if (extra > 0 && !CONFIG.DRY_RUN) {
    var insAt = block.lastRow, lastCol = sheet.getLastColumn(), src = insAt - 1;
    sheet.insertRowsBefore(insAt, extra);
    sheet.getRange(src, 1, 1, lastCol).copyTo(sheet.getRange(insAt, 1, extra, lastCol), SpreadsheetApp.CopyPasteType.PASTE_NORMAL, false);
    sheet.getRange(insAt, 2, extra, 1).clearContent();
    sheet.getRange(insAt, CONFIG.FIRST_DATE_COL, extra, CONFIG.LAST_DATE_COL - CONFIG.FIRST_DATE_COL + 1).clearContent();
    // Номера строк: перенумеровываем блок целиком 1..N (строки вставлены перед последней, поэтому
    // нумерация «от строки выше» давала повторы: …13, 14, 14). Если в колонке № формулы или блок
    // нумеруется не с 1 — номера не трогаем.
    var numN = block.lastRow + extra - block.firstRow + 1;
    var numRg = sheet.getRange(block.firstRow, 1, numN, 1);
    var hasFx = numRg.getFormulas().some(function (r) { return r[0] !== ''; });
    if (!hasFx && Number(sheet.getRange(block.firstRow, 1).getValue()) === 1) {
      var nums = [];
      for (var k = 1; k <= numN; k++) nums.push([k]);
      numRg.setValues(nums);
    }
    block.lastRow += extra;
    delete _blockMemo[sheet.getSheetId() + '|' + norm(group)];
    SpreadsheetApp.flush();
  }

  // Строки детей и свободные строки блока
  var n = block.lastRow - block.firstRow + 1;
  var names = sheet.getRange(block.firstRow, 2, n, 1).getValues();
  var rowByName = {}, free = [], dupRow = {};
  names.forEach(function (r, i) {
    if (String(r[0]).trim() === '') { free.push(block.firstRow + i); return; }
    var k = norm(r[0]);
    if (rowByName[k]) dupRow[k] = true;
    else rowByName[k] = block.firstRow + i;
  });

  var fcol = sheet.getRange(block.firstRow, dateCol, n, 1).getFormulas(); // формулы колонки даты одним запросом
  var writes = []; // {row, col, value, isDate}
  var addedRows = []; // строки, куда добавлено новое имя (им нужен формат как у соседних)
  marks.forEach(function (m) {
    if (dupRow[norm(m.name)]) {
      report.results.push({ id: m.id, name: m.name, result: 'НЕ записано: в блоке ' + group + ' несколько строк с ФИ «' + m.name + '», отметьте вручную в таблице' });
      return;
    }
    var row = rowByName[norm(m.name)], added = false;
    if (!row) {
      if (!free.length) {
        report.results.push({ id: m.id, name: m.name, result: 'НЕ записано: нет свободной строки в блоке ' + group });
        return;
      }
      row = free[0];
      added = true;
    }
    if (fcol[row - block.firstRow][0]) {
      report.results.push({ id: m.id, name: m.name, result: 'НЕ записано: в ячейке формула' });
      return;
    }
    if (added) {
      free.shift();
      rowByName[norm(m.name)] = row;
      writes.push({ row: row, col: 2, value: m.name });
      addedRows.push(row);
    }
    writes.push({ row: row, col: dateCol, value: !!m.present });
    report.results.push({ id: m.id, name: m.name, result: added ? 'добавлен в лист и записан' : 'записан' });
  });

  if (writeDate && writes.length) {
    writes.unshift({ row: block.headerRow, col: dateCol, value: serialOf(dateStr), isDate: true });
  }

  if (!CONFIG.DRY_RUN) {
    var byCol = {};
    writes.forEach(function (w) { (byCol[w.col] = byCol[w.col] || []).push(w); });
    addedRows.forEach(function (r) {
      // шрифт и оформление имени — как у соседней строки блока
      var ref = r > block.firstRow ? r - 1 : r + 1;
      sheet.getRange(ref, 2).copyTo(sheet.getRange(r, 2), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    });
    Object.keys(byCol).forEach(function (col) {
      var ws = byCol[col].sort(function (a, b) { return a.row - b.row; }), i = 0;
      while (i < ws.length) {
        var j = i;
        while (j + 1 < ws.length && ws[j + 1].row === ws[j].row + 1 && !ws[j + 1].isDate && !ws[i].isDate) j++;
        var run = ws.slice(i, j + 1);
        var rg = sheet.getRange(run[0].row, Number(col), run.length, 1);
        rg.setValues(run.map(function (w) { return [w.value]; }));
        if (run[0].isDate) nfSafe_(rg, 'd'); // в шапке видно только число дня
        i = j + 1;
      }
    });
    SpreadsheetApp.flush();
  }
  report.plannedCellWrites = writes.length;
  report.dateColumn = dateCol;
  report.dateWillBeAddedToHeader = writeDate;
  // Лист уже записан. Если журнал не записался, говорим об этом прямо: повторное сохранение безопасно
  // (в лист пишутся те же значения, строки журнала обновляются, а не дублируются).
  try {
    logResults_(report, marks);
  } catch (e) {
    console.error('Журнал посещаемости не записан: ' + group + ' ' + dateStr + ': ' + e.message);
    throw new Error('Отметки записаны в лист ' + d.sheet + ', но журнал посещаемости не обновлён (' + e.message +
      '). Нажмите «Сохранить» ещё раз; если ошибка повторится, сообщите администратору.');
  }
  return report;
}

// Журнал приложения: создаётся только при реальной записи.
var JOURNAL_SHEET_ = 'ЖУРНАЛ ПОСЕЩАЕМОСТИ';

function logResults_(report, marks) {
  if (!marks.length) return;
  // Сопоставляем отметку с результатом по ID ученика (по ФИ — только если ID нет).
  function keyOf(x) { return x.id ? 'id:' + x.id : 'nm:' + norm(x.name); }
  var okKeys = {};
  report.results.forEach(function (r) {
    if (String(r.result).indexOf('НЕ записано') !== 0) okKeys[keyOf(r)] = true;
  });
  marks = marks.filter(function (m) { return okKeys[keyOf(m)]; });
  if (!marks.length) return;
  var sh = attSS_().getSheetByName(JOURNAL_SHEET_);
  if (!sh) throw new Error('Нет листа ' + JOURNAL_SHEET_ + ' в файле посещаемости');
  var p = report.date.split('-');
  var dateCell = p[2] + '.' + p[1] + '.' + p[0];
  var prefix = 'ATT-' + p[0] + p[1] + '-';
  var last = sh.getLastRow();
  var rows = last >= 4 ? sh.getRange(4, 1, last - 3, 10).getDisplayValues() : [];
  // Строка журнала = дата + ID + группа: ученик с доп. программой может быть отмечен в двух группах в один день.
  var byKey = {}, maxSeq = 0;
  rows.forEach(function (r, i) {
    byKey[r[1] + '|' + r[2] + '|' + norm(r[4])] = 4 + i;
    if (String(r[0]).indexOf(prefix) === 0) maxSeq = Math.max(maxSeq, Number(String(r[0]).slice(prefix.length)) || 0);
  });
  var locOf = {};
  readRegistry_().players.forEach(function (x) { locOf[x.id] = x.loc; });
  var updates = [], toAdd = [];
  marks.forEach(function (m) {
    var status = m.present ? 'Присутствовал' : 'Отсутствовал';
    var rowNum = byKey[dateCell + '|' + (m.id || '') + '|' + norm(report.group)];
    if (rowNum) updates.push({ row: rowNum, status: status });
    else toAdd.push(['', dateCell, m.id || '', m.name, report.group, locOf[m.id] || '', status, '', '', 'Приложение']);
  });
  toAdd.forEach(function (r) { maxSeq++; r[0] = prefix + ('000' + maxSeq).slice(-4); });
  if (CONFIG.DRY_RUN) {
    Logger.log('ЖУРНАЛ (пробный режим, ничего не записано)\nОбновить статус: ' + JSON.stringify(updates) +
      '\nДобавить строки:\n' + toAdd.map(function (r) { return r.join(' | '); }).join('\n'));
    return;
  }
  updates.forEach(function (u) { sh.getRange(u.row, 7).setValue(u.status); });
  if (toAdd.length) sh.getRange(sh.getLastRow() + 1, 1, toAdd.length, 10).setValues(toAdd);
}
// Записи журнала по группе за дату: { ID ученика: статус }. Приложение пишет туда каждую сохранённую отметку,
// включая «Отсутствовал», поэтому так отличаем «отсутствовал» от «ещё не отмечали». Только читает.
// Нет листа или он пуст — пустой объект (никаких выводов об отметках).
function journalDay_(group, dateStr) {
  var out = {};
  var sh = attSS_().getSheetByName(JOURNAL_SHEET_);
  if (!sh) return out;
  var last = sh.getLastRow();
  if (last < 4) return out;
  var p = dateStr.split('-'), dateCell = p[2] + '.' + p[1] + '.' + p[0], g = norm(group);
  var rows = sh.getRange(4, 2, last - 3, 6).getDisplayValues(); // B:G — дата, ID, ФИ, группа, локация, статус
  rows.forEach(function (r) {
    var id = String(r[1]).trim();
    if (id && r[0] === dateCell && norm(r[3]) === g) out[id] = r[5];
  });
  return out;
}

/**
 * Сверка листа месяца с журналом посещаемости. Только читает, запуск из редактора: attJournalCheck('10.26').
 * Показывает в журнале выполнения:
 *  - расхождения: у ученика (по ID из реестра) в журнале один статус, а в листе другая отметка;
 *  - дни с галочками в листе, по которым в журнале нет ни одной записи группы
 *    (отмечено вручную в таблице или журнал не записался). Исправление — пересохранить день из приложения.
 */
function attJournalCheck(month) {
  var ss = attSS_(), sh = ss.getSheetByName(month);
  if (!sh) throw new Error('Нет листа ' + month);
  var p = month.split('.'), mm = p[0], yyyy = '20' + p[1];
  var jsh = ss.getSheetByName(JOURNAL_SHEET_), J = {};
  if (jsh && jsh.getLastRow() >= 4) {
    jsh.getRange(4, 2, jsh.getLastRow() - 3, 6).getDisplayValues().forEach(function (r) {
      var d = String(r[0]); // дд.мм.гггг
      if (d.slice(3) !== mm + '.' + yyyy) return;
      var k = norm(r[3]) + '|' + d;
      (J[k] = J[k] || {})[String(r[1]).trim()] = r[5];
    });
  }
  var idOf = {}, many = {};
  readRegistry_().players.forEach(function (x) {
    var k = norm(x.name);
    if (idOf[k]) many[k] = true; else idOf[k] = x.id;
  });
  var out = [], diff = 0, bare = 0, width = CONFIG.LAST_DATE_COL - CONFIG.FIRST_DATE_COL + 1;
  attBlocks_(sh).forEach(function (b) {
    if (!b.slots) return;
    var hdr = sh.getRange(b.title + 1, CONFIG.FIRST_DATE_COL, 1, width).getValues()[0];
    var names = sh.getRange(b.first, 2, b.slots, 1).getValues();
    var vals = sh.getRange(b.first, CONFIG.FIRST_DATE_COL, b.slots, width).getValues();
    hdr.forEach(function (h, c) {
      var day = dayOf(h);
      if (day === null) return;
      var dateCell = ('0' + day).slice(-2) + '.' + mm + '.' + yyyy;
      var jr = J[norm(b.name) + '|' + dateCell] || {};
      var anyTrue = vals.some(function (r, i) { return String(names[i][0]).trim() && r[c] === true; });
      if (anyTrue && !Object.keys(jr).length) { bare++; out.push('БЕЗ ЖУРНАЛА: ' + b.name + ', ' + dateCell); }
      names.forEach(function (r, i) {
        var k = norm(r[0]);
        if (!k || many[k] || !idOf[k] || !jr.hasOwnProperty(idOf[k])) return;
        var inSheet = vals[i][c] === true ? 'Присутствовал' : 'Отсутствовал';
        if (jr[idOf[k]] !== inSheet) {
          diff++;
          out.push('РАСХОЖДЕНИЕ: ' + b.name + ', ' + dateCell + ', ' + String(r[0]).trim() + ' (' + idOf[k] + '): журнал «' + jr[idOf[k]] + '», лист «' + inSheet + '»');
        }
      });
    });
  });
  out.unshift('Сверка ' + month + ': расхождений ' + diff + ', дней с отметками без журнала ' + bare);
  Logger.log(out.join('\n'));
  return { diff: diff, bare: bare, lines: out };
}
