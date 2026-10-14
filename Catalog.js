/** Каталог экипировки: позиции хранятся на листе «КАТАЛОГ ЭКИПИРОВКИ» в файле заказов экипировки (EQUIP_ID). */

var CAT_SHEET = 'КАТАЛОГ ЭКИПИРОВКИ';

function catSheet_() {
  var id = prop_('EQUIP_ID');
  if (!id) throw new Error('Не задан EQUIP_ID в свойствах скрипта');
  var ss = SpreadsheetApp.openById(id), sh = ss.getSheetByName(CAT_SHEET);
  if (sh) return sh;
  if (CONFIG.DRY_RUN) return null;
  sh = ss.insertSheet(CAT_SHEET);
  sh.appendRow(['Название', 'Цена, ₾', 'Размеры (через запятую)', 'Надпись', 'Номер', 'Активна']);
  Object.keys(KIT_PRICES).forEach(function (k) { sh.appendRow([k, KIT_PRICES[k], '', 'да', 'да', 'да']); });
  sh.setFrozenRows(1);
  return sh;
}

function catYes_(v) { return v === true || /^(да|yes|true|1)$/i.test(String(v).trim()); }

function catalogLive_() {
  var sh = catSheet_(), out = [];
  if (!sh) {
    out = Object.keys(KIT_PRICES).map(function (k) { return { row: 0, name: k, price: KIT_PRICES[k], sizes: '', inscr: true, num: true, active: true }; });
  } else if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues().forEach(function (r, i) {
      if (!String(r[0]).trim()) return;
      out.push({ row: i + 2, name: String(r[0]).trim(), price: Number(r[1]) || 0, sizes: String(r[2] || '').trim(),
        inscr: catYes_(r[3]), num: catYes_(r[4]), active: !/^(нет|no|false|0)$/i.test(String(r[5]).trim()) });
    });
  }
  return out;
}

// Каталог из кэша (2 мин); сбрасывается при сохранении позиции.
function catalog_(onlyActive) {
  var all = cacheGetBig_('cat_v1');
  if (!all) { all = catalogLive_(); cachePutBig_('cat_v1', all, 120); }
  return onlyActive ? all.filter(function (x) { return x.active; }) : all;
}

function appCatalog(pin) {
  checkAdmin_(pin);
  return { items: catalog_(false), dryRun: CONFIG.DRY_RUN };
}

// o: {row (0 = новая), name, price, sizes, inscr, num, active}. Ничего не удаляет: позицию можно скрыть.
function appCatalogSave(pin, o) {
  checkAdmin_(pin);
  o = o || {};
  var name = String(o.name || '').trim(), price = Number(o.price);
  if (!name) throw new Error('Введите название позиции');
  if (String(o.price === null || o.price === undefined ? '' : o.price).trim() === '' || isNaN(price) || price < 0) throw new Error('Введите цену (0 или больше)');
  var vals = [[name, price, String(o.sizes || '').trim(), o.inscr ? 'да' : 'нет', o.num ? 'да' : 'нет', o.active === false ? 'нет' : 'да']];
  if (CONFIG.DRY_RUN) return { ok: true, dryRun: true };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = catSheet_(), row = Number(o.row) || 0;
    catalogLive_().forEach(function (x) {
      if (x.row !== row && x.name.toLowerCase() === name.toLowerCase()) throw new Error('Позиция с таким названием уже есть');
    });
    if (row && (row < 2 || row > sh.getLastRow())) throw new Error('Позиция не найдена, обновите страницу');
    if (!row) row = sh.getLastRow() + 1;
    sh.getRange(row, 1, 1, 6).setValues(vals);
    cacheDropBig_('cat_v1');
    logChange_('', '', o.row ? 'каталог экипировки: изменение' : 'каталог экипировки: новая позиция', '', name + ', ' + price + ' ₾');
  } finally {
    lock.releaseLock();
  }
  return { ok: true, dryRun: false };
}