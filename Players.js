/** Модуль «Игроки», только для администратора. Правит реестр игроков, ничего не удаляет. */

var _props = null;
function prop_(k) {
  if (!_props) _props = PropertiesService.getScriptProperties().getProperties();
  return _props[k];
}

function checkAdmin_(pin) {
  var real = prop_('APP_ADMIN_PIN');
  if (!real || String(pin) !== String(real)) throw new Error('Неверный код администратора');
}

function today_() {
  return Utilities.formatDate(new Date(), SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
}

function isoOf_(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (v instanceof Date) return Utilities.formatDate(v, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  var n = Number(v);
  if (isNaN(n) || n < 1000) return '';
  return Utilities.formatDate(new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000), 'GMT', 'yyyy-MM-dd');
}

var _attSS = null;
function attSS_() {
  if (_attSS) return _attSS;
  var id = prop_('ATT_ID');
  if (!id) throw new Error('Не задано свойство ATT_ID (ID таблицы посещаемости)');
  _attSS = SpreadsheetApp.openById(id);
  return _attSS;
}

function readRegistry_() {
  var sh = attSS_().getSheetByName(CONFIG.REGISTRY_SHEET);
  var last = sh.getLastRow();
  var rows = last >= 4 ? sh.getRange(4, 1, last - 3, 8).getValues() : [];
  var players = [];
  rows.forEach(function (r, i) {
    if (!r[0]) return;
    players.push({
      id: String(r[0]), row: 4 + i, name: String(r[1]).trim(), group: String(r[2]).trim(),
      loc: String(r[3]).trim(), status: String(r[4]).trim(), start: isoOf_(r[5]), end: isoOf_(r[6]),
      extras: String(r[7] || '').split(',').map(function (x) { return x.trim(); }).filter(String)
    });
  });
  return { sh: sh, players: players };
}

function lists_(players) {
  var ref = sheetOf_('СПРАВОЧНИКИ');
  var vals = ref.getRange(4, 1, 30, 3).getValues();
  var groups = [], locOf = {}, statuses = [];
  vals.forEach(function (r) {
    var g = String(r[0]).trim();
    if (g && isNaN(Number(g)) && groups.indexOf(g) < 0) {
      groups.push(g);
      if (r[1]) locOf[norm(g)] = String(r[1]).trim();
    }
    var s = String(r[2]).trim();
    if (s && statuses.indexOf(s) < 0) statuses.push(s);
  });
  players.forEach(function (p) {
    if (p.group && groups.indexOf(p.group) < 0) groups.push(p.group);
    if (p.group && p.loc) locOf[norm(p.group)] = p.loc; // реестр важнее справочника
  });
  return { groups: groups, locOf: locOf, statuses: statuses };
}
// ===== Кэш реестра (живёт до 15 минут, при записи через приложение сбрасывается) =====
var REG_CACHE_KEY = 'reg_v1';

var CACHE_MIN_TTL = 900; // кэш живёт не меньше 15 минут (записи через приложение сбрасывают его сами)

function cacheGetBig_(key) {
  var c = CacheService.getScriptCache();
  var n = Number(c.get(key + '_n'));
  if (!n) return null;
  var keys = [];
  for (var i = 0; i < n; i++) keys.push(key + '_' + i);
  var parts = c.getAll(keys), s = '';
  for (var j = 0; j < n; j++) {
    var p = parts[key + '_' + j];
    if (p === null || p === undefined) return null;
    s += p;
  }
  try { return JSON.parse(s); } catch (e) { return null; }
}

function cachePutBig_(key, obj, ttl) {
  try {
    var c = CacheService.getScriptCache();
    var s = JSON.stringify(obj), size = 40000, put = {}, n = 0;
    for (var i = 0; i < s.length; i += size) { put[key + '_' + n] = s.substr(i, size); n++; }
    put[key + '_n'] = String(n);
    c.putAll(put, Math.max(ttl || 120, CACHE_MIN_TTL));
  } catch (e) { /* кэш необязателен */ }
}

function cacheDropBig_(key) {
  try {
    var c = CacheService.getScriptCache();
    var n = Number(c.get(key + '_n')) || 0, keys = [key + '_n'];
    for (var i = 0; i < n; i++) keys.push(key + '_' + i);
    c.removeAll(keys);
  } catch (e) {}
}

function regInvalidate_() {
  cacheDropBig_(REG_CACHE_KEY);
  // Оплаты и посещаемость берут ID и группу игроков из реестра: сбрасываем их кэши по всем месяцам,
  // которые могут быть в работе (прошлый, текущий, следующий, плюс все закэшированные)
  var months = (cacheGetBig_('pmonths') || []).slice(), now = new Date(), tz = Session.getScriptTimeZone();
  for (var i = -1; i <= 1; i++) months.push(Utilities.formatDate(new Date(now.getFullYear(), now.getMonth() + i, 1), tz, 'MM.yy'));
  months.forEach(function (m) { cacheDropBig_('pm_' + m); cacheDropBig_('cola_' + m); });
  cacheDropBig_('sl_v1');
}

// Игроки + списки (для чтения). Писатели используют живой readRegistry_().
function regData_() {
  var hit = cacheGetBig_(REG_CACHE_KEY);
  if (hit) return hit;
  var reg = readRegistry_();
  var data = { players: reg.players, l: lists_(reg.players) };
  cachePutBig_(REG_CACHE_KEY, data, 120);
  return data;
}

function nextId_(players) {
  var max = 0;
  players.forEach(function (p) {
    var m = /(\d+)$/.exec(p.id);
    if (m) max = Math.max(max, Number(m[1]));
  });
  return 'KS-' + ('0000' + (max + 1)).slice(-4);
}

function logChange_(id, name, field, was, now) {
  var log = dbSheet_('ЖУРНАЛ ИЗМЕНЕНИЙ', LOG_HEAD);
  if (log) log.appendRow([new Date(), id, name, field, was, now]);
  cacheDropBig_('md_v2'); cacheDropBig_('mf_v1'); cacheDropBig_('eq_v1'); cacheDropBig_('cat_v1');
}

function appAdminInit(pin) {
  checkAdmin_(pin);
  var d = regData_(), bd = birthById_();
  return {
    groups: d.l.groups, statuses: d.l.statuses,
    players: d.players.map(function (p) {
      return { id: p.id, name: p.name, group: p.group, loc: p.loc, status: p.status, start: p.start, end: p.end, extras: p.extras, birth: bd[p.id] || '' };
    })
  };
}

// Даты рождения: вручную заданные (лист «ДАТЫ РОЖДЕНИЯ» в админ-файле) важнее дат из файла оплат.
var BIRTH_SHEET = 'ДАТЫ РОЖДЕНИЯ';
var BIRTH_HEAD = ['ID игрока', 'ФИ', 'Дата рождения', 'Изменено'];
function birthOverrides_() {
  var hit = cacheGetBig_('bo_v1');
  if (hit) return hit;
  var map = {}, sh = dbRead_(BIRTH_SHEET);
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 3).getDisplayValues().forEach(function (r) {
      var id = String(r[0]).trim(), dt = String(r[2]).trim();
      if (id && /^\d{2}\.\d{2}\.\d{4}$/.test(dt)) map[id] = dt;
    });
  }
  cachePutBig_('bo_v1', map, 3600);
  return map;
}
// Карта «ID игрока → дата рождения dd.mm.yyyy» для всех игроков реестра.
function birthById_() {
  var ov = birthOverrides_(), fromFile = birthByName_(), out = {};
  regData_().players.forEach(function (p) {
    out[p.id] = ov[p.id] || fromFile[norm(p.name)] || '';
  });
  return out;
}
// Записать дату рождения вручную: date в формате dd.mm.yyyy.
function appSetBirth(pin, id, date) {
  checkAdmin_(pin);
  var d = String(date || '').trim();
  if (!/^\d{2}\.\d{2}\.\d{4}$/.test(d)) throw new Error('Дата в формате дд.мм.гггг');
  var p = regData_().players.filter(function (x) { return x.id === id; })[0];
  if (!p) throw new Error('Игрок не найден: ' + id);
  var was = birthById_()[id] || '';
  if (CONFIG.DRY_RUN) return { ok: true, dryRun: true };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = dbSheet_(BIRTH_SHEET, BIRTH_HEAD), row = 0;
    if (sh.getLastRow() > 1) {
      var ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getDisplayValues();
      for (var i = 0; i < ids.length; i++) if (String(ids[i][0]).trim() === id) { row = i + 2; break; }
    }
    var target = row || sh.getLastRow() + 1;
    nfSafe_(sh.getRange(target, 3), '@'); // как текст, чтобы таблица не переписала дату по своей локали
    sh.getRange(target, 1, 1, 4).setValues([[id, p.name, d, new Date()]]);
    logChange_(id, p.name, 'Дата рождения', was, d);
    cacheDropBig_('bo_v1'); cacheDropBig_('birth_v1');
  } finally { lock.releaseLock(); }
  return { ok: true, dryRun: false };
}

