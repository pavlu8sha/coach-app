import { GUESTS, guestExt, parseIndividualFile, parseSessionKey } from './individual.mjs';
import { resolveName } from './events-plan.mjs';

export const MANUAL_TIMES = {
  '2026-09-06': '19:00', '2026-09-12': '18:30', '2026-09-13': '18:00', '2026-09-13 gk': '19:00',
  '2026-09-19': '19:00', '2026-09-20': '18:00', '2026-09-20 gk': '19:00', '2026-09-26': '19:00',
  '2026-09-27': '18:00', '2026-09-27 gk': '19:00', '2026-10-31': '19:00',
};

export function buildIndividualPlan({ registryNames, payRows, sessionsSheet, journalBookings, oldFiles = [] }) {
  const problems = [];
  const times = new Map();
  for (const s of sessionsSheet) times.set(s.key.slice(0, 10) + (s.goalkeepers ? ' gk' : ''), s);
  for (const b of journalBookings) {
    const k = b.key.slice(0, 10) + (b.key.endsWith(' gk') ? ' gk' : '');
    if (!times.has(k)) times.set(k, parseSessionKey(b.key));
  }
  const topics = new Map(sessionsSheet.map(s => [s.key.slice(0, 10) + (s.goalkeepers ? ' gk' : ''), s.topic]));

  const sessMap = new Map();
  for (const r of payRows) {
    const k = r.date + (r.gk ? ' gk' : '');
    const info = times.get(k) ?? (MANUAL_TIMES[k] ? { starts_at: `${r.date}T${MANUAL_TIMES[k]}:00` } : null);
    if (!info) problems.push({ error: `нет времени занятия ${k}` });
    const sid = `IND-${r.date.replace(/-/g, '-')}${r.gk ? '-GK' : ''}`;
    if (!sessMap.has(sid)) sessMap.set(sid, { external_id: sid, starts_at: info ? info.starts_at : null, topic: topics.get(k) ?? null, people: new Map() });
    const sess = sessMap.get(sid);
    const g = GUESTS[r.name.toLowerCase()];
    const pname = g ?? resolveName(r.name, registryNames)?.name;
    if (!pname) { problems.push({ error: `имя не найдено в реестре: ${r.name}` }); continue; }
    const cur = sess.people.get(pname);
    const guest = !!g;
    sess.people.set(pname, { name: pname, guest, external_id: guest ? guestExt(pname) : null, paid: (cur?.paid ?? false) || r.paid });
  }

  for (const f of oldFiles) {
    const r = parseIndividualFile(f.text, f.name, registryNames);
    problems.push(...r.problems);
    for (const os of r.sessions.filter(x => x.starts_at < '2026-09-01')) {
      if (sessMap.has(os.external_id)) { problems.push({ error: `занятие уже есть: ${os.external_id}` }); continue; }
      sessMap.set(os.external_id, { external_id: os.external_id, starts_at: os.starts_at, topic: os.topic, people: new Map(os.people.map(p => [p.name, p])) });
    }
  }

  const sessions = [...sessMap.values()].map(s => ({ ...s, people: [...s.people.values()] }));
  const bookings = sessions.flatMap(s => s.people);
  const guests = [...new Set(bookings.filter(p => p.guest).map(p => p.name))];
  return { sessions, bookings, guests, problems };
}
