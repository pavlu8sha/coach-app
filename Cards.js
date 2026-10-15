/** Карточка игрока: экипировка и оплаты (версия 1). Только для администратора. */

var PAY_SHEET = 'ОПЛАТЫ';

function eqRows_() {
  var sh = equipSheet_();
  var rg = sh.getRange(EQ_FIRST, 1, EQ_ROWS, 12); // те же строки, что в разделе «Экипировка» (раньше только 127)
  var vals = rg.getValues(), disp = rg.getDisplayValues(), out = [];
  vals.forEach(function (r, i) {
    var id = String(r[11] || '').trim();
    if (!id || !String(r[2]).trim()) return;
    out.push({
      row: EQ_FIRST + i, id: id, kit: disp[i][3], size: disp[i][4], inscr: disp[i][5], num: disp[i][6],
      inst: disp[i][7], sum: Number(r[8]) || 0, paid: Number(r[9]) || 0
    });
  });
  return out;
}

// Даты рождения из колонки C групповых блоков листов месяцев файла оплат (блок «Индивидуальные» пропускается).
// Ключ — имя игрока в нижнем регистре; берётся самая свежая запись. Кэш на час.
var BIRTH_CACHE_KEY = 'birth_v1';
function birthByName_() {
  var hit = cacheGetBig_(BIRTH_CACHE_KEY);
  if (hit) return hit;
  var map = {};
  payMonths_().slice().reverse().forEach(function (m) {
    var sh = payFile_().getSheetByName(m);
    if (!sh || sh.getLastRow() < 1) return;
    var data = sh.getRange(1, 1, sh.getLastRow(), 3).getDisplayValues(), cur = null, i, a;
    for (i = 0; i < data.length; i++) {
      a = String(data[i][0]).trim();
      if (a === '№') {
        cur = (i > 0 && !skipGroup_(data[i - 1][0])) ? true : null;
        continue;
      }
      if (!cur || a === '') continue;
      if (isNaN(Number(a))) { cur = null; continue; }
      var name = norm(data[i][1]), dt = String(data[i][2]).trim();
      if (name && /^\d{2}\.\d{2}\.\d{4}$/.test(dt) && !map[name]) map[name] = dt;
    }
  });
  cachePutBig_(BIRTH_CACHE_KEY, map, 3600);
  return map;
}

function appPlayerCard(pin, id) {
  checkAdmin_(pin);
  var birth = birthById_()[id] || '';
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
  return { orders: orders, payments: pays.reverse(), totals: t, birth: birth };
}