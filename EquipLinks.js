/** Привязка заказов экипировки к игрокам. Только для администратора. */

// Цены комплектов для формы заказа: из каталога; если каталог пуст, запасные KIT_PRICES.
// cat — активные позиции каталога, если вызывающий уже получил их (иначе читаются из кэша каталога)
function kitPrices_(cat) {
  var m = {}, n = 0;
  (cat || catalog_(true)).forEach(function (x) { m[x.name] = x.price; n++; });
  return n ? m : KIT_PRICES;
}

// Размеры каждой позиции каталога (через запятую в таблице) — для выпадающего списка в форме
function kitSizes_(cat) {
  var m = {};
  (cat || catalog_(true)).forEach(function (x) {
    m[x.name] = String(x.sizes || '').split(',').map(function (v) { return v.trim(); }).filter(Boolean);
  });
  return m;
}

// Замер (PerfLog.js): обёртка не меняет результат; при PERF_LOG = false ничего не пишет
function appEquipOrders(pin) { return perfSpan_('appEquipOrders', function () { return appEquipOrders0_(pin); }); }
function appEquipOrders0_(pin) {
  checkAdmin_(pin);
  var data = cacheGetBig_('eq_v1');
  // заказы из кэша до появления ID заказа (ord) в данных — перечитываем, иначе экран не свяжет выдачу с заказом
  if (!data || (data.orders.length && data.orders[0].ord === undefined)) { data = equipOrdersLive_(); cachePutBig_('eq_v1', data, 60); }
  // Каталог — один раз на запрос (раньше три чтения кэша cat_v1: цены, флаги, размеры). Активные позиции —
  // тот же фильтр, что catalog_(true); источник и срок кэша не меняются.
  var all = catalog_(false), active = all.filter(function (x) { return x.active; });
  data.prices = kitPrices_(active);
  data.disc = equipDiscCfg_();
  data.flags = {};   // что требует позиция каталога: надпись, номер (колонки «Надпись», «Номер»)
  all.forEach(function (x) { data.flags[x.name.toLowerCase()] = { inscr: !!x.inscr, num: !!x.num }; });
  data.sizes = kitSizes_(active);
  data.issued = equipIssues_();   // выдача по вещам: { ORD: { вещь: {date, who} } } (EquipIssue.js)
  return data;
}

function equipOrdersLive_() {
  var sh = equipSheet_(), rg = sh.getRange(EQ_FIRST, 1, EQ_ROWS, EQ_QTY_COL);
  var vals = rg.getValues(), disp = rg.getDisplayValues(), orders = [], unl = [];
  vals.forEach(function (r, i) {
    var name = String(r[2]).trim();
    if (!name || isNaN(Number(r[0]))) return;
    var id = String(r[11] || '').trim();
    var sum = Number(r[8]) || 0, paid = Number(r[9]) || 0;
    var o = {
      id: id, row: EQ_FIRST + i, no: Number(r[0]), oname: name, kit: disp[i][3], size: disp[i][4], inscr: disp[i][5], num: disp[i][6],
      inst: disp[i][7], sum: sum, paid: paid, debt: Math.max(sum - paid, 0), ord: String(r[13] || '').trim(), qtys: qtysOf_(r[EQ_QTY_COL - 1], String(r[3] || '').split(' + ').length)
    };
    if (id) orders.push(o); else unl.push(o);
  });
  return { orders: orders, unl: unl, unlinked: unl.length };
}

// newId = '' означает «отвязать».
function appRelink(pin, row, newId, fix, expected) {
  checkAdmin_(pin);
  if (CONFIG.DRY_RUN) return relinkCore_(row, newId, fix, expected);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return relinkCore_(row, newId, fix, expected); } finally { lock.releaseLock(); }
}

function relinkCore_(row, newId, fix, expected) {
  row = Number(row);
  if (!(row >= EQ_FIRST && row < EQ_FIRST + EQ_ROWS)) throw new Error('Некорректная строка');
  var sh = equipSheet_();
  assertEquipRowIdentity_(sh, row, expected);
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
function appDeleteOrder(pin, row, expected) {
  checkAdmin_(pin);
  if (CONFIG.DRY_RUN) return deleteOrderCore_(row, expected);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return deleteOrderCore_(row, expected); } finally { lock.releaseLock(); }
}

