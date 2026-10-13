/** Новые индивидуальные / вратарские занятия (шаги 1–2 плана IND_PAYFILE_PLAN.md).
 *  Занятия — лист «ИНДИВИДУАЛЬНЫЕ ЗАНЯТИЯ» в AdminApp.
 *  Записи и оплаты — строки блока «Индивидуальные / Вратарские» на листе месяца файла оплат:
 *  записан = строка с датой занятия и пустой суммой; оплата = сумма 50 ₾ в той же строке;
 *  отмена записи = строка удаляется; отмена оплаты = сумма очищается.
 *  Старые занятия (старая таблица) только читаются — здесь с ними ничего не пишется. */

var IND_EVT = 'ИНДИВИДУАЛЬНЫЕ ЗАНЯТИЯ';
var IND_EVT_HEAD = ['ID', 'Дата', 'Время', 'Вратари', 'Тема', 'Создано'];
var IND_ADM = 'ADM'; // префикс ID новых занятий (лист в AdminApp, а не старая таблица)

function indAdmId_(date, time, gk) { return IND_ADM + '|' + date + ' ' + time + (gk ? ' gk' : ''); }
function indAdmIsNew_(ev) { return ev && ev.src === 'adm'; }
function indNotOld_(ev) {
  if (!indAdmIsNew_(ev)) throw new Error('Старое занятие: старая таблица только для чтения. Записи и оплаты вносятся для новых занятий.');
}

// «гггг-мм-дд» -> «дд.мм.гггг» (как в файле оплат)
function indDmy_(date) { var p = String(date).split('-'); return p[2] + '.' + p[1] + '.' + p[0]; }

function indTxt_(v, fmt) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), fmt);
  return String(v == null ? '' : v).trim();
}

// Занятия из листа AdminApp (без игроков)
function indAdmRows_() {
  var sh = dbRead_(IND_EVT);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues().map(function (r, i) {
    return {
      row: i + 2, id: String(r[0]).trim(), date: indTxt_(r[1], 'yyyy-MM-dd'), time: indTxt_(r[2], 'HH:mm'),
      gk: r[3] === true || String(r[3]).toUpperCase() === 'TRUE', theme: String(r[4] || '').trim()
    };
  }).filter(function (e) { return e.id && e.date; });
}

// Строки блока «Индивидуальные / Вратарские» на листе месяца: {row, name, date(дд.мм.гггг), amount}
// Возвращает null, если листа месяца нет в файле оплат
function indPfRows_(month) {
  var sh = payFile_().getSheetByName(month);
  if (!sh) return null;
  var b = indBlock_(sh), out = [];
  for (var i = b.hdr + 2; i < b.end; i++) {
    var name = String(b.vals[i][1]).trim();
    if (!name) continue;
    out.push({ row: i + 1, name: name, date: b.dates[i], amount: indAmount_(b.vals[i][3]) });
  }
  return out;
}

// Карта «норм. имя -> группа» из реестра (для показа группы игрока)
function indRegGroups_() {
  var map = {};
  regData_().players.forEach(function (p) { map[norm(p.name)] = p.group || 'гость'; });
  return map;
}

// Дата строки файла оплат покрывает занятие: точная дата «дд.мм.гггг» или диапазон «дд-дд.мм.гггг» (пара суббота/воскресенье)
function indDateCovers_(cell, want, gk) {
  if (!cell) return false;
  var c = String(cell).trim(), isGk = /\s*вр$/i.test(c);
  if (isGk) c = c.replace(/\s*вр$/i, '').trim();
  if (isGk !== !!gk) return false; // строка вратарского занятия помечена «вр», индивидуального — нет
  if (c === want) return true;
  var m = /^(\d{1,2})\s*[-\u2013]\s*(\d{1,2})\.(\d{2})\.(\d{4})$/.exec(c);
  if (!m) return false;
  var w = want.split('.');
  return w[1] === m[3] && w[2] === m[4] && +w[0] >= +m[1] && +w[0] <= +m[2];
}

// Игроки занятия из файла оплат. cache — объект на один проход, чтобы не читать лист месяца дважды
function indPfPlayers_(date, cache, gk) {
  var month = indMonthSheet_(date);
  if (!cache[month]) cache[month] = indPfRows_(month) || [];
  var want = indDmy_(date), grp = cache.groups || (cache.groups = indRegGroups_());
  return cache[month].filter(function (r) { return indDateCovers_(r.date, want, gk); }).map(function (r) {
    return { name: r.name, group: grp[norm(r.name)] || 'гость', paid: r.amount > 0, amount: r.amount, pfRow: r.row, pfMonth: month };
  });
}