function appAddPlayer(pin, p) {
  checkAdmin_(pin);
  var res;
  if (CONFIG.DRY_RUN) res = addPlayerCore_(p);
  else {
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try { res = addPlayerCore_(p); } finally { lock.releaseLock(); }
  }
  if (res.ok && !CONFIG.DRY_RUN && p.funnelName) {
    try { res.funnel = funnelMarkRegistered_(p.funnelName, p.group); } catch (e) { res.funnel = false; }
  }
  return res;
}

function addPlayerCore_(p) {
  var name = String(p.name || '').replace(/\s+/g, ' ').trim();
  if (!name) throw new Error('Введите ФИ');
  var reg = readRegistry_(), l = lists_(reg.players);
  if (l.groups.indexOf(p.group) < 0) throw new Error('Выберите основную группу');
  if (p.start && !/^\d{4}-\d{2}-\d{2}$/.test(p.start)) throw new Error('Неверная дата начала');
  var badEx = (p.extras || []).filter(function (g) { return l.groups.indexOf(g) < 0; });
  if (badEx.length) throw new Error('Неизвестная группа: ' + badEx.join(', '));
  var same = reg.players.filter(function (x) { return norm(x.name) === norm(name); });
  if (same.length) throw new Error('Игрок с таким ФИ уже есть: ' + same[0].id + ' (' + same[0].group + ', ' + same[0].status + ')');
  var sim = reg.players.filter(function (x) { return lev_(norm(x.name), norm(name)) <= 2; });
  if (sim.length && !p.force) {
    return { ok: false, similar: sim.slice(0, 5).map(function (x) { return x.name + ' (' + x.id + ', ' + x.group + ')'; }) };
  }
  var id = nextId_(reg.players);
  var extras = (p.extras || []).filter(function (g) { return g !== p.group; });
  var row = [id, name, p.group, l.locOf[norm(p.group)] || '', 'Активен', serialOf(p.start || today_()), '', extras.join(', ')];
  if (!CONFIG.DRY_RUN) {
    var last = 3;
    reg.players.forEach(function (x) { last = Math.max(last, x.row); });
    var r = last + 1, sh = reg.sh;
    if (r > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), r - sh.getMaxRows());
    sh.getRange(r, 1, 1, row.length).setValues([row]);
    // оформление как у строки выше (цвета, рамки, шрифт); значения не трогаем
    if (r > 4) sh.getRange(r - 1, 1, 1, row.length).copyTo(sh.getRange(r, 1, 1, row.length), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    nfSafe_(sh.getRange(r, 6), 'dd.MM.yyyy');
    logChange_(id, name, 'добавлен', '', p.group + (extras.length ? ' + ' + extras.join(', ') : ''));
    regInvalidate_();
  }
  return { ok: true, id: id, name: name, dryRun: CONFIG.DRY_RUN };
}

