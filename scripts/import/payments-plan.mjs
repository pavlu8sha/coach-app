import { parsePayMonth } from './payments.mjs';

const norm = s => String(s).replace(/\s+/g, ' ').trim().toLowerCase();

export const PAY_NAME_ALIAS = { 'kurbanoiv emin': 'kurbanov emin' };
export const PAY_GUESTS = new Set(['gleb']);
export const IND_GROUP = 'Индивидуальные / Вратарские';

export const canon = s => { const k = norm(s); return PAY_NAME_ALIAS[k] ?? k; };

export function buildPaymentsPlan({ registry, files }) {
  const groupNames = new Set(registry.groups.map(g => g.name));
  const months = files.map(f => parsePayMonth(f.text, f.name, groupNames));
  const all = months.flatMap(m => m.rows);
  const regByName = new Map(registry.players.map(p => [norm(p.full_name), p]));

  const unmatched = [...new Set(all
    .filter(r => !PAY_GUESTS.has(norm(r.name)) && !regByName.has(canon(r.name)))
    .map(r => `${r.month.slice(0, 7)} ${r.name}`))];

  const rows = all.filter(r =>
    r.group !== IND_GROUP &&
    !PAY_GUESTS.has(norm(r.name)) &&
    regByName.has(canon(r.name)) &&
    groupNames.has(r.group));

  const subs = new Map();
  const groupsByKey = new Map();
  for (const r of rows) {
    const p = regByName.get(canon(r.name));
    const key = `${p.external_id}|${r.month}`;
    const cur = subs.get(key) || { key, player_ext: p.external_id, month: r.month, group: r.group, amount_due: 0 };
    cur.amount_due += r.paid;
    subs.set(key, cur);
    const groups = groupsByKey.get(key) ?? new Set();
    groups.add(r.group);
    groupsByKey.set(key, groups);
  }
  const ambiguousSubs = [...groupsByKey].filter(([, groups]) => groups.size > 1).map(([key]) => subs.get(key));

  const pays = rows.filter(r => r.paid > 0).map(r => {
    const p = regByName.get(canon(r.name));
    return {
      ref: `PAY_ID ${r.month.slice(0, 7)} ${r.group} №${r.no} ${norm(r.name)}`,
      player_ext: p.external_id,
      month: r.month,
      group: r.group,
      no: r.no,
      name: r.name,
      amount: r.paid,
    };
  });

  return {
    months,
    all,
    rows,
    subs,
    ambiguousSubs,
    pays,
    unmatched,
    missingGroups: [...new Set(all.map(r => r.group).filter(g => !groupNames.has(g)))],
    indRows: all.filter(r => r.group === IND_GROUP).length,
    problems: months.flatMap(m => m.problems),
  };
}
