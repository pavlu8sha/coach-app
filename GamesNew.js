/** Новый раздел «Игры» (только чтение): разбор листа «Игры» из таблицы 1Cf4.
 *  Одна игра занимает несколько строк (тренер и оператор): дата, команда, соперник и счёт есть в первой строке,
 *  в следующих эти ячейки пустые. Техническая победа («технарь») засчитывается как победа. */

// Кириллические А, В, С в названиях команд приводим к латинским: «U9-А» → «U9-A»
function gnTeam_(s) {
  return String(s || '').trim().replace(/А/g, 'A').replace(/В/g, 'B').replace(/С/g, 'C');
}

// Голы из текста: «Grabarenko-3, Zinchenko, Автогол - 1» → [{name, n}, ...]; «-» и пусто — голов нет
function gnGoals_(s) {
  var t = String(s || '').trim();
  if (!t || t === '-') return [];
  return t.split(',').map(function (part) {
    var p = part.trim(), m = /^(.*?)\s*[-–]?\s*(\d+)$/.exec(p);
    var name = m ? m[1].trim() : p, n = m ? Number(m[2]) : 1;
    name = name.replace(/[-–]\s*$/, '').trim();
    return name ? { name: name, n: n } : null;
  }).filter(Boolean);
}

// Счёт: «3:6» → [3, 6]; «технарь» → техническая победа (счёта нет, засчитываем 3:0 только в статистике побед)
function gnScore_(s) {
  var t = String(s || '').trim();
  if (/технар|техническ/i.test(t)) return { tech: true, gf: null, ga: null };
  var m = /^(\d+)\s*[:\-]\s*(\d+)$/.exec(t);
  return m ? { tech: false, gf: Number(m[1]), ga: Number(m[2]) } : { tech: false, gf: null, ga: null };
}

// rows — значения листа «Игры» (строка 0 — заголовки). Возвращает { matches: [...] }.
function gnParseGames_(rows) {
  var matches = [], cur = null;
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    var date = String(r[0] || '').trim(), team = gnTeam_(r[1]), opp = String(r[2] || '').trim();
    var staff = String(r[5] || '').trim(), role = String(r[6] || '').trim(), reg = String(r[7] || '').trim();
    if (!date && !team && !opp && !staff) continue;          // пустая строка-разделитель
    // Игра одна и та же, пока совпадают дата, команда, соперник, счёт и голы (строки тренера и оператора)
    var key = [date || (cur ? cur.date : ''), team, opp, String(r[3] || '').trim(), String(r[4] || '').trim()].join('|');
    if (team && (!cur || key !== cur.key)) {                  // новая игра
      var sc = gnScore_(r[3]);
      cur = { key: key, date: date || (cur ? cur.date : ''), team: team, opp: opp, tech: sc.tech, gf: sc.gf, ga: sc.ga,
              goals: gnGoals_(r[4]), staff: [] };
      matches.push(cur);
    }
    if (cur && staff) cur.staff.push({ name: staff, role: role, reg: reg === 'Да' });
  }
  return { matches: matches };
}

// Результат для статистики: 'W' (победа, в т. ч. техническая), 'D', 'L' или '' (счёта нет)
function gnResult_(m) {
  if (m.tech) return 'W';
  if (m.gf === null || m.ga === null) return '';
  return m.gf > m.ga ? 'W' : (m.gf === m.ga ? 'D' : 'L');
}

// ---- Тренировки и статистика за месяц (только чтение) ----

// Таблица 1Cf4: листы «Игры» и «Тренировки». Пока только чтение; запись будет в AdminApp.
var GN_FILE_ID = '1Cf4jRMEh8078EcMuzcrpUnPyB1g9_XdDzulxSOC3vC4';

function gnStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd.MM.yyyy');
  return v === null || v === undefined ? '' : String(v);
}

function gnValues_(name) {
  var sh = SpreadsheetApp.openById(GN_FILE_ID).getSheetByName(name);
  if (!sh) throw new Error('В таблице нет листа «' + name + '»');
  return sh.getDataRange().getValues().map(function (r) { return r.map(gnStr_); });
}

// Месяц в формате «MM.yyyy» из даты «dd.MM.yyyy»
function gnMonthOf_(date) { return String(date).slice(3, 10); }

// Тренировки: строка — дата, день, тренер (C), локация, группа, тип, начало, конец, часы (I), проведено (J)
function gnParseTrainings_(rows) {
  var out = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!String(r[0] || '').trim()) continue;
    out.push({ date: String(r[0]).trim(), trainer: String(r[2] || '').trim(),
      hours: Number(String(r[8] || '0').replace(',', '.')) || 0, held: String(r[9] || '').trim() === 'Да' });
  }
  return out;
}

// Сравнение дат «dd.MM.yyyy»
function gnSortDate_(a, b) {
  var x = a.split('.'), y = b.split('.');
  return (x[2] + x[1] + x[0]) < (y[2] + y[1] + y[0]) ? -1 : ((x[2] + x[1] + x[0]) > (y[2] + y[1] + y[0]) ? 1 : 0);
}

