// ===== Индивидуальные / вратарские: чтение (шаг 1, без записи) =====
// Цена занятия — indPrice_(дата) из Prices.js (лист «ЦЕНЫ», с месяца начала действия)
var IND_HEAD_RE = /^(\d{1,2}):(\d{2})\s+(\d{2})\.(\d{2})\.(\d{4})\s*(вратари)?\s*$/i;

var _indSS = null;  // файл индивидуальных открываем один раз за запуск
function indSS_() {
  if (_indSS) return _indSS;
  var t0 = Date.now();
  var id = prop_('IND_ID');
  if (!id) throw new Error('Не задан IND_ID');
  _indSS = SpreadsheetApp.openById(id);
  Logger.log('открытие IND: ' + (Date.now() - t0) + ' мс');
  return _indSS;
}

// Тест: ничего не пишет, только показывает, что нашлось
function indTest_() {
  var evs = indParse_();
  Logger.log('Занятий найдено: ' + evs.length);
  var players = 0, paid = 0;
  evs.slice(0, 6).forEach(function (e) {
    Logger.log(e.id + ' | ' + (e.goalkeepers ? 'вратари' : 'индив.') + ' | тема: ' + e.theme +
      ' | записано ' + e.players.length + ' из ' + e.slots + ' слотов');
  });
  evs.forEach(function (e) {
    players += e.players.length;
    e.players.forEach(function (p) { if (p.paid) paid++; });
  });
  Logger.log('Всего записей: ' + players + ', оплачено (Paid=TRUE): ' + paid + ' → ' + (paid * indPrice_('')) + ' ₾ по текущей цене');
}

// ===== Запись (только админ) =====
var IND_LOG = 'ИНДИВИДУАЛЬНЫЕ ОПЛАТЫ';
var IND_HEAD = ['Дата', 'ID занятия', 'Игрок', 'Сумма', 'Способ', 'Тип', 'Комментарий'];

function indLog_(type, ev, name, amount, method, comment) {
  var sh = dbSheet_(IND_LOG, IND_HEAD);
  if (!sh) return;
  sh.appendRow([new Date(), ev.id, name, amount, method || '', type, comment || '']);
  nfSafe_(sh.getRange(sh.getLastRow(), 1), 'dd.MM.yyyy HH:mm');
}

function indPlayer_(ev, name) {
  var low = String(name).trim().toLowerCase();
  for (var i = 0; i < ev.players.length; i++)
    if (ev.players[i].name.toLowerCase() === low) return ev.players[i];
  return null;
}

// Оплата: сумма 50 ₾ в строке игрока файла оплат (игрок должен быть записан)
function appIndPay(pin, id, name, method, comment) {
  checkAdmin_(pin);
  payMethodReq_(method);
  return indLocked_(function () {
    var ev = indFind_(id);
    indNotOld_(ev);
    var p = indPlayer_(ev, name);
    if (!p) throw new Error('Игрок не записан');
    if (p.paid) throw new Error('Уже оплачено');
    var price = indPrice_(ev.date);
    indPfSetAmount_(ev.date, p.name, price, ev.goalkeepers);
    indLog_('Оплата', ev, p.name, price, method, comment || '');
    return { ok: true };
  });
}

// Отмена оплаты: сумма очищается, строка игрока остаётся
function appIndUnpay(pin, id, name) {
  checkAdmin_(pin);
  return indLocked_(function () {
    var ev = indFind_(id);
    indNotOld_(ev);
    var p = indPlayer_(ev, name);
    if (!p) throw new Error('Игрок не записан');
    if (!p.paid) throw new Error('Оплаты нет');
    indPfSetAmount_(ev.date, p.name, '', ev.goalkeepers);
    indLog_('Отмена', ev, p.name, -(Number(p.amount) > 0 ? Number(p.amount) : indPrice_(ev.date)), indLastPayMethod_(ev.id, p.name), 'отмена оплаты');
    return { ok: true };
  });
}

