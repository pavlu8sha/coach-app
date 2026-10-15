/** Статистика посещаемости: считает по листам месяцев, ничего не записывает. */

// Порог «низкой посещаемости», %: настройка stats.lowPct (Settings.js), по умолчанию 50.

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

function blockStats_(name, hdr, rows) {
  var cols = [], c;
  for (c = CONFIG.FIRST_DATE_COL - 1; c < CONFIG.LAST_DATE_COL; c++) { if (dayOf(hdr[c]) !== null) cols.push(c); } // столбцы C:T
  var pl = rows.filter(function (r) { return String(r[1]).trim() !== ''; });
  var held = cols.filter(function (k) { return pl.some(function (r) { return r[k] === true; }); });
  var sessions = held.map(function (k) {
    return { day: dayOf(hdr[k]), present: pl.filter(function (r) { return r[k] === true; }).length };
  });
  var list = pl.map(function (r) {
    var a = held.filter(function (k) { return r[k] === true; }).length;
    return {
      name: String(r[1]).trim(), attended: a, total: held.length,
      pct: held.length ? Math.round(a * 1000 / held.length) / 10 : null
    };
  });
  var att = list.reduce(function (s, x) { return s + x.attended; }, 0);
  var poss = pl.length * held.length;
  return {
    name: name, players: pl.length, trainings: held.length, possible: poss, attended: att,
    pct: poss ? Math.round(att * 1000 / poss) / 10 : null, sessions: sessions, list: list
  };
}

function appStats(pin, month) {
  checkAny_(pin);
  var sheet = sheetOf_(month);
  if (!sheet) throw new Error('Нет листа ' + month);
  var data = sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 2), CONFIG.LAST_DATE_COL).getValues();
  var groups = [], i = 0, j, rows;
  while (i < data.length - 1) {
    if (String(data[i][0]).trim() && String(data[i + 1][0]).trim() === '№') {
      j = i + 2; rows = [];
      while (j < data.length && norm(data[j][0]) !== norm(CONFIG.END_MARKER)) { rows.push(data[j]); j++; }
      groups.push(blockStats_(String(data[i][0]).trim(), data[i + 1], rows));
      i = j;
    }
    i++;
  }
  var T = { groups: groups.length, players: 0, trainings: 0, possible: 0, attended: 0 };
  groups.forEach(function (g) {
    T.players += g.players; T.trainings += g.trainings; T.possible += g.possible; T.attended += g.attended;
  });
  T.pct = T.possible ? Math.round(T.attended * 1000 / T.possible) / 10 : null;
  return { month: month, threshold: settingGet_('stats.lowPct'), groups: groups, totals: T };
}