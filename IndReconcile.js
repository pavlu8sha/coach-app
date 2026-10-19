/** Сверка оплат индивидуальных и вратарских занятий: журнал приложения против блока «Индивидуальные / Вратарские» в файле оплат.
 *  Ничего не записывает. Запускается вручную из редактора Apps Script (функция indPayReconcile), результат в журнале (Просмотр → Журнал). */

function indPayReconcile() {
  // Оплаты берём из листов занятий (галочка «оплатил» у игрока): там история всех занятий, журнал IND_LOG начат позже
  var net = {}, nameOf = {}, evs = indParseRaw_();
  evs.forEach(function (e) {
    var p = e.date.split('-'), dateStr = p[2] + '.' + p[1] + '.' + p[0];
    e.players.forEach(function (pl) {
      if (!pl.paid) return;
      var key = norm(pl.name) + '|' + dateStr;
      net[key] = (net[key] || 0) + indPrice_(dateStr);
      nameOf[key] = pl.name;
    });
  });
  var out = [];
  out.push('Оплаченных занятий (галочка на листах занятий): ' + Object.keys(net).length);
  var paid = Object.keys(net);
  var byMonth = {};
  paid.forEach(function (k) {
    var ds = k.split('|')[1], p = ds.split('.'), month = p[1] + '.' + p[2].slice(2);
    (byMonth[month] = byMonth[month] || []).push({ name: nameOf[k], date: ds, key: k });
  });
  var file = payFile_(), tot = { ok: 0, weak: 0, missing: 0, extra: 0, amt: 0 }, skippedMonths = 0, skippedRows = 0;
  Object.keys(byMonth).sort(function (a, b) { return revMonth_(a).localeCompare(revMonth_(b)); }).forEach(function (month) {
    var sh = file.getSheetByName(month), list = byMonth[month];
    out.push('');
    out.push('== Лист ' + month + ' (' + list.length + ' оплат из приложения)');
    if (!sh) { skippedMonths++; skippedRows += list.length; return; } // в файле оплат нет листа за этот месяц: история до него не сверяется
    var b;
    try { b = indBlock_(sh); } catch (err) { out.push('  ' + err.message); return; }
    var sheetRows = [];
    for (var i = b.hdr + 2; i < b.end; i++) {
      var name = String(b.vals[i][1]).trim();
      if (!name) continue;
      var text = dateText_(b.vals[i][2]);
      if (!text) { // дата может стоять в объединённой ячейке (на несколько строк): берём значение верхней левой ячейки
        var mr = sh.getRange(i + 1, 3).getMergedRanges();
        if (mr.length) text = dateText_(mr[0].getCell(1, 1).getValue());
      }
      text = String(text).replace(/\s*вр$/i, ''); // метка вратарского занятия в дате не мешает сверке
      sheetRows.push({ row: i + 1, name: name, text: text, amt: b.vals[i][3], used: false });
    }
    list.sort(function (x, y) { return x.date.split('.').reverse().join('').localeCompare(y.date.split('.').reverse().join('')) || x.name.localeCompare(y.name); });
    list.forEach(function (e) {
      var hit = null, weak = null;
      sheetRows.forEach(function (s) {
        if (s.used || norm(s.name) !== norm(e.name)) return;
        var kind = dayMatch_(s.text, e.date);
        if (kind === 'strong' && !hit) hit = s;
        if (kind === 'weak' && !weak) weak = s;
      });
      if (hit) {
        hit.used = true; tot.ok++;
        if (indAmount_(hit.amt) !== indPrice_(e.date)) { tot.amt++; out.push('  СУММА В ТАБЛИЦЕ НЕ ' + indPrice_(e.date) + ' ₾ (строка ' + hit.row + '): ' + e.name + ', ' + e.date + ', в таблице: ' + (String(hit.amt).trim() || 'пусто')); }
      }
      else if (weak) { weak.used = true; tot.weak++; out.push('  БЕЗ ДАТЫ В ТАБЛИЦЕ (проверьте строку ' + weak.row + '): ' + e.name + ', ' + e.date); }
      else { tot.missing++; out.push('  НЕТ В ТАБЛИЦЕ: ' + e.name + ', ' + e.date); }
    });
    sheetRows.forEach(function (s) {
      if (!s.used) { tot.extra++; out.push('  ЕСТЬ В ТАБЛИЦЕ, НЕТ В ПРИЛОЖЕНИИ (строка ' + s.row + '): ' + s.name + ', дата «' + s.text + '», ' + s.amt); }
    });
  });
  out.push('');
  out.push('Пропущено месяцев без листа в файле оплат: ' + skippedMonths + ' (оплат: ' + skippedRows + ')');
  out.push('ИТОГО: совпало ' + tot.ok + ', совпало без даты ' + tot.weak + ', с неверной суммой ' + tot.amt + ', нет в таблице ' + tot.missing + ', лишних в таблице ' + tot.extra);
  Logger.log(out.join('\n'));
}

// Совпадение даты строки таблицы с датой занятия: точная дата, диапазон «10-11.10.2026» или пустая дата.
function dayMatch_(text, dateStr) {
  if (text === '') return 'weak';
  if (text.indexOf(dateStr) >= 0) return 'strong';
  var p = dateStr.split('.'), day = +p[0], mon = +p[1], yr = +p[2];
  var m = /(\d{1,2})\s*[-–]\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(text);
  if (m && +m[4] === yr && +m[3] === mon && day >= +m[1] && day <= +m[2]) return 'strong';
  return null;
}

function dateText_(v) {
  return v instanceof Date ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd.MM.yyyy') : String(v).trim();
}
