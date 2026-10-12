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