// Отмена записи: строка игрока удаляется из файла оплат
function appIndRemove(pin, id, name) {
  checkAdmin_(pin);
  return indLocked_(function () {
    var ev = indFind_(id);
    indNotOld_(ev);
    var p = indPlayer_(ev, name);
    if (!p) throw new Error('Игрок не записан');
    if (p.paid) throw new Error('Сначала отмените оплату');
    indPfUnenroll_(ev.date, p.name, ev.goalkeepers);
    indLog_('Снят', ev, p.name, 0, '', '');
    return { ok: true };
  });
}

// Тест ЗАПИСИ — запускать только на копии
function indWriteTest_() {
  var pin = prop_('APP_ADMIN_PIN');
  var evs = indParse_().filter(indAdmIsNew_);
  if (!evs.length) { Logger.log('Нет новых занятий (лист ИНДИВИДУАЛЬНЫЕ ЗАНЯТИЯ)'); return; }
  var e = evs[0], nm = 'ТЕСТ Гость';
  Logger.log('Занятие: ' + e.id);
  appIndAdd(pin, e.id, nm, 'гость');          Logger.log('1. записан');
  appIndPay(pin, e.id, nm, 'Наличные');       Logger.log('2. оплата 50');
  appIndUnpay(pin, e.id, nm);                 Logger.log('3. отмена оплаты');
  appIndRemove(pin, e.id, nm);                Logger.log('4. снят');
  Logger.log('Готово. Проверьте таблицу и лист ИНДИВИДУАЛЬНЫЕ ОПЛАТЫ в AdminApp (4 строки)');
}

// ===== Отметки: индивидуальные / вратари как «группы» раздела Отметки =====
var IND_ATT = 'ИНДИВИДУАЛЬНЫЕ ОТМЕТКИ';
var IND_ATT_HEAD = ['ID занятия', 'Игрок', 'Был', 'Кто отметил', 'Когда'];
var IND_GROUP_RE = /^(Индивидуальные|Вратари)$/;

// Разбор таблицы с кэшем (фактически 15 минут, как и все кэши; прогрев обновляет его каждые 10 минут).
// fresh=true — без кэша, для записи
function indParse_(fresh) {
  if (!fresh) {
    var c = cacheGetBig_('ind_v1');
    if (c) return c;
  }
  var adm = indParseAdm_(), evs = indDropMigrated_(indParseRaw_(), adm).concat(adm);
  cachePutBig_('ind_v1', evs, 60);
  return evs;
}

function indGroupName_(ev) { return ev.goalkeepers ? 'Вратари' : 'Индивидуальные'; }
function indIsGroup_(name) { return IND_GROUP_RE.test(String(name || '')); }

function indMarks_(id) {
  var sh = adminSS_().getSheetByName(IND_ATT), map = {};
  if (!sh || sh.getLastRow() < 2) return map;
  sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(function (r) {
    if (r[0] === id) map[norm(r[1])] = (r[2] === true || String(r[2]).toUpperCase() === 'TRUE');
  });
  return map;
}

function indRoster_(group, dateStr) {
  var ev = indEventByGroup_(group, dateStr), marks = indMarks_(ev.id);
  return ev.players.map(function (p) {
    var o = { id: 'ind:' + p.name, name: p.name };
    var k = norm(p.name);
    if (marks.hasOwnProperty(k)) o.mark = marks[k] ? 'p' : 'a';
    return o;
  });
}

