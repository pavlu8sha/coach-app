/** Оплаты индивидуальных и вратарских занятий пишутся и в файл оплат (блок «Индивидуальные / Вратарские» на листе месяца). Только для администратора. */

var IND_BLOCK_NAME = 'Индивидуальные / Вратарские';

// Лист месяца по дате занятия: 2026-10-10 → «10.26»
function indMonthSheet_(dateStr) {
  var p = String(dateStr).split('-');
  return p[1] + '.' + p[0].slice(2);
}

// Находит блок «Индивидуальные / Вратарские» на листе месяца.
// Возвращает { sh, hdr, end, vals } (индексы строк с нуля), либо бросает ошибку.
function indBlock_(sh) {
  var vals = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 4).getValues(), hdr = -1, i, a;
  for (i = 0; i < vals.length; i++) {
    if (norm(vals[i][0]) === norm(IND_BLOCK_NAME)) { hdr = i; break; }
  }
  if (hdr < 0) throw new Error('В листе ' + sh.getName() + ' нет блока «' + IND_BLOCK_NAME + '»');
  var end = vals.length;
  for (i = hdr + 1; i < vals.length; i++) {
    a = String(vals[i][0]).trim();
    if (a !== '' && a !== '№' && isNaN(Number(a))) { end = i; break; }
  }
  return { hdr: hdr, end: end, vals: vals };
}

// Записывает одну оплату занятия в блок листа месяца. Бросает ошибку, если лист или блок не найдены (тогда оплата не отмечается).
function indPayFileWrite_(dateStr, name, amount) {
  if (CONFIG.DRY_RUN) return { dryRun: true };
  var month = indMonthSheet_(dateStr);
  var sh = payFile_().getSheetByName(month);
  if (!sh) throw new Error('Нет листа ' + month + ' в файле оплат. Оплата не внесена.');
  var b = indBlock_(sh), row = 0, i;
  // Предоплата: строка этого игрока с суммой и без даты уже стоит в таблице. Заполняем её датой занятия, а не добавляем дубль.
  for (i = b.hdr + 2; i < b.end && !row; i++) {
    if (norm(b.vals[i][1]) === norm(name) && indAmount_(b.vals[i][3]) > 0 && indRowDate_(sh, i + 1) === '') row = i + 1;
  }
  for (i = b.hdr + 2; i < b.end && !row; i++) {
    if (String(b.vals[i][1]).trim() === '') row = i + 1; // свободная строка блока (1-based)
  }
  if (!row) {
    sh.insertRowBefore(b.end + 1); // новой строки нет: добавляем в конец блока
    row = b.end + 1;
    sh.getRange(row - 1, 1, 1, 4).copyTo(sh.getRange(row, 1, 1, 4), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    sh.getRange(row, 1).setValue(b.end - b.hdr - 1);
  }
  var p = String(dateStr).split('-');
  sh.getRange(row, 2).setValue(name);
  sh.getRange(row, 3).setNumberFormat('@').setValue(p[2] + '.' + p[1] + '.' + p[0]);
  sh.getRange(row, 4).setNumberFormat('#,##0.00 "₾"').setValue(amount);
  monthInvalidate_(month);
  return { row: row, month: month };
}

// Убирает оплату занятия из блока (при отмене): ищем строку с тем же ФИ и датой.
function indPayFileClear_(dateStr, name) {
  if (CONFIG.DRY_RUN) return { dryRun: true };
  var month = indMonthSheet_(dateStr);
  var sh = payFile_().getSheetByName(month);
  if (!sh) return { cleared: 0 };
  var b = indBlock_(sh), p = String(dateStr).split('-'), want = p[2] + '.' + p[1] + '.' + p[0], cleared = 0;
  for (var i = b.hdr + 2; i < b.end; i++) {
    if (norm(b.vals[i][1]) === norm(name) && String(b.vals[i][2]).trim() === want) {
      sh.getRange(i + 1, 2, 1, 3).clearContent();
      cleared++;
      break;
    }
  }
  monthInvalidate_(month);
  return { cleared: cleared, month: month };
}

// Дата строки таблицы с учётом объединённых ячеек
function indRowDate_(sh, row) {
  var t = dateText_(sh.getRange(row, 3).getValue());
  if (!t) {
    var mr = sh.getRange(row, 3).getMergedRanges();
    if (mr.length) t = dateText_(mr[0].getCell(1, 1).getValue());
  }
  return t;
}

// Сумма из ячейки: число или текст вида «50,00 ₾»
function indAmount_(v) {
  if (typeof v === 'number') return v;
  return Number(String(v).replace(/[^\d,.-]/g, '').replace(',', '.')) || 0;
}

// Ячейки B:D строк блока «Индивидуальные / Вратарские», где что-то записано (для очистки листа)
function indBlockCells_(sh) {
  var b;
  try { b = indBlock_(sh); } catch (e) { return []; }
  var cells = [];
  for (var i = b.hdr + 2; i < b.end; i++) {
    for (var c = 1; c < 4; c++) {
      if (String(b.vals[i][c]).trim() !== '') cells.push(String.fromCharCode(66 + c - 1) + (i + 1));
    }
  }
  return cells;
}

