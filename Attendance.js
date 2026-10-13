/**
 * FC KICKSTART: перенос отметок посещаемости в лист месяца (версия 2).
 *
 * ТЕСТИРОВАТЬ ТОЛЬКО НА КОПИИ ТАБЛИЦЫ.
 * Сейчас запись включена (DRY_RUN = false). Чтобы только посмотреть план без записи,
 * поставьте DRY_RUN = true.
 *
 * Что делает saveAttendance(группа, дата, отметки):
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
function getRoster(group) {
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
function saveAttendance(group, dateStr, marks) {
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
    marks.forEach(function (m) { report.results.push({ name: m.name, result: 'НЕ записано: ' + msg }); });
    logResults(report, marks);
    return report;
  }

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
    var srcNum = Number(sheet.getRange(src, 1).getValue());
    if (srcNum) {
      var nums = [];
      for (var k = 0; k < extra; k++) nums.push([srcNum + k + 1]);
      sheet.getRange(insAt, 1, extra, 1).setValues(nums);
    }
    block.lastRow += extra;
    delete _blockMemo[sheet.getSheetId() + '|' + norm(group)];
    SpreadsheetApp.flush();
  }

  // Строки детей и свободные строки блока
  var n = block.lastRow - block.firstRow + 1;
  var names = sheet.getRange(block.firstRow, 2, n, 1).getValues();
  var rowByName = {}, free = [];
  names.forEach(function (r, i) {
    if (String(r[0]).trim() === '') free.push(block.firstRow + i);
    else rowByName[norm(r[0])] = block.firstRow + i;
  });

  var fcol = sheet.getRange(block.firstRow, dateCol, n, 1).getFormulas(); // формулы колонки даты одним запросом
  var writes = []; // {row, col, value, isDate}
  var addedRows = []; // строки, куда добавлено новое имя (им нужен формат как у соседних)
  marks.forEach(function (m) {
    var row = rowByName[norm(m.name)], added = false;
    if (!row) {
      if (!free.length) {
        report.results.push({ name: m.name, result: 'НЕ записано: нет свободной строки в блоке ' + group });
        return;
      }
      row = free[0];
      added = true;
    }
    if (fcol[row - block.firstRow][0]) {
      report.results.push({ name: m.name, result: 'НЕ записано: в ячейке формула' });
      return;
    }
    if (added) {
      free.shift();
      rowByName[norm(m.name)] = row;
      writes.push({ row: row, col: 2, value: m.name });
      addedRows.push(row);
    }
    writes.push({ row: row, col: dateCol, value: !!m.present });
    report.results.push({ name: m.name, result: added ? 'добавлен в лист и записан' : 'записан' });
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
        if (run[0].isDate) rg.setNumberFormat('d'); // в шапке видно только число дня
        i = j + 1;
      }
    });
    SpreadsheetApp.flush();
  }
  report.plannedCellWrites = writes.length;
  report.dateColumn = dateCol;
  report.dateWillBeAddedToHeader = writeDate;
  logResults(report, marks);
  return report;
}

// Журнал приложения: создаётся только при реальной записи.
var JOURNAL_SHEET_ = 'ЖУРНАЛ ПОСЕЩАЕМОСТИ';

function logResults(report, marks) {
  if (!marks.length) return;
  var okNames = {};
  report.results.forEach(function (r) {
    if (String(r.result).indexOf('НЕ записано') !== 0) okNames[norm(r.name)] = true;
  });
  marks = marks.filter(function (m) { return okNames[norm(m.name)]; });
  if (!marks.length) return;
  var sh = attSS_().getSheetByName(JOURNAL_SHEET_);
  if (!sh) throw new Error('Нет листа ' + JOURNAL_SHEET_ + ' в файле посещаемости');
  var p = report.date.split('-');
  var dateCell = p[2] + '.' + p[1] + '.' + p[0];
  var prefix = 'ATT-' + p[0] + p[1] + '-';
  var last = sh.getLastRow();
  var rows = last >= 4 ? sh.getRange(4, 1, last - 3, 10).getDisplayValues() : [];
  var byKey = {}, maxSeq = 0;
  rows.forEach(function (r, i) {
    byKey[r[1] + '|' + r[2]] = 4 + i;
    if (String(r[0]).indexOf(prefix) === 0) maxSeq = Math.max(maxSeq, Number(String(r[0]).slice(prefix.length)) || 0);
  });
  var locOf = {};
  readRegistry_().players.forEach(function (x) { locOf[x.id] = x.loc; });
  var updates = [], toAdd = [];
  marks.forEach(function (m) {
    var status = m.present ? 'Присутствовал' : 'Отсутствовал';
    var rowNum = byKey[dateCell + '|' + (m.id || '')];
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