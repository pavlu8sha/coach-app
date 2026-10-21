/** Доступ к листу экипировки (файл EQUIP_ID): открывается один раз за запуск, проверяется заголовок «ID игрока» в L3. Только для администратора. */

// Лист заказов текущего сезона: настройка equip.seasonSheet (Settings.js), по умолчанию «СЕЗОН 2026-2027».
var EQ_FIRST = 4, EQ_ROWS = 250; // строки заказов в листе экипировки: 4..253 (таблица заказов до строки 259)

var _equipSheet = null; // лист открываем один раз за запуск

function equipSheet_() {
  if (_equipSheet) return _equipSheet;
  var season = settingGet_('equip.seasonSheet');
  var sh = clubSource_('EQUIP_ID', 'Не задано свойство EQUIP_ID (ID файла экипировки)').getSheetByName(season);
  if (!sh) throw new Error('В файле экипировки нет листа ' + season);
  var cache = CacheService.getScriptCache();
  if (!cache.get('eq_hdr_ok')) {
    if (String(sh.getRange('L3').getValue()).trim() !== 'ID игрока') {
      throw new Error('В файле экипировки в ячейку L3 впишите заголовок «ID игрока»');
    }
    cache.put('eq_hdr_ok', '1', 300);
  }
  _equipSheet = sh;
  return sh;
}