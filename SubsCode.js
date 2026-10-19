/** Абонементы: оплаты по месяцам и группам. Только для администратора. */

var SUB_SHEET = 'АБОНЕМЕНТЫ';

var _payFile = null; // открываем файл оплат один раз за запуск
function payFile_() {
  if (_payFile) return _payFile;
  var id = prop_('PAY_ID');
  if (!id) throw new Error('Не задано свойство PAY_ID (ID файла оплат)');
  _payFile = SpreadsheetApp.openById(id);
  return _payFile;
}

// Месяц оплат из кэша (до 15 мин); сбрасывается при каждой записи платежа через приложение.
// Правки прямо в файле оплат видны после «Обновить данные».
function monthGroups_(month) {
  var key = 'pm_' + month, hit = cacheGetBig_(key);
  if (hit) return hit;
  var sh = payFile_().getSheetByName(month);
  if (!sh) return null;
  var g = parseMonth_(sh);
  cachePutBig_(key, g, 90);
  return g;
}
function monthInvalidate_(month) { cacheDropBig_('pm_' + month); }

// Ключ сортировки месяца «мм.гг» -> «ггмм», чтобы сравнивать по времени
function revMonth_(m) { var p = String(m).split('.'); return p[1] + p[0]; }

// Список месяцев (листы вида 10.26) из кэша.
function payMonths_() {
  var hit = cacheGetBig_('pmonths');
  if (hit) return hit;
  var list = payFile_().getSheets().map(function (s) { return s.getName(); })
    .filter(function (n) { return /^\d{2}\.\d{2}$/.test(n); })
    .sort(function (a, b) { return revMonth_(a).localeCompare(revMonth_(b)); });
  cachePutBig_('pmonths', list, 90);
  return list;
}

// Тариф за месяц: tariff_(group, month) — Prices.js (лист «ЦЕНЫ», с месяца начала действия)
function skipGroup_(name) { return norm(name) === 'индивидуальные / вратарские'; }

// Блоки листа месяца: заголовок группы стоит строкой выше строки «№».
function parseMonth_(sh) {
  var data = sh.getRange(1, 1, sh.getLastRow(), 4).getValues(), groups = [], cur = null, i, a;
  for (i = 0; i < data.length; i++) {
    a = String(data[i][0]).trim();
    if (a === '№') {
      if (i > 0) { cur = { name: String(data[i - 1][0]).trim(), rows: [] }; groups.push(cur); }
      continue;
    }
    if (!cur || a === '') continue;
    if (isNaN(Number(a))) { cur = null; continue; }
    cur.rows.push({ row: i + 1, name: String(data[i][1]).trim(), paid: Number(data[i][3]) || 0 });
  }
  return groups.filter(function (g) { return !skipGroup_(g.name); });
}

// Журнал платежей: пометки «скидка» и способы оплаты (ключи вида 'm|месяц|группа|ФИ').
function subLedger_() {
  var hit = cacheGetBig_('sl_v1');
  if (hit) return hit;
  var ps = dbRead_(SUB_SHEET), flags = {}, sums = {};
  if (ps && ps.getLastRow() > 1) {
    var n = ps.getLastRow() - 1;
    var d = ps.getRange(2, 1, n, 10).getDisplayValues(), a = ps.getRange(2, 7, n, 1).getValues();
    d.forEach(function (r, i) {
      var key = r[4] + '|' + norm(r[5]) + '|' + norm(r[3]);
      if (r[7] === 'Скидка') flags[key] = true;
      if (r[9]) { var k = key + '|' + r[9]; sums[k] = (sums[k] || 0) + (Number(a[i][0]) || 0); }
    });
    Object.keys(sums).forEach(function (k) {
      if (sums[k] <= 0) return;
      var p = k.lastIndexOf('|'), mk = 'm|' + k.slice(0, p), m = k.slice(p + 1);
      flags[mk] = flags[mk] ? flags[mk] + ' + ' + m : m;
    });
  }
  cachePutBig_('sl_v1', flags, 90);
  return flags;
}

