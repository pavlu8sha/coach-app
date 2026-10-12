/** Сборы: сборы, тарифы, участники и платежи. Листы создаются в таблице приложения. Ничего не удаляет. */

var CAMP_SHEET = 'СБОРЫ', CAMP_TAR = 'ТАРИФЫ СБОРОВ', CAMP_PARTS = 'УЧАСТНИКИ СБОРОВ', CAMP_PAYS = 'ОПЛАТЫ СБОРОВ';
var CAMP_CACHE = 'camp_v1';
var _campSS = null;
function campSS_() {
  if (_campSS) return _campSS;
  var id = PropertiesService.getScriptProperties().getProperty('ADMIN_ID');
  if (!id) throw new Error('Не задан ADMIN_ID в свойствах скрипта');
  _campSS = SpreadsheetApp.openById(id);
  return _campSS;
}

function campSheet_(name, headers, seed) {
  var ss = campSS_(), sh = ss.getSheetByName(name);
  if (sh) return sh;
  if (CONFIG.DRY_RUN) return null;
  sh = ss.insertSheet(name);
  sh.appendRow(headers);
  sh.setFrozenRows(1);
  if (seed) seed(sh);
  return sh;
}

function campSheets_() {
  var cs = campSheet_(CAMP_SHEET, ['ID сбора', 'Название', 'Место', 'Начало', 'Конец', 'Бронь, ₾', 'Срок брони', 'Срок полной оплаты', 'Активен']);
  var ts = campSheet_(CAMP_TAR, ['ID сбора', 'Тариф', 'Цена, ₾', 'Активен']);
  var ps = campSheet_(CAMP_PARTS, ['ID записи', 'ID сбора', 'ID игрока', 'ФИ', 'Группа / академия', 'Тариф', 'Сумма, ₾', 'Размер футболки', 'Комментарий', 'Статус', 'Дата записи', 'Гость']);
  var ys = campSheet_(CAMP_PAYS, ['Время', 'Дата', 'ID сбора', 'ID записи', 'ID игрока', 'ФИ', 'Сумма', 'Тип', 'Способ', 'Комментарий']);
  return { cs: cs, ts: ts, ps: ps, ys: ys };
}

function campDrop_() { cacheDropBig_(CAMP_CACHE); }
function r2_(x) { return Math.round(x * 100) / 100; }
function campOn_(v) { return !/^(нет|no|false|0)$/i.test(String(v).trim()); }

// Все данные сборов (кэш сбрасывается при каждой записи; срок кэша на деле не короче 15 минут).
function campAll_() {
  var hit = cacheGetBig_(CAMP_CACHE);
  if (hit) return hit;
  var s = campSheets_(), out = { camps: [], tariffs: [], parts: [], pays: [] };
  function rows(sh, cols) { return sh && sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, cols).getValues() : []; }
  rows(s.cs, 9).forEach(function (r) {
    if (!r[0]) return;
    out.camps.push({ id: String(r[0]), name: String(r[1]), place: String(r[2]), start: isoOf_(r[3]), end: isoOf_(r[4]),
      deposit: Number(r[5]) || 0, depositBy: isoOf_(r[6]), payBy: isoOf_(r[7]), active: campOn_(r[8]) });
  });
  rows(s.ts, 4).forEach(function (r, i) {
    if (!r[0] || !r[1]) return;
    out.tariffs.push({ row: i + 2, camp: String(r[0]), name: String(r[1]).trim(), price: Number(r[2]) || 0, active: campOn_(r[3]) });
  });
  rows(s.ps, 12).forEach(function (r, i) {
    if (!r[0]) return;
    out.parts.push({ row: i + 2, id: String(r[0]), camp: String(r[1]), pid: String(r[2] || ''), name: String(r[3]), grp: String(r[4] || ''),
      tariff: String(r[5]), sum: Number(r[6]) || 0, size: String(r[7] || ''), comment: String(r[8] || ''),
      status: String(r[9] || 'Записан'), date: isoOf_(r[10]), guest: String(r[11] || '') === 'да' });
  });
  rows(s.ys, 10).forEach(function (r, i) {
    if (!r[0]) return;
    out.pays.push({ row: i + 2, date: isoOf_(r[1]), camp: String(r[2]), part: String(r[3]), name: String(r[5]),
      amount: Number(r[6]) || 0, type: String(r[7]), method: String(r[8] || ''), comment: String(r[9] || '') });
  });
  cachePutBig_(CAMP_CACHE, out, 60);
  return out;
}

