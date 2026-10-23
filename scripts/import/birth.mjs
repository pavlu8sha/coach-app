// Даты рождения: правила как в приложении (Players.js, Cards.js).
// Ручной лист «ДАТЫ РОЖДЕНИЯ» (по ID игрока) важнее колонки «Дата / дата рождения» файлов оплат (по имени; побеждает более поздний месяц).
// Чистые функции, без сети.
import { parseCsv } from './registry.mjs';

const norm = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
const DATE = /^(\d{2})\.(\d{2})\.(\d{4})$/;

// dd.mm.yyyy → ISO или null, если даты не существует
export function isoBirth(s) {
  const m = String(s || '').trim().match(DATE);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.getUTCDate() !== Number(dd) || d.getUTCMonth() + 1 !== Number(mm)) return null;
  return `${yyyy}-${mm}-${dd}`;
}

// ДАТЫ РОЖДЕНИЯ: ID игрока, ФИ, Дата рождения, Изменено
export function parseOverrides(text) {
  const out = new Map(), invalid = [];
  for (const r of parseCsv(text).slice(1)) {
    const id = (r[0] || '').trim(), raw = (r[2] || '').trim();
    if (!id) continue;
    const iso = isoBirth(raw);
    if (iso) out.set(id, iso); else invalid.push(`${id} ${r[1] || ''}: «${raw}»`);
  }
  return { overrides: out, invalid };
}

// Лист оплат месяца: перед строкой «№» стоит название группы; блок «Индивидуальные / вратарские» не читается
export function parsePayBirths(text) {
  const rows = parseCsv(text), out = [];
  let cur = false;
  rows.forEach((r, i) => {
    const a = (r[0] || '').trim();
    if (a === '№') { cur = i > 0 && norm(rows[i - 1][0]) !== 'индивидуальные / вратарские'; return; }
    if (!cur || a === '') return;
    if (Number.isNaN(Number(a))) { cur = false; return; }
    const name = (r[1] || '').trim(), raw = (r[2] || '').trim();
    if (name && DATE.test(raw)) out.push({ name, key: norm(name), raw, iso: isoBirth(raw) });
  });
  return out;
}

// Ожидаемый возраст по группе: «U9-A» → 9, «Ortachala U12» → 12; для остальных (weekends, Isani) — не проверяем
const groupAge = g => { const m = String(g || '').match(/U(\d+)/i); return m ? Number(m[1]) : null; };
const ageOn = (iso, today) => { const [y, m, d] = iso.split('-').map(Number), t = new Date(today); let a = t.getUTCFullYear() - y; if (t.getUTCMonth() + 1 < m || (t.getUTCMonth() + 1 === m && t.getUTCDate() < d)) a--; return a; };

// payFiles: [{ month: '09.26', text }]; registryPlayers: parseRegistry().players
export function buildBirthPlan({ registryPlayers, overridesText = '', payFiles = [], today = '2026-10-23' }) {
  const ov = parseOverrides(overridesText);
  const months = [...payFiles].sort((a, b) => (a.month.slice(3) + a.month.slice(0, 2)).localeCompare(b.month.slice(3) + b.month.slice(0, 2))).reverse(); // новые месяцы первыми
  const fromFile = new Map(); // имя → { iso, month }
  const conflicts = [], badFile = [];
  for (const f of months) for (const e of parsePayBirths(f.text)) {
    if (!e.iso) { badFile.push(`${f.month} ${e.name}: «${e.raw}»`); continue; }
    const had = fromFile.get(e.key);
    if (!had) fromFile.set(e.key, { iso: e.iso, month: f.month, name: e.name });
    else if (had.iso !== e.iso && !conflicts.some(c => c.key === e.key)) conflicts.push({ key: e.key, name: e.name, used: `${had.iso} (${had.month})`, other: `${e.iso} (${f.month})` });
  }
  const byKey = new Map();
  for (const p of registryPlayers) byKey.set(norm(p.full_name), (byKey.get(norm(p.full_name)) || 0) + 1);
  const dupNames = [...byKey].filter(([, n]) => n > 1).map(([k]) => k);
  const assigned = [], missing = [], outliers = [], ovUnknown = [];
  const ids = new Set(registryPlayers.map(p => p.external_id));
  for (const id of ov.overrides.keys()) if (!ids.has(id)) ovUnknown.push(id);
  for (const p of registryPlayers) {
    const o = ov.overrides.get(p.external_id);
    const f = fromFile.get(norm(p.full_name));
    const iso = o || f?.iso || null;
    if (!iso) { missing.push(`${p.external_id} ${p.full_name} (${p.group_name || 'без группы'}, ${p.status})`); continue; }
    assigned.push({ external_id: p.external_id, full_name: p.full_name, birth_date: iso, source: o ? 'вручную' : `файл оплат ${f.month}` });
    const g = groupAge(p.group_name);
    if (g != null) { const a = ageOn(iso, today + 'T00:00:00Z'); if (a > g || a < g - 3) outliers.push(`${p.external_id} ${p.full_name} (${p.group_name}): ${iso}, возраст ${a}`); }
  }
  const registryKeys = new Set(registryPlayers.map(p => norm(p.full_name)));
  const notInRegistry = [...fromFile].filter(([k]) => !registryKeys.has(k)).map(([, v]) => `${v.name} (${v.iso}, ${v.month})`);
  return { assigned, missing, outliers, conflicts, invalidOverrides: ov.invalid, badFile, dupNames, ovUnknown, notInRegistry };
}
