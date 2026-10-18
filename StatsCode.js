/** Статистика посещаемости: считает по листам месяцев за выбранный период, ничего не записывает. */

var LOW_PCT = 50; // порог «низкой посещаемости», %

// Статистику видят и тренеры, и администратор: подходит любой из двух кодов.
function checkAny_(pin) { checkPin_(pin); }

function appStatsMonths(pin) {
  checkAny_(pin);
  return SpreadsheetApp.getActive().getSheets()
    .map(function (s) { return s.getName(); })
    .filter(function (n) { return /^\d{2}\.\d{2}$/.test(n); })
    .sort(function (a, b) {
      return a.split('.').reverse().join('').localeCompare(b.split('.').reverse().join(''));
    });
}

function isoDate_(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s)); }

// Листы месяцев «ММ.ГГ» от месяца from до месяца to включительно (даты 'ГГГГ-ММ-ДД').
function monthsBetween_(from, to) {
  var a = from.split('-'), b = to.split('-');
  var y = Number(a[0]), m = Number(a[1]), ye = Number(b[0]), me = Number(b[1]), out = [];
  while (y < ye || (y === ye && m <= me)) {
    out.push(('0' + m).slice(-2) + '.' + String(y).slice(-2));
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

// Блоки групп листа месяца: название, шапка с числами дней, строки игроков.
function blocksOf_(data) {
  var out = [], i = 0, j, rows;
  while (i < data.length - 1) {
    if (String(data[i][0]).trim() && String(data[i + 1][0]).trim() === '№') {
      j = i + 2; rows = [];
      while (j < data.length && norm(data[j][0]) !== norm(CONFIG.END_MARKER)) { rows.push(data[j]); j++; }
      out.push({ name: String(data[i][0]).trim(), hdr: data[i + 1], rows: rows });
      i = j;
    }
    i++;
  }
  return out;
}

// Статистика по группам за период [from, to]. Занятие считается проведённым, если кто-то отмечен «был».
function appStatsRange(pin, from, to) {
  checkAny_(pin);
  if (!isoDate_(from) || !isoDate_(to) || from > to) throw new Error('Неверный период');
  var months = monthsBetween_(from, to);
  if (months.length > 13) throw new Error('Период слишком большой: не больше 13 месяцев');
  var G = {}, order = [];
  months.forEach(function (m) {
    var sheet = sheetOf_(m);
    if (!sheet) return;
    var data = sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 2), CONFIG.LAST_DATE_COL).getValues();
    var base = '20' + m.slice(3, 5) + '-' + m.slice(0, 2) + '-';
    blocksOf_(data).forEach(function (b) {
      var key = norm(b.name);
      if (!G[key]) { G[key] = { name: b.name, sessions: [], players: {}, plist: [] }; order.push(key); }
      var g = G[key];
      var pl = b.rows.filter(function (r) { return String(r[1]).trim() !== ''; });
      pl.forEach(function (r) {
        var nm = String(r[1]).trim();
        if (!g.players.hasOwnProperty(nm)) { g.players[nm] = 0; g.plist.push(nm); }
      });
      for (var c = CONFIG.FIRST_DATE_COL - 1; c < CONFIG.LAST_DATE_COL; c++) { // столбцы C:T
        var d = dayOf(b.hdr[c]);
        if (d === null) continue;
        var iso = base + ('0' + d).slice(-2);
        if (iso < from || iso > to) continue;
        var present = pl.filter(function (r) { return r[c] === true; });
        if (!present.length) continue;
        g.sessions.push({ iso: iso, present: present.length });
        present.forEach(function (r) { g.players[String(r[1]).trim()]++; });
      }
    });
  });
  var groups = order.map(function (key) {
    var g = G[key];
    var n = g.sessions.length;
    g.sessions.sort(function (a, b) { return a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0; });
    var list = g.plist.map(function (nm) {
      var a = g.players[nm];
      return { name: nm, attended: a, total: n, pct: n ? Math.round(a * 1000 / n) / 10 : null };
    });
    var att = list.reduce(function (s, x) { return s + x.attended; }, 0);
    var poss = list.length * n;
    return {
      name: g.name, players: list.length, trainings: n, possible: poss, attended: att,
      pct: poss ? Math.round(att * 1000 / poss) / 10 : null,
      sessions: g.sessions.map(function (s) { return { day: s.iso.slice(8) + '.' + s.iso.slice(5, 7), present: s.present }; }),
      list: list
    };
  }).filter(function (g) { return g.trainings > 0; });
  var T = { groups: groups.length, players: 0, trainings: 0, possible: 0, attended: 0 };
  groups.forEach(function (g) {
    T.players += g.players; T.trainings += g.trainings; T.possible += g.possible; T.attended += g.attended;
  });
  T.pct = T.possible ? Math.round(T.attended * 1000 / T.possible) / 10 : null;
  return { from: from, to: to, threshold: LOW_PCT, groups: groups, totals: T };
}
