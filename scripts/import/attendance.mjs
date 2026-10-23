// Посещаемость: листы месяцев (08.26, 09.26, ...) и «Журнал посещаемости». Чистые функции, без сети.
// Правила (подтверждены владельцем): главный источник — листы месяцев; журнал — только для сверки.
// Тренировка = день, где у группы есть хотя бы одна галочка; в такой день FALSE = «отсутствовал».
// Время начала — из расписания (слот «Групповая» для группы и дня недели).
import { parseCsv } from './registry.mjs';
import { resolveName } from './events-plan.mjs';

const TZ = '+04:00'; // Тбилиси, без перехода на летнее время
const norm = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
const isDigits = s => /^\d+$/.test(String(s || '').trim());

// Лист месяца → дни тренировок: [{date, group, marks:[{name, present}]}]
export function parseMonthSheet(text, month, year) {
  const rows = parseCsv(text);
  const days = new Map(); // `${date}|${group}` → { date, group, marks }
  const skipped = []; // дни без единой галочки
  const problems = [];
  let group = null, cols = null;
  const seen = new Map();
  let dupSame = 0; // повтор строки ребёнка с той же отметкой — безвредный дубль в листе
  rows.forEach((r0, n) => {
    const r = r0.slice(0, 26); // дальше справа служебная сводка
    if (n < 3 || !r.length) return;
    if ((r[0] || '').trim() === '№') {
      cols = r.map((c, i) => [i, String(c).trim()]).filter(([i, c]) => i >= 2 && isDigits(c));
      return;
    }
    const first = (r[0] || '').trim();
    if (first && !isDigits(first) && !(r[1] || '').trim() && first !== 'ИТОГ ГРУППЫ') { group = first; cols = null; return; }
    if (!isDigits(first) || !group || !cols || !(r[1] || '').trim()) return;
    const name = r[1].trim();
    for (const [i, c] of cols) {
      const v = String(r[i] || '').trim().toUpperCase();
      if (v !== 'TRUE' && v !== 'FALSE') continue;
      const date = `${year}-${month}-${c.padStart(2, '0')}`;
      const key = `${date}|${group}`;
      const day = days.get(key) || { date, group, marks: [] };
      const dupKey = `${key}|${norm(name)}`;
      if (seen.has(dupKey)) {
        if (seen.get(dupKey) !== (v === 'TRUE')) problems.push({ line: n + 1, error: `повтор ребёнка с другой отметкой: ${name} (${group}, ${date})` });
        else dupSame++;
        continue;
      }
      seen.set(dupKey, v === 'TRUE');
      day.marks.push({ name, present: v === 'TRUE' });
      days.set(key, day);
    }
  });
  const sessions = [];
  for (const d of days.values()) {
    if (d.marks.some(m => m.present)) sessions.push(d);
    else skipped.push({ date: d.date, group: d.group });
  }
  return { sessions, skipped, problems, dupSame, allDays: [...days.keys()] };
}

// «Журнал посещаемости»: Запись ID, Дата, ID игрока, ФИ, Группа, Локация, Статус, Тренер, Комментарий, Источник
export function parseJournal(text) {
  const out = [];
  for (const r of parseCsv(text)) {
    if (!(r[0] || '').startsWith('ATT-')) continue;
    const m = String(r[1]).trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!m) continue;
    out.push({ date: `${m[3]}-${m[2]}-${m[1]}`, external_id: (r[2] || '').trim(), name: (r[3] || '').trim(), group: (r[4] || '').trim(), present: (r[6] || '').trim() === 'Присутствовал', source: (r[9] || '').trim() });
  }
  return out;
}

// Группы, которые покрывает подпись журнала тренировок: «U13-B/C» → U13-B, U13-C
export function labelGroups(label) {
  const m = String(label || '').trim().match(/^(U\d+-)([A-Z](?:\/[A-Z])+)$/);
  return m ? m[2].split('/').map(x => m[1] + x) : [String(label || '').trim()];
}

// День недели 1..7 (пн..вс) по ISO-дате
export const weekdayOf = iso => { const d = new Date(iso + 'T00:00:00Z').getUTCDay(); return d === 0 ? 7 : d; };

