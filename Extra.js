// ===== Дополнительные тренировки: чтение (шаг 1, без записи) =====

var _extraSS = null;   // файл дополнительных открываем один раз за запуск
function extraSS_() {
  return clubSource_('EXTRA_ID', 'Не задан EXTRA_ID');
}

// Название листа 'дд.мм' -> 'гггг-мм-дд' (год: текущий, а если дата далеко в будущем — прошлый)
function extraDate_(name) {
  var m = /^(\d{1,2})\.(\d{2})/.exec(String(name).trim());
  if (!m) return '';
  var tz = Session.getScriptTimeZone(), now = new Date();
  var y = Number(Utilities.formatDate(now, tz, 'yyyy'));
  if (Date.UTC(y, +m[2] - 1, +m[1]) > now.getTime() + 60 * 86400000) y--;
  return y + '-' + m[2] + '-' + ('0' + m[1]).slice(-2);
}

// Тест: ничего не пишет
function extraTest_() {
  var evs = extraParseRaw_();
  Logger.log('Дат (листов) найдено: ' + evs.length);
  evs.slice(0, 6).forEach(function (e) {
    var paid = e.players.filter(function (p) { return p.paid; }).length;
    Logger.log(e.id + ' | записано ' + e.players.length + ' из ' + e.slots + ' строк | оплачено ' + paid);
  });
  var pl = 0, pd = 0;
  evs.forEach(function (e) { pl += e.players.length; e.players.forEach(function (p) { if (p.paid) pd++; }); });
  Logger.log('Всего записей: ' + pl + ', оплачено (Paid=TRUE): ' + pd);
}

// ===== Запись: дополнительные тренировки (только админ) =====
var EXTRA_LOG = 'ДОПОЛНИТЕЛЬНЫЕ ОПЛАТЫ';
var EXTRA_ATT = 'ДОПОЛНИТЕЛЬНЫЕ ОТМЕТКИ';
var _extraDirty = {};

// Разбор листов; старые листы (кроме 4 свежих) берутся из кэша на час
function extraParseRaw_(want) {
  var out = [];
  extraSS_().getSheets().forEach(function (sh, idx) {
    var name = sh.getName();
    if (want && !want(name)) return;
    var date = extraDate_(name);
    if (!date) return;
    var old = !want && idx >= 4;
    if (old) {
      var hit = cacheGetBig_('extrash_' + name);
      if (hit) { out = out.concat(hit); return; }
    }
    var mine = [], last = sh.getLastRow();
    if (last >= 2) {
      var v = sh.getRange(1, 1, last, 4).getValues(), h = -1, i;
      for (i = 0; i < Math.min(v.length, 5); i++) if (String(v[i][0]).trim() === '№') { h = i; break; }
      if (h >= 0) {
        var ev = { id: name + '|' + date, sheet: name, date: date, head: h + 1, last: h + 1, players: [], empty: [], slots: 0 };
        for (var r = h + 1; r < v.length; r++) {
          var n = String(v[r][0]).trim();
          if (!/^\d+$/.test(n)) break;
          var pn = String(v[r][1]).trim();
          ev.slots++;
          ev.last = r + 1;
          if (pn) ev.players.push({ row: r + 1, n: Number(n), name: pn, group: String(v[r][2]).trim(),
            paid: v[r][3] === true || String(v[r][3]).toUpperCase() === 'TRUE' });
          else ev.empty.push(r + 1);
        }
        mine.push(ev);
      }
    }
    if (old) cachePutBig_('extrash_' + name, mine, 3600);
    out = out.concat(mine);
  });
  return out;
}

function extraParse_(fresh) {
  if (!fresh) { var c = cacheGetBig_('extra_v1'); if (c) return c; }
  var evs = extraParseRaw_();
  cachePutBig_('extra_v1', evs, 300);
  return evs;
}

