/** Создание листа посещаемости (версия 4): строки добавляются, недостающие блоки копируются, группы расставляются по порядку. */

// Порядок групп в листе посещаемости: настройка att.groupOrder. Группы, которых там нет, идут в конце.
var ORDER_BLOCKS = true; // false = не переставлять блоки

function groupRank_(name) {
  var i = (settingGet_('att.groupOrder') || []).map(norm).indexOf(norm(name));
  return i < 0 ? 999 : i;
}

function lastMonthBefore_(ss, month) {
  var prev = ss.getSheets().map(function (s) { return s.getName(); })
    .filter(function (n) { return isMonth_(n) && revMonth_(n) < revMonth_(month); })
    .sort(function (a, b) { return revMonth_(a).localeCompare(revMonth_(b)); });
  return prev.length ? prev[prev.length - 1] : '';
}

// Только игроки, у которых эта группа основная.
function namesFor_(players, group) {
  return players.filter(function (p) { return norm(p.group) === norm(group); }).map(function (p) { return p.name; });
}

// Блоки листа: заголовок, первая строка игроков, число строк, строка «ИТОГ ГРУППЫ» (нумерация с 1).
function attBlocks_(sh) {
  var data = sh.getRange(1, 1, sh.getLastRow(), 1).getValues(), out = [], i, j;
  for (i = 0; i < data.length - 1; i++) {
    if (String(data[i][0]).trim() && String(data[i + 1][0]).trim() === '№') {
      j = i + 2;
      while (j < data.length && norm(data[j][0]) !== norm(CONFIG.END_MARKER)) j++;
      if (j >= data.length) break;
      out.push({ name: String(data[i][0]).trim(), title: i + 1, first: i + 3, slots: j - (i + 2), end: j + 1 });
      i = j;
    }
  }
  return out;
}

function fillNames_(sh, row, slots, names) {
  var n = Math.min(names.length, slots);
  if (!n) return 0;
  var rg = sh.getRange(row, 2, n, 1);
  if (rg.getValues().some(function (r) { return String(r[0]).trim() !== ''; })) return 0;
  rg.setValues(names.slice(0, n).map(function (x) { return [x]; }));
  return n;
}

// Добавляет n строк в блок группы. Ячейки вставляются только в столбцах A:X,
// поэтому служебный блок AA:AL остаётся на месте.
function addRows_(sh, first, slots, n) {
  var lastRow = first + slots - 1, W = 24, src = lastRow + n, r;
  var need = sh.getLastRow() + n - sh.getMaxRows();
  if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need);
  sh.getRange(lastRow, 1, n, W).insertCells(SpreadsheetApp.Dimension.ROWS);
  for (r = 0; r < n; r++) sh.getRange(src, 1, 1, W).copyTo(sh.getRange(lastRow + r, 1, 1, W));
  var rg = sh.getRange(first, 1, slots + n, 1);
  if (!rg.getFormulas().some(function (x) { return x[0] !== ''; })) {
    var nums = [];
    for (r = 1; r <= slots + n; r++) nums.push([r]);
    rg.setValues(nums);
  }
}

// Копирует блок группы из прошлого месяца в конец листа и очищает ФИ, даты и отметки.
function appendBlock_(sh, b) {
  var dest = sh.getLastRow() + 2, h = b.end - b.title + 1;
  var over = dest + h - 1 - sh.getMaxRows();
  if (over > 0) sh.insertRowsAfter(sh.getMaxRows(), over);
  b.src.getRange(b.title, 1, h, 24).copyTo(sh.getRange(dest, 1));
  for (var q = 0; q < h; q++) sh.setRowHeight(dest + q, b.src.getRowHeight(b.title + q));
  sh.getRange(dest + 1, 3, 1, 18).clearContent();
  sh.getRange(dest + 2, 2, b.slots, 1).clearContent();
  sh.getRange(dest + 2, 3, b.slots, 18).clearContent();
  return dest + 2;
}

