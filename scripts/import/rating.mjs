// Рейтинг: правила начисления (docs/RATING_SPEC.md) и расчёт начислений по истории. Чистые функции, без сети.
// Числа — стартовые из спецификации, их правит клуб. Нулевые правила нужны для объяснения («пропуск не снижает баллы»),
// начислений по ним нет.
export const RULES = [
  { code: 'attendance_present', points: 1, explanation: 'Пришёл на тренировку' },
  { code: 'attendance_excused', points: 0, explanation: 'Пропуск по уважительной причине не снижает баллы' },
  { code: 'attendance_absent', points: 0, explanation: 'Пропуск без причины: без штрафа' },
  { code: 'match_played', points: 2, explanation: 'Участие в матче' },
  { code: 'match_win', points: 3, explanation: 'Победа команды в матче' },
  { code: 'match_draw', points: 1, explanation: 'Ничья в матче' },
];

// rulesByCode: { code: { id, points, explanation } }
// sessions: [{ id, starts_at }]; attendance: [{ session_id, player_id, status }]
// matches: [{ id, played_on, goals_for, goals_against }]; matchPlayers: [{ match_id, player_id, played }]
export function computeEvents({ rulesByCode, sessions, attendance, matches, matchPlayers }) {
  const need = ['attendance_present', 'match_played', 'match_win', 'match_draw'];
  for (const c of need) if (!rulesByCode[c]) throw new Error('Нет правила ' + c);
  const events = [];
  const add = (code, player_id, source_type, source_id, occurred_on) => {
    const r = rulesByCode[code];
    if (!r.points) return;
    events.push({ player_id, rule_id: r.id, points: r.points, source_type, source_id, occurred_on, explanation: r.explanation, code });
  };
  // дата тренировки — по времени Тбилиси (+04:00), не по UTC
  const dayOf = iso => { const d = new Date(new Date(iso).getTime() + 4 * 3600 * 1000); return d.toISOString().slice(0, 10); };
  const sessDay = new Map(sessions.map(s => [s.id, dayOf(s.starts_at)]));
  for (const a of attendance) {
    if (a.status !== 'present') continue;
    const day = sessDay.get(a.session_id);
    if (day) add('attendance_present', a.player_id, 'session', a.session_id, day);
  }
  const mInfo = new Map(matches.map(m => [m.id, m]));
  for (const mp of matchPlayers) {
    if (!mp.played) continue;
    const m = mInfo.get(mp.match_id);
    if (!m) continue;
    add('match_played', mp.player_id, 'match', m.id, m.played_on);
    if (m.goals_for != null && m.goals_against != null) {
      if (m.goals_for > m.goals_against) add('match_win', mp.player_id, 'match', m.id, m.played_on);
      else if (m.goals_for === m.goals_against) add('match_draw', mp.player_id, 'match', m.id, m.played_on);
    }
  }
  return events;
}

export function summarize(events) {
  const byRule = {}, byPlayer = new Map();
  for (const e of events) {
    byRule[e.code] = byRule[e.code] || { n: 0, points: 0 };
    byRule[e.code].n++; byRule[e.code].points += e.points;
    byPlayer.set(e.player_id, (byPlayer.get(e.player_id) || 0) + e.points);
  }
  return { byRule, byPlayer, total: events.reduce((s, e) => s + e.points, 0) };
}
