/** Привязка заказов экипировки к игрокам. Только для администратора. */

// Цены комплектов для формы заказа: из каталога; если каталог пуст, запасные KIT_PRICES.
function kitPrices_() {
  var m = {}, n = 0;
  catalog_(true).forEach(function (x) { m[x.name] = x.price; n++; });
  return n ? m : KIT_PRICES;
}

function appEquipOrders(pin) {
  checkAdmin_(pin);
  var data = cacheGetBig_('eq_v1');
  if (!data) { data = equipOrdersLive_(); cachePutBig_('eq_v1', data, 60); }
  data.prices = kitPrices_();
  return data;
}

function equipOrdersLive_() {
  var sh = equipSheet_(), rg = sh.getRange(EQ_FIRST, 1, EQ_ROWS, 12);
  var vals = rg.getValues(), disp = rg.getDisplayValues(), orders = [], unl = [];
  vals.forEach(function (r, i) {
    var name = String(r[2]).trim();
    if (!name || isNaN(Number(r[0]))) return;
    var id = String(r[11] || '').trim();
    var sum = Number(r[8]) || 0, paid = Number(r[9]) || 0;
    var o = {
      id: id, row: EQ_FIRST + i, oname: name, kit: disp[i][3], size: disp[i][4], inscr: disp[i][5], num: disp[i][6],
      inst: disp[i][7], sum: sum, paid: paid, debt: Math.max(sum - paid, 0)
    };
    if (id) orders.push(o); else unl.push(o);
  });
  return { orders: orders, unl: unl, unlinked: unl.length };
}

// newId = '' означает «отвязать».
function appRelink(pin, row, newId, fix) {
  checkAdmin_(pin);
  if (CONFIG.DRY_RUN) return relinkCore_(row, newId, fix);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return relinkCore_(row, newId, fix); } finally { lock.releaseLock(); }
}

function relinkCore_(row, newId, fix) {
  row = Number(row);
  if (!(row >= EQ_FIRST && row < EQ_FIRST + EQ_ROWS)) throw new Error('Некорректная строка');
  var sh = equipSheet_();
  var oldId = String(sh.getRange(row, 12).getValue()).trim();
  var orderName = String(sh.getRange(row, 3).getValue()).trim();
  if (!orderName) throw new Error('В этой строке нет заказа');
  var np = null;
  if (newId) {
    np = readRegistry_().players.filter(function (p) { return p.id === newId; })[0];
    if (!np) throw new Error('Игрок не найден: ' + newId);
  }
  if (oldId === (newId || '')) return { ok: true, dryRun: CONFIG.DRY_RUN, moved: 0 };
  var moved = 0;
  if (!CONFIG.DRY_RUN) {
    sh.getRange(row, 12).setValue(newId || '');
    equipSyncLocations_(sh);
    if (np && fix && orderName !== np.name) {
      sh.getRange(row, 3).setValue(np.name);
      logChange_(np.id, np.name, 'ФИ в заказе экипировки', orderName, np.name);
    }
    var ps = dbRead_(PAY_SHEET);
    if (np && oldId && ps && ps.getLastRow() > 1) {
      ps.getRange(2, 1, ps.getLastRow() - 1, 8).getValues().forEach(function (r, i) {
        if (String(r[2]) === oldId && Number(r[5]) === row) {
          ps.getRange(i + 2, 3, 1, 2).setValues([[np.id, np.name]]);
          moved++;
        }
      });
    }
    logChange_(newId || oldId, np ? np.name : orderName,
      newId ? 'заказ экипировки перепривязан' : 'заказ экипировки отвязан',
      'строка ' + row + ': ' + (oldId || 'без привязки'), newId || 'без привязки');
  }
  cacheDropBig_('eq_v1');
  return { ok: true, dryRun: CONFIG.DRY_RUN, moved: moved };
}

function appEditOrder(pin, row, o) {
  checkAdmin_(pin);
  if (CONFIG.DRY_RUN) return editOrderCore_(row, o);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return editOrderCore_(row, o); } finally { lock.releaseLock(); }
}

function editOrderCore_(row, o) {
  row = Number(row);
  if (!(row >= EQ_FIRST && row < EQ_FIRST + EQ_ROWS)) throw new Error('Некорректная строка');
  var sh = equipSheet_();
  if (!String(sh.getRange(row, 3).getValue()).trim()) throw new Error('В этой строке нет заказа');
  var before = sh.getRange(row, 4, 1, 5).getDisplayValues()[0];
  var oldSum = sh.getRange(row, 9).getValue();
  var kit = String(o.kit || '').trim();
  var newSum = null;
  if (kit && kit !== before[0]) {
    var item = catalog_(true).filter(function (x) { return x.name === kit; })[0];
    if (!item) throw new Error('Выберите позицию из каталога');
    newSum = item.price; // комплект сменился: сумма заказа по новой цене из каталога
  }
  var after = [kit || before[0], String(o.size || '').trim(), String(o.inscr || '').trim(), String(o.num || '').trim(), o.inst ? 'Да' : ''];
  if (!CONFIG.DRY_RUN) {
    // Пишем по одной ячейке: многоколоночная запись диапазона в Sheets даёт ошибку «выберите элемент в одном столбце»
    [5, 6, 7].forEach(function (col) { sh.getRange(row, col).setNumberFormat('@'); }); // размер, надпись, номер хранятся как текст
    for (var ci = 0; ci < after.length; ci++) { sh.getRange(row, 4 + ci).setValue(after[ci]); }
    if (newSum !== null) sh.getRange(row, 9).setValue(newSum);
    cacheDropBig_('eq_v1');
    var what = before.join(' | ') + (newSum !== null ? ' | сумма ' + oldSum : '');
    var now = after.join(' | ') + (newSum !== null ? ' | сумма ' + newSum : '');
    logChange_(String(sh.getRange(row, 12).getValue()).trim(), String(sh.getRange(row, 3).getValue()).trim(),
      'правка заказа экипировки', what, now);
  }
  return { ok: true, dryRun: CONFIG.DRY_RUN, sumChanged: newSum !== null };
}