function deleteOrderCore_(row, expected) {
  row = Number(row);
  if (!(row >= EQ_FIRST && row < EQ_FIRST + EQ_ROWS)) throw new Error('Некорректная строка');
  var sh = equipSheet_();
  assertEquipRowIdentity_(sh, row, expected);
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
    needAll: (settingGet_('equip.discNeedAll') || []).map(function (x) { return low(String(x).split(/\s+или\s+/i)); }),
    needOwn: (settingGet_('equip.discNeedOwn') || []).map(function (x) { return low(String(x).split(/\s+или\s+/i)); }),
    exclude: low(settingGet_('equip.discExclude'))
  };
}

// Количество каждой позиции: колонка M, «2 + 1» по порядку позиций в колонке D; пусто — по 1
function qtysOf_(text, n) {
  var a = String(text || '').split(' + ');
  var out = [];
  for (var i = 0; i < n; i++) { var v = Math.floor(Number(a[i])); out.push(v >= 1 ? v : 1); }
  return out;
}
function qtyCheck_(qs) {
  qs.forEach(function (q) { if (!(q >= 1 && q <= 10)) throw new Error('Количество каждого комплекта: от 1 до 10'); });
  return qs;
}

function kitParts_(kit) {
  return String(kit || '').split(' + ').map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean);
}

