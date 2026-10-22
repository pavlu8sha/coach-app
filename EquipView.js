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

// Номер ORD-xxxx для нового заказа: первый свободный из пропусков в занятом диапазоне, иначе максимум + 1.
// Занятые номера: у строк с заказом (колонка C) и уже связанные с фактом пошива (лист «ФАКТ ПОШИВА»).
// Номера пустых строк (заранее прописанные в колонке N) не считаются занятыми.
// cols — колонки N и C, если уже прочитаны (ordCols_), иначе читаются здесь
function nextOrdId_(sh, cols) {
  cols = cols || ordCols_(sh);
  var nv = cols.nv, cv = cols.cv;
  var used = {}, nums = [];
  function take(s) {
    var m = /^ORD-(\d+)$/.exec(String(s).trim());
    if (m) { used[Number(m[1])] = 1; nums.push(Number(m[1])); }
  }
  nv.forEach(function (r, i) { if (String(cv[i][0]).trim() !== '') take(r[0]); });
  var fact = sh.getParent().getSheetByName('ФАКТ ПОШИВА');
  if (fact && fact.getLastRow() > 1) fact.getRange(2, 1, fact.getLastRow() - 1, 1).getValues().forEach(function (r) { take(r[0]); });
  if (!nums.length) return 'ORD-0001';
  var lo = Math.min.apply(null, nums), hi = Math.max.apply(null, nums), n;
  for (n = lo; n <= hi; n++) if (!used[n]) break;
  return 'ORD-' + ('000' + n).slice(-4);
}

// Колонки N (№ ORD) и C (ФИ) всего листа — одно чтение (C:N) для nextOrdId_ и clearStaleOrdId_
function ordCols_(sh) {
  var last = Math.max(sh.getLastRow(), 1), v = sh.getRange(1, 3, last, 12).getValues();
  return { nv: v.map(function (r) { return [r[11]]; }), cv: v.map(function (r) { return [r[0]]; }) };
}

// Снимает такой же номер с пустых строк (остаток заранее прописанного списка), чтобы номер не дублировался.
// cols — те же прочитанные колонки, что у nextOrdId_ (между вызовами в лист ничего не пишется)
function clearStaleOrdId_(sh, id, keepRow, cols) {
  cols = cols || ordCols_(sh);
  var nv = cols.nv, cv = cols.cv;
  nv.forEach(function (r, i) {
    if (String(r[0]).trim() === id && String(cv[i][0]).trim() === '' && i + 1 !== keepRow) sh.getRange(i + 1, 14).clearContent();
  });
}

