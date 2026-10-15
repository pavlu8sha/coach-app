/** Раздел «Матчи» (версия 3): создание событий и состав. */

var EV_FEE = { 'default': 200, 'U13-A': 300 }; // взнос за чемпионат по умолчанию, ₾
var EV_TYPES = ['Чемпионат', 'Игра', 'Товарищеская', 'Фестиваль', 'Кубок'];

// o: {type, team, name, date 'YYYY-MM-DD', fee, parent, copyFrom}
function appAddEvent(pin, o) {
  checkAny_(pin);
  if (!o || EV_TYPES.indexOf(o.type) < 0) throw new Error('Выберите тип события');
  var isAdmin = appWho(pin) === 'admin';
  if (CONFIG.DRY_RUN) return addEventCore_(o, isAdmin);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return addEventCore_(o, isAdmin);
  } finally {
    lock.releaseLock();
  }
}

/** Взнос события можно задать и изменить после создания. Только админ. У игры взнос берётся с турнира. */
function appSetEventFee(pin, eventId, fee) {
  checkAdmin_(pin);
  var id = String(eventId || ''), v = Number(fee);
  if (!(v >= 0)) throw new Error('Взнос должен быть числом не меньше нуля');
  if (CONFIG.DRY_RUN) return { ok: true, dryRun: true };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var row = sheetOf_('МАТЧИ').getDataRange().getValues().slice(1)
      .filter(function (r) { return String(r[0]) === id; })[0];
    if (!row) throw new Error('Событие не найдено');
    if (String(row[2]) === 'Игра') throw new Error('Взнос задаётся у турнира, а не у отдельной игры');
    feeSet_(id, String(row[1]), String(row[2]), String(row[3]), v);
    logChange_('', '', 'взнос события', '', id + ': ' + v);
    cacheDropBig_('md_v2');
    return { ok: true, dryRun: false, fee: v };
  } finally { lock.releaseLock(); }
}

function addEventCore_(o, isAdmin) {
  var ms = sheetOf_('МАТЧИ'), ps = partsSheet_();
  if (!ms) throw new Error('Нет листа МАТЧИ: сначала выполните перенос файла матчей');
  var tz = ms.getParent().getSpreadsheetTimeZone();
  var rows = ms.getLastRow() > 1 ? ms.getRange(2, 1, ms.getLastRow() - 1, 7).getValues() : [];
  var team = String(o.team || '').trim(), name = String(o.name || '').trim(), parent = '', fee = '', max = 0;
  rows.forEach(function (r) { var m = /(\d+)$/.exec(String(r[0])); if (m) max = Math.max(max, Number(m[1])); });
  var id = 'E-' + ('000' + (max + 1)).slice(-3);
  if (o.type === 'Игра') {
    var par = rows.filter(function (r) { return String(r[0]) === String(o.parent); })[0];
    if (!par) throw new Error('Не найден турнир для игры');
    if (!o.date) throw new Error('Укажите дату игры');
    var dup = rows.some(function (r) {
      return String(r[6]) === String(par[0]) && r[4] instanceof Date && Utilities.formatDate(r[4], tz, 'yyyy-MM-dd') === o.date;
    });
    if (dup) throw new Error('Игра этого турнира на эту дату уже есть');
    team = String(par[1]); name = String(par[3]); parent = String(par[0]);
  } else {
    if (!team) throw new Error('Укажите команду');
    if (!name) throw new Error('Укажите название');
    if ((o.type === 'Товарищеская' || o.type === 'Кубок') && !o.date) throw new Error('Укажите дату');
    if (isAdmin && o.fee !== '' && o.fee !== null && o.fee !== undefined) {
      fee = Number(o.fee);
      if (!(fee >= 0)) throw new Error('Взнос должен быть числом не меньше нуля');
    } else if (o.type === 'Чемпионат') fee = EV_FEE[team] || EV_FEE['default'];
  }
  var copy = [];
  if (o.copyFrom && o.type !== 'Игра' && ps.getLastRow() > 1) {
    ps.getRange(2, 1, ps.getLastRow() - 1, 3).getValues().forEach(function (r) {
      if (String(r[0]) === String(o.copyFrom)) copy.push([id, r[1], r[2], '', '', false, '', '', '', '']);
    });
  }
  if (!CONFIG.DRY_RUN) {
    var r1 = ms.getLastRow() + 1, wroteRow = false;
    try {
      ms.getRange(r1, 1, 1, 7).setValues([[id, team, o.type, name, o.date ? serialOf(o.date) : '', '', parent]]);
      wroteRow = true;
      ms.getRange(r1, 5).setNumberFormat('dd.mm.yyyy');
      feeSet_(id, team, o.type, name, fee);
      if (copy.length) ps.getRange(ps.getLastRow() + 1, 1, copy.length, 10).setValues(copy);
    } catch (e) {
      if (wroteRow) ms.deleteRow(r1);   // откат: строка события не остаётся без взноса или состава
      throw e;
    }
    logChange_('', '', 'новое событие матчей', '', id + ': ' + team + ', ' + o.type + ', ' + name + (o.date ? ', ' + o.date : ''));
    cacheDropBig_('md_v2');
  }
  var gsync = (!CONFIG.DRY_RUN && o.type === 'Игра') ? gnSyncGameSafe_(id) : '';
  return { ok: true, dryRun: CONFIG.DRY_RUN, id: id, copied: copy.length, sync: gsync };
}

