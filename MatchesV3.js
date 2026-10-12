/** Раздел «Матчи» (версия 3): соперник, счёт и голы игроков. Только для администратора. */

function ensureHeaders_() {
  var ms = sheetOf_('МАТЧИ'), ps = partsSheet_();
  if (!ms) throw new Error('Нет листа МАТЧИ: сначала выполните перенос файла матчей');
  var h = ms.getRange(1, 8, 1, 4).getValues()[0], names = ['Соперник', 'Забито', 'Пропущено', 'Сторона'];
  names.forEach(function (n, i) { if (!String(h[i]).trim()) ms.getRange(1, 8 + i).setValue(n); });
  if (!String(ps.getRange(1, 11).getValue()).trim()) ps.getRange(1, 11).setValue('Голы');
}

function matchesData_() {
  var hit = cacheGetBig_('md_v2');
  if (hit) return hit;
  var data = matchesDataLive_();
  cachePutBig_('md_v2', data, 90);
  return data;
}

// Тренер получает игровую часть без денег. Админ получает ещё и взносы.
function appMatchesData(pin) {
  checkAny_(pin);
  var d = matchesData_();
  d.role = appWho(pin) === 'admin' ? 'admin' : 'trainer';
  if (d.role === 'admin') {
    var f = finData_();
    d.events.forEach(function (e) { e.fee = f.fees[e.id] || 0; });
    d.parts.forEach(function (p) {
      var x = f.pays[p.e + '|' + p.p];
      p.paid = x ? x.paid : 0; p.sum = x ? x.sum : 0; p.method = x ? x.method : '';
    });
  }
  return d;
}

// Список игроков для добавления в состав: без личных и денежных данных.
function appMatchPlayers(pin) {
  checkAny_(pin);
  return { players: regData_().players.map(function (p) { return { id: p.id, name: p.name, group: p.group, status: p.status }; }) };
}

function matchesDataLive_() {
  var ms = sheetOf_('МАТЧИ'), ps = partsSheet_();
  var tz = (ms || ps).getParent().getSpreadsheetTimeZone();
  var num = function (v) { return v === '' || v === null || isNaN(Number(v)) ? null : Number(v); };
  var ev = ms && ms.getLastRow() > 1 ? ms.getRange(2, 1, ms.getLastRow() - 1, 11).getValues() : [];
  var events = ev.filter(function (r) { return r[0]; }).map(function (r) {
    return {
      id: String(r[0]), team: String(r[1]), type: String(r[2]), name: String(r[3]),
      date: r[4] instanceof Date ? Utilities.formatDate(r[4], tz, 'yyyy-MM-dd') : '',
      parent: String(r[6] || ''),
      opp: String(r[7] || ''), gf: num(r[8]), ga: num(r[9]), side: String(r[10] || '')
    };
  });
  var pv = ps.getLastRow() > 1 ? ps.getRange(2, 1, ps.getLastRow() - 1, 11).getValues() : [];
  var parts = pv.filter(function (r) { return r[0] && r[1]; }).map(function (r) {
    return {
      e: String(r[0]), p: String(r[1]), n: String(r[2]),
      played: r[3] === true ? 1 : (r[3] === false ? 0 : -1), ft: String(r[4] || ''),
      goals: Number(r[10]) || 0
    };
  });
  return { events: events, parts: parts };
}

// marks: [{id, name, played, goals, ft}], res: {opp, gf, ga, side}
function appSaveGame2(pin, eventId, marks, res) {
  checkAny_(pin);
  if (!eventId || !Array.isArray(marks)) throw new Error('Нет данных для сохранения');
  var out;
  if (CONFIG.DRY_RUN) {
    out = saveGame2Core_(String(eventId), marks, res || {});
  } else {
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      out = saveGame2Core_(String(eventId), marks, res || {});
    } finally {
      lock.releaseLock();
    }
  }
  var lg = CONFIG.DRY_RUN ? '' : legacySafe_(eventId);
  out.legacy = lg;
  return out;
}

function saveGame2Core_(eventId, marks, res) {
  ensureHeaders_();
  var ms = sheetOf_('МАТЧИ'), ps = partsSheet_();
  var mrow = 0;
  if (ms.getLastRow() > 1) {
    ms.getRange(2, 1, ms.getLastRow() - 1, 1).getValues().forEach(function (r, i) { if (String(r[0]) === eventId) mrow = i + 2; });
  }
  if (!mrow) throw new Error('Событие не найдено');
  var num = function (v) { return v === '' || v === null || v === undefined ? '' : Number(v); };
  var gf = num(res.gf), ga = num(res.ga);
  if ((gf !== '' && !(gf >= 0)) || (ga !== '' && !(ga >= 0))) throw new Error('Счёт должен быть числом не меньше нуля');
  var last = ps.getLastRow(), idx = {};
  var vals = last > 1 ? ps.getRange(2, 1, last - 1, 11).getValues() : [];
  vals.forEach(function (r, i) { if (String(r[0]) === eventId) idx[String(r[1])] = i; });
  var add = [], upd = 0, goalsSum = 0;
  marks.forEach(function (m) {
    var id = String(m.id), g = Math.max(Number(m.goals) || 0, 0), played = !!m.played || g > 0;
    var ft = played ? (res.side || m.ft || '') : '';
    goalsSum += g;
    if (idx.hasOwnProperty(id)) {
      var r = vals[idx[id]];
      r[3] = played; r[4] = ft; r[10] = g || '';
      upd++;
    } else if (played) {
      add.push([eventId, id, m.name, true, ft, '', '', '', '', '', g || '']);
    }
  });
  if (!CONFIG.DRY_RUN) {
    // Счёт и соперника пишем только если их явно передали: отметки игроков не должны стирать результат
    if (res && Object.keys(res).length) ms.getRange(mrow, 8, 1, 4).setValues([[String(res.opp || '').trim(), gf, ga, res.side || '']]);
    if (upd) {
      ps.getRange(2, 4, vals.length, 2).setValues(vals.map(function (r) { return [r[3], r[4]]; }));
      ps.getRange(2, 11, vals.length, 1).setValues(vals.map(function (r) { return [r[10]]; }));
    }
    if (add.length) ps.getRange(ps.getLastRow() + 1, 1, add.length, 11).setValues(add);
    logChange_('', '', 'результат игры ' + eventId, '', (gf === '' ? 'счёт не указан' : gf + ':' + ga) + ', голов у игроков ' + goalsSum);
    cacheDropBig_('md_v2');
  }
  return { ok: true, dryRun: CONFIG.DRY_RUN, goalsSum: goalsSum, gf: gf, updated: upd, added: add.length };
}