function addOrderCore_(o) {
  // Замер по шагам — в журнал выполнения, одной строкой: только названия шагов и миллисекунды (без ФИ, ID, сумм)
  var tStart = Date.now(), tLast = tStart, steps = [];
  function step(name) { var t = Date.now(); steps.push(name + ' ' + (t - tLast) + ' мс'); tLast = t; }
  // Комплект может быть из нескольких позиций через « + »: каждая должна быть в каталоге
  var cat = catalog_(true), parts = String(o.kit || '').split(' + ').map(function (x) { return x.trim(); }).filter(Boolean);
  var items = parts.map(function (name) { return cat.filter(function (x) { return x.name === name; })[0]; });
  if (!parts.length || items.some(function (x) { return !x; })) throw new Error('Выберите позицию из каталога');
  // Количество каждой позиции (одинаковые комплекты; размер, надпись и номер общие на заказ)
  var qs = qtyCheck_(parts.map(function (p, i) { return Math.floor(Number(o.qtys && o.qtys[i])) || 1; }));
  var catSum = items.reduce(function (s, x, i) { return s + Number(x.price || 0) * qs[i]; }, 0);
  // Сумма не указана — по каталогу со скидкой из настроек (как считает форма)
  if (!(Number(o.sum) > 0)) {
    var dc = equipDiscCalc_(equipDiscCfg_(), kitParts_(o.kit), catPrices_(cat), !!o.inst, equipOthers_(equipSheet_(), String(o.id || '').trim(), 0), qs);
    if (dc.disc !== null) catSum = dc.disc;
  }
  var sum = Number(o.sum) || catSum, paid = Number(o.paid) || 0;
  if (sum <= 0) throw new Error('Введите сумму заказа');
  if (paid < 0 || paid > sum) throw new Error('Оплачено сейчас: от 0 до суммы заказа');
  var method = String(o.method || '').trim();
  if (paid > 0 && !method) throw new Error('Выберите способ оплаты: наличные или перевод');
  if (method && PAY_METHODS.indexOf(method) < 0) throw new Error('Неизвестный способ оплаты');
  step('каталог');
  // Реестр читаем один раз: он же нужен для локаций (equipSyncLocations_) в этом же запросе
  var players = readRegistry_().players;
  var p = players.filter(function (x) { return x.id === o.id; })[0];
  if (!p) throw new Error('Игрок не найден: ' + o.id);
  // Что нужно заполнить — по настройкам каталога выбранных позиций (размер — если у позиции есть размеры)
  var missing = [];
  // Размер, номер и надпись не обязательны при создании: дописываются при изменении заказа (в Экипировке помечаются как незаполненные)
  if (missing.length) throw new Error('Для заказа укажите: ' + missing.join(', '));
  step('реестр');
  var sh = equipSheet_();
  // Повторяющиеся номера в группе пока разрешены: номер — желаемый игроком, окончательный выдаётся после жребия
  var rows = sh.getRange(EQ_FIRST, 1, EQ_ROWS, 12).getValues(), row = 0, i, c, empty;
  for (i = 0; i < rows.length && !row; i++) {
    empty = true;
    for (c = 1; c < 12; c++) { if (String(rows[i][c]).trim() !== '') empty = false; }
    if (empty && String(rows[i][0]).trim() !== '' && !isNaN(Number(rows[i][0]))) row = EQ_FIRST + i;
  }
  step('лист заказов');
  // Повтор того же заказа за 15 секунд не записываем (строка заказа в журнале отличается только номером строки).
  // Проверяем до вставки строки, чтобы при отказе в таблице ничего не менялось
  if (!CONFIG.DRY_RUN && recentOrderDup_(o.id, o.kit, sum)) throw new Error('Похоже на повтор: такой заказ только что добавлен. Обновите страницу');
  step('проверка повтора');
  if (!row) { row = newOrderRow_(sh, rows); step('новая строка'); } // свободных строк нет: вставляем новую перед итогами
  var dateStr = o.date || today_();
  if (!CONFIG.DRY_RUN) {
    // Столбцы B:J одной записью (дата, ФИ, комплект, размер, надпись, номер, рассрочка, сумма, оплачено)
    // номер заказа (ORD-xxxx) для «Производства» и «Факта пошива» — считаем до записи строки, пока она пустая
    var cols = ordCols_(sh), ordId = nextOrdId_(sh, cols);
    clearStaleOrdId_(sh, ordId, row, cols);
    step('номер ORD');
    var rg = sh.getRange(row, 2, 1, 9), nf = rg.getNumberFormats();
    nf[0][0] = 'dd.mm.yyyy'; nf[0][3] = '@'; nf[0][5] = '@';
    rg.setNumberFormats(nf);
    rg.setValues([[serialOf(dateStr), p.name, o.kit, String(o.size || ''), String(o.inscr || ''), String(o.num || ''), o.inst ? 'Да' : '', sum, paid]]);
    // количество — в колонку O (EQ_QTY_COL); заголовок ставим, только если его ещё нет
    if (!String(sh.getRange(EQ_FIRST - 1, EQ_QTY_COL).getValue()).trim()) sh.getRange(EQ_FIRST - 1, EQ_QTY_COL).setValue('Кол-во');
    nfSafe_(sh.getRange(row, EQ_QTY_COL), '@');
    // L:O одной записью: ID игрока, локация (то же значение, что сразу ниже запишет equipSyncLocations_), № ORD, количество
    sh.getRange(row, 12, 1, EQ_QTY_COL - 11).setValues([[o.id, p.loc || '', ordId, qs.join(' + ')]]);
    step('запись строки');
    equipSyncLocations_(sh, players);
    step('локации');
    var k = sh.getRange(row, 11);
    // формула долга: копируем из строки выше (текст формулы из кода в таблице с нашим языком не всегда читается)
    var above = sh.getRange(row - 1, 11);
    if (above.getFormula()) above.copyTo(k, SpreadsheetApp.CopyPasteType.PASTE_FORMULA, false);
    else k.setFormula('=IF(I' + row + '="","",MAX(I' + row + '-J' + row + ',0))');
    if (paid > 0) {
      var ps = dbSheet_(PAY_SHEET, PAY_HEAD);
      var r2 = ps.getLastRow() + 1;
      ps.getRange(r2, 1, 1, 9).setValues([[new Date(), dateStr, o.id, p.name, 'Экипировка: ' + o.kit, eqNoOfRow_(sh, row), paid, 'при заказе', method]]);
      nfSafe_(ps.getRange(r2, 7), '#,##0.00 "₾"');
    }
    step('оплата');
    logChange_(o.id, p.name, 'новый заказ экипировки', '', o.kit + (qs.some(function (q) { return q > 1; }) ? ', кол-во ' + qs.join(' + ') : '') + ', ' + sum + ' ₾, строка ' + row);
    step('журнал');
  }
  Logger.log('заказ экипировки: ' + steps.join(', ') + ', итого ' + (Date.now() - tStart) + ' мс');
  return { ok: true, dryRun: CONFIG.DRY_RUN, row: row };
}
// Есть ли в журнале изменений за последние 15 секунд такой же новый заказ этого игрока (тот же комплект и сумма)
function recentOrderDup_(id, kit, sum) {
  var log = dbRead_('ЖУРНАЛ ИЗМЕНЕНИЙ');
  if (!log || log.getLastRow() < 2) return false;
  var last = log.getLastRow(), from = Math.max(2, last - 24), now = Date.now(), pre = kit + ', ' + sum + ' ₾';
  return log.getRange(from, 1, last - from + 1, 6).getValues().some(function (r) {
    return r[0] instanceof Date && now - r[0].getTime() <= 15000 && String(r[1]) === String(id)
      && String(r[3]) === 'новый заказ экипировки' && String(r[5]).indexOf(pre) === 0;
  });
}

