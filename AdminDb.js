/** Таблица AdminApp: финансовые журналы, закрытые от тренеров. */

var SUB_HEAD = ['Время', 'Дата', 'ID игрока', 'ФИ', 'Месяц', 'Группа', 'Сумма', 'Тип', 'Комментарий', 'Способ'];
var PAY_HEAD = ['Время', 'Дата', 'ID игрока', 'ФИ', 'За что', 'Строка заказа', 'Сумма', 'Комментарий', 'Способ'];
var LOG_HEAD = ['Время', 'ID', 'ФИ', 'Поле', 'Было', 'Стало'];

var _adminSS = null;
function adminSS_() {
  return clubSource_('ADMIN_ID', 'Не задан ADMIN_ID в свойствах скрипта');
}

// Чтение: лист из AdminApp или null, ничего не создаёт.
function dbRead_(name) { return adminSS_().getSheetByName(name); }

// Запись: лист из AdminApp, при отсутствии создаётся с заголовком (кроме пробного режима).
function dbSheet_(name, headers) {
  var ss = adminSS_(), sh = ss.getSheetByName(name);
  if (sh) return sh;
  if (CONFIG.DRY_RUN) return null;
  sh = ss.insertSheet(name);
  if (headers) { sh.appendRow(headers); sh.setFrozenRows(1); }
  return sh;
}

var FIN_SHEETS = ['АБОНЕМЕНТЫ', 'ОПЛАТЫ', 'ЖУРНАЛ ИЗМЕНЕНИЙ'];

// Копирует листы целиком в AdminApp (формат сохраняется). Старые листы не трогает. Если лист уже есть в AdminApp, пропускает.
function migrateFinance() {
  if (CONFIG.DRY_RUN) { Logger.log('DRY_RUN: миграция финансов пропущена; листы не копировались.'); return; }
  var src = SpreadsheetApp.getActive(), dst = adminSS_(), out = [];
  FIN_SHEETS.forEach(function (n) {
    var s = src.getSheetByName(n);
    if (!s) { out.push(n + ': в таблице посещаемости нет'); return; }
    if (dst.getSheetByName(n)) { out.push(n + ': в AdminApp уже есть, пропущено'); return; }
    var c = s.copyTo(dst);
    c.setName(n);
    out.push(n + ': скопировано строк ' + s.getLastRow());
  });
  Logger.log(out.join('\n'));
}

// Сверка: число строк и сумма платежей в старых и новых листах.
function verifyFinance() {
  var src = SpreadsheetApp.getActive(), dst = adminSS_(), out = [];
  function sum(sh) {
    if (!sh || sh.getLastRow() < 2) return 0;
    return sh.getRange(2, 7, sh.getLastRow() - 1, 1).getValues().reduce(function (a, r) { return a + (Number(r[0]) || 0); }, 0);
  }
  FIN_SHEETS.forEach(function (n) {
    var a = src.getSheetByName(n), b = dst.getSheetByName(n);
    var ra = a ? a.getLastRow() : -1, rb = b ? b.getLastRow() : -1;
    var line = n + ': строк ' + ra + ' → ' + rb;
    if (n !== 'ЖУРНАЛ ИЗМЕНЕНИЙ') line += '; сумма ' + sum(a) + ' → ' + sum(b);
    out.push((ra === rb && (n === 'ЖУРНАЛ ИЗМЕНЕНИЙ' || sum(a) === sum(b)) ? 'OK     ' : 'РАЗЛИЧИЕ ') + line);
  });
  Logger.log(out.join('\n'));
}

var MFEE_HEAD = ['Событие', 'ID игрока', 'ФИ', 'Взнос оплачен', 'Сумма ₾', 'Способ', 'Дата оплаты', 'Комментарий'];
var EFEE_HEAD = ['ID события', 'Команда', 'Тип', 'Название', 'Взнос ₾'];

