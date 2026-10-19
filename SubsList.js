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
  regData_().players.forEach(function (p) { byName[norm(p.name)] = p; });
  var flags = subLedger_(), rank = { paid: 0, partial: 1 }, back = ['paid', 'partial', 'none'];
  mg.forEach(function (g) {
    if (skipGroup_(g.name)) return;
    g.rows.forEach(function (r) {
      if (!r.name) return;
      var key = norm(r.name), p = byName[key], id = p && p.id;
      if (!id || subIsExtra_(p, g.name)) return;   // доп. программа: статус — по основному абонементу
      var T = tariff_(g.name, m), disc = !!flags[m + '|' + norm(g.name) + '|' + key];
      var s = subState_(T, norm(g.name) === norm(p.group) ? effPaid_(mg, g.name, r.name, p) : r.paid, disc);
      var rk = rank[s.st] === undefined ? 2 : rank[s.st];
      var old = out.map[id] === undefined ? -1 : rank[out.map[id]] === undefined ? 2 : rank[out.map[id]];
      if (rk > old) out.map[id] = back[rk];
    });
  });
  return out;
}