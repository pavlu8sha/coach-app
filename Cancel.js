/** Отмена платежа: пишет сторнирующую строку в журнал и уменьшает «Оплачено». Ничего не удаляет. */

function appCancelPayment(pin, src, row, expected) {
  checkAdmin_(pin);
  row = Number(row);
  var ss = SpreadsheetApp.getActive(), lock = LockService.getScriptLock();
  if (!CONFIG.DRY_RUN) lock.waitLock(20000);
  try {
    if (src === 'sub') return cancelSub_(ss, row, expected);
    if (src === 'eq') return cancelEq_(ss, row, expected);
    throw new Error('Неизвестный тип платежа');
  } finally {
    if (!CONFIG.DRY_RUN) lock.releaseLock();
  }
}

// Журналы платежей адресуются номером строки; после сортировки журнала строка может оказаться чужим платежом.
// Форма присылает снимок платежа из ленты (время записи, ФИ, сумма); сверяем до любой записи.
var PAY_STALE_MSG = 'Платёж изменился или строка журнала сместилась. Обновите ленту платежей и повторите; отмена не внесена.';
function assertPayRowIdentity_(r, expected) {
  if (!expected || typeof expected !== 'object') throw new Error('Обновите ленту платежей и повторите');
  var t = r[0] instanceof Date ? r[0].getTime() : 0;
  var same = t === (Number(expected.t) || 0) && t > 0
    && String(r[3]).trim() === String(expected.name || '').trim()
    && Math.abs((Number(r[6]) || 0) - (Number(expected.amount) || 0)) < 0.005;
  if (!same) throw new Error(PAY_STALE_MSG);
}

function cancelSub_(ss, row, expected) {
  var ps = dbRead_(SUB_SHEET);
  if (!ps || row < 2 || row > ps.getLastRow()) throw new Error('Платёж не найден');
  var all = ps.getRange(2, 1, ps.getLastRow() - 1, 10).getValues(), r = all[row - 2];
  assertPayRowIdentity_(r, expected);
  var amount = Number(r[6]) || 0, kind = String(r[7]);
  if (kind === 'Скидка') throw new Error('Платёж со скидкой в приложении отменить нельзя');
  if (!(amount > 0) || ['Оплата', 'Частичный'].indexOf(kind) < 0) throw new Error('Эту запись отменить нельзя');
  var tag = 'отмена платежа, строка ' + row;
  if (all.some(function (x) { return String(x[7]) === 'Отмена' && String(x[8]) === tag; })) throw new Error('Этот платёж уже отменён');
  var month = String(r[4]), group = String(r[5]), id = String(r[2]), name = String(r[3]);
  var sh = payFile_().getSheetByName(month);
  if (!sh) throw new Error('В файле оплат нет листа ' + month);
  var g = parseMonth_(sh).filter(function (x) { return norm(x.name) === norm(group); })[0];
  var pr = g && g.rows.filter(function (x) { return norm(x.name) === norm(name); })[0];
  if (!pr) throw new Error('В листе ' + month + ' не найден игрок ' + name);
  if (pr.paid < amount) throw new Error('В листе оплат внесено меньше суммы платежа (' + pr.paid + ' ₾), проверьте вручную');
  if (!CONFIG.DRY_RUN) {
    if (!dbSheet_(SUB_SHEET, SUB_HEAD)) throw new Error('Нет журнала платежей (лист ' + SUB_SHEET + ' в AdminApp). Отмена не внесена.');
    var cell = sh.getRange(pr.row, 4), oldVal = pr.paid;
    cell.setValue(Math.round((pr.paid - amount) * 100) / 100);
    try {
      fmt_(cell, '#,##0.00 "₾"');
      subLog2_(month, group, { id: id, name: name }, -amount, 'Отмена', today_(), tag, String(r[9] || ''));
    } catch (e) {
      cell.setValue(oldVal);   // журнал не записан: возвращаем сумму в файле оплат как было
      throw e;
    }
    monthInvalidate_(month);
    logChange_(id, name, 'отмена платежа (абонемент)', '', amount + ' ₾, ' + month + ', ' + group);
  }
  return { ok: true, dryRun: CONFIG.DRY_RUN };
}

function cancelEq_(ss, row, expected) {
  var ps = dbRead_(PAY_SHEET);
  if (!ps || row < 2 || row > ps.getLastRow()) throw new Error('Платёж не найден');
  var all = ps.getRange(2, 1, ps.getLastRow() - 1, 9).getValues(), r = all[row - 2];
  assertPayRowIdentity_(r, expected);
  var amount = Number(r[6]) || 0;
  if (!(amount > 0)) throw new Error('Эту запись отменить нельзя');
  var tag = 'отмена платежа, строка ' + row;
  if (all.some(function (x) { return Number(x[6]) < 0 && String(x[7]) === tag; })) throw new Error('Этот платёж уже отменён');
  var id = String(r[2]), orderNo = Number(r[5]), eq = equipSheet_(), orderRow = eqRowOfNo_(eq, orderNo);
  if (!orderRow) throw new Error('Заказ не найден в файле экипировки, проверьте вручную');
  if (String(eq.getRange(orderRow, 12).getValue()).trim() !== id) throw new Error('Заказ перепривязан или изменён, проверьте вручную');
  var paid = Number(eq.getRange(orderRow, 10).getValue()) || 0;
  if (paid < amount) throw new Error('В файле экипировки оплачено меньше суммы платежа (' + paid + ' ₾), проверьте вручную');
  if (!CONFIG.DRY_RUN) {
    var n = ps.getLastRow() + 1, eqCell = eq.getRange(orderRow, 10);
    eqCell.setValue(Math.round((paid - amount) * 100) / 100);
    try {
      ps.getRange(n, 1, 1, 9).setValues([[new Date(), today_(), id, r[3], r[4], orderNo, -amount, tag, String(r[8] || '')]]);
      nfSafe_(ps.getRange(n, 7), '#,##0.00 "₾"');
    } catch (e) {
      eqCell.setValue(paid);   // журнал не записан: возвращаем «оплачено» как было
      throw e;
    }
    cacheDropBig_('eq_v1');
    logChange_(id, String(r[3]), 'отмена платежа (экипировка)', '', amount + ' ₾, строка заказа ' + orderRow);
  }
  return { ok: true, dryRun: CONFIG.DRY_RUN };
}