/** Должники по абонементу за месяц: активные игроки, у которых за выбранный месяц оплата не полная. Только чтение. */

function appDebtors(pin, month) {
  checkAdmin_(pin);
  var d = new Date();
  var m = month || (('0' + (d.getMonth() + 1)).slice(-2) + '.' + String(d.getFullYear()).slice(2));
  var months = payMonths_();
  var out = { month: m, months: months, found: false, groups: [], count: 0, sum: 0 };
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
    [p.group].concat(p.extras || []).forEach(function (gn) {
      if (!gn || skipGroup_(gn)) return;
      var T;
      try { T = tariff_(gn); } catch (e) { return; }
      if (!T) return;
      var key = norm(gn) + '|' + norm(p.name);
      var paid = paidOf[key] || 0, disc = !!flags[m + '|' + norm(gn) + '|' + norm(p.name)];
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