/**
 * Расписание сезона — лист «РАСПИСАНИЕ» в AdminApp, правится на экране «Настройки».
 * Одна строка — одна тренировка: день, локация, начало, конец, группа (как в листе «Тренировки»), тип, тренеры
 * и «Группы в отметках» — группы реестра, которые в этот день показываются в «Отметках» как группы дня.
 * Пока листа нет, действует SCHEDULE_DEFAULT (расписание сезона 2026-2027, каким оно было в коде).
 * Используется: дневное расписание тренировок (GamesNew.js) и группы дня в «Отметках» (WebApp.js).
 */

var SCHED_SHEET = 'РАСПИСАНИЕ';
var SCHED_HEAD = ['День', 'Локация', 'Начало', 'Конец', 'Группа', 'Тип', 'Тренеры', 'Группы в отметках'];
var SCHED_DAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];   // индекс — день недели (0 — вс)
var SCHED_TYPES = ['Групповая', 'Индивидуальная', 'Вратарская'];

// [день, локация, начало, конец, группа, тип, тренеры, группы в отметках]
var SCHEDULE_DEFAULT = [
  [1, 'Красный парк', '16:00', '17:00', 'U7-А/В', 'Групповая', 'Дима, Руслан', 'U7-A, U7-B'],
  [1, 'Красный парк', '17:00', '18:00', 'U9-А/В', 'Групповая', 'Дима, Руслан', 'U9-A, U9-B'],
  [1, 'Красный парк', '18:00', '19:00', 'U11', 'Групповая', 'Паша, Руслан', 'U11'],
  [2, 'Красный парк', '15:45', '17:15', 'U13-B/C', 'Групповая', 'Соприк, Цотне', 'U13-B, U13-C'],
  [2, 'Красный парк', '17:00', '18:30', 'U10-A/В', 'Групповая', 'Паша, Цотне', 'U10-A, U10-B'],
  [2, 'Красный парк', '18:15', '20:00', 'U13-A', 'Групповая', 'Соприк, Паша', 'U13-A'],
  [3, 'Красный парк', '16:00', '16:45', 'U7-А/В', 'Групповая', 'Дима, Руслан', 'U7-A, U7-B'],
  [3, 'Красный парк', '16:30', '17:45', 'U9-А/В', 'Групповая', 'Дима, Руслан', 'U9-A, U9-B'],
  [3, 'Красный парк', '17:30', '19:00', 'U11', 'Групповая', 'Паша, Руслан', 'U11'],
  [4, 'Красный парк', '15:45', '17:00', 'U13-B/C', 'Групповая', 'Соприк, Цотне', 'U13-B, U13-C'],
  [4, 'Красный парк', '16:45', '18:00', 'U10-A/В', 'Групповая', 'Паша, Цотне', 'U10-A, U10-B'],
  [4, 'Красный парк', '17:45', '19:00', 'U13-A', 'Групповая', 'Соприк, Паша', 'U13-A'],
  [5, 'Красный парк', '16:00', '16:45', 'U7-А/В', 'Групповая', 'Дима, Руслан', 'U7-A, U7-B'],
  [5, 'Красный парк', '16:30', '17:45', 'U9-А/В', 'Групповая', 'Дима, Руслан', 'U9-A, U9-B'],
  [5, 'Красный парк', '17:30', '19:00', 'U11', 'Групповая', 'Паша, Руслан', 'U11'],
  [6, 'Красный парк', '16:00', '17:00', 'Weekends', 'Групповая', 'Руслан, Цотне', 'weekends'],
  [6, 'Красный парк', '16:45', '18:00', 'U13-B', 'Групповая', 'Соприк, Цотне', 'U13-B'],
  [6, 'Красный парк', '17:45', '19:00', 'U13-C', 'Групповая', 'Цотне, Соприк', 'U13-C'],
  [6, 'Красный парк', '19:00', '20:00', 'Индивидуальные', 'Индивидуальная', 'Гио, Соприк', ''],
  [0, 'Красный парк', '16:00', '17:00', 'Weekends', 'Групповая', 'Руслан, Цотне', 'weekends'],
  [0, 'Красный парк', '16:45', '18:00', 'U10-A/В', 'Групповая', 'Паша, Цотне', 'U10-A, U10-B'],
  [0, 'Красный парк', '18:00', '19:00', 'Индивидуальные', 'Индивидуальная', 'Гио, Паша', ''],
  [0, 'Красный парк', '19:00', '20:00', 'Вратари', 'Вратарская', 'Антон, Гио', ''],
  [1, 'Чиковани', '18:00', '19:30', 'U13-A', 'Групповая', 'Соприк', 'U13-A'],
  [1, 'Исани', '16:30', '17:30', 'Исани U7', 'Групповая', 'Гио', 'Isani'],
  [3, 'Исани', '16:30', '17:30', 'Исани U7', 'Групповая', 'Гио', 'Isani'],
  [5, 'Исани', '16:30', '17:30', 'Исани U7', 'Групповая', 'Гио', 'Isani'],
  [2, 'Ортачала', '15:00', '15:50', 'Ortachala U9', 'Групповая', 'Гио', 'Ortachala U9'],
  [2, 'Ортачала', '15:50', '17:00', 'Ortachala U12', 'Групповая', 'Гио', 'Ortachala U12'],
  [4, 'Ортачала', '15:00', '15:50', 'Ortachala U9', 'Групповая', 'Гио', 'Ortachala U9'],
  [4, 'Ортачала', '15:50', '17:00', 'Ortachala U12', 'Групповая', 'Гио', 'Ortachala U12'],
  [6, 'Ортачала', '10:00', '10:50', 'Ortachala U9', 'Групповая', 'Гио', 'Ortachala U9'],
  [6, 'Ортачала', '10:50', '12:00', 'Ortachala U12', 'Групповая', 'Гио', 'Ortachala U12']
];

