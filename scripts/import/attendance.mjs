// Посещаемость: листы месяцев (08.26, 09.26, ...) и «Журнал посещаемости». Чистые функции, без сети.
// Правила (подтверждены владельцем): листы месяцев — основа; «Журнал посещаемости» (ЖУРНАЛ ПОСЕЩАЕМОСТИ.csv) приоритетнее листа:
// при расхождении берётся отметка журнала, а отметки, которых в листе нет (в том числе целый день), дописываются из журнала (29.10).
// Тренировка = день, где у группы есть хотя бы одна галочка; в такой день FALSE = «отсутствовал».
// Время начала — из расписания (слот «Групповая» для группы и дня недели).
import { parseCsv } from './registry.mjs';
import { resolveName } from './events-plan.mjs';
import { guestExt } from './individual.mjs';

// Дети, которые есть в листе августа, но не в реестре (подтверждено владельцем): заводятся как неактивные игроки GUEST-…
export const FORMER = ['Bayter Aivi', 'Caregorodcev Lev', 'Dmitriev Nikita', 'Litvinov Bogdan', 'Fedotov Adam', 'Fedotov Shon'];
// Дети из листов, которых пока нет в реестре; владелец добавит их после перехода (29.10). Их отметки не импортируются и импорт не останавливают.
// Любое другое имя вне реестра по-прежнему останавливает запись.
export const DEFERRED = ['Orudzhov Ali', 'Orudzhov Kinan'];
// Время тренировок, которых нет ни в расписании, ни в журнале тренировок (сообщено владельцем)
export const TIME_FIX = {
  '2026-08-22|U13-A': '18:45',
  '2026-08-29|U13-A': '18:45', '2026-08-29|U13-B': '17:30', '2026-08-29|U13-C': '17:30', // U13-B и U13-C занимались вместе в 17:30–18:45
};
// Даты в листах, записанные со сдвигом на день (подтверждено владельцем): исходная дата|группа → верная дата
export const DATE_FIX = {
  '2026-08-30|U13-A': '2026-08-29', '2026-08-30|U13-B': '2026-08-29', '2026-08-30|U13-C': '2026-08-29',
  '2026-09-27|U13-B': '2026-09-26', '2026-09-27|U13-C': '2026-09-26',
};
// Дни, где в листе стоят отметки, но это не тренировка: 20.09 у U13-A был матч чемпионата (E-087), тренировки не было
export const NOT_TRAINING = new Set(['2026-09-20|U13-A']);

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
  // время начала: расписание группы, затем журнал тренировок, затем поправка владельца
  const timesFor = (group, date) => {
    let times = slots.get(`${group}|${weekdayOf(date)}`);
    if (!times && logSlots.has(`${group}|${date}`)) { times = logSlots.get(`${group}|${date}`); fromLog++; }
    if (!times && TIME_FIX[`${date}|${group}`]) times = new Set([TIME_FIX[`${date}|${group}`]]);
    return times ?? null;
  };
  const excluded = [], shifted = [];
  const allDays = new Set();
  const sessions = [], marks = [], unmatched = new Map(), deferred = new Map(), problems = [], skipped = [], noSlot = [], manySlots = [];
  const resolved = new Map(); // имя из листа → игрок
  const former = new Map();
  const resolve = name => {
    if (resolved.has(name)) return resolved.get(name);
    const f = FORMER.find(x => norm(x) === norm(name));
    if (f) { const p = { external_id: guestExt(f), full_name: f }; former.set(p.external_id, p); resolved.set(name, p); return p; }
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
    for (const d0 of parsed.sessions) {
      if (NOT_TRAINING.has(`${d0.date}|${d0.group}`)) { excluded.push(`${d0.date} ${d0.group}`); continue; }
      const fixed = DATE_FIX[`${d0.date}|${d0.group}`];
      const d = fixed ? { ...d0, date: fixed } : d0;
      if (fixed) shifted.push(`${d0.date} → ${fixed} ${d0.group}`);
      const times = timesFor(d.group, d.date);
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
        if (!p) {
          if (DEFERRED.some(x => norm(x) === norm(m.name))) deferred.set(m.name, (deferred.get(m.name) || 0) + 1);
          else unmatched.set(m.name, (unmatched.get(m.name) || 0) + 1);
          continue;
        }
        marks.push({ group_name: d.group, source_key, external_id: p.external_id, name: p.full_name, status: m.present ? 'present' : 'absent' });
      }
    }
  }
  // Журнал приоритетнее листа: расхождение — берём отметку журнала; отметка (или день), которых нет в листе, — дописываем из журнала
  const journal = journalText ? parseJournal(journalText) : [];
  const markAt = new Map(marks.map(m => [`${m.group_name}|${m.source_key.slice(4)}|${m.external_id}`, m]));
  const sessionAt = new Map(sessions.map(x => [`${x.group_name}|${x.date}`, x]));
  const sheetDays = allDays;
  const journalPresentDays = new Set(journal.filter(x => x.present).map(x => `${x.group}|${x.date}`)); // день без единого «присутствовал» в журнале тренировкой не считаем
  const disagree = [], journalOnly = [], journalSkipped = [];
  let both = 0, agree = 0;
  for (const j of journal) {
    if (NOT_TRAINING.has(`${j.date}|${j.group}`)) continue;
    const p = j.external_id ? registryPlayers.find(x => x.external_id === j.external_id) : null;
    const rp = p ?? byName.get(resolveName(j.name, names)?.name);
    const fp = rp ? null : FORMER.find(x => norm(x) === norm(j.name));
    const id = rp?.external_id ?? (fp ? guestExt(fp) : j.external_id);
    const who = rp ? { external_id: rp.external_id, full_name: rp.full_name } : fp ? { external_id: guestExt(fp), full_name: fp } : null;
    const k = `${j.group}|${j.date}|${id}`;
    const have = markAt.get(k);
    if (have) {
      both++;
      if ((have.status === 'present') === j.present) { agree++; continue; }
      disagree.push(`${j.date} ${j.group} ${j.name}: журнал «${j.present ? 'был' : 'не был'}», лист «${have.status === 'present' ? 'был' : 'не был'}» → берём журнал`);
      have.status = j.present ? 'present' : 'absent';
      continue;
    }
    const desc = `${j.date} ${j.group} ${j.name}${sheetDays.has(`${j.group}|${j.date}`) ? '' : ' (дня нет в листе)'}`;
    if (!who) { journalSkipped.push(`${desc}: игрока нет в реестре`); continue; }
    let sess = sessionAt.get(`${j.group}|${j.date}`);
    if (!sess) {
      if (!journalPresentDays.has(`${j.group}|${j.date}`)) { journalSkipped.push(`${desc}: в журнале за этот день никто не присутствовал`); continue; }
      const times = timesFor(j.group, j.date);
      if (!times) { journalSkipped.push(`${desc}: нет времени занятия`); continue; }
      sess = { group_name: j.group, source_key: `ATT|${j.date}`, date: j.date, starts_at: `${j.date}T${[...times].sort()[0]}:00${TZ}` };
      sessions.push(sess); sessionAt.set(`${j.group}|${j.date}`, sess);
    }
    if (fp) former.set(who.external_id, { external_id: who.external_id, full_name: who.full_name });
    const m = { group_name: j.group, source_key: sess.source_key, external_id: who.external_id, name: who.full_name, status: j.present ? 'present' : 'absent' };
    marks.push(m); markAt.set(k, m);
    journalOnly.push(desc);
  }
  return {
    excluded, shifted, dupSame, fromLog, former: [...former.values()], sessions, marks, unmatched: [...unmatched].map(([name, n]) => ({ name, n })), deferred: [...deferred].map(([name, n]) => ({ name, n })), problems, skipped, noSlot, manySlots,
    journal: { rows: journal.length, both, agree, disagree, journalOnly, journalSkipped },
  };
}
