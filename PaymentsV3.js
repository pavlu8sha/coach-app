/** Приём оплат: экипировка со способом оплаты и общая лента за сегодня (версия 3). */

// Оплата заказа экипировки. Способ необязателен для старых форм, но если он указан, его пишем в столбец I журнала «ОПЛАТЫ».
function appAddPayment(pin, id, row, amount, dateStr, comment, method) {
  checkAdmin_(pin);
  if (method && PAY_METHODS.indexOf(method) < 0) throw new Error('Неизвестный способ оплаты');
  amount = Math.round(Number(amount) * 100) / 100;
  if (!(amount > 0)) throw new Error('Введите сумму больше нуля');
  row = Number(row);
  if (!(row >= 4 && row === Math.floor(row))) throw new Error('Неверная строка заказа, обновите страницу');
  var eq = equipSheet_(), lock = LockService.getScriptLock();
  if (!CONFIG.DRY_RUN) lock.waitLock(20000);
  try {
    if (row > eq.getLastRow()) throw new Error('Заказ не найден, обновите страницу');
    if (String(eq.getRange(row, 12).getValue()).trim() !== id) throw new Error('Заказ не относится к этому игроку, обновите страницу');
    var sum = Math.round((Number(eq.getRange(row, 9).getValue()) || 0) * 100) / 100;
    var paid = Math.round((Number(eq.getRange(row, 10).getValue()) || 0) * 100) / 100;
    var left = Math.round((sum - paid) * 100) / 100;
    return { ok: true, dryRun: CONFIG.DRY_RUN, paid: newPaid, debt: Math.max(Math.round((left - amount) * 100) / 100, 0) };
    var name = String(eq.getRange(row, 3).getValue()).trim(), kit = String(eq.getRange(row, 4).getValue()).trim();
    var newPaid = Math.round((paid + amount) * 100) / 100;
    if (!CONFIG.DRY_RUN) {
      var ps = dbSheet_(PAY_SHEET, PAY_HEAD);
      if (!ps) throw new Error('Нет журнала платежей (лист ' + PAY_SHEET + ' в AdminApp). Оплата не внесена.');
      if (isRecentDup_(ps, [[3, id], [6, row], [7, String(amount)], [9, method || '']], 15)) throw new Error('Похоже на повтор: такой платёж только что записан. Обновите страницу');
      eq.getRange(row, 10).setValue(newPaid);
      var r = ps.getLastRow() + 1;
      ps.getRange(r, 1, 1, 9).setValues([[new Date(), dateStr || today_(), id, name, 'Экипировка: ' + kit, row, amount, comment || '', method || '']]);
      fmt_(ps.getRange(r, 7), '#,##0.00 "₾"');
      cacheDropBig_('eq_v1');
    }
    return { ok: true, dryRun: CONFIG.DRY_RUN, paid: newPaid, debt: Math.round((left - amount) * 100) / 100 };
  } finally {
    if (!CONFIG.DRY_RUN) lock.releaseLock();
  }
}

// Платежи за сегодня (по дате оплаты): абонемент и экипировка, с итогами по способам.
// Читаем только хвост журналов: новые записи всегда дописываются в конец.
function appTodayPayments(pin) {
  checkAdmin_(pin);
  var ss = SpreadsheetApp.getActive(), tz = ss.getSpreadsheetTimeZone(), td = today_();
  var out = [], tot = { 'Наличные': 0, 'Перевод': 0, other: 0 }, rev = {};
  function day(v) { return v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : String(v); }
  function tail(sh, cols) {
    var last = sh ? sh.getLastRow() : 0;
    if (last < 2) return { from: 2, rows: [] };
    var from = Math.max(2, last - 399);
    return { from: from, rows: sh.getRange(from, 1, last - from + 1, cols).getValues() };
  }
  var st = tail(dbRead_(SUB_SHEET), 10), et = tail(dbRead_(PAY_SHEET), 9), m;
  st.rows.forEach(function (r) {
    if (String(r[7]) === 'Отмена' && (m = /строка (\d+)$/.exec(String(r[8])))) rev['sub|' + m[1]] = true;
  });
  et.rows.forEach(function (r) {
    if (Number(r[6]) < 0 && (m = /строка (\d+)$/.exec(String(r[7])))) rev['eq|' + m[1]] = true;
  });
  function add(r, what, kind, method, amt, src, row) {
    if (tot.hasOwnProperty(method)) tot[method] += amt; else tot.other += amt;
    var done = amt > 0 && !!rev[src + '|' + row];
    var can = amt > 0 && !done && (src === 'eq' || kind === 'Оплата' || kind === 'Частичный');
    out.push({ t: r[0] instanceof Date ? r[0].getTime() : 0, name: String(r[3]), what: what, kind: kind, method: method,
      amount: amt, src: src, row: row, canCancel: can, reversed: done, neg: amt < 0 });
  }
  st.rows.forEach(function (r, i) {
    if (day(r[1]) === td) add(r, 'Абонемент ' + r[4] + ', ' + r[5], String(r[7]), String(r[9] || ''), Number(r[6]) || 0, 'sub', st.from + i);
  });
  et.rows.forEach(function (r, i) {
    if (day(r[1]) === td) add(r, String(r[4]), '', String(r[8] || ''), Number(r[6]) || 0, 'eq', et.from + i);
  });
  var it = tail(dbRead_(IND_LOG), 7);
  var xt = tail(dbRead_(EXTRA_LOG), 7);
  xt.rows.forEach(function (r, i) {
    var amt = Number(r[3]) || 0;
    if (!amt) return; // записи, снятия, создание тренировки без денег не показываем
    var d = r[0] instanceof Date ? day(r[0]) : indDayStr_(r[0]);
    if (d !== td) return;
    var m3 = /^(\d{2}\.\d{2})\|/.exec(String(r[1]));
    var method = String(r[4] || '');
    if (tot.hasOwnProperty(method)) tot[method] += amt; else tot.other += amt;
    out.push({ t: r[0] instanceof Date ? r[0].getTime() : 0, name: String(r[2]), what: 'Дополнительная ' + (m3 ? m3[1] : ''),
      kind: String(r[5]), method: method, amount: amt, src: 'ext', row: xt.from + i, canCancel: false, reversed: false, neg: amt < 0 });
  });
  it.rows.forEach(function (r, i) {
    var amt = Number(r[3]) || 0;
    if (!amt) return; // записи и снятия без денег не показываем
    var d = r[0] instanceof Date ? day(r[0]) : indDayStr_(r[0]);
    if (d !== td) return;
    var m2 = /\|(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})( gk)?$/.exec(String(r[1]));
    var what = m2 ? (m2[5] ? 'Вратарские ' : 'Индивидуальное ') + m2[3] + '.' + m2[2] + ' ' + m2[4] : 'Индивидуальное';
    var method = String(r[4] || '');
    if (tot.hasOwnProperty(method)) tot[method] += amt; else tot.other += amt;
    out.push({ t: r[0] instanceof Date ? r[0].getTime() : 0, name: String(r[2]), what: what, kind: String(r[5]),
      method: method, amount: amt, src: 'ind', row: it.from + i, canCancel: false, reversed: false, neg: amt < 0 });
  });
  out.sort(function (a, b) { return b.t - a.t; });
  return { items: out, totals: tot };
}