function campFind_(all, campId) {
  return all.camps.filter(function (c) { return c.id === campId; })[0] || all.camps.filter(function (c) { return c.active; })[0] || all.camps[0] || null;
}

function campLocked_(fn) {
  var lock = LockService.getScriptLock();
  if (!CONFIG.DRY_RUN) lock.waitLock(20000);
  try { return fn(); } finally { if (!CONFIG.DRY_RUN) lock.releaseLock(); }
}

// Данные экрана «Сборы» по одному сбору.
function appCampData(pin, campId) {
  checkAdmin_(pin);
  var all = campAll_(), td = today_(), camp = campFind_(all, campId);
  var list = all.camps.map(function (c) { return { id: c.id, name: c.name }; });
  if (!camp) return { camps: list, camp: null, tariffs: [], parts: [], totals: {} };
  var paidOf = {}, hist = {}, rev = {};
  all.pays.forEach(function (y) {
    if (y.camp !== camp.id) return;
    paidOf[y.part] = (paidOf[y.part] || 0) + y.amount;
    var m = /строка (\d+)$/.exec(y.comment);
    if (y.type === 'Отмена' && m) rev[m[1]] = true;
  });
  all.pays.forEach(function (y) {
    if (y.camp !== camp.id) return;
    (hist[y.part] = hist[y.part] || []).push({ row: y.row, date: y.date, amount: y.amount, type: y.type, method: y.method, comment: y.comment,
      canCancel: y.amount > 0 && !rev[y.row] && (y.type === 'Бронь' || y.type === 'Оплата'), reversed: y.amount > 0 && !!rev[y.row] });
  });
  var T = { n: 0, sum: 0, paid: 0, debt: 0, booked: 0, byTariff: {} };
  var parts = all.parts.filter(function (p) { return p.camp === camp.id; }).map(function (p) {
    var paid = r2_(paidOf[p.id] || 0), debt = Math.max(r2_(p.sum - paid), 0), cancelled = p.status === 'Отказ';
    var st = cancelled ? 'cancelled' : (p.sum > 0 && paid >= p.sum ? 'paid' : (paid >= camp.deposit && camp.deposit > 0 ? 'booked' : (paid > 0 ? 'partial' : 'none')));
    var lateDep = !cancelled && !!camp.depositBy && td > camp.depositBy && paid < camp.deposit;
    var lateFull = !cancelled && !!camp.payBy && td > camp.payBy && debt > 0;
    if (!cancelled) {
      T.n++; T.sum += p.sum; T.paid += paid; T.debt += debt; if (st === 'booked' || st === 'paid') T.booked++;
      var b = T.byTariff[p.tariff] = T.byTariff[p.tariff] || { n: 0, sum: 0 };
      b.n++; b.sum += p.sum;
    }
    return { id: p.id, pid: p.pid, name: p.name, grp: p.grp, tariff: p.tariff, sum: p.sum, size: p.size, comment: p.comment, status: p.status,
      guest: p.guest, paid: paid, debt: debt, st: st, lateDep: lateDep, lateFull: lateFull, hist: (hist[p.id] || []).reverse() };
  });
  parts.sort(function (a, b) { return a.name.localeCompare(b.name); });
  return { camps: list, camp: camp, tariffs: all.tariffs.filter(function (t) { return t.camp === camp.id; }), parts: parts, totals: T };
}