function subState_(T, paid, disc) {
  if (paid >= T || (disc && paid > 0)) return { st: 'paid', debt: 0 };
  return { st: paid > 0 ? 'partial' : 'unpaid', debt: Math.max(T - paid, 0) };
}

function subLog_(month, group, p, amount, kind, dateStr, comment) {
  subLog2_(month, group, p, amount, kind, dateStr, comment, '');
}

function appPayMonths(pin) {
  checkAdmin_(pin);
  return payMonths_();
}

function appPayMonth(pin, month) {
  checkAdmin_(pin);
  var mg = monthGroups_(month);
  if (!mg) throw new Error('Нет листа ' + month);
  var flags = subLedger_(), byName = {};
  regData_().players.forEach(function (x) { var k = norm(x.name); if (!byName[k]) byName[k] = x; });
  var groups = mg.map(function (g) {
    var T = tariff_(g.name, month), rows = [], free = 0;
    g.rows.forEach(function (r) {
      if (!r.name) { free++; return; }
      var p = byName[norm(r.name)];
      // выбывший игрок без оплаты за месяц в списке не нужен
      if (p && p.status !== 'Активен' && !(r.paid > 0)) return;
      var paid = p && norm(p.group) === norm(g.name) ? effPaid_(mg, g.name, r.name, p) : r.paid;
      var disc = !!flags[month + '|' + norm(g.name) + '|' + norm(r.name)];
      var s = subState_(T, paid, disc);
      rows.push({ name: r.name, id: p ? p.id : '', paid: paid, st: s.st, debt: s.debt, disc: disc && paid > 0 && paid < T,
        method: flags['m|' + month + '|' + norm(g.name) + '|' + norm(r.name)] || '' });
    });
    return { name: g.name, tariff: T, rows: rows, free: free };
  });
  return { month: month, groups: groups };
}

// Оплата игрока за месяц в его основной группе. Если в основной группе ничего не внесено,
// а игрок переведён из другой группы (и она не его доп. программа) — берём оплату из той группы.
function effPaid_(mg, gn, name, p) {
  var own = 0, moved = 0, extras = (p.extras || []).map(norm);
  mg.forEach(function (g) {
    g.rows.forEach(function (r) {
      if (norm(r.name) !== norm(name)) return;
      if (norm(g.name) === norm(gn)) own = Math.max(own, r.paid || 0);
      else if (r.paid > 0 && extras.indexOf(norm(g.name)) < 0) moved = Math.max(moved, r.paid);
    });
  });
  return own > 0 ? own : moved;
}

// Принять уже внесённую неполную сумму как «скидку по договорённости».
function appSubDiscount(pin, month, group, id, comment) {
  checkAdmin_(pin);
  if (CONFIG.DRY_RUN) return subDiscountCore_(month, group, id, comment);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return subDiscountCore_(month, group, id, comment); } finally { lock.releaseLock(); }
}

function subDiscountCore_(month, group, id, comment) {
  var p = readRegistry_().players.filter(function (x) { return x.id === id; })[0];
  if (!p) throw new Error('Игрок не найден');
  var sh = payFile_().getSheetByName(month);
  var g = sh && parseMonth_(sh).filter(function (x) { return norm(x.name) === norm(group); })[0];
  var row = g && g.rows.filter(function (r) { return norm(r.name) === norm(p.name); })[0];
  if (!row || !(row.paid > 0)) throw new Error('В этом месяце у игрока нет внесённой суммы');
  if (row.paid >= tariff_(group, month)) throw new Error('Абонемент за этот месяц уже оплачен полностью');
  if (CONFIG.DRY_RUN) return { ok: true, dryRun: true };
  if (!dbSheet_(SUB_SHEET, SUB_HEAD)) throw new Error('Нет журнала платежей (лист ' + SUB_SHEET + ' в AdminApp). Скидка не записана.');
  cacheDropBig_('sl_v1');   // читаем журнал заново: вдруг скидку только что приняли
  if (subLedger_()[month + '|' + norm(group) + '|' + norm(p.name)]) throw new Error('Скидка по этому месяцу уже принята');
  subLog_(month, group, p, 0, 'Скидка', today_(), comment || 'принято как скидка');
  return { ok: true, dryRun: false };
}