// Добавляет игрока в состав события или турнира.
function appAddParticipant(pin, eventId, playerId) {
  try {
    return appAddParticipants(pin, eventId, [playerId]);
  } catch (e) {
    if (/уже в составе/.test(e.message)) throw new Error('Игрок уже в составе');
    throw e;
  }
}

// Добавляет сразу нескольких игроков в состав (уже имеющихся пропускает).
function appAddParticipants(pin, eventId, ids) {
  checkAny_(pin);
  var res;
  if (CONFIG.DRY_RUN) {
    res = addParticipantsCore_(eventId, ids);
  } else {
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      res = addParticipantsCore_(eventId, ids);
    } finally {
      lock.releaseLock();
    }
  }
  var pulled = 0;
  if (!CONFIG.DRY_RUN) {
    try { pulled = legacyPullPaid_(eventId, res.names); } catch (e) {}
  }
  return { ok: true, dryRun: CONFIG.DRY_RUN, added: res.added, pulled: pulled };
}

function addParticipantsCore_(eventId, ids) {
  eventId = String(eventId);
  var ms = sheetOf_('МАТЧИ');
  var known = ms && ms.getLastRow() > 1 && ms.getRange(2, 1, ms.getLastRow() - 1, 1).getValues().some(function (r) { return String(r[0]) === eventId; });
  if (!known) throw new Error('Событие не найдено');
  var map = {};
  readRegistry_().players.forEach(function (p) { map[p.id] = p; });
  var ps = partsSheet_(), last = ps.getLastRow(), have = {};
  if (last > 1) ps.getRange(2, 1, last - 1, 2).getValues().forEach(function (r) {
    if (String(r[0]) === eventId) have[String(r[1])] = 1;
  });
  var rows = [], unknown = 0, inactive = 0;
  (ids || []).forEach(function (id) {
    if (!map[id]) { unknown++; return; }
    if (map[id].status !== 'Активен') { inactive++; return; }
    if (!have[id]) { have[id] = 1; rows.push([eventId, id, map[id].name, '', '', false, '', '', '', '']); }
  });
  if (!rows.length) throw new Error(inactive ? 'Игрок не активен (пауза или ушёл): в состав не добавлен'
    : (unknown ? 'Игрок не найден' : 'Все выбранные игроки уже в составе'));
  if (!CONFIG.DRY_RUN) {
    ps.getRange(ps.getLastRow() + 1, 1, rows.length, 10).setValues(rows);
    logChange_('', '', 'добавлены в состав матчей', '', eventId + ': ' + rows.length + ' игроков');
    cacheDropBig_('md_v2');
  }
  return { added: rows.length, names: rows.map(function (r) { return r[2]; }) };
}