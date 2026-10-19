/**
 * Цены с месяца начала действия — лист «ЦЕНЫ» в AdminApp, правится на экране «Настройки».
 * Строка: «С месяца» (ММ.ГГ) | «Позиция» | «Группа» | «Цена, ₾» | «Изменено».
 * Позиции: «Абонемент» (группа — своя цена группы; пусто — все остальные группы) и «Индивидуальное занятие».
 * Цена за месяц — из последней строки с «С месяца» не позже этого месяца. Своя строка группы важнее общей.
 * Прошлые месяцы остаются по своей цене: новая цена добавляется строкой с нового месяца, старые строки не меняются.
 * Пока строк для позиции нет, действуют цены по умолчанию (PRICE_DEFAULTS) — как было в коде.
 */

var PRICE_SHEET = 'ЦЕНЫ';
var PRICE_HEAD = ['С месяца', 'Позиция', 'Группа', 'Цена, ₾', 'Изменено'];
var PRICE_SUB = 'Абонемент', PRICE_IND = 'Индивидуальное занятие';
var PRICE_KINDS = [PRICE_SUB, PRICE_IND];
var PRICE_DEFAULTS = {};
PRICE_DEFAULTS[PRICE_SUB] = { '': 165, 'weekends': 130 };
PRICE_DEFAULTS[PRICE_IND] = { '': 50 };

// «10.26» → 2610; дата «2026-10-25» или «25.10.2026» → 2610; пусто — текущий месяц
function priceMonthKey_(v) {
  var s = String(v || '').trim(), m;
  if ((m = /^(\d{2})\.(\d{2})$/.exec(s))) return Number(m[2]) * 100 + Number(m[1]);
  if ((m = /^(\d{4})-(\d{2})/.exec(s))) return (Number(m[1]) % 100) * 100 + Number(m[2]);
  if ((m = /^\d{1,2}\.(\d{2})\.(\d{4})/.exec(s))) return (Number(m[2]) % 100) * 100 + Number(m[1]);   // дд.мм.гггг
  var d = new Date();
  return (d.getFullYear() % 100) * 100 + d.getMonth() + 1;
}

function priceCheck_(r) {
  var from = String(r.from !== undefined ? r.from : r[0]).trim(), kind = String(r.kind !== undefined ? r.kind : r[1]).trim();
  var group = String(r.group !== undefined ? r.group : r[2]).replace(/\s+/g, ' ').trim();
  var raw = String(r.price !== undefined ? r.price : r[3]).replace(',', '.').replace(/\s|₾/g, ''), price = Number(raw);
  var m = /^(\d{2})\.(\d{2})$/.exec(from);
  if (!m || Number(m[1]) < 1 || Number(m[1]) > 12) return { error: 'месяц в формате ММ.ГГ, например 11.26' };
  if (PRICE_KINDS.indexOf(kind) < 0) return { error: 'позиция: ' + PRICE_KINDS.join(' или ') };
  if (kind === PRICE_IND && group) return { error: 'у индивидуального занятия группа не указывается' };
  if (raw === '' || isNaN(price) || price < 0 || price > 100000) return { error: 'цена — число от 0 до 100000' };
  return { row: [from, kind, group, Math.round(price * 100) / 100] };
}

var _priceRun = null;
function priceLoad_() {
  if (_priceRun) return _priceRun;
  var key = 'price_' + settingsVer_(), cache = CacheService.getScriptCache(), hit = cache.get(key);
  if (hit) { try { _priceRun = JSON.parse(hit); return _priceRun; } catch (e) {} }
  var res = { rows: [], bad: [] }, sh = null;
  try { sh = dbRead_(PRICE_SHEET); } catch (e) { console.warn('Цены недоступны, действуют цены по умолчанию: ' + e.message); }
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 4).getDisplayValues().forEach(function (r, i) {
      if (r.every(function (x) { return String(x).trim() === ''; })) return;
      var c = priceCheck_(r);
      if (c.error) res.bad.push({ line: i + 2, error: c.error }); else res.rows.push(c.row.concat([i + 2]));
    });
  }
  try { cache.put(key, JSON.stringify(res), 600); } catch (e) {}
  _priceRun = res;
  return res;
}