function indSaveMarks_(pin, group, dateStr, marks) {
  return indLocked_(function () {
    var ev = indEventByGroup_(group, dateStr);
    var names = {};
    ev.players.forEach(function (p) { names[norm(p.name)] = p.name; });
    var sh = dbSheet_(IND_ATT, IND_ATT_HEAD);
    var report = { dryRun: false, group: group, date: dateStr, results: [] };
    if (!sh) { report.dryRun = true; return report; }
    var last = sh.getLastRow();
    var rows = last > 1 ? sh.getRange(2, 1, last - 1, 2).getValues() : [];
    var idx = {};
    rows.forEach(function (r, i) { idx[r[0] + '|' + norm(r[1])] = i + 2; });
    var who = appWho(pin) || 'trainer';
    var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM.yyyy HH:mm');
    marks.forEach(function (m) {
      var k = norm(m.name);
      if (!names[k]) { report.results.push({ name: m.name, result: 'НЕ записано: нет в списке занятия' }); return; }
      var vals = [ev.id, names[k], !!m.present, who, now];
      var row = idx[ev.id + '|' + k];
      if (row) sh.getRange(row, 1, 1, 5).setValues([vals]);
      else { sh.appendRow(vals); idx[ev.id + '|' + k] = sh.getLastRow(); }
      report.results.push({ name: m.name, result: 'записан' });
    });
    return report;
  });
}

// Список активных игроков реестра для записи на занятие (только админ)
function appIndPlayers(pin) {
  checkAdmin_(pin);
  return regData_().players
    .filter(function (p) { return p.status === 'Активен'; })
    .map(function (p) { return { name: p.name, group: p.group }; })
    .sort(function (a, b) { return a.name.localeCompare(b.name); });
}

// ===== Постоянные игроки и автосоздание занятий =====
var IND_PERM = 'ПОСТОЯННЫЕ';
var IND_PERM_HEAD = ['Игрок', 'Группа', 'Занятие', 'Активен', 'Добавлен'];
var IND_SLOTS = { '6-ind': 1, '0-ind': 1, '0-gk': 1 }; // сб индив., вс индив., вс вратари

function indSlotKey_(date, gk) {
  var p = date.split('-');
  return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay() + '-' + (gk ? 'gk' : 'ind');
}

function indPermList_() {
  var sh = adminSS_().getSheetByName(IND_PERM);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues().map(function (r, i) {
    return { row: i + 2, name: String(r[0]).trim(), group: String(r[1]).trim(), slot: String(r[2]).trim(),
             active: r[3] === true || String(r[3]).toUpperCase() === 'TRUE' };
  }).filter(function (p) { return p.name; });
}

function appIndData(pin) {
  checkAdmin_(pin);
  var evs = indParse_();
  evs.sort(function (a, b) { return (b.date + b.time).localeCompare(a.date + a.time); });
  var out = evs.slice(0, 60).map(function (e) {
    return { id: e.id, date: e.date, time: e.time, gk: e.goalkeepers, theme: e.theme, price: indPrice_(e.date),
             cap: e.cap, players: e.players.map(function (p) {
               return { name: p.name, group: p.group, paid: p.paid }; }) };
  });
  var perms = indPermList_().filter(function (p) { return p.active; })
    .map(function (p) { return { name: p.name, group: p.group, slot: p.slot }; });
  return { price: indPrice_(''), events: out, perms: perms, debts: indDebts_(evs) };
}

// Вписывает игрока в блок занятия (вызывать внутри блокировки)
// Запись игрока: строка с датой занятия в файле оплат (без лимита мест; лимита в таблице нет)
// Мест на занятии: настройки ind.capIndividual / ind.capGoalkeepers
function indCap_(gk) { return settingGet_(gk ? 'ind.capGoalkeepers' : 'ind.capIndividual'); }

function indPutPlayer_(ev, name, group) {
  indNotOld_(ev);
  if (indPlayer_(ev, name)) throw new Error('Уже записан на это занятие');
  var cap = indCap_(ev.goalkeepers);
  if (ev.players.length >= cap) throw new Error('Мест нет: максимум ' + cap);
  indPfEnroll_(ev.date, name, ev.goalkeepers);
  indLog_('Запись', ev, name, 0, '', group || 'гость');
}

