/** Статус оплаты абонемента всех игроков за месяц (для плашек в списке «Игроки»). Только чтение. */

function appPaySummary(pin, month) {
  checkAdmin_(pin);
  var d = new Date();
  var m = month || (('0' + (d.getMonth() + 1)).slice(-2) + '.' + String(d.getFullYear()).slice(2));
  var out = { month: m, found: false, map: {} };
  var mg = monthGroups_(m);
  if (!mg) return out;
  out.found = true;
  var byName = {};
  regData_().players.forEach(function (p) { byName[norm(p.name)] = p.id; });
  var flags = subLedger_(), rank = { paid: 0, partial: 1 }, back = ['paid', 'partial', 'none'];
  mg.forEach(function (g) {
    if (skipGroup_(g.name)) return;
    g.rows.forEach(function (r) {
      if (!r.name) return;
      var key = norm(r.name), id = byName[key];
      if (!id) return;
      var T = tariff_(g.name), disc = !!flags[m + '|' + norm(g.name) + '|' + key];
      var s = subState_(T, r.paid, disc);
      var rk = rank[s.st] === undefined ? 2 : rank[s.st];
      var old = out.map[id] === undefined ? -1 : rank[out.map[id]] === undefined ? 2 : rank[out.map[id]];
      if (rk > old) out.map[id] = back[rk];
    });
  });
  return out;
}