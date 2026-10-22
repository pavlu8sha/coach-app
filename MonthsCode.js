/** Создание листов месяцев (посещаемость и оплаты). Только для администратора. */

function monthKey_(d) { return ('0' + (d.getMonth() + 1)).slice(-2) + '.' + String(d.getFullYear()).slice(-2); }

function isMonth_(n) { return /^\d{2}\.\d{2}$/.test(n); }

// revMonth_ («мм.гг» → «ггмм» для сравнения месяцев) — одна на проект, в SubsCode.js

// Три месяца, листов которых ещё нет: считаем от текущего месяца или от последнего созданного листа (что позже).
function appMonthOptions(pin, kind) {
  checkAdmin_(pin);
  var ss = kind === 'pay' ? payFile_() : attSS_();
  var names = ss.getSheets().map(function (s) { return s.getName(); }).filter(isMonth_);
  var now = new Date(), base = new Date(now.getFullYear(), now.getMonth(), 1), out = [];
  names.forEach(function (n) {
    var p = n.split('.');
    var next = new Date(2000 + Number(p[1]), Number(p[0]), 1); // месяц после этого листа
    if (next > base) base = next;
  });
  for (var i = 0; i < 3; i++) {
    out.push(monthKey_(new Date(base.getFullYear(), base.getMonth() + i, 1)));
  }
  return out;
}

// Новый лист ставим сразу после последнего листа месяца.
// Нумерация «№» по блокам заново: 1, 2, 3… без пропусков (после удаления строк ушедших)
function renumberRows_(sh) {
  parseMonth_(sh).forEach(function (g) {
    g.rows.forEach(function (r, i) {
      if (Number(sh.getRange(r.row, 1).getValue()) !== i + 1) sh.getRange(r.row, 1).setValue(i + 1);
    });
  });
}

function placeAfterMonths_(ss, sh) {
  var last = 0;
  ss.getSheets().forEach(function (s) {
    if (s.getSheetId() !== sh.getSheetId() && isMonth_(s.getName())) last = Math.max(last, s.getIndex());
  });
  ss.setActiveSheet(sh);
  ss.moveActiveSheet(last ? last + 1 : ss.getSheets().length);
}

function appCreatePayMonth(pin, month) {
  checkAdmin_(pin);
  if (CONFIG.DRY_RUN) return createPayMonthCore_(month);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return createPayMonthCore_(month); } finally { lock.releaseLock(); }
}

function createPayMonthCore_(month) {
  if (!isMonth_(month)) throw new Error('Месяц нужен в формате ММ.ГГ');
  var ss = payFile_();
  if (ss.getSheetByName(month)) throw new Error('Лист ' + month + ' уже есть');
  var prev = ss.getSheets().map(function (s) { return s.getName(); })
    .filter(function (n) { return isMonth_(n) && revMonth_(n) < revMonth_(month); })
    .sort(function (a, b) { return revMonth_(a).localeCompare(revMonth_(b)); });
  if (!prev.length) throw new Error('Нет предыдущего листа месяца, с которого можно скопировать');
  var src = ss.getSheetByName(prev[prev.length - 1]);
  var active = {}, inactive = {};
  readRegistry_().players.forEach(function (p) {
    if (p.status === 'Активен') active[norm(p.name)] = true; else inactive[norm(p.name)] = true;
  });
  function leaves(r) { return r.name && inactive[norm(r.name)] && !active[norm(r.name)]; }
  var removed = [], kept = 0;
  parseMonth_(src).forEach(function (g) {
    g.rows.forEach(function (r) {
      if (!r.name) return;
      if (leaves(r)) removed.push(r.name); else kept++;
    });
  });
  var cleared = 0;
  if (!CONFIG.DRY_RUN) {
    var sh = null;
    try {
      sh = src.copyTo(ss);
      sh.setName(month);
      // Ушедших игроков удаляем строками целиком (без дыр в списке), остальным очищаем оплату
      var dcells = [], gone = [];
      parseMonth_(sh).forEach(function (g) {
        g.rows.forEach(function (r) {
          if (r.paid) cleared++;
          if (leaves(r)) { gone.push(r.row); return; }
          dcells.push('D' + r.row);
        });
      });
      if (dcells.length) sh.getRangeList(dcells).clearContent();
      gone.sort(function (a, b) { return b - a; }).forEach(function (row) { sh.deleteRow(row); });
      if (gone.length) renumberRows_(sh);
      // Блок «Индивидуальные / Вратарские» разбор листа пропускает, поэтому чистим его отдельно: новый месяц начинается пустым
      var bcells = indBlockCells_(sh);
      if (bcells.length) sh.getRangeList(bcells).clearContent();
      var MN = ['ЯНВАРЬ', 'ФЕВРАЛЬ', 'МАРТ', 'АПРЕЛЬ', 'МАЙ', 'ИЮНЬ', 'ИЮЛЬ', 'АВГУСТ', 'СЕНТЯБРЬ', 'ОКТЯБРЬ', 'НОЯБРЬ', 'ДЕКАБРЬ'];
      var a1 = String(sh.getRange('A1').getValue());
      if (a1.indexOf('ОПЛАТЫ') >= 0) {
        sh.getRange('A1').setValue('FC KICKSTART • ОПЛАТЫ • ' + MN[Number(month.slice(0, 2)) - 1] + ' 20' + month.slice(3));
      }
      placeAfterMonths_(ss, sh);
    } catch (e) {
      // Любая ошибка: недоделанный лист не оставляем.
      if (sh) { try { ss.deleteSheet(sh); } catch (ignore) {} }
      throw new Error(e.message + ' Лист не создан.');
    }
    logChange_('', '', 'создан лист месяца (оплаты)', prev[prev.length - 1], month);
    cacheDropBig_('pmonths');
    monthInvalidate_(month);
  }
  return { ok: true, dryRun: CONFIG.DRY_RUN, month: month, from: prev[prev.length - 1], kept: kept, removed: removed, cleared: cleared };
}