/** Приём оплат абонемента со способом оплаты (версия 2). Только для администратора. */

var PAY_METHODS = ['Наличные', 'Перевод'];

// Способ оплаты обязателен: наличные или перевод (без значения по умолчанию)
function payMethodReq_(method) {
  if (PAY_METHODS.indexOf(String(method || '')) < 0) throw new Error('Выберите способ оплаты: наличные или перевод');
}

// Формат ячеек: если столбец типизирован (Таблица в Google Таблицах), формат не ставим и не падаем
function fmt_(rg, pattern) { try { rg.setNumberFormat(pattern); } catch (e) {} return rg; }
// Формат ячейки best-effort: в столбцах с типом (таблица-чипы, дата, число) Google отказывает, запись данных не должна падать.
function nfSafe_(rg, pattern) { try { rg.setNumberFormat(pattern); } catch (e) {} return rg; }

// Журнал платежей со столбцом «Способ» (J).
function subLog2_(month, group, p, amount, kind, dateStr, comment, method) {
  var ps = dbSheet_(SUB_SHEET, SUB_HEAD);
  if (!ps) return;
  var r = ps.getLastRow() + 1;
  fmt_(ps.getRange(r, 5), '@');
  ps.getRange(r, 1, 1, 10).setValues([[new Date(), dateStr || today_(), p.id, p.name, month, group, amount, kind, comment || '', method || '']]);
  fmt_(ps.getRange(r, 7), '#,##0.00 "₾"');
  cacheDropBig_('sl_v1');
}

// type: 'Скидка' или 'Частичный', если сумма меньше остатка. method: 'Наличные' или 'Перевод'.
function appSubPay(pin, month, group, id, amount, type, dateStr, comment, method) {
  checkAdmin_(pin);
  if (method && PAY_METHODS.indexOf(method) < 0) throw new Error('Неизвестный способ оплаты');
  amount = Math.round(Number(amount) * 100) / 100;
  if (!(amount > 0)) throw new Error('Введите сумму больше нуля');
  if (CONFIG.DRY_RUN) return subPayCore_(month, group, id, amount, type, dateStr, comment, method);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return subPayCore_(month, group, id, amount, type, dateStr, comment, method);
  } finally {
    lock.releaseLock();
  }
}

function subPayCore_(month, group, id, amount, type, dateStr, comment, method) {
  var p = readRegistry_().players.filter(function (x) { return x.id === id; })[0];
  if (!p) throw new Error('Игрок не найден');
  var sh = payFile_().getSheetByName(month);
  if (!sh) throw new Error('Нет листа ' + month);
  var g = parseMonth_(sh).filter(function (x) { return norm(x.name) === norm(group); })[0];
  if (!g) throw new Error('В листе ' + month + ' нет блока группы ' + group);
  var row = g.rows.filter(function (r) { return norm(r.name) === norm(p.name); })[0], added = false;
  if (!row) {
    var sim = g.rows.filter(function (r) { return r.name && lev_(norm(r.name), norm(p.name)) <= 2; })[0];
    if (sim) throw new Error('В блоке есть похожее имя «' + sim.name + '», проверьте написание');
    row = g.rows.filter(function (r) { return !r.name; })[0];
    if (!row) throw new Error('В блоке ' + group + ' нет свободных строк. Добавьте их в файле оплат.');
    added = true;
  }
  var T = tariff_(group), paid = added ? 0 : row.paid;
  var disc = !!subLedger_()[month + '|' + norm(group) + '|' + norm(p.name)];
  var remaining = Math.round(Math.max(T - paid, 0) * 100) / 100;
  // Переплата и доплата по абонементу со скидкой допускаются: сумма пишется как оплата и видна в карточке.
  // По абонементу со скидкой тип не спрашиваем: частичная сумма пишется как «Частичный», если тип не выбран.
  if (!disc && amount < remaining && ['Скидка', 'Частичный'].indexOf(type) < 0) throw new Error('Выберите тип: скидка или частичный платёж');
  var kind = amount >= remaining ? 'Оплата' : (type || 'Частичный');
  if (!CONFIG.DRY_RUN) {
    if (!dbSheet_(SUB_SHEET, SUB_HEAD)) throw new Error('Нет журнала платежей (лист ' + SUB_SHEET + ' в AdminApp). Оплата не внесена.');
    if (isRecentDup_(dbSheet_(SUB_SHEET, SUB_HEAD), [[3, p.id], [5, month], [6, group], [7, String(amount)], [8, kind], [10, method]], 15)) throw new Error('Похоже на повтор: такой платёж только что записан. Обновите страницу');
    if (added) sh.getRange(row.row, 2).setValue(p.name);
    var cell = sh.getRange(row.row, 4);
    cell.setValue(Math.round((paid + amount) * 100) / 100);
    fmt_(cell, '#,##0.00 "₾"');
    subLog2_(month, group, p, amount, kind, dateStr, comment, method);
    monthInvalidate_(month);
  }
  return { ok: true, dryRun: CONFIG.DRY_RUN, kind: kind };
}