// Для записи: свежее чтение листа этого занятия
function extraFind_(id) {
  var sn = String(id).split('|')[0];
  var evs = extraParseRaw_(function (n) { return n === sn; });
  for (var i = 0; i < evs.length; i++) if (evs[i].id === id) { _extraDirty[evs[i].sheet] = 1; return evs[i]; }
  throw new Error('Тренировка не найдена');
}

var _extraLogSh = null;

// allowDry = true только для отметок: у них свой отчёт о «пробном режиме»
function extraLocked_(fn, allowDry) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (!allowDry) {
      if (CONFIG.DRY_RUN) throw new Error('Пробный режим: в таблицу дополнительных ничего не записано.');
      _extraLogSh = dbSheet_(EXTRA_LOG, IND_HEAD);
      if (!_extraLogSh) throw new Error('Журнал недоступен: ничего не записано');
    }
    return fn();
  } finally {
    _extraLogSh = null;
    cacheDropBig_('extra_v1');
    Object.keys(_extraDirty).forEach(function (n) { cacheDropBig_('extrash_' + n); });
    _extraDirty = {};
    lock.releaseLock();
  }
}

function extraLog_(type, ev, name, amount, method, comment) {
  var sh = _extraLogSh || dbSheet_(EXTRA_LOG, IND_HEAD);
  if (!sh) return;
  sh.appendRow([new Date(), ev.id, name, amount, method || '', type, comment || '']);
  nfSafe_(sh.getRange(sh.getLastRow(), 1), 'dd.MM.yyyy HH:mm');
}

function extraPlayer_(ev, name) {
  var low = String(name).trim().toLowerCase();
  for (var i = 0; i < ev.players.length; i++) if (ev.players[i].name.toLowerCase() === low) return ev.players[i];
  return null;
}

function extraPut_(ev, name, group) {
  if (extraPlayer_(ev, name)) throw new Error('Уже записан на эту тренировку');
  var cap = settingGet_('extra.cap');   // 0 — без ограничения
  if (cap > 0 && ev.players.length >= cap) throw new Error('Мест нет: максимум ' + cap);
  var sh = extraSS_().getSheetByName(ev.sheet), row;
  if (ev.empty.length) row = ev.empty[0];
  else {
    sh.insertRowAfter(ev.last);
    row = ev.last + 1;
    sh.getRange(ev.last, 1, 1, 4).copyTo(sh.getRange(row, 1, 1, 4));
    sh.getRange(row, 1).setValue(ev.slots + 1);
  }
  sh.getRange(row, 2, 1, 3).setValues([[name, group || 'гость', false]]);
  extraLog_('Запись', ev, name, 0, '', group || 'гость');
}

function appExtraAdd(pin, id, name, group) {
  checkAdmin_(pin);
  name = String(name || '').trim();
  if (!name) throw new Error('Укажите имя игрока');
  return extraLocked_(function () { extraPut_(extraFind_(id), name, group); return { ok: true }; });
}

function appExtraRemove(pin, id, name) {
  checkAdmin_(pin);
  return extraLocked_(function () {
    var ev = extraFind_(id), p = extraPlayer_(ev, name);
    if (!p) throw new Error('Игрок не записан');
    if (p.paid) throw new Error('Сначала отмените оплату');
    extraSS_().getSheetByName(ev.sheet).getRange(p.row, 2, 1, 3).setValues([['', '', false]]);
    extraLog_('Снят', ev, p.name, 0, '', '');
    return { ok: true };
  });
}

// Удалить отметки тренировки из ДОПОЛНИТЕЛЬНЫЕ ОТМЕТКИ (снизу вверх, чтобы не сбить номера строк)
function extraRemoveMarks_(id) {
  var sh = adminSS_().getSheetByName(EXTRA_ATT);
  if (!sh || sh.getLastRow() < 2) return 0;
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues(), n = 0;
  for (var i = v.length - 1; i >= 0; i--) {
    if (v[i][0] === id) { sh.deleteRow(i + 2); n++; }
  }
  return n;
}

