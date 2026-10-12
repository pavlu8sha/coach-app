/** Разовый перенос оплат взноса «Championship 2» U9 из листа «U9 Friendly» в приложение. */

function importU9Preview() { Logger.log(importU9Paid_(true)); }
function importU9Run() { Logger.log(importU9Paid_(false)); }

function importU9Paid_(dry) {
  var ss = SpreadsheetApp.getActive();
  var evRow = ss.getSheetByName('МАТЧИ').getDataRange().getValues().slice(1).filter(function (r) {
    return /^U9/i.test(String(r[1])) && String(r[2]) === 'Чемпионат' && /championship\s*2/i.test(String(r[3]));
  })[0];
  if (!evRow) throw new Error('в МАТЧИ нет чемпионата U9 «Championship 2»');
  var id = String(evRow[0]), fee = Number(evRow[5]) || 0;
  var src = gamesFile_().getSheetByName('U9 Friendly');
  if (!src) throw new Error('в файле игр нет листа «U9 Friendly»');
  var v = src.getDataRange().getValues(), col = -1;
  v[0].forEach(function (x, i) { if (/championship\s*2/i.test(String(x))) col = i; });
  if (col < 0) throw new Error('на листе нет колонки «Championship 2»');
  var ps = partsSheet_(), pv = ps.getDataRange().getValues(), rowOf = {};
  pv.forEach(function (r, i) { if (i && String(r[0]) === id && r[1]) rowOf[nameKey2_(String(r[2]))] = i + 1; });
  var ALIAS = { 'kiryal dzhan': 'Kyral Dzhan', 'lyashenko kyryl': 'Liashenko Kyryl', 'goltsev max': 'Goltcev Max', 'gongadze sergey': 'Gognadze Sergey' };
  var plan = [], miss = [], same = 0;
  for (var i = 2; i < v.length; i++) {
    var name = String(v[i][1]).trim(), val = v[i][col];
    if (!name || val === '' || val === undefined) continue;
    var paid = val === true || String(val).toUpperCase() === 'TRUE';
    if (!paid && !(val === false || String(val).toUpperCase() === 'FALSE')) continue;
    var row = rowOf[nameKey2_(ALIAS[name.toLowerCase()] || name)];
    if (!row) { miss.push(name + (paid ? ' (оплатил)' : '')); continue; }
    if (pv[row - 1][5] === paid || pv[row - 1][5] === true) { same++; continue; }
    plan.push({ row: row, name: name, paid: paid });
  }
  var head = 'Событие ' + id + ', взнос ' + fee + ' ₾. К записи: ' + plan.length + ' (оплатили: '
    + plan.filter(function (p) { return p.paid; }).length + '), уже совпадает: ' + same
    + (miss.length ? '. Не найдены в составе приложения: ' + miss.join(', ') : '') + '.';
  if (dry || CONFIG.DRY_RUN) return (dry ? 'ПРОБНЫЙ ПЛАН. ' : 'Пробный режим, ничего не записано. ') + head;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    plan.forEach(function (p) {
      ps.getRange(p.row, 6).setValue(p.paid);
      ps.getRange(p.row, 7).setValue(p.paid ? fee : '');
    });
    logChange_('', '', 'импорт оплат Championship 2 (U9)', '', head);
  } finally { lock.releaseLock(); }
  var legacy = '';
  try { legacy = ' Старый файл: ' + legacySync_(id, false); } catch (e) { legacy = ' Старый файл: ' + e.message; }
  return 'ГОТОВО. ' + head + legacy;
}