// o: {camp, pid | guest:true+guestName+guestInfo, tariff, sum, size, comment}
function appCampAdd(pin, o) {
  checkAdmin_(pin);
  var all = campAll_(), camp = campFind_(all, o.camp);
  if (!camp) throw new Error('Сбор не найден');
  var t = all.tariffs.filter(function (x) { return x.camp === camp.id && x.active && x.name === o.tariff; })[0];
  if (!t) throw new Error('Выберите тариф');
    var rawSum = String(o.sum == null ? '' : o.sum).trim();
    var sum = r2_(rawSum === '' ? t.price : Number(rawSum));
    if (!(sum >= 0)) throw new Error('Сумма не может быть отрицательной');
  var pid = '', name = '', grp = '', guest = '';
  if (o.guest) {
    name = String(o.guestName || '').replace(/\s+/g, ' ').trim();
    if (!name) throw new Error('Введите ФИ гостя');
    grp = String(o.guestInfo || '').trim(); guest = 'да';
  } else {
    var p = regData_().players.filter(function (x) { return x.id === o.pid; })[0];
    if (!p) throw new Error('Игрок не найден');
    pid = p.id; name = p.name; grp = p.group;
  }
  return campLocked_(function () {
    campDrop_();
    var fresh = campAll_(), max = 0;
    if (fresh.parts.some(function (x) { return x.camp === camp.id && x.status !== 'Отказ' && (pid ? x.pid === pid : norm(x.name) === norm(name)); })) {
      throw new Error(name + ' уже записан(а) на этот сбор');
    }
    fresh.parts.forEach(function (x) { var m = /(\d+)$/.exec(x.id); if (m) max = Math.max(max, Number(m[1])); });
    var id = 'CP-' + ('0000' + (max + 1)).slice(-4);
    if (!CONFIG.DRY_RUN) {
      var ps = campSheets_().ps, r = ps.getLastRow() + 1;
      ps.getRange(r, 1, 1, 12).setValues([[id, camp.id, pid, name, grp, t.name, sum, String(o.size || '').trim(), String(o.comment || '').trim(), 'Записан', serialOf(today_()), guest]]);
      ps.getRange(r, 11).setNumberFormat('dd.MM.yyyy');
      logChange_(pid, name, 'запись на сбор', '', camp.name + ', ' + t.name + ', ' + sum + ' ₾');
      campDrop_();
    }
    return { ok: true, dryRun: CONFIG.DRY_RUN, id: id };
  });
}

// c: {tariff, sum, size, comment, status}. Ничего не удаляет: отказ ставится статусом.
function appCampUpdate(pin, id, c) {
  checkAdmin_(pin);
  c = c || {};
  var sum = Number(c.sum);
  if (!(sum > 0)) throw new Error('Введите сумму больше нуля');
  var status = c.status === 'Отказ' ? 'Отказ' : 'Записан';
  return campLocked_(function () {
    campDrop_();
    var all = campAll_(), p = all.parts.filter(function (x) { return x.id === id; })[0];
    if (!p) throw new Error('Запись не найдена');
    var paidNow = 0;
    all.pays.forEach(function (y) { if (y.part === id) paidNow += y.amount; });
    paidNow = r2_(paidNow);
    if (status === 'Отказ' && paidNow > 0) throw new Error('Есть платежи (' + paidNow + ' ₾): сначала отмените их, потом отмечайте отказ');
    if (sum < paidNow) throw new Error('Сумма меньше уже внесённой (' + paidNow + ' ₾)');
    var t = all.tariffs.filter(function (x) { return x.camp === p.camp && x.name === c.tariff; })[0];
    if (!t) throw new Error('Выберите тариф');
    if (!CONFIG.DRY_RUN) {
      campSheets_().ps.getRange(p.row, 6, 1, 5).setValues([[t.name, sum, String(c.size || '').trim(), String(c.comment || '').trim(), status]]);
      logChange_(p.pid, p.name, 'изменение записи на сбор', p.tariff + ', ' + p.sum + ' ₾, ' + p.status, t.name + ', ' + sum + ' ₾, ' + status);
      campDrop_();
    }
    return { ok: true, dryRun: CONFIG.DRY_RUN };
  });
}

// type: 'Бронь' или 'Оплата'. method: 'Наличные' или 'Перевод'.
function appCampPay(pin, id, amount, type, dateStr, comment, method) {
  checkAdmin_(pin);
  amount = r2_(Number(amount));
  if (!(amount > 0)) throw new Error('Введите сумму больше нуля');
  if (PAY_METHODS.indexOf(method) < 0) throw new Error('Выберите способ оплаты: наличные или перевод');
  type = type === 'Бронь' ? 'Бронь' : 'Оплата';
  return campLocked_(function () {
    campDrop_();
    var all = campAll_(), p = all.parts.filter(function (x) { return x.id === id; })[0];
    if (!p) throw new Error('Запись не найдена');
    if (p.status === 'Отказ') throw new Error('Участник отказался от сбора');
    var paid = 0;
    all.pays.forEach(function (y) { if (y.part === id) paid += y.amount; });
    paid = r2_(paid);
    if (!CONFIG.DRY_RUN) {
      var ys = campSheets_().ys, r = ys.getLastRow() + 1;
      if (isRecentDup_(ys, [[4, p.id], [7, String(amount)], [8, type], [9, method]], 15)) throw new Error('Похоже на повтор: такой платёж только что записан. Обновите страницу');
      ys.getRange(r, 1, 1, 10).setValues([[new Date(), dateStr || today_(), p.camp, p.id, p.pid, p.name, amount, type, method, comment || '']]);
      ys.getRange(r, 7).setNumberFormat('#,##0.00 "₾"');
      campDrop_();
    }
    return { ok: true, dryRun: CONFIG.DRY_RUN, paid: r2_(paid + amount), debt: Math.max(r2_(p.sum - paid - amount), 0) };
  });
}