// Переставляет блоки групп в порядок настройки att.groupOrder (вырезать и вставить, формулы сохраняются).
function reorderBlocks_(sh) {
  var W = 24, blocks = attBlocks_(sh);
  blocks.forEach(function (b, i) { b.i = i; });
  var target = blocks.slice().sort(function (a, b) { return groupRank_(a.name) - groupRank_(b.name) || a.i - b.i; });
  var names = target.map(function (b) { return b.name; });
  if (target.every(function (b, i) { return b === blocks[i]; })) return names;
  blocks.forEach(function (b) {
    b.h = [sh.getRowHeight(b.title), sh.getRowHeight(b.title + 1), sh.getRowHeight(b.first), sh.getRowHeight(b.end)];
  });
  var start = blocks[0].title, last = blocks[blocks.length - 1].end;
  var S = last + blocks.length + 3, pos = S;
  var need = S + (last - start + 1) + blocks.length * 2 - sh.getMaxRows();
  if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need);
  target.forEach(function (b) {
    var h = b.end - b.title + 1;
    sh.getRange(b.title, 1, h, W).moveTo(sh.getRange(pos, 1));
    b.height = h;
    pos += h + 1;
  });
  sh.getRange(S, 1, pos - S - 1, W).moveTo(sh.getRange(start, 1));
  var row = start;
  target.forEach(function (b) {
    sh.setRowHeight(row, b.h[0]);
    sh.setRowHeight(row + 1, b.h[1]);
    sh.setRowHeights(row + 2, b.slots, b.h[2]);
    sh.setRowHeight(row + 2 + b.slots, b.h[3]);
    row += b.height + 1;
  });
  return names;
}

function appCreateAttMonth(pin, month) {
  checkAdmin_(pin);
  if (!isMonth_(month)) throw new Error('Месяц нужен в формате ММ.ГГ');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return createAttMonthCore_(month);
  } finally {
    lock.releaseLock();
  }
}

function createAttMonthCore_(month) {
  var ss = attSS_(); // лист месяца создаётся в таблице посещаемости (ATT_ID), куда пишутся отметки
  if (ss.getSheetByName(month)) throw new Error('Лист ' + month + ' уже есть');
  var tpl = ss.getSheetByName('ШАБЛОН МЕСЯЦА');
  if (!tpl) throw new Error('В файле нет листа «ШАБЛОН МЕСЯЦА»');
  var players = readRegistry_().players.filter(function (p) { return p.status === 'Активен'; });
  var plan = attBlocks_(tpl).map(function (b) { b.names = namesFor_(players, b.name); return b; });
  var extra = [], prevName = lastMonthBefore_(ss, month);
  if (prevName) {
    var prev = ss.getSheetByName(prevName);
    attBlocks_(prev).forEach(function (b) {
      if (plan.some(function (p) { return norm(p.name) === norm(b.name); })) return;
      b.src = prev; b.names = namesFor_(players, b.name); extra.push(b);
    });
  }
  var report = plan.map(function (g) {
    var add = Math.max(g.names.length - g.slots, 0);
    return { name: g.name, players: g.names.length, slots: g.slots, added: add, placed: g.names.length, failed: false, copied: false };
  }).concat(extra.map(function (g) {
    return { name: g.name, players: g.names.length, slots: g.slots, added: 0, placed: Math.min(g.names.length, g.slots), failed: false, copied: true };
  }));
    var have = plan.concat(extra).map(function (b) { return norm(b.name); }), missing = [];
    players.forEach(function (p) {
      if (p.group && have.indexOf(norm(p.group)) < 0 && missing.indexOf(p.group) < 0) missing.push(p.group);
    });
  var order = plan.concat(extra)
    .sort(function (a, b) { return groupRank_(a.name) - groupRank_(b.name); })
    .map(function (g) { return g.name; });
  if (CONFIG.DRY_RUN) return { ok: true, dryRun: true, month: month, groups: report, order: order, missing: missing };

  var sh = null;
  try {
    sh = tpl.copyTo(ss);
    sh.setName(month);
    // Сначала группы шаблона, снизу вверх, чтобы номера строк выше не сдвигались.
    for (var k = plan.length - 1; k >= 0; k--) {
      var g = plan[k], need = Math.max(g.names.length - g.slots, 0), room = g.slots;
      if (need > 0) {
        try { addRows_(sh, g.first, g.slots, need); room = g.slots + need; }
        catch (err) { report[k].failed = true; report[k].added = 0; }
      }
      report[k].placed = fillNames_(sh, g.first, room, g.names);
    }
    // Затем блоки из прошлого месяца (например, weekends), в конец листа.
    extra.forEach(function (b, e) {
      var row = appendBlock_(sh, b);
      report[plan.length + e].placed = fillNames_(sh, row, b.slots, b.names);
    });
    // И наконец расставляем группы в нужном порядке.
    if (ORDER_BLOCKS) {
      try { order = reorderBlocks_(sh); }
      catch (err2) { throw new Error('Не удалось расставить группы в нужном порядке (' + err2.message + ').'); }
    }
    placeAfterMonths_(ss, sh);
  } catch (e) {
    // Любая ошибка: недоделанный лист не оставляем.
    if (sh) { try { ss.deleteSheet(sh); } catch (ignore) {} }
    throw new Error(e.message + ' Лист не создан.');
  }
  logChange_('', '', 'создан лист месяца (посещаемость)', '', month);
  return { ok: true, dryRun: false, month: month, groups: report, order: order, missing: missing };
}