/** Перенос файла матчей в плоские таблицы МАТЧИ и УЧАСТИЕ (версия 1). Запускается из редактора скриптов. */

var G_SKIP = ['U9', 'Newton cup | 2014-2015 | 14.06'];  // устаревшие вкладки
var G_YEAR = 2026;
// Взнос за чемпионат при переносе — из настройки matches.champFee (Settings.js); не задан — без взноса.
var IMP_SHEET = 'ИМПОРТ ИГРОКОВ';

function translit2_(s) {
  var HG = { 'а': 'a', 'в': 'b', 'е': 'e', 'к': 'k', 'м': 'm', 'н': 'h', 'о': 'o', 'р': 'p', 'с': 'c', 'т': 't', 'у': 'y', 'х': 'x' };
  var M = { 'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e', 'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'i', 'к': 'k',
    'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts',
    'ч': 'ch', 'ш': 'sh', 'щ': 'sh', 'ы': 'y', 'э': 'e', 'ю': 'iu', 'я': 'ia', 'ь': '', 'ъ': '' };
  return String(s).split(/\s+/).map(function (w) {
    w = w.toLowerCase();
    var mixed = /[a-z]/.test(w) && /[а-яё]/.test(w); // латиница с кириллической «х» и т.п.
    return w.replace(/[а-яё]/g, function (c) { return mixed ? (HG[c] || c) : (M[c] !== undefined ? M[c] : c); });
  }).join(' ');
}

// Ключ имени: слова в алфавитном порядке, чтобы не зависеть от порядка «Имя Фамилия».
function nameKey2_(s) { return translit2_(s).replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(String).sort().join(' '); }