// Удалить тренировку (лист), только если нет оплаченных
function appExtraEventDelete(pin, id) {
  checkAdmin_(pin);
  return extraLocked_(function () {
    var ev = extraFind_(id), ss = extraSS_();
    if (ev.players.some(function (p) { return p.paid; })) throw new Error('Есть оплаты: сначала отмените их');
    if (ss.getSheets().length < 2) throw new Error('Нельзя удалить единственный лист');
    var names = ev.players.map(function (p) { return p.name; }).join(', ');
    ss.deleteSheet(ss.getSheetByName(ev.sheet));
    var mk = extraRemoveMarks_(ev.id);
    extraLog_('Удалено', ev, '', 0, '', 'игроки: ' + names + '; отметок удалено: ' + mk);
    return { ok: true };
  });
}

// Последняя оплата игрока по тренировке: способ и сумма (для сторно)
function extraLastPay_(id, name) {
  var sh = adminSS_().getSheetByName(EXTRA_LOG);
  if (!sh || sh.getLastRow() < 2) return { method: '', amount: 0 };
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues();
  for (var i = v.length - 1; i >= 0; i--)
    if (v[i][1] === id && v[i][2] === name && v[i][5] === 'Оплата')
      return { method: String(v[i][4] || ''), amount: Number(v[i][3]) || 0 };
  return { method: '', amount: 0 };
}

function appExtraUnpay(pin, id, name) {
  checkAdmin_(pin);
  return extraLocked_(function () {
    var ev = extraFind_(id), p = extraPlayer_(ev, name);
    if (!p) throw new Error('Игрок не записан');
    if (!p.paid) throw new Error('Оплаты нет');
    var last = extraLastPay_(ev.id, p.name);
    extraSS_().getSheetByName(ev.sheet).getRange(p.row, 4).setValue(false);
    extraLog_('Отмена', ev, p.name, -last.amount, last.method, 'отмена оплаты, строка ' + p.row);
    return { ok: true };
  });
}

// ===== Сумма тренировки (хранится в AdminApp) =====
var EXTRA_PRICES = 'ДОПОЛНИТЕЛЬНЫЕ ТРЕНИРОВКИ';
var EXTRA_PRICES_HEAD = ['ID', 'Дата', 'Сумма', 'Изменено'];

function extraPrices_() {
  var sh = adminSS_().getSheetByName(EXTRA_PRICES), map = {};
  if (!sh || sh.getLastRow() < 2) return map;
  sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(function (r) { if (r[0]) map[r[0]] = Number(r[2]) || 0; });
  return map;
}

// Место тренировки, введённое в приложении (лист «МЕСТА ТРЕНИРОВОК» в админ-файле). Ключ — ID тренировки.
var EXTRA_PLACES = 'МЕСТА ТРЕНИРОВОК';
function extraPlaces_() {
  var hit = cacheGetBig_('xpl_v1');
  if (hit) return hit;
  var map = {}, sh = adminSS_().getSheetByName(EXTRA_PLACES);
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) { if (r[0]) map[String(r[0])] = String(r[1] || ''); });
  }
  cachePutBig_('xpl_v1', map, 3600);
  return map;
}
function appSetExtraPlace(pin, id, place) {
  checkAdmin_(pin);
  var p = String(place || '').replace(/\s+/g, ' ').trim();
  if (!id) throw new Error('Тренировка не выбрана');
  if (p.length > 60) throw new Error('Слишком длинное место');
  if (CONFIG.DRY_RUN) return { ok: true, dryRun: true };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { extraPlaceSet_(id, p); } finally { lock.releaseLock(); }
  return { ok: true, dryRun: false };
}
// Записать место; oldId — прежний ID, если тренировка перенесена на другую дату. place undefined — только переименовать.
function extraPlaceSet_(id, place, oldId) {
  var sh = dbSheet_(EXTRA_PLACES, ['ID тренировки', 'Место', 'Изменено']);
  if (!sh) return;
  var from = oldId || id, row = 0;
  if (sh.getLastRow() > 1) {
    var ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(from)) { row = i + 2; break; }
  }
  var val = place;
  if (val === undefined) {
    if (!row) return;
    val = String(sh.getRange(row, 2).getValue() || '');
  }
  var target = row || sh.getLastRow() + 1;
  sh.getRange(target, 1, 1, 3).setValues([[String(id), val, new Date()]]);
  cacheDropBig_('xpl_v1');
}

