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