// Новые занятия целиком (с игроками из файла оплат). filterDate — только эта дата.
function indParseAdm_(filterDate) {
  var rows = indAdmRows_().filter(function (e) { return !filterDate || e.date === filterDate; });
  var cache = {};
  return rows.map(function (e) {
    var players = indPfPlayers_(e.date, cache, e.gk);
    return {
      src: 'adm', sheet: IND_ADM, row: e.row, id: e.id,
      date: e.date, time: e.time, goalkeepers: e.gk, theme: e.theme,
      cap: e.gk ? 7 : 6, slots: players.length, players: players, empty: [], last: e.row
    };
  });
}

// Строка игрока на дату в блоке листа месяца: номер строки (с 1) или 0
function indPfFind_(sh, b, date, name, gk) {
  var want = indDmy_(date), low = norm(name);
  for (var i = b.hdr + 2; i < b.end; i++) {
    if (norm(b.vals[i][1]) === low && indDateCovers_(b.dates[i], want, gk)) return i + 1;
  }
  return 0;
}

// Нумерация № в блоке заново (после удаления строки)
function indPfRenumber_(sh) {
  var b = indBlock_(sh), k = 1, out = [];
  for (var i = b.hdr + 2; i < b.end; i++) {
    var a = String(b.vals[i][0]).trim();
    if (a !== '' && !isNaN(Number(a))) out.push([k++]); else out.push([b.vals[i][0]]);
  }
  if (out.length) sh.getRange(b.hdr + 3, 1, out.length, 1).setValues(out);
}

