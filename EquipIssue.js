/**
 * Выдача экипировки: отметка по каждой вещи заказа (решение владельца 23.10).
 * - Лист «ВЫДАЧА» в файле экипировки: одна строка на выданную вещь — ID заказа (ORD), вещь, дата выдачи, кто выдал,
 *   ID игрока, ФИ, когда отмечено. Снять отметку — удалить её строку (история — в журнале изменений AdminApp).
 * - Итог по заказу — в колонку «Выдано» листа «ФАКТ ПОШИВА» (её же показывает «ПРОИЗВОДСТВО»):
 *   «Да» — выданы все вещи, «Частично» — часть, «Нет» — ничего. Если строки заказа там нет, она добавляется.
 * Ключ — ID заказа из колонки N (ORD-xxxx): не меняется при удалении строк и перепривязке игрока.
 */

var ISSUE_SHEET = 'ВЫДАЧА', ISSUE_HEAD = ['ID заказа', 'Вещь', 'Дата выдачи', 'Кто выдал', 'ID игрока', 'ФИ', 'Отмечено'];
var FACT_SHEET = 'ФАКТ ПОШИВА', FACT_ISSUED_COL = 8;   // H «Выдано»: Не подтверждено / Нет / Частично / Да

function issueKits_(kit) { return String(kit || '').split(' + ').map(function (x) { return x.trim(); }).filter(Boolean); }

function issueSheet_(create) {
  var ss = equipSheet_().getParent(), sh = ss.getSheetByName(ISSUE_SHEET);
  if (sh || !create) return sh;
  sh = ss.insertSheet(ISSUE_SHEET);
  sh.getRange(1, 1, 1, ISSUE_HEAD.length).setValues([ISSUE_HEAD]);
  sh.setFrozenRows(1);
  return sh;
}

// Строки листа «ВЫДАЧА»: [{row, ord, item, date, who}]
function issueRows_(sh) {
  var last = sh ? sh.getLastRow() : 0;
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 4).getDisplayValues().map(function (r, i) {
    return { row: i + 2, ord: String(r[0]).trim(), item: String(r[1]).trim(), date: String(r[2]).trim(), who: String(r[3]).trim() };
  }).filter(function (x) { return x.ord && x.item; });
}

// Выдачи для экрана: { 'ORD-0131': { 'Тренировочная форма': { date: '23.10.2026', who: 'Павел' } } }
var ISSUE_CACHE = 'eqiss_v1';
function equipIssues_() {
  var hit = cacheGetBig_(ISSUE_CACHE);
  if (hit) return hit;
  var out = {};
  issueRows_(issueSheet_(false)).forEach(function (x) { (out[x.ord] = out[x.ord] || {})[x.item] = { date: x.date, who: x.who }; });
  cachePutBig_(ISSUE_CACHE, out, 60);
  return out;
}

// «Да» — выданы все вещи заказа, «Частично» — часть, «Нет» — ничего
function issueStatus_(kits, issuedItems) {
  var n = kits.filter(function (k) { return issuedItems.indexOf(k) >= 0; }).length;
  return n === 0 ? 'Нет' : (n === kits.length ? 'Да' : 'Частично');
}

// Итог в «ФАКТ ПОШИВА» (H «Выдано»). Строки заказа нет — добавляем после последней (как в «КАК РАБОТАТЬ»).
function issueFactWrite_(ss, ord, name, status) {
  var f = ss.getSheetByName(FACT_SHEET);
  if (!f) return false;
  var last = f.getLastRow(), ids = last > 1 ? f.getRange(2, 1, last - 1, 1).getDisplayValues() : [];
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === ord) { f.getRange(i + 2, FACT_ISSUED_COL).setValue(status); return true; }
  }
  var n = Math.max(last, 1) + 1;
  f.getRange(n, 1, 1, FACT_ISSUED_COL).setValues([[ord, name, '', '', '', '', 'Не подтверждено', status]]);
  return true;
}

// Отметить (on) или снять выдачу вещей заказа. row — строка заказа на листе сезона; items — названия вещей из заказа;
// date — «гггг-мм-дд» (для выдачи); who — кто выдал (текст).
function appEquipIssue(pin, row, items, on, date, who) {
  checkAdmin_(pin);
  row = Number(row);
  if (!(row >= EQ_FIRST && row < EQ_FIRST + EQ_ROWS)) throw new Error('Некорректная строка');
  items = (Array.isArray(items) ? items : []).map(function (x) { return String(x).trim(); }).filter(Boolean);
  if (!items.length) throw new Error('Отметьте, что выдаёте');
  var m = on ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || '')) : null;
  if (on && !m) throw new Error('Укажите дату выдачи');
  var dateText = m ? m[3] + '.' + m[2] + '.' + m[1] : '';
  who = String(who || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (CONFIG.DRY_RUN) return { ok: true, dryRun: true };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = equipSheet_(), r = sh.getRange(row, 1, 1, 14).getValues()[0];
    var name = String(r[2]).trim(), kits = issueKits_(r[3]), id = String(r[11]).trim(), ord = String(r[13]).trim();
    if (!name || !kits.length) throw new Error('Заказ не найден, обновите страницу');
    if (!ord) throw new Error('У заказа нет ID заказа (колонка N «ID заказа»): выдачу отметить нельзя');
    items.forEach(function (it) { if (kits.indexOf(it) < 0) throw new Error('Вещи «' + it + '» нет в заказе, обновите страницу'); });
    var is = issueSheet_(true), rows = issueRows_(is).filter(function (x) { return x.ord === ord; });
    var have = rows.map(function (x) { return x.item; }), changed = [];
    if (on) {
      var add = items.filter(function (it, i) { return have.indexOf(it) < 0 && items.indexOf(it) === i; });
      if (add.length) {
        var n = is.getLastRow() + 1;
        nfSafe_(is.getRange(n, 1, add.length, 4), '@');   // «23.10.2026» остаётся текстом
        is.getRange(n, 1, add.length, ISSUE_HEAD.length).setValues(add.map(function (it) { return [ord, it, dateText, who, id, name, new Date()]; }));
      }
      changed = add;
      have = have.concat(add);
    } else {
      var del = rows.filter(function (x) { return items.indexOf(x.item) >= 0; }).map(function (x) { return x.row; }).sort(function (a, b) { return b - a; });
      del.forEach(function (rr) { try { is.deleteRow(rr); } catch (e) { is.getRange(rr, 1, 1, ISSUE_HEAD.length).clearContent(); } });
      changed = items.filter(function (it) { return have.indexOf(it) >= 0; });
      have = have.filter(function (it) { return items.indexOf(it) < 0; });
    }
    var status = issueStatus_(kits, have);
    issueFactWrite_(sh.getParent(), ord, name, status);
    cacheDropBig_(ISSUE_CACHE);
    if (changed.length) {
      logChange_(id, name, on ? 'выдача экипировки' : 'отмена выдачи экипировки', '',
        ord + ': ' + changed.join(' + ') + (on ? ', ' + dateText + (who ? ', выдал(а) ' + who : '') : '') + ' → ' + status);
    }
    return { ok: true, status: status, changed: changed.length };
  } finally {
    lock.releaseLock();
  }
}