// Копирует денежные данные матчей в AdminApp. Старые листы не трогает. Повторный запуск ничего не перезаписывает.
function migrateMatchFees() {
  if (CONFIG.DRY_RUN) { Logger.log('DRY_RUN: миграция взносов матчей/событий пропущена; листы не создавались.'); return; }
  var src = SpreadsheetApp.getActive(), dst = adminSS_(), out = [];
  var ps = src.getSheetByName('УЧАСТИЕ'), ms = src.getSheetByName('МАТЧИ');
  if (!ps || !ms) throw new Error('Нет листа УЧАСТИЕ или МАТЧИ');

  if (dst.getSheetByName('ВЗНОСЫ МАТЧЕЙ')) {
    out.push('ВЗНОСЫ МАТЧЕЙ: уже есть, пропущено');
  } else {
    var rows = [];
    if (ps.getLastRow() > 1) {
      ps.getRange(2, 1, ps.getLastRow() - 1, 10).getValues().forEach(function (r) {
        if (!r[0] || !r[1]) return;
        var has = r[5] === true || String(r[6]).trim() !== '' || String(r[7]).trim() !== '' || String(r[8]).trim() !== '' || String(r[9]).trim() !== '';
        if (has) rows.push([r[0], r[1], r[2], r[5] === true, r[6], r[7], r[8], r[9]]);
      });
    }
    var sh = dst.insertSheet('ВЗНОСЫ МАТЧЕЙ');
    sh.getRange(1, 1, 1, MFEE_HEAD.length).setValues([MFEE_HEAD]);
    sh.setFrozenRows(1);
    if (rows.length) {
      sh.getRange(2, 1, rows.length, MFEE_HEAD.length).setValues(rows);
      nfSafe_(sh.getRange(2, 7, rows.length, 1), 'dd.MM.yyyy');
    }
    out.push('ВЗНОСЫ МАТЧЕЙ: перенесено строк ' + rows.length);
  }

  if (dst.getSheetByName('ВЗНОСЫ СОБЫТИЙ')) {
    out.push('ВЗНОСЫ СОБЫТИЙ: уже есть, пропущено');
  } else {
    var ev = [];
    if (ms.getLastRow() > 1) {
      ms.getRange(2, 1, ms.getLastRow() - 1, 6).getValues().forEach(function (r) {
        if (r[0] && Number(r[5]) > 0) ev.push([r[0], r[1], r[2], r[3], Number(r[5])]);
      });
    }
    var sh2 = dst.insertSheet('ВЗНОСЫ СОБЫТИЙ');
    sh2.getRange(1, 1, 1, EFEE_HEAD.length).setValues([EFEE_HEAD]);
    sh2.setFrozenRows(1);
    if (ev.length) sh2.getRange(2, 1, ev.length, EFEE_HEAD.length).setValues(ev);
    out.push('ВЗНОСЫ СОБЫТИЙ: перенесено строк ' + ev.length);
  }
  Logger.log(out.join('\n'));
}

// Сверка: количество строк с деньгами, сумма взносов и число оплаченных в старых и новых листах.
function verifyMatchFees() {
  var src = SpreadsheetApp.getActive(), dst = adminSS_(), out = [];
  var ps = src.getSheetByName('УЧАСТИЕ'), ms = src.getSheetByName('МАТЧИ');
  var a = { n: 0, sum: 0, paid: 0 }, ef = { n: 0, sum: 0 };
  if (ps.getLastRow() > 1) {
    ps.getRange(2, 1, ps.getLastRow() - 1, 10).getValues().forEach(function (r) {
      if (!r[0] || !r[1]) return;
      var has = r[5] === true || String(r[6]).trim() !== '' || String(r[7]).trim() !== '' || String(r[8]).trim() !== '' || String(r[9]).trim() !== '';
      if (!has) return;
      a.n++; a.sum += Number(r[6]) || 0; if (r[5] === true) a.paid++;
    });
  }
  if (ms.getLastRow() > 1) {
    ms.getRange(2, 1, ms.getLastRow() - 1, 6).getValues().forEach(function (r) {
      if (r[0] && Number(r[5]) > 0) { ef.n++; ef.sum += Number(r[5]); }
    });
  }
  var b = { n: 0, sum: 0, paid: 0 }, ef2 = { n: 0, sum: 0 };
  var s1 = dst.getSheetByName('ВЗНОСЫ МАТЧЕЙ'), s2 = dst.getSheetByName('ВЗНОСЫ СОБЫТИЙ');
  if (s1 && s1.getLastRow() > 1) {
    s1.getRange(2, 1, s1.getLastRow() - 1, 8).getValues().forEach(function (r) {
      b.n++; b.sum += Number(r[4]) || 0; if (r[3] === true) b.paid++;
    });
  }
  if (s2 && s2.getLastRow() > 1) {
    s2.getRange(2, 1, s2.getLastRow() - 1, 5).getValues().forEach(function (r) { ef2.n++; ef2.sum += Number(r[4]) || 0; });
  }
  out.push((a.n === b.n && a.sum === b.sum && a.paid === b.paid ? 'OK     ' : 'РАЗЛИЧИЕ ') + 'Взносы игроков: строк ' + a.n + ' → ' + b.n + '; сумма ' + a.sum + ' → ' + b.sum + '; оплачено ' + a.paid + ' → ' + b.paid);
  out.push((ef.n === ef2.n && ef.sum === ef2.sum ? 'OK     ' : 'РАЗЛИЧИЕ ') + 'Взносы событий: строк ' + ef.n + ' → ' + ef2.n + '; сумма ' + ef.sum + ' → ' + ef2.sum);
  Logger.log(out.join('\n'));
}

var MFEE_SHEET = 'ВЗНОСЫ МАТЧЕЙ', EFEE_SHEET = 'ВЗНОСЫ СОБЫТИЙ';
var _fin = null;

