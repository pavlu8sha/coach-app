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
  // Дата группы стоит только в первой строке группы (ячейки объединены). Строки группы берут её дату;
  // группа начинается со строки с № «1».
  var dates = [], cur = '';
  for (i = 0; i < vals.length; i++) dates[i] = '';
  for (i = hdr + 2; i < end; i++) {
    var c = dateText_(vals[i][2]), n = String(vals[i][0]).trim();
    if (n === '1') cur = c;
    else if (c) cur = c;
    dates[i] = cur;
  }
  return { hdr: hdr, end: end, vals: vals, dates: dates };
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