// fromId — прежний ID, если тренировка перенесена на другую дату
function extraPriceSet_(id, date, amount, fromId) {
  var sh = dbSheet_(EXTRA_PRICES, EXTRA_PRICES_HEAD);
  if (!sh) return;
  var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM.yyyy HH:mm');
  var last = sh.getLastRow(), row = 0, key = fromId || id;
  if (last > 1) {
    var ids = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) if (ids[i][0] === key) { row = i + 2; break; }
  }
  if (row) sh.getRange(row, 1, 1, 4).setValues([[id, date, amount, now]]);
  else sh.appendRow([id, date, amount, now]);
}

function extraAmt_(v) { // '' / null -> null, иначе число с округлением
  if (v === undefined || v === null || v === '') return null;
  var a = Math.round(Number(v) * 100) / 100;
  if (!(a > 0)) throw new Error('Сумма должна быть больше нуля');
  return a;
}

// Должники: прошедшие или сегодняшние тренировки без оплаты; долг = сумма тренировки (если задана)
function extraDebts_(evs, prices) {
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var map = {}, order = [];
  evs.forEach(function (e) {
    if (e.date > today) return;
    e.players.forEach(function (p) {
      if (p.paid) return;
      var k = norm(p.name), pr = prices[e.id] || 0;
      if (!map[k]) { map[k] = { name: p.name, group: p.group, count: 0, total: 0, events: [] }; order.push(k); }
      map[k].count++;
      map[k].total += pr;
      map[k].events.push({ id: e.id, date: e.date, price: pr });
    });
  });
  return order.map(function (k) { return map[k]; })
    .sort(function (a, b) { return b.total - a.total || b.count - a.count || a.name.localeCompare(b.name); });
}

function appExtraData(pin) {
  checkAdmin_(pin);
  var evs = extraParse_(), prices = extraPrices_(), places = extraPlaces_();
  evs.sort(function (a, b) { return b.date.localeCompare(a.date); });
  return {
    cap: settingGet_('extra.cap'),
    events: evs.slice(0, 60).map(function (e) {
      return { id: e.id, date: e.date, price: prices[e.id] || 0, place: places[e.id] || '',
        players: e.players.map(function (p) { return { name: p.name, group: p.group, paid: p.paid }; }) };
    }),
    debts: extraDebts_(evs, prices)
  };
}

// Оплата: по умолчанию сумма тренировки; можно передать другую
function appExtraPay(pin, id, name, method, amount, comment) {
  checkAdmin_(pin);
  payMethodReq_(method);
  var over = extraAmt_(amount);
  return extraLocked_(function () {
    var ev = extraFind_(id), p = extraPlayer_(ev, name);
    if (!p) throw new Error('Игрок не записан');
    if (p.paid) throw new Error('Уже оплачено');
    var sum = over !== null ? over : (extraPrices_()[id] || 0);
    if (!(sum > 0)) throw new Error('Не задана сумма тренировки: укажите её через «Изменить»');
    extraSS_().getSheetByName(ev.sheet).getRange(p.row, 4).setValue(true);
    extraLog_('Оплата', ev, p.name, sum, method, comment || '');
    return { ok: true };
  });
}

