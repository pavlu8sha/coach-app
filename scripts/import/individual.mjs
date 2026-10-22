// Индивидуальные тренировки (листы IND_ID): занятия и записи с оплатой. Чистая функция, без сети.
// Занятие — один файл: строка 1 «ЧЧ:ММ ДД.ММ.ГГГГ», строка 2 — тема, далее таблица «№ / ФИ / Group / Paid».
import { parseCsv } from './registry.mjs';
import { resolveName } from './events-plan.mjs';

export const IND_PRICE = 50;
// Фамилии, которые не совпадают с реестром: явное соответствие (подтверждено тренером)
const IND_ALIAS = { 'krivopalov timofei': 'Krivolapov Timofey' };
// Гости (разовые, в клубе не состоят). Reinen и Ranen — один человек: записан как Reinen.
export const GUESTS = {
  'gordok artem': 'Gordok Artem', 'molchanov dima': 'Molchanov Dima', 'mamedov daniel': 'Mamedov Daniel',
  'reinen': 'Reinen', 'ranen': 'Reinen',
};
const guestExt = name => 'GUEST-' + name.toUpperCase().replace(/[^A-Z]+/g, '-').replace(/^-|-$/g, '');

// Файл может содержать несколько занятий (разные даты и вратарские блоки): каждый блок — шапка, тема, таблица
export function parseIndividualFile(text, fileName, registryNames) {
  const rows = parseCsv(text);
  const problems = [], sessions = [];
  const isHead = r => /^\d{2}:\d{2}\s+\d{2}\.\d{2}\.\d{4}/.test((r[0] || '').trim());
  const starts = rows.map((r, i) => (isHead(r) ? i : -1)).filter(i => i >= 0);
  if (!starts.length) return { sessions, problems: [{ file: fileName, error: 'не найдена шапка занятия' }] };
  starts.forEach((hi, bi) => {
    const end = starts[bi + 1] ?? rows.length;
    const head = rows[hi][0].trim().match(/^(\d{2}):(\d{2})\s+(\d{2})\.(\d{2})\.(\d{4})(.*)$/);
    const [, hh, mi, dd, mm, yyyy, tail] = head;
    const goalkeepers = /вратар/i.test(tail);
    const topic = (rows[hi + 1]?.[0] || '').trim() || null;
    const th = rows.findIndex((r, k) => k > hi && k < end && (r[0] || '').trim() === '№');
    if (th < 0) { problems.push({ file: fileName, error: `${dd}.${mm}: нет таблицы участников` }); return; }
    const people = new Map();   // полное имя (или GUEST-…) → {name, external_id, guest, paid}
    for (const r of rows.slice(th + 1, end)) {
      const raw = (r[1] || '').trim();
      if (!/^\d+$/.test((r[0] || '').trim()) || !raw) continue;
      const paid = (r[3] || '').trim() === 'TRUE';
      const g = GUESTS[raw.toLowerCase()];
      if (g) { if (!people.has(g)) people.set(g, { name: g, external_id: guestExt(g), guest: true, paid }); else people.get(g).paid ||= paid; continue; }
      const alias = IND_ALIAS[raw.toLowerCase()];
      const res = alias ? { name: alias } : resolveName(raw, registryNames);
      if (!res) { problems.push({ file: fileName, error: `имя не найдено в реестре: ${raw}` }); continue; }
      if (!people.has(res.name)) people.set(res.name, { name: res.name, external_id: null, guest: false, paid });
      else people.get(res.name).paid ||= paid;
    }
    sessions.push({
      external_id: `IND-${yyyy}-${mm}-${dd}-${hh}${mi}${goalkeepers ? '-GK' : ''}`,
      starts_at: `${yyyy}-${mm}-${dd}T${hh}:${mi}:00`, topic: goalkeepers ? (topic ? `Вратари: ${topic}` : 'Вратари') : topic,
      file: fileName, people: [...people.values()],
    });
  });
  return { sessions, problems };
}
