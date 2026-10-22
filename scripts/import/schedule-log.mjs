// Расписание (лист РАСПИСАНИЕ) и журнал тренировок (лист «Тренировки»). Чистые функции, без сети.
import { parseCsv } from './registry.mjs';

const WEEKDAY = { 'пн': 1, 'вт': 2, 'ср': 3, 'чт': 4, 'пт': 5, 'сб': 6, 'вс': 7 };
const WEEKDAY_FULL = { 'понедельник': 1, 'вторник': 2, 'среда': 3, 'четверг': 4, 'пятница': 5, 'суббота': 6, 'воскресенье': 7 };
const KIND = { 'групповая': 'Групповая', 'индивидуальная': 'Индивидуальная', 'вратарская': 'Вратарская' };
// Кириллические А, В, С в названиях групп → латинские (в листах встречаются оба варианта)
// Только для названий вида U7-А/В: в «Вратари» буква В настоящая кириллица, её не трогаем
export const normGroup = s => {
  const t = String(s || '').trim();
  return /^U\d/i.test(t) ? t.replace(/А/g, 'A').replace(/В/g, 'B').replace(/С/g, 'C') : t;
};
// Индивидуальные и вратарские слоты в расписании — одна группа клуба в файле оплат
export const groupForSlot = name => (/^(Индивидуальные|Вратари)$/i.test(name) ? 'Индивидуальные / Вратарские' : name);
const hhmm = s => { const m = String(s || '').trim().match(/^(\d{1,2}):(\d{2})$/); return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null; };
const iso = s => { const m = String(s || '').trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const hours = s => { const v = Number(String(s || '').trim().replace(',', '.')); return Number.isFinite(v) ? v : null; };

// РАСПИСАНИЕ: День, Локация, Начало, Конец, Группа, Тип, Тренеры, Группы в отметках
export function parseSchedule(text) {
  const problems = [];
  const rows = parseCsv(text).slice(1).filter(r => (r[0] || '').trim());
  const out = [];
  rows.forEach((r, i) => {
    const weekday = WEEKDAY[(r[0] || '').trim().toLowerCase()];
    const starts_at = hhmm(r[2]), ends_at = hhmm(r[3]);
    const kind = KIND[(r[5] || '').trim().toLowerCase()];
    if (!weekday || !starts_at || !kind) { problems.push({ line: i + 2, error: 'не разобрана строка расписания' }); return; }
    let marks = (r[7] || '').split(',').map(normGroup).filter(Boolean);
    if (!marks.length) marks = [groupForSlot(normGroup(r[4]))];
    for (const g of marks) out.push({
      group_name: g, weekday, starts_at, ends_at, location: (r[1] || '').trim() || null,
      coaches: (r[6] || '').trim() || null, kind, label: normGroup(r[4]),
      source_key: `${weekday}|${starts_at}|${normGroup(r[4])}`,
    });
  });
  return { rows: out, problems };
}

// «Тренировки»: Дата, День недели, Тренер, Локация, Группа, Тип тренировки, Начало, Конец, Часы, Проведено
// Одинаковые строки (тот же день, тренер, группа, время) — разные записи: номер вхождения входит в ключ.
// Подтверждено тренером: 17.10 у Соприка и Цотне строка «U13-B/C» — это U13-B (первая) и U13-C (вторая).
const SPLIT_17_10 = { 'Соприк|17:00': ['U13-B', 'U13-C'], 'Цотне|18:00': ['U13-B', 'U13-C'] };
export function parseTrainingLog(text) {
  const problems = [], count = new Map();
  const rows = parseCsv(text).slice(1).filter(r => (r[0] || '').trim());
  const out = [];
  rows.forEach((r, i) => {
    const held_on = iso(r[0]);
    const coach = (r[2] || '').trim();
    let group_label = normGroup(r[4]);
    const kind = KIND[(r[5] || '').trim().toLowerCase()];
    const starts_at = hhmm(r[6]), ends_at = hhmm(r[7]);
    if (!held_on || !coach || !group_label || !kind) { problems.push({ line: i + 2, error: 'не разобрана строка журнала' }); return; }
    const base = `${held_on}|${coach}|${group_label}|${starts_at}`;
    const n = (count.get(base) || 0) + 1;
    count.set(base, n);
    if (held_on === '2026-10-17' && group_label === 'U13-B/C' && SPLIT_17_10[`${coach}|${starts_at}`]) {
      group_label = SPLIT_17_10[`${coach}|${starts_at}`][n - 1];
    }
    out.push({
      external_id: `${held_on}|${coach}|${group_label}|${starts_at}|${n}`, held_on, weekday: (r[1] || '').trim() || null,
      coach, location: (r[3] || '').trim() || null, group_label, kind, starts_at, ends_at,
      hours: hours(r[8]), held: (r[9] || '').trim() !== 'Нет',
    });
  });
  return { rows: out, duplicates: [], problems };
}
