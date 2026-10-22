// Индивидуальные занятия из листов приложения (AdminApp): ИНДИВИДУАЛЬНЫЕ ЗАНЯТИЯ и ИНДИВИДУАЛЬНЫЕ ОПЛАТЫ (журнал).
// Чистая функция, без сети. Состояние записи — проигрывание журнала по порядку:
// Запись → записан; Оплата → оплачен; Отмена (отмена оплаты) → не оплачен; Снят → запись удалена.
// «Перенос», «Изменено», «Тип» без игрока пропускаются. Ключ занятия — «ГГГГ-ММ-ДД ЧЧ:ММ[ gk]» (без префикса ID).
import { parseCsv } from './registry.mjs';
import { resolveName } from './events-plan.mjs';

export const IND_PRICE = 50;
// Гости (разовые, в клубе не состоят): их нет в реестре, записываются отдельно
export const GUESTS = {
  'gleb': 'Gleb',
  // старые занятия (до сентября): гости из таблицы занятий
  'gordok artem': 'Gordok Artem', 'molchanov dima': 'Molchanov Dima', 'mamedov daniel': 'Mamedov Daniel',
  'reinen': 'Reinen', 'ranen': 'Reinen',
};
// Фамилии старой таблицы занятий, не совпадающие с реестром (подтверждено тренером)
const IND_ALIAS = { 'krivopalov timofei': 'Krivolapov Timofey' };
export const guestExt = name => 'GUEST-' + name.toUpperCase().replace(/[^A-Z]+/g, '-').replace(/^-|-$/g, '');

export const sessionKey = id => String(id || '').split('|').pop().trim();   // "ADM|2026-10-18 18:00" → "2026-10-18 18:00"

export function parseSessionKey(key) {
  const m = key.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})( gk)?$/);
  if (!m) return null;
  const [, yyyy, mm, dd, hh, mi, gk] = m;
  return { key, starts_at: `${yyyy}-${mm}-${dd}T${hh}:${mi}:00`, goalkeepers: !!gk, external_id: `IND-${yyyy}-${mm}-${dd}-${hh}${mi}${gk ? '-GK' : ''}` };
}

// Лист ЗАНЯТИЯ: ID, Дата, Время, Вратари, Тема, Создано
export function parseSessionsSheet(text) {
  return parseCsv(text).slice(1).filter(r => (r[0] || '').trim()).map(r => {
    const info = parseSessionKey(sessionKey(r[0]));
    return info ? { ...info, topic: (r[4] || '').trim() || null } : null;
  }).filter(Boolean);
}

// Журнал ОПЛАТЫ → состояние записей по занятиям
export function replayJournal(text, registryNames) {
  const rows = parseCsv(text).slice(1).filter(r => (r[0] || '').trim());
  const state = new Map();   // key|name → {key, name, guest, booked, paid}
  const problems = [];
  const resolved = new Map();
  const who = raw => {
    const n = (raw || '').trim();
    if (!n) return null;
    if (resolved.has(n)) return resolved.get(n);
    const g = GUESTS[n.toLowerCase()];
    let out;
    if (g) out = { name: g, guest: true, external_id: guestExt(g) };
    else {
      const r = resolveName(n, registryNames);
      out = r ? { name: r.name, guest: false, external_id: null } : null;
      if (!out) problems.push({ error: `игрок не найден в реестре: ${n}` });
    }
    resolved.set(n, out);
    return out;
  };
  for (const r of rows) {
    const type = (r[5] || '').trim(), key = sessionKey(r[1]);
    const name = (r[2] || '').trim();
    if (!name || !['Запись', 'Оплата', 'Отмена', 'Снят'].includes(type)) continue;
    const p = who(name); if (!p) continue;
    const k = key + '|' + p.name;
    const s = state.get(k) || { key, name: p.name, guest: p.guest, external_id: p.external_id, booked: false, paid: false };
    if (type === 'Запись') s.booked = true;
    if (type === 'Оплата') { s.booked = true; s.paid = true; }
    if (type === 'Отмена') s.paid = false;
    if (type === 'Снят') { s.booked = false; s.paid = false; }
    state.set(k, s);
  }
  return { bookings: [...state.values()].filter(s => s.booked), problems };
}

// Блок «Индивидуальные / Вратарские» в файле оплат (лист месяца). Строка = запись; сумма = оплачено.
// Дата в строке, «вр» — вратарская; пустая дата — дата предыдущей строки блока.
// Вратарские в сентябре в файле оплат без отметки «вр» — подтверждено тренером.
// Для 20.09 вторая строка Dzidziguri Matvey — вратарская (первая — индивидуальная).
const GK_NO_MARK = {
  '2026-09-20': { gk: ['Gilichinskiy Shunya', 'Beresnev Fedor'], second_gk: ['Dzidziguri Matvey'] },
  '2026-09-27': { gk: ['Beresnev Fedor', 'Vaksin Lev', 'Kyral Dzhan', 'Gilichinskiy Shunya'] },
};
export function parsePayBlock(text) {
  const rows = parseCsv(text);
  const start = rows.findIndex(r => (r[0] || '').trim() === 'Индивидуальные / Вратарские');
  if (start < 0) return [];
  const out = [];
  let date = null, gk = false;
  const seen = new Map();
  for (const r of rows.slice(start + 2)) {
    const first = (r[0] || '').trim();
    if (!/^\d+$/.test(first)) break;                 // конец блока
    const name = (r[1] || '').trim();
    const m = (r[2] || '').trim().match(/^(\d{2})\.(\d{2})\.(\d{4})(\s+вр)?$/);
    if (m) { date = `${m[3]}-${m[2]}-${m[1]}`; gk = !!m[4]; }
    if (!name || !date) continue;
    let isGk = gk;
    const rule = GK_NO_MARK[date];
    if (rule && !m?.[4]) {
      const n = (seen.get(name) || 0) + 1;
      seen.set(name, n);
      if (rule.gk?.includes(name)) isGk = true;
      if (rule.second_gk?.includes(name)) isGk = n === 2;
    }
    out.push({ date, gk: isGk, name, paid: !!(r[3] || '').trim() });
  }
  return out;
}

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