// parts — позиции заказа (в нижнем регистре); prices — {позиция в нижнем регистре: цена};
// others — прежние заказы игрока [{kit, sum}]. Возвращает {total, excl, disc}; disc = null — скидки нет.
function equipDiscCalc_(cfg, parts, prices, inst, others, qtys) {
  var total = 0, excl = 0;
  parts.forEach(function (k, i) {
    var v = (Number(prices[k]) || 0) * ((qtys && qtys[i]) || 1);
    total += v;
    if (cfg.exclude.indexOf(k) >= 0) excl += v;
  });
  var out = { total: total, excl: excl, disc: null };
  if (inst || !(cfg.pct > 0) || !parts.length) return out;
  if (!cfg.needAll.every(function (alt) { return alt.some(function (k) { return parts.indexOf(k) >= 0; }); })) return out;
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

// Общая защита для всех операций, которые UI адресует номером строки (правка, удаление, перепривязка, оплата, выдача).
// После сортировки или сдвига строк открытая форма может указывать на чужой заказ: сверяем № заказа, ФИО, ID игрока и ID заказа (ord)
// до первой записи; при несовпадении отказ без изменений. expected присылает форма из загруженных данных (№, ФИО, ID, ord).
var EQ_STALE_MSG = 'Заказ изменился или строка сместилась. Обновите список заказов и откройте форму заново; изменения не сохранены.';
function assertEquipRowIdentity_(sh, row, expected) {
  if (!expected || typeof expected !== 'object') throw new Error('Обновите список заказов и откройте форму заново');
  var disp = function (c) { return String(sh.getRange(row, c).getDisplayValues()[0][0] || '').trim(); };
  var same = disp(1) === String(expected.no == null ? '' : expected.no).trim()
    && disp(3) === String(expected.name || '').trim()
    && String(sh.getRange(row, 12).getValue() || '').trim() === String(expected.id || '').trim()
    && String(sh.getRange(row, 14).getValue() || '').trim() === String(expected.ord || '').trim();
  if (!same) throw new Error(EQ_STALE_MSG);
}

// Проверяет, что форма всё ещё редактирует тот же заказ, а не другую запись в сдвинувшейся строке.
function assertEquipOrderIdentity_(sh, row, expected) {
  if (!expected || typeof expected !== 'object') throw new Error('Обновите список заказов и откройте форму заново');
  var actual = {
    no: String(sh.getRange(row, 1).getDisplayValues()[0][0] || '').trim(),
    name: String(sh.getRange(row, 3).getDisplayValues()[0][0] || '').trim(),
    kit: String(sh.getRange(row, 4).getDisplayValues()[0][0] || '').trim(),
    size: String(sh.getRange(row, 5).getDisplayValues()[0][0] || '').trim(),
    inscr: String(sh.getRange(row, 6).getDisplayValues()[0][0] || '').trim(),
    num: String(sh.getRange(row, 7).getDisplayValues()[0][0] || '').trim(),
    inst: String(sh.getRange(row, 8).getDisplayValues()[0][0] || '').trim(),
    sum: Number(sh.getRange(row, 9).getValue()) || 0,
    id: String(sh.getRange(row, 12).getValue() || '').trim(),
    ord: String(sh.getRange(row, 14).getValue() || '').trim()
  };
  var same = actual.no === String(expected.no == null ? '' : expected.no).trim()
    && actual.name === String(expected.name || '').trim()
    && actual.id === String(expected.id || '').trim();
  if (expected.ord) same = same && actual.ord === String(expected.ord).trim();
  else same = same
    && actual.kit === String(expected.kit || '').trim()
    && actual.size === String(expected.size || '').trim()
    && actual.inscr === String(expected.inscr || '').trim()
    && actual.num === String(expected.num || '').trim()
    && actual.inst === String(expected.inst || '').trim()
    && Math.abs(actual.sum - (Number(expected.sum) || 0)) < 0.005;
  if (!same) throw new Error('Заказ изменился или строка сместилась. Обновите список заказов и откройте форму заново; изменения не сохранены.');
}

function editOrderCore_(row, o) {
  row = Number(row);
  if (!(row >= EQ_FIRST && row < EQ_FIRST + EQ_ROWS)) throw new Error('Некорректная строка');
  var sh = equipSheet_();
  if (!String(sh.getRange(row, 3).getValue()).trim()) throw new Error('В этой строке нет заказа');
  assertEquipOrderIdentity_(sh, row, o.expected);
  var before = sh.getRange(row, 4, 1, 5).getDisplayValues()[0];
  var oldSum = sh.getRange(row, 9).getValue();
  var kit = String(o.kit || '').trim();
  var newSum = null, qs = null;
  var kparts = kit.split(' + ').map(function (x) { return x.trim(); }).filter(Boolean);
  var mOld = String(sh.getRange(row, EQ_QTY_COL).getValue()).trim();
  if (kit) {
    qs = Array.isArray(o.qtys) ? qtyCheck_(kparts.map(function (x, i) { return Math.floor(Number(o.qtys[i])) || 1; }))
      : (kit === before[0] ? qtysOf_(mOld, kparts.length) : qtysOf_('', kparts.length));
  }
  var qtyChanged = qs !== null && qs.join(' + ') !== qtysOf_(mOld, kparts.length).join(' + ');
  if (kit) {
    // Заказ может содержать несколько комплектов («A + B»): сумма — сумма цен каждого из них
    var needCat = kit !== before[0] || !(Number(oldSum) > 0) || qtyChanged; // сменился комплект, количество или сумма ещё не стоит
    var cat = catalog_(true), missing = '';
    kit.split(' + ').forEach(function (part) {
      var name = part.trim();
      if (!cat.some(function (x) { return x.name === name; })) missing = missing || name;
    });
    if (missing && needCat) throw new Error('Выберите позицию из каталога: ' + missing);
    // Скидка пересчитывается при каждом сохранении, если она положена (null — скидки нет)
    var id = String(sh.getRange(row, 12).getValue()).trim();
    var calc = equipDiscCalc_(equipDiscCfg_(), kitParts_(kit), catPrices_(cat), !!o.inst, equipOthers_(sh, id, row), qs);
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
    if (qs) { nfSafe_(sh.getRange(row, EQ_QTY_COL), '@'); sh.getRange(row, EQ_QTY_COL).setValue(qs.join(' + ')); }
    if (newSum !== null) sh.getRange(row, 9).setValue(newSum);
    cacheDropBig_('eq_v1');
    var what = before.join(' | ') + (newSum !== null ? ' | сумма ' + oldSum : '');
    var now = after.join(' | ') + (newSum !== null ? ' | сумма ' + newSum : '');
    logChange_(String(sh.getRange(row, 12).getValue()).trim(), String(sh.getRange(row, 3).getValue()).trim(),
      'правка заказа экипировки', what, now);
  }
  return { ok: true, dryRun: CONFIG.DRY_RUN, sumChanged: newSum !== null };
}