function appUpdatePlayer(pin, id, c) {
  checkAdmin_(pin);
  if (CONFIG.DRY_RUN) return updatePlayerCore_(id, c);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return updatePlayerCore_(id, c); } finally { lock.releaseLock(); }
}

function updatePlayerCore_(id, c) {
  var reg = readRegistry_(), l = lists_(reg.players);
  var p = reg.players.filter(function (x) { return x.id === id; })[0];
  if (!p) throw new Error('Игрок не найден: ' + id);
  if (c.status !== p.status && l.statuses.indexOf(c.status) < 0) throw new Error('Неизвестный статус');
  if (c.end && !/^\d{4}-\d{2}-\d{2}$/.test(c.end)) throw new Error('Неверная дата окончания');
  var newEx = (c.extras || []).filter(function (g) { return p.extras.indexOf(g) < 0 && l.groups.indexOf(g) < 0; });
  if (newEx.length) throw new Error('Неизвестная группа: ' + newEx.join(', '));
  var ch = []; // {col, value, field, was, now, isDate}
  var nm = String(c.name || '').replace(/\s+/g, ' ').trim();
  if (!nm) throw new Error('ФИ не может быть пустым');
  if (nm !== p.name) {
    if (reg.players.some(function (x) { return x.id !== id && norm(x.name) === norm(nm); })) throw new Error('Игрок с таким ФИ уже есть');
    ch.push({ col: 2, value: nm, field: 'ФИ', was: p.name, now: nm });
  }
  if (c.group !== p.group) {
    if (l.groups.indexOf(c.group) < 0) throw new Error('Неизвестная группа');
    var loc = l.locOf[norm(c.group)] || p.loc;
    ch.push({ col: 3, value: c.group, field: 'Основная группа', was: p.group, now: c.group });
    if (loc !== p.loc) ch.push({ col: 4, value: loc, field: 'Локация', was: p.loc, now: loc });
  }
  if (c.status !== p.status) {
    ch.push({ col: 5, value: c.status, field: 'Статус', was: p.status, now: c.status });
    if (c.status !== 'Активен') {
      var e = c.end || today_();
      ch.push({ col: 7, value: serialOf(e), field: 'Дата окончания', was: p.end, now: e, isDate: true });
    } else if (p.end) {
      ch.push({ col: 7, value: '', field: 'Дата окончания', was: p.end, now: '' });
    }
  }
  var ex = (c.extras || []).join(', ');
  if (ex !== p.extras.join(', ')) ch.push({ col: 8, value: ex, field: 'Доп. программы', was: p.extras.join(', '), now: ex });
  if (!CONFIG.DRY_RUN && ch.length) {
    ch.forEach(function (x) {
      var rg = reg.sh.getRange(p.row, x.col);
      rg.setValue(x.value);
      if (x.isDate) nfSafe_(rg, 'dd.MM.yyyy');
      logChange_(id, p.name, x.field, x.was, x.now);
    });
    regInvalidate_();
  }
  if (!CONFIG.DRY_RUN && nm !== p.name) renameSweep_(id, p.name, nm);
  return { ok: true, changed: ch.length, renamed: nm !== p.name, dryRun: CONFIG.DRY_RUN };
}