function appIndAdd(pin, id, name, group) {
  checkAdmin_(pin);
  name = String(name || '').trim();
  if (!name) throw new Error('Укажите имя игрока');
  return indLocked_(function () {
    indPutPlayer_(indFind_(id), name, group);
    return { ok: true };
  });
}

function appIndAddEvent(pin, date, time, gk, theme) {
  checkAdmin_(pin);
  return indLocked_(function () { return indCreateEvent_(date, time, gk, theme); });
}

// Добавить в постоянные (+ сразу вписать в ближайшие занятия этого типа)
function appIndPermAdd(pin, name, group, slot) {
  checkAdmin_(pin);
  name = String(name || '').trim();
  if (!name) throw new Error('Укажите имя игрока');
  if (!IND_SLOTS[slot]) throw new Error('Неверное занятие');
  return indLocked_(function () {
    var low = name.toLowerCase();
    if (indPermList_().some(function (p) { return p.active && p.slot === slot && p.name.toLowerCase() === low; }))
      throw new Error('Уже в постоянных на это занятие');
    var tz = Session.getScriptTimeZone();
    var sh = dbSheet_(IND_PERM, IND_PERM_HEAD);
    if (sh) sh.appendRow([name, group || 'гость', slot, true, Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy HH:mm')]);
    var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    var ids = indParse_(true).filter(function (e) {
      return indAdmIsNew_(e) && e.date >= today && indSlotKey_(e.date, e.goalkeepers) === slot;
    }).map(function (e) { return e.id; });
    var n = 0;
    ids.forEach(function (id) {
      try {
        var ev = indFind_(id);
        if (!indPlayer_(ev, name)) { indPutPlayer_(ev, name, group || 'гость'); n++; }
      } catch (e) {}
    });
    return { ok: true, applied: n };
  });
}

// Убрать из постоянных (строка остаётся в листе с Активен = FALSE)
function appIndPermOff(pin, name, slot) {
  checkAdmin_(pin);
  return indLocked_(function () {
    var low = String(name).trim().toLowerCase(), sh = adminSS_().getSheetByName(IND_PERM);
    var f = indPermList_().filter(function (p) { return p.active && p.slot === slot && p.name.toLowerCase() === low; })[0];
    if (!sh || !f) throw new Error('Не найден в постоянных');
    sh.getRange(f.row, 4).setValue(false);
    return { ok: true };
  });
}

// ----- Автосоздание: каждый вторник на ближайшие выходные -----
function indWeeklyCreate() {
  if (CONFIG.DRY_RUN) { Logger.log('DRY_RUN: индивидуальные занятия на выходные не созданы'); return { dryRun: true }; }
  var tz = Session.getScriptTimeZone();
  var y = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd').split('-');
  var base = Date.UTC(+y[0], +y[1] - 1, +y[2]);
  var toSat = (6 - new Date(base).getUTCDay() + 7) % 7;
  function ds(add) { return Utilities.formatDate(new Date(base + (toSat + add) * 86400000), 'UTC', 'yyyy-MM-dd'); }
  var sat = ds(0), sun = ds(1);
  return indLocked_(function () {
    var a = indCreateEvent_(sat, '19:00', false, '');
    var b = indCreateEvent_(sun, '18:00', false, '');
    var c = indCreateEvent_(sun, '19:00', true, 'Вратари');
    Logger.log(sat + ' индив.: ' + JSON.stringify(a));
    Logger.log(sun + ' индив.: ' + JSON.stringify(b));
    Logger.log(sun + ' вратари: ' + JSON.stringify(c));
  });
}

// Запуск из редактора («Выполнить»), только в окне обслуживания MAINT_UNTIL (см. Maint.js). Ничего не возвращает.
function indInstallTrigger() { maintCheck_(); indInstallTrigger_(); }

// Включает ежечасную проверку. Занятия создаются в день и час из настроек
// (ind.autoDay, ind.autoHour), поэтому после смены настройки триггер переустанавливать не нужно.
function indInstallTrigger_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var h = t.getHandlerFunction();
    if (h === 'indWeeklyCreate' || h === 'indAutoTick') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('indAutoTick').timeBased().everyHours(1).create();
  Logger.log('Триггер создан: каждый час; занятия создаются в ' + settingGet_('ind.autoDay') + ', ' + settingGet_('ind.autoHour') + ':00');
}

// Ежечасно: в день и час из настроек создаёт занятия на ближайшие выходные (один раз в неделю).
function indAutoTick() {
  var tz = Session.getScriptTimeZone(), now = new Date();
  var wd = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][Number(Utilities.formatDate(now, tz, 'u')) % 7];
  if (wd !== settingGet_('ind.autoDay') || Number(Utilities.formatDate(now, tz, 'H')) < settingGet_('ind.autoHour')) return;
  var today = Utilities.formatDate(now, tz, 'yyyy-MM-dd'), props = PropertiesService.getScriptProperties();
  if (props.getProperty('IND_AUTO_LAST') === today) return;
  indWeeklyCreate();
  props.setProperty('IND_AUTO_LAST', today);
}