// Новая тренировка: дата и сумма за неё
function appExtraAddEvent(pin, date, amount, place) {
  checkAdmin_(pin);
  var pl = String(place || '').replace(/\s+/g, ' ').trim();
  if (pl.length > 60) throw new Error('Слишком длинное место');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Неверная дата');
  var amt = extraAmt_(amount);
  if (amt === null) throw new Error('Введите сумму за тренировку');
  var p = date.split('-'), name = p[2] + '.' + p[1];
  if (extraDate_(name) !== date) throw new Error('Дата вне допустимого диапазона: не дальше 60 дней вперёд и не старше ~10 месяцев');
  return extraLocked_(function () {
    var ss = extraSS_();
    if (ss.getSheetByName(name)) return { ok: true, exists: true };
    var sh = ss.insertSheet(name, 0), id = name + '|' + date;
    try {
      nfSafe_(sh.getRange(1, 1), '@').setValue(name);
      sh.getRange(1, 1, 1, 4).merge();
      sh.getRange(2, 1, 1, 4).setValues([['№', 'ФИ ребенка', 'Group', 'Paid']]);
      var rows = [];
      for (var k = 1; k <= 18; k++) rows.push([k, '', '', false]);
      sh.getRange(3, 1, 18, 4).setValues(rows);
      sh.getRange(3, 4, 18, 1).insertCheckboxes();
      sh.getRange(1, 1, 20, 4).setBorder(true, true, true, true, true, true, '#000000', SpreadsheetApp.BorderStyle.SOLID);
      sh.getRange(1, 1, 2, 4).setHorizontalAlignment('center').setFontWeight('bold');
      sh.getRange(3, 1, 18, 1).setHorizontalAlignment('center');
      sh.getRange(3, 4, 18, 1).setHorizontalAlignment('center');
      extraPriceSet_(id, date, amt);
      if (pl) extraPlaceSet_(id, pl);
    } catch (e) { ss.deleteSheet(sh); throw e; }
    _extraDirty[name] = 1;
    extraLog_('Создано', { id: id }, '', 0, '', 'сумма ' + amt);
    return { ok: true, exists: false };
  });
}

// Переименовать ID тренировки в листе AdminApp (col — номер столбца с ID)
function extraRenameId_(sheetName, col, oldId, newId) {
  var sh = adminSS_().getSheetByName(sheetName);
  if (!sh || sh.getLastRow() < 2) return;
  var rg = sh.getRange(2, col, sh.getLastRow() - 1, 1), v = rg.getValues(), ch = false;
  v.forEach(function (r) { if (r[0] === oldId) { r[0] = newId; ch = true; } });
  if (ch) rg.setValues(v);
}

// Изменить дату и/или сумму тренировки
function appExtraEventEdit(pin, id, date, amount, place) {
  checkAdmin_(pin);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Неверная дата');
  var pl = place === undefined ? undefined : String(place).replace(/\s+/g, ' ').trim();
  if (pl && pl.length > 60) throw new Error('Слишком длинное место');
  var amt = extraAmt_(amount), p0 = date.split('-');
  if (extraDate_(p0[2] + '.' + p0[1]) !== date) throw new Error('Дата вне допустимого диапазона: не дальше 60 дней вперёд и не старше ~10 месяцев');
  return extraLocked_(function () {
    var ev = extraFind_(id), ss = extraSS_(), p = p0, name = p[2] + '.' + p[1], newId = name + '|' + date;
    if (name !== ev.sheet) {
      if (ss.getSheetByName(name)) throw new Error('Лист «' + name + '» уже есть');
      var sh = ss.getSheetByName(ev.sheet);
      sh.setName(name);
      if (ev.head > 1) nfSafe_(sh.getRange(1, 1), '@').setValue(name);
      extraRenameId_(EXTRA_ATT, 1, ev.id, newId);   // отметки
      extraRenameId_(EXTRA_LOG, 2, ev.id, newId);   // журнал оплат: суммы и даты не трогаем, только метка события
      _extraDirty[name] = 1;
    }
    var price = amt !== null ? amt : (extraPrices_()[id] || 0);
    if (price > 0 || newId !== id) extraPriceSet_(newId, date, price, id);
    extraPlaceSet_(newId, pl, id);
    extraLog_('Изменено', { id: newId }, '', 0, '', 'было: ' + ev.id + (amt !== null ? '; сумма ' + amt : ''));
    return { ok: true };
  });
}

