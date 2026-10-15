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

// Счёт: «3:6» → [3, 6]; «1:2 (пен.)» → [1, 2] (пояснение в скобках не учитывается);
// «технарь» → техническая победа (счёта нет, засчитываем 3:0 только в статистике побед)
function gnScore_(s) {
  var t = String(s || '').trim();
  if (/технар|техническ/i.test(t)) return { tech: true, gf: null, ga: null };
  var m = /^(\d+)\s*[:\-]\s*(\d+)$/.exec(t.replace(/\(.*?\)/g, '').trim());
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
    var h = Number(String(r[8] || '0').replace(',', '.')) || 0;
    out.push({ date: String(r[0]).trim(), trainer: String(r[2] || '').trim(), location: String(r[3] || '').trim(),
      group: String(r[4] || '').trim() || String(r[5] || '').trim(), type: String(r[5] || '').trim(),
      start: String(r[6] || '').trim(), end: String(r[7] || '').trim(),
      hours: Math.round(h * 100) / 100,                                 // таблица хранит часы с погрешностью вида 0,9999…
      held: String(r[9] || '').trim() === 'Да' });
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

// ---- Справочники для форм (только чтение) ----

// Колонки листа «Справочники»: A тренеры, B локации, C группы, D типы тренировок
function appTrainingOptions(pin) {
  checkAdmin_(pin);
  var rows = gnValues_('Справочники');
  function col(i) {
    var seen = {}, out = [];
    rows.slice(1).forEach(function (r) {
      var v = String(r[i] || '').trim();
      if (v && !seen[v]) { seen[v] = 1; out.push(v); }
    });
    return out;
  }
  return { trainers: col(0), locations: col(1), groups: col(2), types: col(3) };
}

// День недели (0 — вс) из даты «дд.мм.гггг»
function gnWeekday_(date) {
  var p = String(date).split('.');
  return new Date(+p[2], +p[1] - 1, +p[0]).getDay();
}

// ---- Расписание сезона 2026-2027 (источник для дневного расписания) ----
// wd: 0 — вс, 1 — пн, … 6 — сб. Каждая тренировка с двумя тренерами записывается двумя строками.
var GN_SEASON = [
  [1,'Красный парк','16:00','17:00','U7-А/В','Групповая',['Дима','Руслан']],
  [1,'Красный парк','16:45','18:00','U9-А/В','Групповая',['Дима','Руслан']],
  [1,'Красный парк','17:45','19:00','U11','Групповая',['Паша','Руслан']],
  [2,'Красный парк','15:45','17:15','U13-B/C','Групповая',['Соприк','Цотне']],
  [2,'Красный парк','17:00','18:30','U10-A/В','Групповая',['Паша','Цотне']],
  [2,'Красный парк','18:15','20:00','U13-A','Групповая',['Соприк','Паша']],
  [3,'Красный парк','16:00','16:45','U7-А/В','Групповая',['Дима','Руслан']],
  [3,'Красный парк','16:30','17:45','U9-А/В','Групповая',['Дима','Руслан']],
  [3,'Красный парк','17:30','19:00','U11','Групповая',['Паша','Руслан']],
  [4,'Красный парк','15:45','17:00','U13-B/C','Групповая',['Соприк','Цотне']],
  [4,'Красный парк','16:45','18:00','U10-A/В','Групповая',['Паша','Цотне']],
  [4,'Красный парк','17:45','19:00','U13-A','Групповая',['Соприк','Паша']],
  [5,'Красный парк','16:00','16:45','U7-А/В','Групповая',['Дима','Руслан']],
  [5,'Красный парк','16:30','17:45','U9-А/В','Групповая',['Дима','Руслан']],
  [5,'Красный парк','17:30','19:00','U11','Групповая',['Паша','Руслан']],
  [6,'Красный парк','16:00','17:00','Weekends','Групповая',['Руслан','Цотне']],
  [6,'Красный парк','16:45','18:00','U13-B','Групповая',['Соприк','Цотне']],
  [6,'Красный парк','17:45','19:00','U13-C','Групповая',['Цотне','Соприк']],
  [6,'Красный парк','19:00','20:00','Индивидуальные','Индивидуальная',['Гио','Соприк']],
  [0,'Красный парк','16:00','17:00','Weekends','Групповая',['Руслан','Цотне']],
  [0,'Красный парк','16:45','18:00','U10-A/В','Групповая',['Паша','Цотне']],
  [0,'Красный парк','18:00','19:00','Индивидуальные','Индивидуальная',['Гио','Паша']],
  [0,'Красный парк','19:00','20:00','Вратари','Вратарская',['Антон','Гио']],
  [1,'Чиковани','18:00','19:30','U13-A','Групповая',['Соприк']],
  [1,'Исани','16:30','17:30','Исани U7','Групповая',['Гио']],
  [3,'Исани','16:30','17:30','Исани U7','Групповая',['Гио']],
  [5,'Исани','16:30','17:30','Исани U7','Групповая',['Гио']],
  [2,'Ортачала','15:00','15:50','Ortachala U9','Групповая',['Гио']],
  [2,'Ортачала','15:50','17:00','Ortachala U12','Групповая',['Гио']],
  [4,'Ортачала','15:00','15:50','Ortachala U9','Групповая',['Гио']],
  [4,'Ортачала','15:50','17:00','Ortachala U12','Групповая',['Гио']],
  [6,'Ортачала','10:00','10:50','Ortachala U9','Групповая',['Гио']],
  [6,'Ортачала','10:50','12:00','Ortachala U12','Групповая',['Гио']]
].map(function (x) { return { wd: x[0], loc: x[1], start: x[2], end: x[3], group: x[4], type: x[5], trainers: x[6] }; });

// Дата из календаря «гггг-мм-дд» или текст «дд.мм.гггг» → «дд.мм.гггг»
function gnDmy_(v) {
  var s = String(v || '').trim();
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? m[3] + '.' + m[2] + '.' + m[1] : s;
}

// Тренировки на выбранную дату по расписанию сезона; статус — из уже внесённых строк
function appDailySchedule(pin, date) {
  checkAdmin_(pin);
  date = gnDmy_(date);
  if (!/^\d{2}\.\d{2}\.\d{4}$/.test(date)) throw new Error('Дата в формате дд.мм.гггг');
  var wd = gnWeekday_(date);
  var done = {};
  gnParseTrainings_(gnTrainingsRows_()).forEach(function (t) {
    if (t.date === date && t.held) { var k = t.group + '|' + t.start; (done[k] = done[k] || []).push(t.trainer); }
  });
  return GN_SEASON.filter(function (x) { return x.wd === wd; }).map(function (x) {
    var rec = done[x.group + '|' + x.start] || [];
    return { loc: x.loc, start: x.start, end: x.end, group: x.group, type: x.type, trainers: x.trainers,
      status: rec.length ? 'done' : 'open', recorded: rec };
  });
}

// Добавить тренера к уже записанной тренировке: пишется только он; повтора не будет
function appAddTrainerDaily(pin, o) {
  checkAdmin_(pin);
  var date = gnDmy_(o.date), tr = String(o.trainer || '').trim();
  if (!tr) throw new Error('Выберите тренера');
  var already = gnParseTrainings_(gnTrainingsRows_()).some(function (t) {
    return t.date === date && t.held && t.group === o.group && t.start === o.start && t.trainer === tr;
  });
  if (already) return { ok: true, exists: true };
  if (gnMarkHeld_(date, o.group, o.start, tr)) return { ok: true, written: 1 };
  appTrainingAdd(pin, { date: date, trainer: tr, location: o.loc, group: o.group, type: o.type,
    start: o.start, end: o.end, held: true });
  return { ok: true, written: 1 };
}

// Замена тренеров у записанной тренировки: меняются имена в её строках по порядку;
// количество тренеров не меняется (добавление делается отдельной кнопкой)
function appTrainingReplaceTrainers(pin, o) {
  checkAdmin_(pin);
  var date = gnDmy_(o.date), names = (o.trainers || []).map(function (x) { return String(x || '').trim(); });
  if (!names.length || names.some(function (x) { return !x; })) throw new Error('Выберите тренеров');
  if (names.some(function (x, i) { return names.indexOf(x) !== i; })) throw new Error('Тренер выбран дважды');
  var sh = gnTrainingsSheet_(), vals = sh.getDataRange().getValues(), rowsNo = [];
  for (var i = 1; i < vals.length; i++) {
    var r = vals[i];
    if (String(r[0]).trim() === date && String(r[9] || '').trim() === 'Да' &&
        (String(r[4] || '').trim() || String(r[5] || '').trim()) === o.group && String(r[6] || '').trim() === o.start) rowsNo.push(i + 1);
  }
  if (rowsNo.length !== names.length) throw new Error('В записи тренеров: ' + rowsNo.length + ', выбрано: ' + names.length + '. Количество меняется кнопкой «+ тренер».');
  if (CONFIG.DRY_RUN) return { ok: true, dryRun: true };
  rowsNo.forEach(function (rowNo, k) { sh.getRange(rowNo, 3).setValue(names[k]); });
  logChange_('', '', 'замена тренеров (раздел Игры)', date + ' ' + o.group + ' ' + o.start, names.join(', '));
  return { ok: true, changed: rowsNo.length };
}

// Отмечает «Да» у заготовленной строки листа «Тренировки» (дата, группа, время и тренер совпадают, отметки ещё нет).
// Возвращает true, если строка нашлась. Так отметка ложится на ту же строку, а не дописывается внизу листа.
function gnMarkHeld_(date, group, start, trainer) {
  var sh = gnTrainingsSheet_(), vals = sh.getDataRange().getValues(), tz = Session.getScriptTimeZone();
  var cell = function (v) { return v instanceof Date ? Utilities.formatDate(v, tz, 'dd.MM.yyyy') : String(v || '').trim(); };
  for (var i = 1; i < vals.length; i++) {
    var r = vals[i];
    if (cell(r[0]) === date && (cell(r[4]) || cell(r[5])) === group && cell(r[6]) === start &&
        cell(r[2]) === trainer && cell(r[9]) !== 'Да') {
      sh.getRange(i + 1, 10).setValue('Да');
      logChange_('', '', 'тренировка (раздел Игры)', '', date + ' ' + trainer + ' ' + group + ' (отметка)');
      return true;
    }
  }
  return false;
}

// Подтверждение «да»: по одной строке на каждого тренера; уже записанную тренировку не дублируем
function appConfirmDaily(pin, o) {
  checkAdmin_(pin);
  var date = gnDmy_(o.date);
  var dup = gnParseTrainings_(gnTrainingsRows_()).some(function (t) {
    return t.date === date && t.held && t.group === o.group && t.start === o.start;
  });
  if (dup) return { ok: true, exists: true };
  var n = 0;
  (o.trainers || []).forEach(function (tr) {
    if (!String(tr || '').trim()) return;
    if (gnMarkHeld_(date, o.group, o.start, String(tr).trim())) { n++; return; }
    appTrainingAdd(pin, { date: date, trainer: tr, location: o.loc, group: o.group, type: o.type,
      start: o.start, end: o.end, held: true });
    n++;
  });
  return { ok: true, written: n };
}