// Все денежные данные матчей из AdminApp (один раз за запуск).
function finMap_() {
  if (_fin) return _fin;
  var ss = adminSS_(), tz = ss.getSpreadsheetTimeZone(), out = { pays: {}, fees: {}, feeRow: {} };
  var s1 = ss.getSheetByName(MFEE_SHEET), s2 = ss.getSheetByName(EFEE_SHEET);
  if (s1 && s1.getLastRow() > 1) {
    s1.getRange(2, 1, s1.getLastRow() - 1, 8).getValues().forEach(function (r, i) {
      if (!r[0] || !r[1]) return;
      out.pays[r[0] + '|' + r[1]] = { row: i + 2, paid: r[3] === true, sum: Number(r[4]) || 0, method: String(r[5] || ''),
        date: r[6] instanceof Date ? Utilities.formatDate(r[6], tz, 'yyyy-MM-dd') : String(r[6] || ''), comment: String(r[7] || '') };
    });
  }
  if (s2 && s2.getLastRow() > 1) {
    s2.getRange(2, 1, s2.getLastRow() - 1, 5).getValues().forEach(function (r, i) {
      if (!r[0]) return;
      out.fees[String(r[0])] = Number(r[4]) || 0;
      out.feeRow[String(r[0])] = i + 2;
    });
  }
  _fin = out;
  return out;
}

function finCacheDrop_() { cacheDropBig_('mf_v1'); }
function finPaid_(eventId, playerId) { var x = finMap_().pays[eventId + '|' + playerId]; return x ? x.paid : null; }
function feeOf_(eventId) { return finMap_().fees[String(eventId)] || 0; }
// Игрок уже оплатил тот же турнир в другой группе той же команды (U9-A и U9-B): второй взнос не нужен.
function siblingPaid_(eventId, playerId) {
  var evs = sheetOf_('МАТЧИ').getDataRange().getValues().slice(1);
  var me = evs.filter(function (r) { return String(r[0]) === String(eventId); })[0];
  if (!me) return false;
  var base = function (t) { return String(t).replace(/\s*-\s*[A-Za-z0-9]+$/, '').toLowerCase(); };
  var pays = finMap_().pays;
  return evs.some(function (r) {
    if (String(r[0]) === String(eventId) || String(r[2]) !== String(me[2]) || String(r[3]) !== String(me[3])) return false;
    if (base(r[1]) !== base(me[1])) return false;
    var x = pays[r[0] + '|' + playerId];
    return !!x && x.paid === true;
  });
}

// Для экрана админа: взносы событий и оплаты игроков (кэш 90 с).
function finData_() {
  var hit = cacheGetBig_('mf_v1');
  if (hit) return hit;
  var m = finMap_(), d = { fees: m.fees, pays: {} };
  Object.keys(m.pays).forEach(function (k) { var x = m.pays[k]; d.pays[k] = { paid: x.paid ? 1 : 0, sum: x.sum, method: x.method }; });
  cachePutBig_('mf_v1', d, 90);
  return d;
}

// Записывает или меняет размер взноса события. Ноль разрешён только для уже существующей строки.
function feeSet_(eventId, team, type, name, fee) {
  fee = Number(fee);
  if (!(fee >= 0) || CONFIG.DRY_RUN) return;
  var sh = dbSheet_(EFEE_SHEET, EFEE_HEAD), m = finMap_(), row = m.feeRow[eventId];
  if (!row && !(fee > 0)) return;                 // новое событие без взноса строку не создаёт
  if (row) sh.getRange(row, 5).setValue(fee);
  else { row = sh.getLastRow() + 1; sh.getRange(row, 1, 1, 5).setValues([[eventId, team, type, name, fee]]); m.feeRow[eventId] = row; }
  m.fees[eventId] = fee;
  finCacheDrop_();
}

// Создаёт или обновляет оплату игрока по событию. v: {paid, sum, method, date 'YYYY-MM-DD', comment}.
function finUpsert_(eventId, playerId, name, v) {
  if (CONFIG.DRY_RUN) return;
  var sh = dbSheet_(MFEE_SHEET, MFEE_HEAD), m = finMap_(), key = eventId + '|' + playerId, cur = m.pays[key];
  var row = cur ? cur.row : sh.getLastRow() + 1, iso = /^\d{4}-\d\d-\d\d$/;
  var d = v.date || (cur ? cur.date : '');
  var comment = v.comment ? v.comment : (cur ? cur.comment : '');
  sh.getRange(row, 1, 1, 8).setValues([[eventId, playerId, name, !!v.paid, Number(v.sum) || 0, v.method || '', iso.test(d) ? serialOf(d) : '', comment]]);
  nfSafe_(sh.getRange(row, 7), 'dd.MM.yyyy');
  m.pays[key] = { row: row, paid: !!v.paid, sum: Number(v.sum) || 0, method: v.method || '', date: d, comment: comment };
  finCacheDrop_();
}