// Тест ЗАПИСИ — только на копии: создаёт тренировку через 30 дней и убирает её
function extraWriteTest_() {
  var pin = prop_('APP_ADMIN_PIN'), tz = Session.getScriptTimeZone();
  function ds(d) { return Utilities.formatDate(new Date(Date.now() + d * 86400000), tz, 'yyyy-MM-dd'); }
  var d1 = ds(30), d2 = ds(31), nm = 'ТЕСТ Гость';
  appExtraAddEvent(pin, d1, 30);                    Logger.log('1. тренировка создана, сумма 30');
  var id1 = d1.slice(8) + '.' + d1.slice(5, 7) + '|' + d1;
  appExtraAdd(pin, id1, nm, 'гость');               Logger.log('2. записан');
  appExtraPay(pin, id1, nm, 'Наличные');            Logger.log('3. оплата (сумма тренировки 30)');
  appExtraUnpay(pin, id1, nm);                      Logger.log('4. отмена оплаты');
  appExtraRemove(pin, id1, nm);                     Logger.log('5. снят');
  appExtraEventEdit(pin, id1, d2, 40);              Logger.log('6. перенесена на ' + d2 + ', сумма 40');
  var id2 = d2.slice(8) + '.' + d2.slice(5, 7) + '|' + d2;
  appExtraEventDelete(pin, id2);                    Logger.log('7. удалена');
  Logger.log('Готово. В AdminApp: ДОПОЛНИТЕЛЬНЫЕ ОПЛАТЫ (Создано, Запись, Оплата 30, Отмена -30, Снят, Изменено, Удалено) и ДОПОЛНИТЕЛЬНЫЕ ТРЕНИРОВКИ (строка с суммой 40)');
}

// ===== Отметки: «Дополнительные» как группа раздела Отметки =====
var EXTRA_GROUP = 'Дополнительные';

function extraIsGroup_(name) { return String(name || '') === EXTRA_GROUP; }

// Тренировки на дату: читаем только лист этой даты (быстро)
function extraParseForDate_(date) {
  var p = date.split('-'), key = p[2] + '.' + p[1];
  return extraParseRaw_(function (n) { return String(n).trim() === key; })
    .filter(function (e) { return e.date === date; });
}

function extraGroups_(dateStr) {
  try { return extraParse_().some(function (e) { return e.date === dateStr; }) ? [{ name: EXTRA_GROUP, sched: true }] : []; }
  catch (e) { return []; } // нет EXTRA_ID или доступа — просто не показываем группу
}

function extraEventByDate_(dateStr) {
  var evs = extraParseForDate_(dateStr);
  if (!evs.length) throw new Error('На эту дату дополнительной тренировки нет');
  return evs[0];
}

function extraMarks_(id) {
  var sh = adminSS_().getSheetByName(EXTRA_ATT), map = {};
  if (!sh || sh.getLastRow() < 2) return map;
  sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(function (r) {
    if (r[0] === id) map[norm(r[1])] = (r[2] === true || String(r[2]).toUpperCase() === 'TRUE');
  });
  return map;
}

function extraRoster_(dateStr) {
  var ev = extraEventByDate_(dateStr), marks = extraMarks_(ev.id);
  return ev.players.map(function (p) {
    var o = { id: 'ext:' + p.name, name: p.name }, k = norm(p.name);
    if (marks.hasOwnProperty(k)) o.mark = marks[k] ? 'p' : 'a';
    return o;
  });
}