// Создаёт занятие (строка в AdminApp), сразу записывает постоянных в файл оплат. Если занятие уже есть — ничего не делает.
function indCreateEvent_(date, time, gk, theme) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(time)) throw new Error('Неверная дата или время');
  if (CONFIG.DRY_RUN) { Logger.log('DRY_RUN: занятие не создано ' + date + ' ' + time); return { dryRun: true }; }
  gk = !!gk;
  var hh = ('0' + time.split(':')[0]).slice(-2) + ':' + time.split(':')[1];
  var evs = indParse_(true);
  for (var i = 0; i < evs.length; i++)
    if (evs[i].date === date && evs[i].time === hh && evs[i].goalkeepers === gk) return { ok: true, exists: true };
  if (!gk && !String(theme || '').trim()) theme = indAutoTheme_(date, evs);
  theme = String(theme || '').trim() || (gk ? 'Вратари' : '');
  indAdmAppend_(date, hh, gk, theme);
  var perm = 0, skipped = 0, slot = indSlotKey_(date, gk);
  indPermList_().filter(function (x) { return x.active && x.slot === slot; }).forEach(function (x) {
    try {
      indPfEnroll_(date, x.name, gk);
      indLog_('Запись', { id: indAdmId_(date, hh, gk) }, x.name, 0, '', 'постоянный');
      perm++;
    } catch (e) { skipped++; }
  });
  return { ok: true, exists: false, perm: perm, skipped: skipped };
}

// Изменить дату, время, тему занятия (только новые занятия). Дата меняется, если нет оплат: записанные переносятся
function appIndEventEdit(pin, id, date, time, theme) {
  checkAdmin_(pin);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(time)) throw new Error('Неверная дата или время');
  return indLocked_(function () {
    var ev = indFind_(id);
    indNotOld_(ev);
    var hh = ('0' + time.split(':')[0]).slice(-2) + ':' + time.split(':')[1];
    var dateChanged = date !== ev.date;
    if (dateChanged && ev.players.some(function (p) { return p.paid; }))
      throw new Error('Есть оплаты: сначала отмените оплату, потом меняйте дату');
    indParse_(true).forEach(function (e) {
      if (e.id !== ev.id && e.date === date && e.time === hh && e.goalkeepers === ev.goalkeepers)
        throw new Error('Такое занятие уже есть');
    });
    if (dateChanged) { // записанные переходят на новую дату: строки в файле оплат перезаписываются
      ev.players.forEach(function (p) {
        indPfUnenroll_(ev.date, p.name, ev.goalkeepers);
        indPfEnroll_(date, p.name, ev.goalkeepers);
      });
    }
    var sh = dbSheet_(IND_EVT, IND_EVT_HEAD), newId = indAdmId_(date, hh, ev.goalkeepers);
    nfSafe_(sh.getRange(ev.row, 1, 1, 3), '@');
    sh.getRange(ev.row, 1, 1, 5).setValues([[newId, date, hh, ev.goalkeepers, String(theme || '').trim()]]);
    if (newId !== ev.id) { // переносим отметки «кто был» на новый ID занятия
      var ms = adminSS_().getSheetByName(IND_ATT);
      if (ms && ms.getLastRow() > 1) {
        var rg = ms.getRange(2, 1, ms.getLastRow() - 1, 1), v = rg.getValues(), ch = false;
        v.forEach(function (r) { if (r[0] === ev.id) { r[0] = newId; ch = true; } });
        if (ch) rg.setValues(v);
      }
    }
    indLog_('Изменено', { id: newId }, '', 0, '', 'было: ' + ev.id + ' | тема: ' + ev.theme);
    return { ok: true };
  });
}