function lev2_(a, b) {
  var prev = [], cur, i, j;
  for (j = 0; j <= b.length; j++) prev[j] = j;
  for (i = 1; i <= a.length; i++) {
    cur = [i];
    for (j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

var _gamesFile = null;   // файл матчей открываем один раз за запуск
function gamesFile_() {
  return clubSource_('GAMES_ID', 'Не задано свойство GAMES_ID (ID файла матчей)');
}

function gDate_(s) {
  var m = /^(\d{1,2})\.(\d{1,2})$/.exec(String(s).trim());
  return m ? { d: Number(m[1]), m: Number(m[2]) } : null;
}

// G_YEAR = год начала сезона; месяцы января–июня относятся ко второй половине сезона (следующий год).
function gSerial_(dm) {
  var y = dm.m < 7 ? G_YEAR + 1 : G_YEAR;
  return Math.round((Date.UTC(y, dm.m - 1, dm.d) - Date.UTC(1899, 11, 30)) / 86400000);
}

// Красная заливка = игрок не участвует.
function isRed_(hex) {
  var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  if (!m) return false;
  var r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  return r > 180 && r - g > 40 && r - b > 40;
}

// Разбор вкладки: строка 1 — подписи (даты, «Festival», «Championship N»), строка 2 — «Paid» или «Played».
function parseGames_(sh, team) {
  var rg = sh.getDataRange(), V = rg.getValues(), D = rg.getDisplayValues(), n = V.length, w = D[0].length;
  var bg = sh.getRange(1, 2, n, 1).getBackgrounds();
  var row1 = D[0], row2 = D[1], events = [], cur = null, red = 0, unclear = 0, players = [], c, i;
  for (i = 2; i < n; i++) {
    var nm = String(V[i][1]).trim();
    if (!nm || String(V[i][0]).trim() === '' || isNaN(Number(V[i][0]))) continue;
    var isr = isRed_(bg[i][0]);
    if (isr) red++;
    players.push({ i: i, name: nm, red: isr });
  }
  function add(o) { o.team = team; events.push(o); return o; }
  for (c = 2; c < w; c++) {
    var K = String(row2[c]).trim(), L = String(row1[c]).trim(), dm = gDate_(L);
    var nk = c + 1 < w ? String(row2[c + 1]).trim() : '', nl = c + 1 < w ? String(row1[c + 1]).trim() : '';
    if (K !== 'Played' && K !== 'Paid') continue;
    if (dm) {
      if (nl === '' && ((K === 'Played' && nk === 'Paid') || (K === 'Paid' && nk === 'Played'))) {
        add({ type: 'Товарищеская', name: 'Товарищеская игра', date: dm, playedCol: K === 'Played' ? c : c + 1, paidCol: K === 'Paid' ? c : c + 1, parent: null });
        c++;
      } else if (K === 'Played') {
        add({ type: cur ? 'Игра' : 'Товарищеская', name: cur ? cur.name : 'Товарищеская игра', date: dm, playedCol: c, parent: cur });
      } else {
        add({ type: 'Кубок', name: 'Кубок', date: dm, paidCol: c, parent: null });
      }
    } else if (K === 'Paid') {
      var name = L || (c === 2 ? String(row1[0]).trim() : '');
      if (!name || /перерыв/i.test(name)) continue;
      var type = /festival/i.test(name) ? 'Фестиваль' : (/championship/i.test(name) ? 'Чемпионат' : 'Турнир');
      cur = add({ type: type, name: name, date: null, paidCol: c, parent: null });
    }
  }
  if (!events.length && gDate_(row1[0])) { // вкладка одного турнира (кубок): дата в A1, столбец Paid
    for (c = 2; c < w; c++) {
      if (String(row2[c]).trim() === 'Paid') { add({ type: 'Кубок', name: sh.getName(), date: gDate_(row1[0]), paidCol: c, parent: null }); break; }
    }
  }
  events.forEach(function (e) {
    e.rows = [];
    players.forEach(function (p) {
      if (p.red) return;
      var pv = e.playedCol === undefined ? '' : V[p.i][e.playedCol], fv = e.paidCol === undefined ? '' : V[p.i][e.paidCol];
      if (typeof pv === 'number' || typeof fv === 'number') unclear++;
      var played = pv === true ? true : (pv === false ? false : null);
      var paid = fv === true ? true : (fv === false ? false : null);
      if (e.paidCol === undefined) { if (played !== true) return; }
      else if (played === null && paid === null) return;
      e.rows.push({ name: p.name, played: played, paid: paid });
    });
  });
  return { events: events, players: players.length, red: red, unclear: unclear };
}

function parseAllGames_() {
  var out = [], notes = [];
  gamesFile_().getSheets().forEach(function (sh) {
    var nm = sh.getName();
    if (G_SKIP.indexOf(nm) >= 0) { notes.push('Пропущена устаревшая вкладка ' + nm); return; }
    var team = /newton/i.test(nm) ? nm : nm.replace(/\s*friendly\s*$/i, '').trim();
    var r = parseGames_(sh, team);
    r.events.forEach(function (e) { out.push(e); });
    notes.push(nm + ': событий ' + r.events.length + ', игроков в списке ' + r.players + ', красных строк (не участвуют) ' + r.red + ', клеток с числами вместо TRUE/FALSE ' + r.unclear);
  });
  return { events: out, notes: notes };
}

// ШАГ 1. Создаёт лист «ИМПОРТ ИГРОКОВ» для проверки соответствия имён реестру.
function importMatchesPreview_() {
  var res = parseAllGames_(), reg = readRegistry_().players;
  var keys = reg.map(function (p) { return nameKey2_(p.name); });
  var seen = {}, order = [];
  res.events.forEach(function (e) {
    e.rows.forEach(function (x) {
      var k = nameKey2_(x.name);
      if (!seen[k]) { seen[k] = { name: x.name, teams: {} }; order.push(k); }
      seen[k].teams[e.team] = true;
    });
  });
  var rows = order.map(function (k) {
    var d = reg.map(function (p, j) { return { p: p, d: lev2_(k, keys[j]) }; }).sort(function (a, b) { return a.d - b.d; });
    var best = d[0];
    return [seen[k].name, best.d <= 2 ? best.p.name : '', best.d === 0 ? 'точно' : (best.d <= 2 ? 'похоже' : 'выберите вручную'),
      d.slice(0, 3).map(function (x) { return x.p.name; }).join(' / '), Object.keys(seen[k].teams).join(', '), best.d];
  });
  rows.sort(function (a, b) { return (a[2] === 'выберите вручную' ? 0 : 1) - (b[2] === 'выберите вручную' ? 0 : 1) || b[5] - a[5]; });
  if (CONFIG.DRY_RUN) {
    Logger.log('DRY_RUN: предпросмотр рассчитан, но лист «' + IMP_SHEET + '» не создан и не изменён. Уникальных имён: ' + rows.length + ', событий: ' + res.events.length + '.');
    return;
  }
  var ss = adminSS_(), sh = ss.getSheetByName(IMP_SHEET);
  if (sh && sh.getLastRow() > 1) throw new Error('Лист «' + IMP_SHEET + '» уже есть, в нём может быть ваш выбор имён. Удалите лист вручную, если нужно пересоздать.');
  sh = sh || ss.insertSheet(IMP_SHEET);
  sh.clear();
  sh.getRange(1, 1, 1, 5).setValues([['Имя в файле матчей', 'Игрок в реестре (выберите из списка)', 'Совпадение', 'Подсказки', 'Команды']]);
  if (rows.length) {
    sh.getRange(2, 1, rows.length, 5).setValues(rows.map(function (r) { return r.slice(0, 5); }));
    var names = readRegistry_().players.map(function (p) { return p.name; });
    var rule = SpreadsheetApp.newDataValidation().requireValueInList(names, true).setAllowInvalid(false).build();
    sh.getRange(2, 2, rows.length, 1).setDataValidation(rule);
  }
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 220); sh.setColumnWidth(2, 260); sh.setColumnWidth(4, 360);
  var lines = res.notes.slice();
  res.events.forEach(function (e) { lines.push(e.team + ' | ' + e.type + ' | ' + e.name + ' | ' + (e.date ? e.date.d + '.' + e.date.m : '-') + ' | записей ' + e.rows.length); });
  Logger.log(lines.join('\n') + '\n\nУникальных имён: ' + rows.length + ', из них без автосовпадения: ' +
    rows.filter(function (r) { return r[2] === 'выберите вручную'; }).length);
}

// ШАГ 2. Создаёт листы МАТЧИ и УЧАСТИЕ по проверенному соответствию имён.
function importMatchesCommit_() {
  var ss = adminSS_(), mp = ss.getSheetByName(IMP_SHEET);
  if (!mp) throw new Error('Сначала запустите importMatchesPreview_ и проверьте лист «' + IMP_SHEET + '»');
  if (ss.getSheetByName('МАТЧИ') || ss.getSheetByName('УЧАСТИЕ')) throw new Error('Листы МАТЧИ или УЧАСТИЕ уже есть: перенос уже выполнялся');
  var byName = {}, map = {};
  readRegistry_().players.forEach(function (p) { byName[norm(p.name)] = p; });
  if (mp.getLastRow() > 1) {
    mp.getRange(2, 1, mp.getLastRow() - 1, 2).getValues().forEach(function (r) {
      var p = byName[norm(r[1])];
      if (String(r[0]).trim() && p) map[nameKey2_(r[0])] = p;
    });
  }
  var res = parseAllGames_(), ev = [], pr = [], skipped = {}, n = 0;
  res.events.forEach(function (e) { e.id = 'E-' + ('000' + (++n)).slice(-3); });
  res.events.forEach(function (e) {
    var cfee = e.type === 'Чемпионат' ? settingGet_('matches.champFee', e.team) : null;
    var fee = cfee === null ? '' : cfee;
    ev.push([e.id, e.team, e.type, e.name, e.date ? gSerial_(e.date) : '', fee, e.parent ? e.parent.id : '']);
    e.rows.forEach(function (x) {
      var p = map[nameKey2_(x.name)];
      if (!p) { skipped[x.name] = true; return; }
      pr.push([e.id, p.id, p.name, x.played === null ? '' : x.played, '', x.paid === null ? '' : x.paid, (x.paid === true && fee) ? fee : '', '', '', '']);
    });
  });
  var lost = Object.keys(skipped);
  Logger.log('Событий: ' + ev.length + ', записей участия: ' + pr.length + '. Не перенесены (нет игрока в реестре): ' + (lost.length ? lost.join(', ') : 'нет'));
  if (CONFIG.DRY_RUN) { Logger.log('Пробный режим (DRY_RUN = true): ничего не записано.'); return; }
  var s1 = null, s2 = null;
  try {
    s1 = ss.insertSheet('МАТЧИ');
    s2 = ss.insertSheet('УЧАСТИЕ');
    s1.getRange(1, 1, 1, 7).setValues([['ID', 'Команда', 'Тип', 'Название', 'Дата', 'Взнос ₾', 'Турнир (ID)']]);
    s2.getRange(1, 1, 1, 10).setValues([['Событие', 'ID игрока', 'ФИ', 'Играл', 'За команду', 'Взнос оплачен', 'Сумма ₾', 'Способ', 'Дата оплаты', 'Комментарий']]);
    if (ev.length) {
      s1.getRange(2, 1, ev.length, 7).setValues(ev);
      nfSafe_(s1.getRange(2, 5, ev.length, 1), 'dd.mm.yyyy');
    }
    if (pr.length) s2.getRange(2, 1, pr.length, 10).setValues(pr);
    s1.setFrozenRows(1); s2.setFrozenRows(1);
  } catch (e) {
    [s1, s2].forEach(function (s) { if (s) { try { ss.deleteSheet(s); } catch (ignore) {} } });
    throw e;
  }
  logChange_('', '', 'перенос файла матчей', '', 'событий ' + ev.length + ', записей участия ' + pr.length);
}

/** Перенос «Championship 1» U9 из старого файла: два турнира (U9-A и U9-B). Записи — только в u9Champ1Apply. */

function u9Champ1Plan_() {
  var sh = gamesFile_().getSheetByName('U9');
  if (!sh) throw new Error('в старом файле нет листа U9');
  var d = sh.getDataRange().getDisplayValues();
  var reg = {};
  readRegistry_().players.forEach(function (p) { reg[nameKey2_(p.name)] = p; });
  var plans = [];
  for (var r = 0; r < d.length; r++) {
    var team = String(d[r][1]).trim();
    if (!/^U9-[AB]$/.test(team) || String(d[r][2]).trim() !== 'Championship 1') continue;
    var games = [];
    for (var c = 3; c < d[r].length; c++) {
      var dm = String(d[r][c]).trim();
      if (!/^\d{2}\.\d{2}$/.test(dm)) break;
      games.push({ c: c, dm: dm, iso: '2026-' + dm.slice(3, 5) + '-' + dm.slice(0, 2) });
    }
    var players = [], unknown = [];
    for (var i = r + 2; i < d.length; i++) {
      var nm = String(d[i][1]).trim();
      if (!nm || /^U9-/.test(nm)) break;
      var key = nm.toLowerCase();
      if (U9_SKIP_.indexOf(key) >= 0) continue;
      var p = reg[nameKey2_(U9_ALIAS_[key] || nm)];
      var rec = {
        name: nm, id: p ? p.id : '', paid: d[i][2] === 'TRUE',
        played: games.map(function (g) { return d[i][g.c] === 'TRUE'; })
      };
      if (!p) unknown.push(nm);
      players.push(rec);
    }
    plans.push({ team: team, games: games, players: players, unknown: unknown });
  }
  return plans;
}

var U9_SKIP_ = ['pashkin denis'];
var U9_ALIAS_ = {
  'ganakova varya': 'Ganakova Varvara',
  'cherkasov misha': 'Cherkasov Mikhail',
  'sechko ilya': 'Siachko Ilia',
  'grichshenikov sergey': 'Grichshenkov Sergey',
  'grichshenikov mikhail': 'Grichshenkov Misha',
  'german gio': 'German Georgiy'
};

function u9Champ1Preview_() {
  var out = [];
  u9Champ1Plan_().forEach(function (p) {
    out.push(p.team + ': игр ' + p.games.length + ' (' + p.games.map(function (g) { return g.dm; }).join(', ') +
      '), игроков ' + p.players.length + ', оплатили ' + p.players.filter(function (x) { return x.paid; }).length);
    if (p.unknown.length) out.push('  НЕ НАЙДЕНЫ в реестре: ' + p.unknown.join(', '));
  });
  Logger.log(out.join('\n'));
  return out.join('\n');
}

function u9Champ1Apply_() {
  if (CONFIG.DRY_RUN) return 'DRY_RUN включён: ничего не записано';
  var log = [];
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    u9Champ1Plan_().forEach(function (p) {
      var tid = addEventCore_({ type: 'Чемпионат', team: p.team, name: 'Championship 1' }, true).id;
      log.push(p.team + ': турнир ' + tid);
      var known = p.players.filter(function (x) { return x.id; });
      if (known.length) {
        try { addParticipantsCore_(tid, known.map(function (x) { return x.id; })); }
        catch (e) { log.push('  состав: ' + e.message); }
      }
      p.games.forEach(function (g, gi) {
        var gid = addEventCore_({ type: 'Игра', parent: tid, date: g.iso }, true).id;
        var marks = known.filter(function (x) { return x.played[gi]; })
          .map(function (x) { return { id: x.id, name: x.name, played: true, goals: 0, ft: '' }; });
        if (marks.length) saveGame2Core_(gid, marks, {});
        log.push('  игра ' + g.dm + ' (' + gid + '): сыграли ' + marks.length);
      });
    });
  } finally {
    lock.releaseLock();
  }
  cacheDropBig_('md_v2');
  logChange_('', '', 'перенос U9 Championship 1 из старого файла', '', log.join('; '));
  Logger.log(log.join('\n'));
  return log.join('\n');
}