/** Раздел «Экипировка»: просмотр заказов и добавление новых. Только для администратора. */

var KIT_PRICES = { 'тренировочная': 100, 'игровая': 200, 'тренировочная & игровая': 300, 'вратарская': 200 };

// o: {id, kit, sum, size, inscr, num, inst, paid, date, method}
function appAddOrder(pin, o) {
  checkAdmin_(pin);
  if (CONFIG.DRY_RUN) return addOrderCore_(o);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return addOrderCore_(o); } finally { lock.releaseLock(); }
}

function addOrderCore_(o) {
  var item = catalog_(true).filter(function (x) { return x.name === o.kit; })[0];
  if (!item) throw new Error('Выберите позицию из каталога');
  var sum = Number(o.sum) || item.price, paid = Number(o.paid) || 0;
  if (sum <= 0) throw new Error('Введите сумму заказа');
  if (paid < 0 || paid > sum) throw new Error('Оплачено сейчас: от 0 до суммы заказа');
  var method = String(o.method || '').trim();
  if (paid > 0 && !method) throw new Error('Выберите способ оплаты: наличные или перевод');
  if (method && PAY_METHODS.indexOf(method) < 0) throw new Error('Неизвестный способ оплаты');
  var p = readRegistry_().players.filter(function (x) { return x.id === o.id; })[0];
  if (!p) throw new Error('Игрок не найден: ' + o.id);
  var sh = equipSheet_();
  var rows = sh.getRange(EQ_FIRST, 1, EQ_ROWS, 12).getValues(), row = 0, i, c, empty;
  for (i = 0; i < rows.length && !row; i++) {
    empty = true;
    for (c = 1; c < 12; c++) { if (String(rows[i][c]).trim() !== '') empty = false; }
    if (empty && String(rows[i][0]).trim() !== '' && !isNaN(Number(rows[i][0]))) row = EQ_FIRST + i;
  }
  if (!row) throw new Error('В файле экипировки нет свободных пронумерованных строк. Добавьте их перед строкой итогов.');
  var dateStr = o.date || today_();
  if (!CONFIG.DRY_RUN) {
    // Столбцы B:J одной записью (дата, ФИ, комплект, размер, надпись, номер, рассрочка, сумма, оплачено)
    var rg = sh.getRange(row, 2, 1, 9), nf = rg.getNumberFormats();
    nf[0][0] = 'dd.mm.yyyy'; nf[0][3] = '@'; nf[0][5] = '@';
    rg.setNumberFormats(nf);
    rg.setValues([[serialOf(dateStr), p.name, o.kit, String(o.size || ''), String(o.inscr || ''), String(o.num || ''), o.inst ? 'Да' : '', sum, paid]]);
    sh.getRange(row, 12).setValue(o.id);
    var k = sh.getRange(row, 11);
    if (!k.getFormula()) k.setFormula('=IF(I' + row + '="","",MAX(I' + row + '-J' + row + ',0))');
    if (paid > 0) {
      var ps = dbSheet_(PAY_SHEET, PAY_HEAD);
      var r2 = ps.getLastRow() + 1;
      ps.getRange(r2, 1, 1, 9).setValues([[new Date(), dateStr, o.id, p.name, 'Экипировка: ' + o.kit, row, paid, 'при заказе', method]]);
      ps.getRange(r2, 7).setNumberFormat('#,##0.00 "₾"');
    }
    logChange_(o.id, p.name, 'новый заказ экипировки', '', o.kit + ', ' + sum + ' ₾, строка ' + row);
  }
  return { ok: true, dryRun: CONFIG.DRY_RUN, row: row };
}