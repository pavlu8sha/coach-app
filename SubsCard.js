/** Абонемент в карточке игрока. Только для администратора, ничего не пишет. */

function appPlayerSubs(pin, id) {
  checkAdmin_(pin);
  var p = regData_().players.filter(function (x) { return x.id === id; })[0];
  if (!p) throw new Error('Игрок не найден');
  var key = norm(p.name), flags = subLedger_(), items = [];
  var rev = function (m) { return m.split('.').reverse().join(''); };
  var months = payMonths_().slice();
  months.forEach(function (m) {
    (monthGroups_(m) || []).forEach(function (g) {
      g.rows.forEach(function (r) {
        if (!r.name || norm(r.name) !== key) return;
        if (subIsExtra_(p, g.name)) {   // доп. программа: без своего долга, внесённое идёт в основной абонемент
          if (r.paid > 0) items.push({ month: m, group: g.name, tariff: 0, paid: r.paid, st: 'paid', debt: 0, extra: p.group, disc: false,
            method: flags['m|' + m + '|' + norm(g.name) + '|' + key] || '' });
          return;
        }
        var T = tariff_(g.name, m), disc = !!flags[m + '|' + norm(g.name) + '|' + key];
        var paidEff = norm(g.name) === norm(p.group) ? effPaid_(monthGroups_(m), g.name, r.name, p) : r.paid;
        var s = subState_(T, paidEff, disc);
        items.push({ month: m, group: g.name, tariff: T, paid: paidEff, st: s.st, debt: s.debt, disc: disc && paidEff > 0 && paidEff < T,
          method: flags['m|' + m + '|' + norm(g.name) + '|' + key] || '' });
      });
    });
  });
  items.sort(function (a, b) { return rev(b.month).localeCompare(rev(a.month)); });
  months.sort(function (a, b) { return rev(b).localeCompare(rev(a)); });
  var tariffs = {};
  [p.group].forEach(function (g) { if (g && !skipGroup_(g)) tariffs[g] = tariff_(g); });   // оплата — в основной группе: доп. программы идут в её счёт  // текущий месяц: для формы оплаты
  var tariffsBy = {};
  months.forEach(function (m) { tariffsBy[m] = {}; Object.keys(tariffs).forEach(function (g) { tariffsBy[m][g] = tariff_(g, m); }); });
  var hist = [], ps = dbRead_(SUB_SHEET);
  if (ps && ps.getLastRow() > 1) {
    ps.getRange(2, 1, ps.getLastRow() - 1, 10).getDisplayValues().forEach(function (r) {
      if (r[2] === id) hist.push({ date: r[1], month: r[4], group: r[5], amount: r[6], type: r[7], comment: r[8], method: r[9] });
    });
  }
  return { items: items, hist: hist.reverse(), months: months, tariffs: tariffs, tariffsBy: tariffsBy };
}