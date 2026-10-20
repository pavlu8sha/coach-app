/** Привязка заказов экипировки к игрокам. Только для администратора. */

// Цены комплектов для формы заказа: из каталога; если каталог пуст, запасные KIT_PRICES.
function kitPrices_() {
  var m = {}, n = 0;
  catalog_(true).forEach(function (x) { m[x.name] = x.price; n++; });
  return n ? m : KIT_PRICES;
}

// Размеры каждой позиции каталога (через запятую в таблице) — для выпадающего списка в форме
function kitSizes_() {
  var m = {};
  catalog_(true).forEach(function (x) {
    m[x.name] = String(x.sizes || '').split(',').map(function (v) { return v.trim(); }).filter(Boolean);
  });
  return m;
}

function appEquipOrders(pin) {
  checkAdmin_(pin);
  var data = cacheGetBig_('eq_v1');
  if (!data) { data = equipOrdersLive_(); cachePutBig_('eq_v1', data, 60); }
  data.prices = kitPrices_();
  data.disc = equipDiscCfg_();
  data.flags = {};   // что требует позиция каталога: надпись, номер (колонки «Надпись», «Номер»)
  catalog_(false).forEach(function (x) { data.flags[x.name.toLowerCase()] = { inscr: !!x.inscr, num: !!x.num }; });
  data.sizes = kitSizes_();
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
      id: id, row: EQ_FIRST + i, no: Number(r[0]), oname: name, kit: disp[i][3], size: disp[i][4], inscr: disp[i][5], num: disp[i][6],
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
    var ps = dbRead_(PAY_SHEET), myNo = eqNoOfRow_(sh, row);
    if (np && oldId && myNo && ps && ps.getLastRow() > 1) {
      ps.getRange(2, 1, ps.getLastRow() - 1, 8).getValues().forEach(function (r, i) {
        if (String(r[2]) === oldId && Number(r[5]) === myNo) {
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

// Удаление заказа: удаляет строку целиком. Строку с оплатой не удаляем.
function appDeleteOrder(pin, row) {
  checkAdmin_(pin);
  if (CONFIG.DRY_RUN) return deleteOrderCore_(row);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return deleteOrderCore_(row); } finally { lock.releaseLock(); }
}

function deleteOrderCore_(row) {
  row = Number(row);
  if (!(row >= EQ_FIRST && row < EQ_FIRST + EQ_ROWS)) throw new Error('Некорректная строка');
  var sh = equipSheet_();
  if (!String(sh.getRange(row, 3).getValue()).trim()) throw new Error('В этой строке нет заказа');
  var paid = Number(sh.getRange(row, 10).getValue()) || 0;
  if (paid > 0) throw new Error('По заказу есть оплата (' + paid + ' ₾). Сначала отмените оплату, потом удалите заказ');
  if (!CONFIG.DRY_RUN) {
    var id = String(sh.getRange(row, 12).getValue()).trim(), name = String(sh.getRange(row, 3).getValue()).trim();
    var what = sh.getRange(row, 4, 1, 6).getDisplayValues()[0].join(' | ');
    sh.deleteRow(row); // строка удаляется целиком, нижние заказы и итоги сдвигаются, формулы итогов подстраиваются
    equipSyncLocations_(sh);
    cacheDropBig_('eq_v1');
    logChange_(id, name, 'удаление заказа экипировки', what, '');
  }
  return { ok: true, dryRun: CONFIG.DRY_RUN, row: row };
}

// Скидка на комплект — правило из настроек (Settings.js, equip.disc*): процент, округление, какие позиции нужны
// в заказе (needAll), какие должны быть у игрока в прошлых заказах или в этом (needOwn, «или» — любая из)
// и какие идут по полной цене (exclude). При рассрочке скидки нет. Прежние заказы игрока с позициями needOwn
// учитываются как «уже оплачено»: в заказе записывается доплата. Тот же расчёт — в Kit.html (discCalc).
function equipDiscCfg_() {
  function low(a) { return (a || []).map(function (x) { return String(x).trim().toLowerCase(); }); }
  return {
    pct: Number(settingGet_('equip.discPct')) || 0, round: Number(settingGet_('equip.discRound')) || 1,
    needAll: low(settingGet_('equip.discNeedAll')),
    needOwn: (settingGet_('equip.discNeedOwn') || []).map(function (x) { return low(String(x).split(/\s+или\s+/i)); }),
    exclude: low(settingGet_('equip.discExclude'))
  };
}

function kitParts_(kit) {
  return String(kit || '').split(' + ').map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean);
}

// parts — позиции заказа (в нижнем регистре); prices — {позиция в нижнем регистре: цена};
// others — прежние заказы игрока [{kit, sum}]. Возвращает {total, excl, disc}; disc = null — скидки нет.
function equipDiscCalc_(cfg, parts, prices, inst, others) {
  var total = 0, excl = 0;
  parts.forEach(function (k) {
    var v = Number(prices[k]) || 0;
    total += v;
    if (cfg.exclude.indexOf(k) >= 0) excl += v;
  });
  var out = { total: total, excl: excl, disc: null };
  if (inst || !(cfg.pct > 0) || !parts.length) return out;
  if (!cfg.needAll.every(function (k) { return parts.indexOf(k) >= 0; })) return out;
  var own = {};
  parts.concat.apply(parts, (others || []).map(function (o) { return kitParts_(o.kit); })).forEach(function (k) { own[k] = 1; });
  if (!cfg.needOwn.every(function (alt) { return alt.some(function (k) { return own[k]; }); })) return out;
  var base = [].concat.apply([], cfg.needOwn);
  var prior = (others || []).filter(function (o) { return kitParts_(o.kit).some(function (k) { return base.indexOf(k) >= 0; }); })
    .reduce(function (s, o) { return s + (Number(o.sum) || 0); }, 0);
  var target = Math.round((prior + total - excl) * (100 - cfg.pct) / 100 / cfg.round) * cfg.round;
  out.disc = Math.max(target - prior, 0) + excl;
  return out;
}

// Прежние заказы игрока (кроме строки skipRow)
function equipOthers_(sh, id, skipRow) {
  if (!id) return [];
  return sh.getRange(EQ_FIRST, 1, EQ_ROWS, 12).getValues().filter(function (r, i) {
    return EQ_FIRST + i !== skipRow && String(r[11]).trim() === id && String(r[3]).trim();
  }).map(function (r) { return { kit: String(r[3]), sum: Number(r[8]) || 0 }; });
}

function catPrices_(cat) {
  var m = {};
  cat.forEach(function (x) { m[x.name.toLowerCase()] = Number(x.price) || 0; });
  return m;
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
  if (kit) {
    // Заказ может содержать несколько комплектов («A + B»): сумма — сумма цен каждого из них
    var needCat = kit !== before[0] || !(Number(oldSum) > 0); // сменился комплект или сумма ещё не стоит
    var cat = catalog_(true), missing = '';
    kit.split(' + ').forEach(function (part) {
      var name = part.trim();
      if (!cat.some(function (x) { return x.name === name; })) missing = missing || name;
    });
    if (missing && needCat) throw new Error('Выберите позицию из каталога: ' + missing);
    // Скидка пересчитывается при каждом сохранении, если она положена (null — скидки нет)
    var id = String(sh.getRange(row, 12).getValue()).trim();
    var calc = equipDiscCalc_(equipDiscCfg_(), kitParts_(kit), catPrices_(cat), !!o.inst, equipOthers_(sh, id, row));
    var total = calc.total, disc = missing ? null : calc.disc;
    if (needCat) newSum = disc !== null ? disc : total;
    else if (disc !== null) newSum = disc;
  }
  var after = [kit || before[0], String(o.size || '').trim(), String(o.inscr || '').trim(), String(o.num || '').trim().replace(/\s*[\/,]\s*/g, ','), o.inst ? 'Да' : ''];
  // Размер, надпись и номер можно не указывать: дописываются при изменении заказа.
  // Повторяющиеся номера в группе пока разрешены (номер желаемый, окончательный — после жребия).
  if (!CONFIG.DRY_RUN) {
    // Пишем по одной ячейке: многоколоночная запись диапазона в Sheets даёт ошибку «выберите элемент в одном столбце»
    [5, 6, 7].forEach(function (col) { nfSafe_(sh.getRange(row, col), '@'); }); // размер, надпись, номер хранятся как текст
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