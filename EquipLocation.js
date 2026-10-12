/** Колонка «Локация» в файле экипировки (столбец M): значение берётся из реестра игроков по ID в колонке L. Только для администратора. */

var EQ_LOC_COL = 13; // столбец M, за пределами таблицы заказов (A:L)

// Записывает локацию игрока в каждую строку заказа. Порядок строк не меняется.
function equipSyncLocations_(sh) {
  if (CONFIG.DRY_RUN) return 0;
  var locOf = {};
  readRegistry_().players.forEach(function (p) { locOf[p.id] = p.loc; });
  var ids = sh.getRange(EQ_FIRST, 12, EQ_ROWS, 1).getValues();
  var out = ids.map(function (r) { return [locOf[String(r[0]).trim()] || '']; });
  sh.getRange(3, EQ_LOC_COL).setValue('Локация');
  sh.getRange(EQ_FIRST, EQ_LOC_COL, EQ_ROWS, 1).setValues(out);
  // оформление как у остальных ячеек колонки: по центру, без жирного (новая строка его не наследует)
  var lc = sh.getRange(EQ_FIRST, EQ_LOC_COL, EQ_ROWS, 1);
  lc.setHorizontalAlignment('center').setFontWeight('normal');
  return out.filter(function (r) { return r[0] !== ''; }).length;
}

// Кнопка «Локации в таблице» на странице экипировки
function appSyncEquipLocations(pin) {
  checkAdmin_(pin);
  var lock = LockService.getScriptLock();
  if (!CONFIG.DRY_RUN) lock.waitLock(20000);
  try {
    var n = equipSyncLocations_(equipSheet_());
    return { ok: true, dryRun: CONFIG.DRY_RUN, filled: n };
  } finally {
    if (!CONFIG.DRY_RUN) lock.releaseLock();
  }
}

// Группа для номеров: u7-a и u7-b считаются одной группой «u7»
function baseGroup_(g) { return String(g || '').trim().replace(/\s*-\s*[a-zа-яё]$/i, ''); }

// Ищет другого игрока той же группы с таким же номером. Возвращает ФИ или ''. row — строку заказа не сравниваем.
function equipNumClash_(sh, id, num, row) {
  num = String(num || '').trim().toLowerCase();
  if (!num) return '';
  var groupOf = {};
  readRegistry_().players.forEach(function (p) { groupOf[p.id] = baseGroup_(p.group); });
  var myG = groupOf[id];
  if (!myG) return '';
  var vals = sh.getRange(EQ_FIRST, 1, EQ_ROWS, 12).getValues(), hit = '';
  vals.forEach(function (r, i) {
    var rr = EQ_FIRST + i, oid = String(r[11]).trim();
    if (rr === row || !oid || oid === id || hit) return;
    if (String(r[6]).trim().toLowerCase() === num && groupOf[oid] === myG) hit = String(r[2]).trim() || oid;
  });
  return hit;
}

// Надпись нужна на всех комплектах, кроме тренировочного
function inscrNeeded_(kit) { return String(kit || '').trim().toLowerCase() !== 'тренировочная'; }
