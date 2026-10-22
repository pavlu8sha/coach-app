// Индивидуальные занятия из листов приложения (AdminApp): ИНДИВИДУАЛЬНЫЕ ЗАНЯТИЯ и ИНДИВИДУАЛЬНЫЕ ОПЛАТЫ (журнал).
// Чистая функция, без сети. Состояние записи — проигрывание журнала по порядку:
// Запись → записан; Оплата → оплачен; Отмена (отмена оплаты) → не оплачен; Снят → запись удалена.
// «Перенос», «Изменено», «Тип» без игрока пропускаются. Ключ занятия — «ГГГГ-ММ-ДД ЧЧ:ММ[ gk]» (без префикса ID).
import { parseCsv } from './registry.mjs';
import { resolveName } from './events-plan.mjs';

export const IND_PRICE = 50;
// Гости (разовые, в клубе не состоят): их нет в реестре, записываются отдельно
export const GUESTS = { 'gleb': 'Gleb' };
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