function extraSaveMarks_(pin, dateStr, marks) {
  return extraLocked_(function () {
    var ev = extraEventByDate_(dateStr), names = {};
    ev.players.forEach(function (p) { names[norm(p.name)] = p.name; });
    var sh = dbSheet_(EXTRA_ATT, IND_ATT_HEAD);
    var report = { dryRun: false, group: EXTRA_GROUP, date: dateStr, results: [] };
    if (!sh) { report.dryRun = true; return report; }
    var last = sh.getLastRow(), idx = {};
    (last > 1 ? sh.getRange(2, 1, last - 1, 2).getValues() : []).forEach(function (r, i) { idx[r[0] + '|' + norm(r[1])] = i + 2; });
    var who = appWho(pin) || 'trainer';
    var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM.yyyy HH:mm');
    marks.forEach(function (m) {
      var k = norm(m.name);
      if (!names[k]) { report.results.push({ name: m.name, result: 'НЕ записано: нет в списке тренировки' }); return; }
      var vals = [ev.id, names[k], !!m.present, who, now], row = idx[ev.id + '|' + k];
      if (row) sh.getRange(row, 1, 1, 5).setValues([vals]);
      else { sh.appendRow(vals); idx[ev.id + '|' + k] = sh.getLastRow(); }
      report.results.push({ name: m.name, result: 'записан' });
    });
    return report;
  }, true);
}

// Сбросить кэш старых листов дополнительных (кнопка «Обновить данные»)
function extraDropSheetCache_() {
  try { extraSS_().getSheets().forEach(function (s) { cacheDropBig_('extrash_' + s.getName()); }); } catch (e) {}
}

// Дополнительные тренировки одного игрока (для «Приёма оплат» и карточки)
function appExtraOfPlayer(pin, id) {
  checkAdmin_(pin);
  var name = '';
  (regData_().players || []).some(function (p) {
    if (String(p.id) === String(id)) { name = p.name; return true; }
    return false;
  });
  if (!name) return [];
  var key = norm(name), evs = extraParse_(), prices = extraPrices_(), out = [];
  evs.forEach(function (ev) {
    ev.players.forEach(function (pp) {
      if (norm(pp.name) === key) out.push({
        id: ev.id, name: pp.name, date: ev.date, paid: !!pp.paid,
        price: Number(prices[ev.id]) || 0, label: 'Дополнительная ' + String(ev.id).split('|')[0]
      });
    });
  });
  // свежие сверху: сортируем по дате (гггг-мм-дд), которая стоит в id после «|»
  out.sort(function (a, b) {
    var x = String(a.id).split('|')[1] || '', y = String(b.id).split('|')[1] || '';
    return x < y ? 1 : x > y ? -1 : 0;
  });
  // последние 8 оплаченных и все неоплаченные
  var res = [], n = 0;
  out.forEach(function (o) {
    if (!o.paid || n < 8) { res.push(o); if (o.paid) n++; }
  });
  return res;
}
// Отметки «написал(а)» по неоплаченным тренировкам: лист AdminApp «ОТМЕТКИ СООБЩЕНИЙ» (событие, игрок).
var WROTE_SHEET = 'ОТМЕТКИ СООБЩЕНИЙ', WROTE_HEAD = ['Событие', 'Игрок'];

function appWroteList(pin) {
  checkAdmin_(pin);
  var sh = dbRead_(WROTE_SHEET);
  if (!sh) return [];
  var n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, 2).getValues()
    .filter(function (r) { return String(r[0]) && String(r[1]); })
    .map(function (r) { return String(r[0]) + '|' + String(r[1]); });
}

// keys: список «событие|игрок», которые отмечены сейчас; лист перезаписывается целиком
function appWroteSet(pin, keys) {
  checkAdmin_(pin);
  if (CONFIG.DRY_RUN) return { ok: true, dryRun: true };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = dbSheet_(WROTE_SHEET, WROTE_HEAD);
    var n = Math.max(sh.getLastRow() - 1, 1);
    // Текстовый формат до записи: иначе «11.10» Sheets превращает в дату, и отметка не совпадает при чтении
    nfSafe_(sh.getRange(2, 1, Math.max(sh.getMaxRows() - 1, n), 2), '@');
    sh.getRange(2, 1, n, 2).clearContent();
    var rows = (keys || []).map(function (k) { var i = String(k).indexOf('|'); return [String(k).slice(0, i), String(k).slice(i + 1)]; });
    if (rows.length) sh.getRange(2, 1, rows.length, 2).setValues(rows);
    return { ok: true, count: rows.length };
  } finally {
    lock.releaseLock();
  }
}