// Цена позиции для группы на месяц (ММ.ГГ или дата). group — для абонемента.
function priceFor_(kind, group, when) {
  var key = priceMonthKey_(when), g = norm(group || ''), own = null, gen = null;
  priceLoad_().rows.forEach(function (r) {
    if (r[1] !== kind) return;
    var k = priceMonthKey_(r[0]);
    if (k > key) return;
    if (r[2] && norm(r[2]) === g) { if (!own || k >= own.k) own = { k: k, v: r[3] }; }
    else if (!r[2]) { if (!gen || k >= gen.k) gen = { k: k, v: r[3] }; }
  });
  if (own) return own.v;
  var def = PRICE_DEFAULTS[kind] || {};
  if (g && def.hasOwnProperty(g)) return def[g];   // своя цена группы по умолчанию (weekends), пока у группы нет строк
  if (gen) return gen.v;
  return def[''];
}

// Тариф абонемента группы за месяц (ММ.ГГ); без месяца — текущий
function tariff_(group, month) { return priceFor_(PRICE_SUB, group, month); }
// Цена индивидуального / вратарского занятия на дату занятия
function indPrice_(date) { return priceFor_(PRICE_IND, '', date); }

// ---------- Экран «Настройки» ----------

function appPrices(pin) {
  checkAdmin_(pin);
  var p = priceLoad_(), cur = priceMonthKey_(), defs = [];
  Object.keys(PRICE_DEFAULTS).forEach(function (kind) {
    Object.keys(PRICE_DEFAULTS[kind]).forEach(function (g) { defs.push({ kind: kind, group: g, price: PRICE_DEFAULTS[kind][g] }); });
  });
  return {
    kinds: PRICE_KINDS, bad: p.bad, defaults: defs,
    rows: p.rows.map(function (r) { return { from: r[0], kind: r[1], group: r[2], price: r[3], line: r[4], future: priceMonthKey_(r[0]) > cur }; })
      .sort(function (a, b) { return priceMonthKey_(b.from) - priceMonthKey_(a.from) || a.kind.localeCompare(b.kind) || a.group.localeCompare(b.group); }),
    now: { sub: tariff_('', ''), ind: indPrice_('') }
  };
}

// Новая цена с месяца. Прошлые месяцы не меняются: месяц не может быть раньше текущего.
function appPriceAdd(pin, o) {
  checkAdmin_(pin);
  var c = priceCheck_(o || {});
  if (c.error) throw new Error(c.error);
  if (priceMonthKey_(c.row[0]) < priceMonthKey_()) throw new Error('Цену можно задать с текущего или будущего месяца: прошлые месяцы остаются по своей цене');
  if (CONFIG.DRY_RUN) return { ok: true, dryRun: true };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (priceLoad_().rows.some(function (r) { return r[0] === c.row[0] && r[1] === c.row[1] && norm(r[2]) === norm(c.row[2]); }))
      throw new Error('Цена «' + c.row[1] + (c.row[2] ? ', ' + c.row[2] : '') + '» с ' + c.row[0] + ' уже есть: удалите её и добавьте заново');
    var was = c.row[1] === PRICE_SUB ? tariff_(c.row[2], c.row[0]) : indPrice_(c.row[0]);
    var sh = dbSheet_(PRICE_SHEET, PRICE_HEAD), n = sh.getLastRow() + 1, rg = sh.getRange(n, 1, 1, 5);
    nfSafe_(sh.getRange(n, 1), '@');
    rg.setValues([[c.row[0], c.row[1], c.row[2], c.row[3], Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM.yyyy')]]);
    settingsBump_();
    _priceRun = null;
    logChange_('', '', 'цена: ' + c.row[1] + (c.row[2] ? ' (' + c.row[2] + ')' : '') + ' с ' + c.row[0], String(was), String(c.row[3]));
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// Удалить можно только строку будущего месяца (ещё не действующую цену)
function appPriceDelete(pin, line) {
  checkAdmin_(pin);
  line = Number(line);
  if (CONFIG.DRY_RUN) return { ok: true, dryRun: true };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    _priceRun = null;
    var r = priceLoad_().rows.filter(function (x) { return x[4] === line; })[0];
    if (!r) throw new Error('Строка не найдена, обновите страницу');
    if (priceMonthKey_(r[0]) <= priceMonthKey_()) throw new Error('Действующую или прошлую цену удалить нельзя: от неё зависят суммы прошлых месяцев');
    dbRead_(PRICE_SHEET).deleteRow(line);
    settingsBump_();
    _priceRun = null;
    logChange_('', '', 'цена удалена: ' + r[1] + (r[2] ? ' (' + r[2] + ')' : '') + ' с ' + r[0], String(r[3]), '');
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}