// Отмена платежа: пишет строку с минусом, ничего не удаляет.
function appCampCancel(pin, row) {
  checkAdmin_(pin);
  row = Number(row);
  return campLocked_(function () {
    campDrop_();
    var all = campAll_(), y = all.pays.filter(function (x) { return x.row === row; })[0];
    if (!y || !(y.amount > 0) || (y.type !== 'Бронь' && y.type !== 'Оплата')) throw new Error('Эту запись отменить нельзя');
    var tag = 'отмена платежа, строка ' + row;
    if (all.pays.some(function (x) { return x.type === 'Отмена' && x.comment === tag; })) throw new Error('Этот платёж уже отменён');
    var p = all.parts.filter(function (x) { return x.id === y.part; })[0];
    if (!CONFIG.DRY_RUN) {
      var ys = campSheets_().ys, r = ys.getLastRow() + 1;
      ys.getRange(r, 1, 1, 10).setValues([[new Date(), today_(), y.camp, y.part, p ? p.pid : '', y.name, -y.amount, 'Отмена', y.method, tag]]);
      ys.getRange(r, 7).setNumberFormat('#,##0.00 "₾"');
      logChange_(p ? p.pid : '', y.name, 'отмена платежа (сбор)', '', y.amount + ' ₾');
      campDrop_();
    }
    return { ok: true, dryRun: CONFIG.DRY_RUN };
  });
}

// Проверка: создаёт листы сборов (если их нет) и показывает, что прочитано.
function campsTest() {
  var all = campAll_();
  Logger.log('Сборов: ' + all.camps.length + ', тарифов: ' + all.tariffs.length + ', участников: ' + all.parts.length + ', платежей: ' + all.pays.length);
  all.camps.forEach(function (c) { Logger.log(c.id + ' ' + c.name + ', ' + c.start + ' — ' + c.end + ', бронь ' + c.deposit + ' до ' + c.depositBy + ', оплата до ' + c.payBy); });
  all.tariffs.forEach(function (t) { Logger.log('  тариф: ' + t.name + ' = ' + t.price); });
}

// Есть ли в журнале недавняя (за secs секунд) строка с теми же значениями.
// cols: пары [номер колонки с 1, значение]. Смотрим последние 25 строк, колонка A — время записи.
function isRecentDup_(sh, cols, secs) {
  if (!sh) return false;
  var last = sh.getLastRow();
  if (last < 2) return false;
  var from = Math.max(2, last - 24), n = last - from + 1, width = sh.getLastColumn();
  var v = sh.getRange(from, 1, n, width).getValues(), now = Date.now();
  return v.some(function (r) {
    if (!(r[0] instanceof Date) || now - r[0].getTime() > secs * 1000) return false;
    return cols.every(function (c) { return String(r[c[0] - 1]) === String(c[1]); });
  });
}