// Статистика по тренерам за месяц (месяц «MM.yyyy»; пусто — все месяцы)
function gnStats_(games, trainings, month) {
  var st = {};
  function row(name) { return st[name] = st[name] || { trainer: name, trainings: 0, hours: 0, asTrainer: 0, asOperator: 0, parts: 0, reg: 0, tr: [], gm: [] }; }
  trainings.forEach(function (t) {
    if (!t.held || (month && gnMonthOf_(t.date) !== month)) return;
    var x = row(t.trainer); x.trainings++; x.hours += t.hours;
    x.tr.push({ date: t.date, group: t.group, hours: t.hours });
  });
  games.forEach(function (m) {
    if (month && gnMonthOf_(m.date) !== month) return;
    m.staff.forEach(function (s) {
      var x = row(s.name); x.parts++;
      if (/тренер/i.test(s.role)) x.asTrainer++; else if (/оператор/i.test(s.role)) x.asOperator++;
      if (s.reg) x.reg++;
      x.gm.push({ date: m.date, team: m.team, opp: m.opp, tech: m.tech, gf: m.gf, ga: m.ga, role: s.role, reg: s.reg });
    });
  });
  return Object.keys(st).sort().map(function (k) {
    var x = st[k];
    x.hours = Math.round(x.hours * 100) / 100;
    x.pct = x.parts ? Math.round(x.reg / x.parts * 100) : null;
    x.tr.sort(function (a, b) { return gnSortDate_(a.date, b.date); });
    x.gm.sort(function (a, b) { return gnSortDate_(a.date, b.date); });
    return x;
  });
}

// Для админа: игры и статистика за месяц
function appGamesData(pin, month) {
  checkAdmin_(pin);
  var games = gnParseGames_(gnValues_('Игры')).matches;
  var trainings = gnParseTrainings_(gnTrainingsRows_());
  var m = month || '';
  return {
    games: games.filter(function (g) { return !m || gnMonthOf_(g.date) === m; }),
    stats: gnStats_(games, trainings, m)
  };
}

// ---- Тренировки в таблице 1Cf4 (лист «Тренировки») ----

var GN_TR_HEAD = ['Дата', 'День недели', 'Тренер', 'Локация', 'Группа', 'Тип тренировки', 'Начало', 'Конец', 'Часы', 'Проведено'];
var GN_WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

// Лист «Тренировки» в таблице 1Cf4 (он уже существует)
function gnTrainingsSheet_() {
  var sh = SpreadsheetApp.openById(GN_FILE_ID).getSheetByName('Тренировки');
  if (!sh) throw new Error('В таблице 1Cf4 нет листа «Тренировки»');
  return sh;
}

// Все строки листа «Тренировки» (с заголовком), для статистики
function gnTrainingsRows_() { return gnValues_('Тренировки'); }

// Часы из времени начала и конца: «17:00» и «18:30» → 1.5
function gnHours_(start, end) {
  var a = /^(\d{1,2}):(\d{2})$/.exec(String(start || '')), b = /^(\d{1,2}):(\d{2})$/.exec(String(end || ''));
  if (!a || !b) return 0;
  return Math.round(((+b[1] * 60 + +b[2]) - (+a[1] * 60 + +a[2])) / 6) / 10;
}

// Добавить тренировку (только админ). Дата в формате «dd.MM.yyyy».
function appTrainingAdd(pin, o) {
  checkAdmin_(pin);
  if (!/^\d{2}\.\d{2}\.\d{4}$/.test(String(o.date || ''))) throw new Error('Дата в формате дд.мм.гггг');
  if (!String(o.trainer || '').trim()) throw new Error('Укажите тренера');
  var p = o.date.split('.'), wd = GN_WEEKDAYS[new Date(+p[2], +p[1] - 1, +p[0]).getDay()];
  var hours = gnHours_(o.start, o.end);
  if (CONFIG.DRY_RUN) return { dryRun: true, hours: hours };
  var sh = gnTrainingsSheet_(), r = sh.getLastRow() + 1;
  sh.getRange(r, 1, 1, 10).setNumberFormat('@').setValues([[o.date, wd, String(o.trainer).trim(), String(o.location || ''),
    String(o.group || ''), String(o.type || ''), String(o.start || ''), String(o.end || ''), String(hours).replace('.', ','), o.held === false ? 'Нет' : 'Да']]);
  logChange_('', '', 'тренировка (раздел Игры)', '', o.date + ' ' + o.trainer + ' ' + (o.group || ''));
  return { ok: true, row: r, hours: hours };
}

// ---- Страница «Учёт» (только админ): месяцы, тренировки месяца ----

// Месяцы, по которым есть игры или тренировки, по возрастанию
function appAccountMonths(pin) {
  checkAdmin_(pin);
  var set = {};
  gnParseGames_(gnValues_('Игры')).matches.forEach(function (m) { set[gnMonthOf_(m.date)] = 1; });
  gnTrainingsRows_().slice(1).forEach(function (r) { if (/^\d{2}\.\d{2}\.\d{4}$/.test(r[0])) set[gnMonthOf_(r[0])] = 1; });
  return Object.keys(set).filter(Boolean).sort(function (a, b) {
    var x = a.split('.'), y = b.split('.');
    return (x[1] + x[0]) < (y[1] + y[0]) ? -1 : ((x[1] + x[0]) > (y[1] + y[0]) ? 1 : 0);
  });
}

// Тренировки месяца для таблицы на странице
function appTrainingsList(pin, month) {
  checkAdmin_(pin);
  return gnParseTrainings_(gnTrainingsRows_()).filter(function (t) {
    return !month || gnMonthOf_(t.date) === month;
  });
}