// Свободных строк нет: перед строкой итогов вставляем сразу пачку пронумерованных пустых строк (как было
// заведено в листе — заранее прописанные строки) и расширяем формулы итогов (SUM по I, J, K) и правила цвета.
// Долгая вставка — раз в EQ_NEW_ROWS заказов, а не при каждом. Возвращает первую новую строку.
// vals — строки заказов (EQ_FIRST.., 12 колонок), если уже прочитаны. Если строка итогов не похожа на ожидаемую,
// останавливаемся, ничего не меняя.
var EQ_NEW_ROWS = 10;
function newOrderRow_(sh, vals) {
  vals = vals || sh.getRange(EQ_FIRST, 1, EQ_ROWS, 12).getValues();
  var tot = 0, maxNum = 0, i, c, empty;
  for (i = 0; i < vals.length && !tot; i++) {
    empty = true;
    for (c = 1; c < 8; c++) { if (String(vals[i][c]).trim() !== '') empty = false; }
    if (empty && String(vals[i][8]).trim() !== '') tot = EQ_FIRST + i;
  }
  if (!tot) throw new Error('В файле экипировки не найдена строка итогов. Добавьте строку заказа вручную.');
  for (i = 0; i < tot - EQ_FIRST; i++) {
    if (String(vals[i][0]).trim() !== '' && !isNaN(Number(vals[i][0]))) maxNum = Math.max(maxNum, Number(vals[i][0]));
  }
  // номер не переиспользуем: старые платежи могут ссылаться и на удалённые заказы
  var jps = dbRead_(PAY_SHEET);
  if (jps && jps.getLastRow() > 1) {
    jps.getRange(2, 1, jps.getLastRow() - 1, 6).getValues().forEach(function (r) {
      if (String(r[4]).indexOf('Экипировка') === 0 && Number(r[5]) > maxNum) maxNum = Number(r[5]);
    });
  }
  // сколько строк вставить: пачку, но строка итогов должна остаться в просматриваемых строках (до EQ_FIRST + EQ_ROWS - 1)
  var n = Math.max(1, Math.min(EQ_NEW_ROWS, EQ_FIRST + EQ_ROWS - 1 - tot));
  var ok = true;
  var fixed = sh.getRange(tot, 9, 1, 3).getFormulas()[0].map(function (s) {
    var m = /^=SUM\(([A-Z])4:([A-Z])(\d+)\)$/.exec(String(s));
    if (!m || m[1] !== m[2] || Number(m[3]) !== tot - 1) { ok = false; return s; }
    return '=SUM(' + m[1] + '4:' + m[2] + (tot + n - 1) + ')';
  });
  if (!ok) throw new Error('Строка итогов в файле экипировки изменена. Добавьте строку заказа вручную.');
  if (!CONFIG.DRY_RUN) {
    sh.insertRowsBefore(tot, n);
    sh.getRange(tot + n, 9, 1, 3).setFormulas([fixed]);
    var nums = [];
    for (i = 1; i <= n; i++) nums.push([maxNum + i]);
    sh.getRange(tot, 1, n, 1).setValues(nums);
    // оформление как у строки выше (шрифт, цвета, границы)
    sh.getRange(tot - 1, 1, 1, 12).copyTo(sh.getRange(tot, 1, n, 12), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    // условное форматирование (зелёный/красный по оплате): расширяем диапазон, который заканчивается строкой выше
    var rules = sh.getConditionalFormatRules();
    sh.setConditionalFormatRules(rules.map(function (rule) {
      var changed = false;
      var nr = rule.getRanges().map(function (r) {
        if (r.getLastRow() !== tot - 1) return r;
        changed = true;
        return sh.getRange(r.getRow(), r.getColumn(), r.getNumRows() + n, r.getNumColumns());
      });
      return changed ? rule.copy().setRanges(nr).build() : rule;
    }));
  }
  return tot;
}