// План: сессии и отметки + всё, что нужно показать владельцу
// sheets: [{ text, month: '09', year: '2026' }]; schedule: строки parseSchedule; registryPlayers: parseRegistry().players
export function buildAttendancePlan({ sheets, journalText, schedule, registryPlayers, trainingLog = [] }) {
  const names = registryPlayers.map(p => p.full_name);
  const byName = new Map(registryPlayers.map(p => [p.full_name, p]));
  const slots = new Map(); // `${group}|${weekday}` → [HH:MM]
  for (const s of schedule) {
    if (s.kind !== 'Групповая') continue;
    const k = `${s.group_name}|${s.weekday}`;
    if (!slots.has(k)) slots.set(k, new Set());
    slots.get(k).add(s.starts_at);
  }
  const logSlots = new Map(); // `${group}|${date}` → [HH:MM] из журнала тренировок
  for (const r of trainingLog) for (const g of labelGroups(r.group_label)) {
    const k = `${g}|${r.held_on}`;
    if (!logSlots.has(k)) logSlots.set(k, new Set());
    logSlots.get(k).add(r.starts_at);
  }
  let dupSame = 0, fromLog = 0;
  const allDays = new Set();
  const sessions = [], marks = [], unmatched = new Map(), problems = [], skipped = [], noSlot = [], manySlots = [];
  const resolved = new Map(); // имя из листа → игрок
  const resolve = name => {
    if (resolved.has(name)) return resolved.get(name);
    const r = resolveName(name, names);
    const p = r ? byName.get(r.name) : null;
    resolved.set(name, p || null);
    return p || null;
  };
  const sessionKeys = new Set();
  for (const sh of sheets) {
    const parsed = parseMonthSheet(sh.text, sh.month, sh.year);
    problems.push(...parsed.problems);
    skipped.push(...parsed.skipped);
    dupSame += parsed.dupSame;
    for (const k of parsed.allDays) allDays.add(k.replace(/^(\d{4}-\d{2}-\d{2})\|(.*)$/, '$2|$1'));
    for (const d of parsed.sessions) {
      let times = slots.get(`${d.group}|${weekdayOf(d.date)}`);
      if (!times && logSlots.has(`${d.group}|${d.date}`)) { times = logSlots.get(`${d.group}|${d.date}`); fromLog++; }
      if (!times) { noSlot.push(`${d.date} ${d.group}`); continue; }
      const t = [...times].sort();
      if (t.length > 1) manySlots.push(`${d.date} ${d.group}: ${t.join(', ')}`);
      const source_key = `ATT|${d.date}`;
      const key = `${d.group}|${source_key}`;
      if (sessionKeys.has(key)) { problems.push({ error: `повтор тренировки ${d.group} ${d.date}` }); continue; }
      sessionKeys.add(key);
      sessions.push({ group_name: d.group, source_key, date: d.date, starts_at: `${d.date}T${t[0]}:00${TZ}` });
      for (const m of d.marks) {
        const p = resolve(m.name);
        if (!p) { unmatched.set(m.name, (unmatched.get(m.name) || 0) + 1); continue; }
        marks.push({ group_name: d.group, source_key, external_id: p.external_id, name: p.full_name, status: m.present ? 'present' : 'absent' });
      }
    }
  }
  // Сверка с журналом (только чтение)
  const journal = journalText ? parseJournal(journalText) : [];
  const sheetMark = new Map(marks.map(m => [`${m.group_name}|${m.source_key.slice(4)}|${m.external_id}`, m.status === 'present']));
  const sheetDays = allDays;
  const disagree = [], journalOnly = [];
  let both = 0, agree = 0;
  for (const j of journal) {
    const id = j.external_id || (byName.get(resolveName(j.name, names)?.name)?.external_id);
    const k = `${j.group}|${j.date}|${id}`;
    if (sheetMark.has(k)) { both++; if (sheetMark.get(k) === j.present) agree++; else disagree.push(`${j.date} ${j.group} ${j.name}: журнал «${j.present ? 'был' : 'не был'}», лист «${sheetMark.get(k) ? 'был' : 'не был'}»`); }
    else journalOnly.push(`${j.date} ${j.group} ${j.name}${sheetDays.has(`${j.group}|${j.date}`) ? '' : ' (дня нет в листе)'}`);
  }
  return {
    dupSame, fromLog, sessions, marks, unmatched: [...unmatched].map(([name, n]) => ({ name, n })), problems, skipped, noSlot, manySlots,
    journal: { rows: journal.length, both, agree, disagree, journalOnly },
  };
}