function schedSplit_(s) { return String(s || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean); }

function schedRow_(x) {
  return { wd: x[0], loc: x[1], start: x[2], end: x[3], group: x[4], type: x[5], trainers: schedSplit_(x[6]), att: schedSplit_(x[7]) };
}

// Время «9:5», «09:05», «9.05» → «09:05»; неверное — ''
function schedTime_(v) {
  if (v instanceof Date) return ('0' + v.getHours()).slice(-2) + ':' + ('0' + v.getMinutes()).slice(-2);
  var m = /^(\d{1,2})[:.](\d{2})$/.exec(String(v || '').trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return '';
  return ('0' + m[1]).slice(-2) + ':' + m[2];
}

// Проверка одной строки (из листа или с экрана). Возвращает {row} или {error}.
function schedCheck_(r) {
  var day = String(r.day !== undefined ? r.day : r[0]).trim().toLowerCase();
  var wd = SCHED_DAYS.indexOf(day.slice(0, 2));
  if (wd < 0 && /^[0-6]$/.test(day)) wd = Number(day);
  var start = schedTime_(r.start !== undefined ? r.start : r[2]), end = schedTime_(r.end !== undefined ? r.end : r[3]);
  var loc = String(r.loc !== undefined ? r.loc : r[1]).trim(), group = String(r.group !== undefined ? r.group : r[4]).trim();
  var type = String(r.type !== undefined ? r.type : r[5]).trim() || 'Групповая';
  var trainers = String(r.trainers !== undefined ? r.trainers : r[6]).trim(), att = String(r.att !== undefined ? r.att : r[7]).trim();
  if (wd < 0) return { error: 'день недели: пн, вт, ср, чт, пт, сб или вс' };
  if (!start || !end) return { error: 'время в формате ЧЧ:ММ' };
  if (start >= end) return { error: 'начало должно быть раньше конца' };
  if (!loc) return { error: 'не указана локация' };
  if (!group) return { error: 'не указана группа' };
  if (SCHED_TYPES.indexOf(type) < 0) return { error: 'тип: ' + SCHED_TYPES.join(', ') };
  return { row: [wd, loc, start, end, group, type, schedSplit_(trainers).join(', '), schedSplit_(att).join(', ')] };
}

var _schedRun = null;
// Строки расписания на время запуска: лист «РАСПИСАНИЕ», если он есть и не пуст; иначе SCHEDULE_DEFAULT.
// Неверные строки листа пропускаются (их видно на экране «Настройки» с причиной).
function schedLoad_() {
  if (_schedRun) return _schedRun;
  var key = 'sched_' + settingsVer_(), cache = CacheService.getScriptCache(), hit = cache.get(key);
  if (hit) { try { _schedRun = JSON.parse(hit); return _schedRun; } catch (e) {} }
  var res = { source: 'default', rows: SCHEDULE_DEFAULT, bad: [] }, sh = null;
  try { sh = dbRead_(SCHED_SHEET); } catch (e) { console.warn('Расписание недоступно, действует расписание по умолчанию: ' + e.message); }
  if (sh && sh.getLastRow() > 1) {
    var rows = [], bad = [];
    sh.getRange(2, 1, sh.getLastRow() - 1, SCHED_HEAD.length).getValues().forEach(function (r, i) {
      if (r.every(function (x) { return String(x).trim() === ''; })) return;
      var c = schedCheck_(r);
      if (c.error) bad.push({ line: i + 2, error: c.error }); else rows.push(c.row);
    });
    if (rows.length) res = { source: 'sheet', rows: rows, bad: bad };
  }
  try { cache.put(key, JSON.stringify(res), 600); } catch (e) {}
  _schedRun = res;
  return res;
}

// Расписание в виде объектов {wd, loc, start, end, group, type, trainers[], att[]}
function schedSeason_() { return schedLoad_().rows.map(schedRow_); }

// Группа реестра по расписанию в этот день недели? Группы, которых нет в расписании, показываются в любой день.
function schedHasGroup_(group, wd) {
  var g = norm(group), known = false, today = false;
  schedSeason_().forEach(function (x) {
    x.att.forEach(function (a) {
      if (norm(a) !== g) return;
      known = true;
      if (x.wd === wd) today = true;
    });
  });
  return known ? today : true;
}

// ---------- Экран «Настройки» ----------

function appSchedule(pin) {
  checkAdmin_(pin);
  var s = schedLoad_();
  return {
    source: s.source, bad: s.bad, days: SCHED_DAYS, types: SCHED_TYPES,
    rows: s.rows.map(function (r) { return { day: SCHED_DAYS[r[0]], loc: r[1], start: r[2], end: r[3], group: r[4], type: r[5], trainers: r[6], att: r[7] }; })
  };
}

// rows: [{day, loc, start, end, group, type, trainers, att}] — расписание целиком; лист перезаписывается.
function appScheduleSave(pin, rows) {
  checkAdmin_(pin);
  if (!Array.isArray(rows) || !rows.length) throw new Error('Расписание пустое: добавьте хотя бы одну тренировку');
  var out = [];
  rows.forEach(function (r, i) {
    var c = schedCheck_(r || {});
    if (c.error) throw new Error('Строка ' + (i + 1) + ': ' + c.error);
    out.push(c.row);
  });
  out.sort(function (a, b) { return ((a[0] + 6) % 7) - ((b[0] + 6) % 7) || String(a[1]).localeCompare(String(b[1])) || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0); });
  if (CONFIG.DRY_RUN) return { ok: true, dryRun: true, count: out.length };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var was = schedLoad_();
    var sh = dbSheet_(SCHED_SHEET, SCHED_HEAD);
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, SCHED_HEAD.length).clearContent();
    var vals = out.map(function (r) { return [SCHED_DAYS[r[0]]].concat(r.slice(1)); });
    var rg = sh.getRange(2, 1, vals.length, SCHED_HEAD.length);
    nfSafe_(rg, '@');                       // время и списки храним текстом
    rg.setValues(vals);
    settingsBump_();
    _schedRun = null;
    logChange_('', '', 'расписание сезона', (was.source === 'sheet' ? 'лист, ' : 'по умолчанию, ') + was.rows.length + ' трен.', out.length + ' трен.');
    return { ok: true, count: out.length };
  } finally {
    lock.releaseLock();
  }
}
