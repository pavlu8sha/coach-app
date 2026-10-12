/** Карточка игрока: экипировка и оплаты (версия 1). Только для администратора. */

var PAY_SHEET = 'ОПЛАТЫ';

function eqRows_() {
  var sh = equipSheet_();
  var rg = sh.getRange(4, 1, 127, 12);
  var vals = rg.getValues(), disp = rg.getDisplayValues(), out = [];
  vals.forEach(function (r, i) {
    var id = String(r[11] || '').trim();
    if (!id || !String(r[2]).trim()) return;
    out.push({
      row: 4 + i, id: id, kit: disp[i][3], size: disp[i][4], inscr: disp[i][5], num: disp[i][6],
      inst: disp[i][7], sum: Number(r[8]) || 0, paid: Number(r[9]) || 0
    });
  });
  return out;
}

function appPlayerCard(pin, id) {
  checkAdmin_(pin);
  var orders = eqRows_().filter(function (o) { return o.id === id; }).map(function (o) {
    o.debt = Math.max(o.sum - o.paid, 0);
    return o;
  });
  var pays = [], ps = sheetOf_(PAY_SHEET);
  if (ps && ps.getLastRow() > 1) {
    ps.getRange(2, 1, ps.getLastRow() - 1, 8).getDisplayValues().forEach(function (r) {
      if (r[2] === id) pays.push({ date: r[1], what: r[4], amount: r[6], comment: r[7] });
    });
  }
  var t = { sum: 0, paid: 0, debt: 0 };
  orders.forEach(function (o) { t.sum += o.sum; t.paid += o.paid; t.debt += o.debt; });
  return { orders: orders, payments: pays.reverse(), totals: t };
}