// Редактор тарифов сбора. rows: [{row, name, price, active}]; row = 0 для нового тарифа.
// Ничего не удаляет: тариф, которого нет в списке, снимается с «Активен».
// Переименовать можно только тариф, по которому никто не записан.
function appCampTariffSave(pin, campId, rows) {
  checkAdmin_(pin);
  if (!Array.isArray(rows) || !rows.length) throw new Error('Нет данных тарифов');
  var all0 = campAll_(), camp = campFind_(all0, campId);
  if (!camp) throw new Error('Сбор не найден');
  var clean = rows.map(function (r) {
    var name = String(r.name || '').replace(/\s+/g, ' ').trim();
    var raw = String(r.price == null ? '' : r.price).trim();
    if (!name) throw new Error('Пустое название тарифа');
    if (raw === '' || !(Number(raw) >= 0)) throw new Error('Тариф «' + name + '»: укажите цену, число не меньше нуля');
    return { row: Number(r.row) || 0, name: name, price: r2_(Number(raw)), active: !!r.active };
  });
  var seen = {};
  clean.forEach(function (c) {
    if (seen[c.name]) throw new Error('Тариф «' + c.name + '» указан дважды');
    seen[c.name] = true;
  });
  return campLocked_(function () {
    campDrop_();
    var fresh = campAll_();
    var mine = fresh.tariffs.filter(function (t) { return t.camp === camp.id; });
    var sent = {};
    clean.forEach(function (c) {
      if (!c.row) return;
      var old = mine.filter(function (t) { return t.row === c.row; })[0];
      if (!old) throw new Error('Тариф не найден: обновите страницу');
      sent[c.row] = true;
      if (old.name !== c.name && fresh.parts.some(function (p) { return p.camp === camp.id && p.tariff === old.name; })) {
        throw new Error('Тариф «' + old.name + '» уже выбран участниками: переименовать нельзя');
      }
    });
    mine.forEach(function (t) {
      if (!sent[t.row] && seen[t.name]) throw new Error('Название «' + t.name + '» уже занято другим тарифом');
    });
    if (!CONFIG.DRY_RUN) {
      var ts = campSheets_().ts;
      clean.forEach(function (c) {
        var vals = [[camp.id, c.name, c.price, c.active ? 'да' : 'нет']];
        if (c.row) ts.getRange(c.row, 1, 1, 4).setValues(vals);
        else ts.getRange(ts.getLastRow() + 1, 1, 1, 4).setValues(vals);
      });
      mine.forEach(function (t) {
        if (!sent[t.row]) ts.getRange(t.row, 4).setValue('нет');
      });
      campDrop_();
    }
    return { ok: true, dryRun: CONFIG.DRY_RUN };
  });
}

// Создать или изменить сбор. o: {id (пусто для нового), name, place, start, end, deposit, depositBy, payBy, active}
// Ничего не удаляет: сбор снимается с «Активен».
function appCampSave(pin, o) {
  checkAdmin_(pin);
  o = o || {};
  var isoRe = /^\d{4}-\d{2}-\d{2}$/;
  var name = String(o.name || '').replace(/\s+/g, ' ').trim();
  var place = String(o.place || '').trim();
  var start = String(o.start || ''), end = String(o.end || '');
  var dep = String(o.deposit == null ? '' : o.deposit).trim();
  var depBy = String(o.depositBy || ''), payBy = String(o.payBy || '');
  var active = o.active !== false;
  if (!name) throw new Error('Введите название сбора');
  if (!isoRe.test(start) || !isoRe.test(end)) throw new Error('Укажите даты начала и конца');
  if (end < start) throw new Error('Дата конца раньше даты начала');
  if (dep === '' || !(Number(dep) >= 0)) throw new Error('Укажите сумму брони (0, если бронь не нужна)');
  if (depBy && !isoRe.test(depBy)) throw new Error('Неверная дата срока брони');
  if (payBy && !isoRe.test(payBy)) throw new Error('Неверная дата срока полной оплаты');
  if (depBy && payBy && depBy > payBy) throw new Error('Срок брони позже срока полной оплаты');
  if (payBy && payBy > end) throw new Error('Срок полной оплаты позже конца сбора');
  return campLocked_(function () {
    campDrop_();
    var all = campAll_(), id = String(o.id || ''), cur = null, max = 0;
    all.camps.forEach(function (c) {
      var m = /(\d+)$/.exec(c.id);
      if (m) max = Math.max(max, Number(m[1]));
      if (c.id === id) cur = c;
    });
    if (id && !cur) throw new Error('Сбор не найден: обновите страницу');
    if (!cur) id = 'CMP-' + ('0000' + (max + 1)).slice(-4);
    if (!CONFIG.DRY_RUN) {
      var cs = campSheets_().cs, r = 0;
      if (cur) {
        var n = cs.getLastRow() - 1;
        var ids = n > 0 ? cs.getRange(2, 1, n, 1).getValues() : [];
        for (var i = 0; i < ids.length; i++) {
          if (String(ids[i][0]) === id) { r = i + 2; break; }
        }
        if (!r) throw new Error('Сбор не найден: обновите страницу');
      } else {
        r = cs.getLastRow() + 1;
      }
      cs.getRange(r, 1, 1, 9).setValues([[id, name, place, serialOf(start), serialOf(end), Number(dep),
        depBy ? serialOf(depBy) : '', payBy ? serialOf(payBy) : '', active ? 'да' : 'нет']]);
      cs.getRange(r, 4, 1, 2).setNumberFormat('dd.MM.yyyy');
      cs.getRange(r, 7, 1, 2).setNumberFormat('dd.MM.yyyy');
      campDrop_();
    }
    return { ok: true, dryRun: CONFIG.DRY_RUN, id: id };
  });
}