// Переименование игрока во всех таблицах, где имя хранится текстом. Вызывается под блокировкой, после записи реестра.
// Сопоставляем по имени (без регистра), ID в этих листах нет.
function renameSweep_(id, oldName, newName) {
  var o = norm(oldName), report = {};
  function bump(k, n) { if (n) report[k] = (report[k] || 0) + n; }
  // Колонка с именем: fix(название, лист, номер колонки, первая строка данных)
  function fix(key, sh, col, from) {
    if (!sh) return;
    var last = sh.getLastRow();
    if (last < from) return;
    var rg = sh.getRange(from, col, last - from + 1, 1), v = rg.getValues(), n = 0;
    v.forEach(function (r) { if (norm(r[0]) === o) { r[0] = newName; n++; } });
    if (n) { rg.setValues(v); bump(key, n); }
  }
  var ad = adminSS_();
  fix('Абонементы', ad.getSheetByName(SUB_SHEET), 4, 2);       // журнал АБОНЕМЕНТЫ, ФИ в D
  fix('Оплаты экипировки', ad.getSheetByName(PAY_SHEET), 4, 2); // журнал ОПЛАТЫ, ФИ в D
  fix('Доп. оплаты', ad.getSheetByName(EXTRA_LOG), 3, 2);       // ДОПОЛНИТЕЛЬНЫЕ ОПЛАТЫ, ФИ в C
  fix('Доп. отметки', ad.getSheetByName(EXTRA_ATT), 2, 2);      // ДОПОЛНИТЕЛЬНЫЕ ОТМЕТКИ, ФИ в B
  fix('Инд. журнал', ad.getSheetByName(IND_LOG), 3, 2);         // журнал индивидуальных, ФИ в C
  fix('Состав матчей', partsSheet_(), 3, 2);                    // УЧАСТИЕ, ФИ в C
  fix('Экипировка', equipSheet_(), 3, 4);                       // заказы экипировки, ФИ в C, данные с 4-й строки
  // Листы месяцев оплат: имя в колонке B внутри блоков групп
  payFile_().getSheets().forEach(function (sh) {
    if (!/^\d{2}\.\d{2}$/.test(sh.getName())) return;
    var n = 0;
    parseMonth_(sh).forEach(function (g) {
      g.rows.forEach(function (r) {
        if (norm(r.name) === o) { sh.getRange(r.row, 2).setValue(newName); n++; }
      });
    });
    bump('Оплаты ' + sh.getName(), n);
  });
  // Листы дополнительных тренировок: имя в колонке B
  var nd = 0;
  extraParseRaw_(function () { return true; }).forEach(function (e) {
    e.players.forEach(function (p) {
      if (norm(p.name) === o) { extraSS_().getSheetByName(e.sheet).getRange(p.row, 2).setValue(newName); nd++; }
    });
  });
  bump('Доп. тренировки', nd);
  logChange_(id, newName, 'переименован: сверка таблиц', oldName, newName + (Object.keys(report).length ? ' | ' + JSON.stringify(report) : ' | нигде не найден'));
  return report;
}

var _attSS = null; // таблица посещаемости, открывается один раз за запуск
function attSS_() {
  if (_attSS) return _attSS;
  var id = prop_('ATT_ID');
  if (!id) throw new Error('Не задано свойство ATT_ID (ID таблицы посещаемости)');
  _attSS = SpreadsheetApp.openById(id);
  return _attSS;
}

// Листы, которые живут в AdminApp. Все остальные листы читаются из посещаемости.
var ADMIN_SHEETS_ = ['МАТЧИ', 'УЧАСТИЕ', 'ИМПОРТ ИГРОКОВ', 'ОПЛАТЫ', 'ЖУРНАЛ ИЗМЕНЕНИЙ',
  'АБОНЕМЕНТЫ', 'ИНДИВИДУАЛЬНЫЕ ОПЛАТЫ', 'ДОПОЛНИТЕЛЬНЫЕ ОПЛАТЫ', 'ДОПОЛНИТЕЛЬНЫЕ ОТМЕТКИ', 'СБОРЫ'];

function sheetOf_(name) {
  var ss = ADMIN_SHEETS_.indexOf(name) >= 0 ? adminSS_() : attSS_();
  return ss.getSheetByName(name);
}