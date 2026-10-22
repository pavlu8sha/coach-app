/** Должники по абонементу за месяц: активные игроки, у которых за выбранный месяц оплата не полная. Только чтение. */

function appDebtors(pin, month) {
  checkAdmin_(pin);
  var d = new Date();
  var m = month || (('0' + (d.getMonth() + 1)).slice(-2) + '.' + String(d.getFullYear()).slice(2));
  var months = payMonths_();
  var out = { month: m, months: months, found: false, groups: [], count: 0, sum: 0 };
  try { out.wrote = debtWroteOf_(m); } catch (e) { out.wrote = []; }   // отметки «написал(а)» этого месяца: ID игроков
  try { out.ind = indDebts_(indParse_()); } catch (e) { out.ind = []; }
  try { out.extra = extraDebts_(extraParse_(), extraPrices_()); } catch (e) { out.extra = []; }
  var mg = monthGroups_(m);
  if (!mg) return out;
  out.found = true;
  var paidOf = {};
  mg.forEach(function (g) {
    g.rows.forEach(function (r) { if (r.name) paidOf[norm(g.name) + '|' + norm(r.name)] = r.paid; });
  });
  var flags = subLedger_(), byGroup = {};
  regData_().players.forEach(function (p) {
    if (p.status !== 'Активен') return;
    [p.group].forEach(function (gn) {   // доп. программы отдельного долга не дают: идут в счёт основного (effPaid_)
      if (!gn || skipGroup_(gn)) return;
      var T;
      try { T = tariff_(gn, m); } catch (e) { return; }
      if (!T) return;
      var key = norm(gn) + '|' + norm(p.name);
      var paid = norm(gn) === norm(p.group) ? effPaid_(mg, gn, p.name, p) : (paidOf[key] || 0);
      var disc = !!flags[m + '|' + norm(gn) + '|' + norm(p.name)];
      var s = subState_(T, paid, disc);
      if (s.st === 'paid') return;
      (byGroup[gn] = byGroup[gn] || { name: gn, tariff: T, items: [] }).items.push(
        { id: p.id, name: p.name, paid: paid, debt: Math.max(T - paid, 0), partial: paid > 0 });
      out.count++; out.sum += Math.max(T - paid, 0);
    });
  });
  Object.keys(byGroup).sort().forEach(function (k) {
    byGroup[k].items.sort(function (a, b) { return a.name.localeCompare(b.name); });
    out.groups.push(byGroup[k]);
  });
  return out;
}

// ---------- Отметки «написал(а)» (общие для всех устройств; раньше — только в браузере, localStorage «debtDone») ----------
// Лист AdminApp «ОТМЕТКИ ДОЛЖНИКОВ»: месяц (ММ.ГГ) | ID игрока | когда отмечено. Механика — Wrote.js.
var DEBT_WROTE_SHEET = 'ОТМЕТКИ ДОЛЖНИКОВ', DEBT_WROTE_HEAD = ['Месяц', 'ID игрока', 'Отмечено'];

function debtWroteKey_(month, id) {
  var m = String(month || '').trim(), i = String(id || '').trim();
  if (!/^\d{2}\.\d{2}$/.test(m) || !/^[^|]{1,40}$/.test(i)) return null;
  return [m, i];
}

// ID игроков, отмеченных за месяц
function debtWroteOf_(month) {
  return wroteRows_(dbRead_(DEBT_WROTE_SHEET))
    .filter(function (r) { return r[0] === month && r[1]; })
    .map(function (r) { return r[1]; });
}

// Поставить или снять одну отметку
function appDebtWrote(pin, month, id, on) {
  checkAdmin_(pin);
  var k = debtWroteKey_(month, id);
  if (!k) throw new Error('Неверная отметка');
  return wroteToggle_(DEBT_WROTE_SHEET, DEBT_WROTE_HEAD, k[0], k[1], !!on);
}

// Однократный перенос отметок, сохранённых раньше в браузере: keys «ММ.ГГ|ID». Только добавляет, ничего не снимает.
function appDebtWroteImport(pin, keys) {
  checkAdmin_(pin);
  var pairs = [];
  (Array.isArray(keys) ? keys : []).slice(0, 2000).forEach(function (s) {
    var t = String(s), i = t.indexOf('|'), k = i > 0 ? debtWroteKey_(t.slice(0, i), t.slice(i + 1)) : null;
    if (k) pairs.push(k);
  });
  if (CONFIG.DRY_RUN) return { ok: true, dryRun: true, added: 0 };
  return { ok: true, added: wroteAddMany_(DEBT_WROTE_SHEET, DEBT_WROTE_HEAD, pairs) };
}