// Записать игрока на занятие. Предоплата без даты (есть сумма) занимает эту строку, иначе — свободная или новая строка.
function indPfEnroll_(date, name, gk) {
  if (CONFIG.DRY_RUN) return { dryRun: true };
  var month = indMonthSheet_(date), sh = payFile_().getSheetByName(month);
  if (!sh) throw new Error('Нет листа ' + month + ' в файле оплат. Запись не внесена.');
  var b = indBlock_(sh), want = indDmy_(date), low = norm(name), pre = 0, row = 0, i;
  for (i = b.hdr + 2; i < b.end; i++) {
    if (norm(b.vals[i][1]) !== low) continue;
    var d = b.dates[i];
    if (indDateCovers_(d, want, gk)) throw new Error('Уже записан на это занятие');
    if (!d && !pre && indAmount_(b.vals[i][3]) > 0) pre = i + 1;
  }
  if (pre) row = pre;
  // Свободные строки внутри групп не используем: их дата может быть объединённой ячейкой (диапазон дат группы).
  // Новая строка всегда в конце блока.
  if (!row) {
    sh.insertRowBefore(b.end + 1);
    row = b.end + 1;
    sh.getRange(row - 1, 1, 1, 4).copyTo(sh.getRange(row, 1, 1, 4), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    sh.getRange(row, 1).setValue(b.end - b.hdr - 1);
  }
  sh.getRange(row, 2).setValue(String(name).trim());
  var txt = want + (gk ? ' вр' : '');
  sh.getRange(row, 3).setNumberFormat('@').setValue(txt);
  SpreadsheetApp.flush();
  if (dateText_(sh.getRange(row, 3).getValue()) !== txt) {
    throw new Error('Дата не записалась в строку ' + row + ' файла оплат. Проверьте, нет ли объединения ячеек.');
  }
  monthInvalidate_(month);
  return { row: row, month: month };
}

// Снять игрока с занятия: строка удаляется целиком (только если не оплачено)
function indPfUnenroll_(date, name, gk) {
  if (CONFIG.DRY_RUN) return { dryRun: true };
  var month = indMonthSheet_(date), sh = payFile_().getSheetByName(month);
  if (!sh) return { removed: 0 };
  var b = indBlock_(sh), row = indPfFind_(sh, b, date, name, gk);
  if (!row) return { removed: 0 };
  if (indAmount_(b.vals[row - 1][3]) > 0) throw new Error('Сначала отмените оплату');
  sh.deleteRow(row);
  indPfRenumber_(sh);
  monthInvalidate_(month);
  return { removed: 1 };
}

// Поставить сумму оплаты (amount) или очистить её (amount = '') у записанного игрока; строка остаётся
function indPfSetAmount_(date, name, amount, gk) {
  if (CONFIG.DRY_RUN) return { dryRun: true };
  var month = indMonthSheet_(date), sh = payFile_().getSheetByName(month);
  if (!sh) throw new Error('Нет листа ' + month + ' в файле оплат. Оплата не внесена.');
  var b = indBlock_(sh), row = indPfFind_(sh, b, date, name, gk);
  if (!row) throw new Error('Игрок не записан');
  if (amount === '') sh.getRange(row, 4).clearContent();
  else sh.getRange(row, 4).setNumberFormat('#,##0.00 "₾"').setValue(amount);
  monthInvalidate_(month);
  return { row: row, month: month };
}

// Создать строку нового занятия на листе AdminApp
function indAdmAppend_(date, time, gk, theme) {
  var sh = dbSheet_(IND_EVT, IND_EVT_HEAD);
  if (!sh) return null;
  var r = sh.getLastRow() + 1, tz = Session.getScriptTimeZone();
  sh.getRange(r, 1, 1, 3).setNumberFormat('@');
  sh.getRange(r, 1, 1, 6).setValues([[indAdmId_(date, time, gk), date, time, !!gk, theme || '',
    Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy HH:mm')]]);
  return { row: r, id: indAdmId_(date, time, gk) };
}

// ===== Перенос неоплаченных записей старых занятий в новую модель (разово) =====
// Строки в файле оплат для записанных уже есть (их ведёт файл оплат), перенос создаёт занятие в AdminApp.
// Старое занятие с оплатами, которых нет в файле оплат, не переносится (расхождение).
function indMigratePlan_() {
  indDropSheetCache_(); // старые листы кэшируются на час: читаем свежие данные
  var old = indParseRaw_(), adm = indParseAdm_(), plan = [];
  old.forEach(function (ev) {
    var unpaid = ev.players.filter(function (p) { return !p.paid; });
    if (!unpaid.length) return;
    var done = adm.some(function (a) { return a.date === ev.date && a.time === ev.time && a.goalkeepers === ev.goalkeepers; });
    if (done) return;
    var fileP = indPfPlayers_(ev.date, {}, ev.goalkeepers);
    var inFile = function (name) { return fileP.some(function (f) { return norm(f.name) === norm(name); }); };
    var mism = ev.players.filter(function (p) {
      return p.paid && !fileP.some(function (f) { return norm(f.name) === norm(p.name) && f.paid; });
    }).map(function (p) { return p.name; });
    plan.push({
      ev: ev, unpaid: unpaid, mism: mism,
      toEnroll: unpaid.filter(function (p) { return !inFile(p.name); })
    });
  });
  return plan;
}

// Только отчёт в журнал, ничего не пишет
function indMigrateReport() {
  indMigratePlan_().forEach(function (x) {
    Logger.log(x.ev.id + ' | неоплаченных: ' + x.unpaid.map(function (p) { return p.name; }).join(', ') +
      ' | в файле оплат нет: ' + (x.toEnroll.map(function (p) { return p.name; }).join(', ') || 'нет') +
      (x.mism.length ? ' | РАСХОЖДЕНИЕ, не перенесётся: ' + x.mism.join(', ') : ''));
  });
}

// Переносит: создаёт занятие в AdminApp и дописывает в файл оплат недостающие строки (без сумм)
function indMigrateApply() {
  return indLocked_(function () {
    var done = 0;
    indMigratePlan_().forEach(function (x) {
      if (x.mism.length) { Logger.log('Пропущено ' + x.ev.id + ': расхождение оплат'); return; }
      indAdmAppend_(x.ev.date, x.ev.time, x.ev.goalkeepers, x.ev.theme);
      x.toEnroll.forEach(function (p) { indPfEnroll_(x.ev.date, p.name, x.ev.goalkeepers); });
      indLog_('Перенос', { id: indAdmId_(x.ev.date, x.ev.time, x.ev.goalkeepers) }, '', 0, '', 'из старой таблицы, неоплаченных: ' + x.unpaid.length);
      done++;
    });
    Logger.log('Перенесено занятий: ' + done);
    return done;
  });
}

// Старое занятие, перенесённое в новую модель, не дублирует новое в общем списке
function indDropMigrated_(old, adm) {
  return old.filter(function (o) {
    return !adm.some(function (a) { return a.date === o.date && a.time === o.time && a.goalkeepers === o.goalkeepers; });
  });
}
