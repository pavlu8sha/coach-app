/**
 * Отметки «написал(а)» — общие для всех устройств: строки листа в AdminApp, по одной строке на отметку.
 * Используются в «Должниках» (лист «ОТМЕТКИ ДОЛЖНИКОВ») и в «Дополнительных тренировках» («ОТМЕТКИ СООБЩЕНИЙ»).
 * Каждое нажатие меняет только свою строку под блокировкой, поэтому одновременные отметки разных людей
 * не затирают друг друга (раньше лист перезаписывался целиком набором с одной страницы).
 * Первые две колонки — ключ отметки (текст); третья, если есть в заголовке, — когда отмечено.
 */

// Ключи отметок листа: [[a, b], ...] — как текст, пустые строки пропускаются
function wroteRows_(sh) {
  var last = sh ? sh.getLastRow() : 0;
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 2).getDisplayValues().map(function (r) { return [String(r[0]).trim(), String(r[1]).trim()]; });
}

// Новая строка отметки: текстовый формат до записи, иначе «10.26» Sheets превращает в дату
function wroteAppend_(sh, head, rows) {
  var n = sh.getLastRow() + 1;
  nfSafe_(sh.getRange(n, 1, rows.length, 2), '@');
  sh.getRange(n, 1, rows.length, head.length).setValues(rows.map(function (p) { return head.length > 2 ? [p[0], p[1], new Date()] : [p[0], p[1]]; }));
}

// Поставить (on) или снять одну отметку (a, b). Поставить — добавить строку, если такой нет; снять — удалить все такие строки.
function wroteToggle_(name, head, a, b, on) {
  if (CONFIG.DRY_RUN) return { ok: true, dryRun: true, on: !!on };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = on ? dbSheet_(name, head) : dbRead_(name);
    if (!sh) return { ok: true, on: false };
    var hit = [];
    wroteRows_(sh).forEach(function (r, i) { if (r[0] === a && r[1] === b) hit.push(i + 2); });
    if (on) { if (!hit.length) wroteAppend_(sh, head, [[a, b]]); }
    else {
      for (var j = hit.length - 1; j >= 0; j--) {
        try { sh.deleteRow(hit[j]); } catch (e) { sh.getRange(hit[j], 1, 1, head.length).clearContent(); }   // последнюю строку листа удалить нельзя
      }
    }
    return { ok: true, on: !!on };
  } finally {
    lock.releaseLock();
  }
}

// Добавить сразу несколько отметок, которых ещё нет (ничего не снимает). pairs: [[a, b], ...]. Возвращает число добавленных.
function wroteAddMany_(name, head, pairs) {
  if (!pairs.length) return 0;
  if (CONFIG.DRY_RUN) return 0;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = dbSheet_(name, head), have = {}, add = [];
    wroteRows_(sh).forEach(function (r) { have[r[0] + '|' + r[1]] = 1; });
    pairs.forEach(function (p) { var k = p[0] + '|' + p[1]; if (!have[k]) { have[k] = 1; add.push(p); } });
    if (add.length) wroteAppend_(sh, head, add);
    return add.length;
  } finally {
    lock.releaseLock();
  }
}