// Удалить занятие целиком (только новые и только если нет оплат). Записанные снимаются из файла оплат
function appIndEventDelete(pin, id) {
  checkAdmin_(pin);
  return indLocked_(function () {
    var ev = indFind_(id);
    indNotOld_(ev);
    if (ev.players.some(function (p) { return p.paid; }))
      throw new Error('Есть оплаты: сначала отмените оплату у игроков');
    ev.players.forEach(function (p) { indPfUnenroll_(ev.date, p.name, ev.goalkeepers); });
    dbSheet_(IND_EVT, IND_EVT_HEAD).deleteRow(ev.row);
    indLog_('Удалено', ev, '', 0, '', 'игроки: ' + ev.players.map(function (p) { return p.name; }).join(', '));
    return { ok: true };
  });
}

// Оформление блока: границы, выравнивание. top — первая строка блока, n — число строк блока
function indFormatBlock_(sh, top, n) {
  sh.getRange(top, 1, n, 4).setBorder(true, true, true, true, true, true, '#000000', SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange(top, 1, 2, 4).setHorizontalAlignment('center').setFontWeight('bold');
  sh.getRange(top + 2, 1, 1, 4).setHorizontalAlignment('center').setFontWeight('bold');
  sh.getRange(top + 3, 1, n - 3, 1).setHorizontalAlignment('center');
  sh.getRange(top + 3, 4, n - 3, 1).setHorizontalAlignment('center');
}

// Разово привести к этому виду все занятия таблицы (можно не запускать: нужные блоки уже оформлены)
function indFormatAll_() {
  indParse_(true).forEach(function (ev) {
    if (indAdmIsNew_(ev)) return; // новые занятия — строки листа AdminApp, оформление блока не нужно
    indFormatBlock_(indSS_().getSheetByName(ev.sheet), ev.row, ev.last - ev.row + 1);
  });
  Logger.log('Оформлено блоков: ' + indParse_(true).length);
}

// Темы индивидуальных по кругу — настройка ind.themes (порядок цикла; текст должен совпадать с таблицей)
function indAutoTheme_(date, evs) {
  var IND_THEMES = settingGet_('ind.themes') || [];
  if (!IND_THEMES.length) return '';
  var p = date.split('-'), dt = Date.UTC(+p[0], +p[1] - 1, +p[2]);
  var sat = new Date(dt).getUTCDay() === 0 ? dt - 86400000 : dt;
  function ds(ms) { return Utilities.formatDate(new Date(ms), 'UTC', 'yyyy-MM-dd'); }
  var satS = ds(sat), sunS = ds(sat + 86400000);
  function idx(t) {
    for (var i = 0; i < IND_THEMES.length; i++) if (norm(IND_THEMES[i]) === norm(t)) return i;
    return -1;
  }
  var ind = evs.filter(function (e) { return !e.goalkeepers && idx(e.theme) >= 0; });
  var same = ind.filter(function (e) { return e.date === satS || e.date === sunS; })[0];
  if (same) return IND_THEMES[idx(same.theme)];                       // та же неделя — та же тема
  var prev = ind.filter(function (e) { return e.date < satS; })
    .sort(function (a, b) { return b.date.localeCompare(a.date); })[0];
  if (prev) return IND_THEMES[(idx(prev.theme) + 1) % IND_THEMES.length]; // следующая по кругу
  return IND_THEMES[0];
}

// Способ последней оплаты игрока по занятию (для сторно)
function indLastPayMethod_(id, name) {
  var sh = adminSS_().getSheetByName(IND_LOG);
  if (!sh || sh.getLastRow() < 2) return '';
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues();
  for (var i = v.length - 1; i >= 0; i--)
    if (v[i][1] === id && v[i][2] === name && v[i][5] === 'Оплата') return String(v[i][4] || '');
  return '';
}

// Дата из старой текстовой записи 'дд.мм.гггг чч:мм' -> 'гггг-мм-дд'
function indDayStr_(s) {
  var m = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(String(s));
  return m ? m[3] + '-' + m[2] + '-' + m[1] : '';
}

// Должники: записаны на прошедшие занятия, Paid = FALSE
function indDebts_(evs) {
  var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  var map = {}, order = [];
  evs.forEach(function (e) {
    if ((e.date + ' ' + e.time) > now) return;
    e.players.forEach(function (p) {
      if (p.paid) return;
      var k = norm(p.name);
      if (!map[k]) { map[k] = { name: p.name, group: p.group, total: 0, events: [] }; order.push(k); }
      var pr = indPrice_(e.date);
      map[k].total += pr;
      map[k].events.push({ id: e.id, date: e.date, time: e.time, gk: e.goalkeepers, price: pr });
    });
  });
  return order.map(function (k) { return map[k]; })
    .sort(function (a, b) { return b.total - a.total || a.name.localeCompare(b.name); });
}

// Занятия игрока (для «Приёма оплат» и карточки): последние 8 + все неоплаченные
function appIndOfPlayer(pin, id) {
  checkAdmin_(pin);
  var pl = regData_().players.filter(function (x) { return x.id === id; })[0];
  if (!pl) throw new Error('Игрок не найден');
  var key = norm(pl.name), out = [];
  var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  indParse_().forEach(function (e) {
    e.players.forEach(function (p) {
      if (norm(p.name) !== key) return;
      var d = e.date.split('-');
      out.push({ id: e.id, name: p.name, date: e.date, time: e.time, gk: e.goalkeepers, paid: p.paid,
        past: (e.date + ' ' + e.time) <= now, price: indPrice_(e.date),
        label: (e.goalkeepers ? 'Вратарские ' : 'Индивидуальное ') + d[2] + '.' + d[1] + ' ' + e.time });
    });
  });
  out.sort(function (a, b) { return (b.date + b.time).localeCompare(a.date + a.time); });
  return out.filter(function (x, i) { return i < 8 || !x.paid; });
}

var _indDirty = {}; // листы, изменённые в текущем запуске (для сброса их кэша)

// Разбор занятий. want(name) — необязательный фильтр листов; без него старые листы берутся из кэша
function indParseRaw_(want) {
  var ss = indSS_(), out = [];
  ss.getSheets().forEach(function (sh, idx) {
    var name = sh.getName();
    if (want && !want(name)) return;
    var old = !want && idx >= 4;
    if (old) {
      var hit = cacheGetBig_('indsh_' + name);
      if (hit) { out = out.concat(hit); return; }
    }
    var mine = [], last = sh.getLastRow();
    if (last >= 3) {
      var v = sh.getRange(1, 1, last, 4).getValues();
      for (var i = 0; i < v.length; i++) {
        var m = IND_HEAD_RE.exec(String(v[i][0]).trim());
        if (!m) continue;
        var ev = {
          sheet: name, row: i + 1,
          date: m[5] + '-' + m[4] + '-' + m[3],
          time: ('0' + m[1]).slice(-2) + ':' + m[2],
          goalkeepers: !!m[6],
          theme: String(v[i + 1] ? v[i + 1][0] : '').trim(),
          players: [], slots: 0
        };
        ev.id = ev.sheet + '|' + ev.date + ' ' + ev.time + (ev.goalkeepers ? ' gk' : '');
        var h = -1;
        for (var k = i + 1; k <= i + 3 && k < v.length; k++) {
          if (String(v[k][0]).trim() === '№') { h = k; break; }
        }
        if (h < 0) continue;
        ev.cap = indCap_(ev.goalkeepers);
        ev.empty = [];
        ev.last = h + 1;
        for (var r = h + 1; r < v.length; r++) {
          var n = String(v[r][0]).trim();
          if (!/^\d+$/.test(n)) break;
          var pn = String(v[r][1]).trim();
          ev.slots++;
          ev.last = r + 1;
          if (pn) ev.players.push({
            row: r + 1, n: Number(n), name: pn,
            group: String(v[r][2]).trim(),
            paid: v[r][3] === true || String(v[r][3]).toUpperCase() === 'TRUE'
          });
          else ev.empty.push(r + 1);
        }
        mine.push(ev);
      }
    }
    if (old) cachePutBig_('indsh_' + name, mine, 3600);
    out = out.concat(mine);
  });
  return out;
}

// Занятия только с листов, относящихся к дате (лист «сб/вс» содержит оба дня)
function indParseForDate_(date) {
  var p = date.split('-'), dt = Date.UTC(+p[0], +p[1] - 1, +p[2]);
  function dm(ms) { return Utilities.formatDate(new Date(ms), 'UTC', 'dd.MM'); }
  var keys = [dm(dt), dm(dt - 86400000), dm(dt + 86400000)];
  var old = indParseRaw_(function (name) {
    return name.split('/').some(function (t) { return keys.indexOf(t.trim()) >= 0; });
  }).filter(function (e) { return e.date === date; });
  var adm = indParseAdm_(date);
  return indDropMigrated_(old, adm).concat(adm);
}

// Для записи: всегда свежее чтение этого занятия (новые — из AdminApp и файла оплат, старые — из старой таблицы)
function indFind_(id) {
  var sn = String(id).split('|')[0];
  var evs = sn === IND_ADM ? indParseAdm_() : indParseRaw_(function (n) { return n === sn; });
  for (var i = 0; i < evs.length; i++) {
    if (evs[i].id === id) { _indDirty[evs[i].sheet] = 1; return evs[i]; }
  }
  throw new Error('Занятие не найдено');
}

function indLocked_(fn) {
  if (CONFIG.DRY_RUN) throw new Error('Пробный режим: в таблицу индивидуальных ничего не записано.');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally {
    cacheDropBig_('ind_v1');
    Object.keys(_indDirty).forEach(function (n) { cacheDropBig_('indsh_' + n); });
    _indDirty = {};
    lock.releaseLock();
  }
}

// Сбросить кэш всех листов (кнопка «Обновить данные»)
function indDropSheetCache_() {
  try { indSS_().getSheets().forEach(function (s) { cacheDropBig_('indsh_' + s.getName()); }); } catch (e) {}
}

function indGroups_(dateStr) {
  var seen = {}, out = [];
  indParseForDate_(dateStr)
    .sort(function (a, b) { return a.time.localeCompare(b.time); })
    .forEach(function (e) {
      var n = indGroupName_(e);
      if (!seen[n]) { seen[n] = 1; out.push({ name: n, sched: true }); }
    });
  return out;
}

function indEventByGroup_(group, dateStr) {
  var evs = indParseForDate_(dateStr);
  for (var i = 0; i < evs.length; i++)
    if (indGroupName_(evs[i]) === group) return evs[i];
  throw new Error('На эту дату занятия «' + group + '» нет');
}