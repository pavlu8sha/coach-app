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
  // несколько групп в одном месяце: если текущая группа реестра среди них, берём её (как до этой правки), иначе группу первой строки
  for (const [key, groups] of groupsByKey) {
    const s = subs.get(key);
    const regGroup = registry.players.find(p => p.external_id === s.player_ext)?.group_name;
    if (groups.size > 1 && groups.has(regGroup)) s.group = regGroup;
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

const cents = x => Math.round(Number(x) * 100);

// Что записать в журнал платежей. Журнал только добавляется, поэтому сверяем по сумме «игрок × месяц», а не только по ссылке строки:
//   file     — строки листов оплат: { ref, key, amount }, key = «id игрока|ГГГГ-ММ»;
//   existing — уже записанные платежи импорта (legacy_ref «PAY_ID …»): { ref, key, amount }.
// Если новая строка вносит ровно недостающую сумму — пишем её, как раньше. Если в базе уже внесено столько, сколько в файле
// (строку перенесли в другую группу или номер, ссылка сменилась), второй платёж не пишем. Если суммы расходятся иначе
// (строку дополнили или платёж внесён иначе), пишем один платёж-коррекцию на разницу (в том числе отрицательный).
export function planPaymentWrites({ file, existing }) {
  const byKey = rows => { const m = new Map(); for (const r of rows) m.set(r.key, [...(m.get(r.key) ?? []), r]); return m; };
  const fileBy = byKey(file), dbBy = byKey(existing);
  const allRefs = new Set(existing.map(x => x.ref)); // ссылка, уже внесённая под любым ключом (например, имя игрока в ссылке менялось), повторно не пишется
  const inserts = [], covered = [], corrections = [];
  for (const [key, items] of fileBy) {
    const db = dbBy.get(key) ?? [];
    const have = new Set(db.map(x => x.ref));
    const unmatched = items.filter(x => !have.has(x.ref) && !allRefs.has(x.ref));
    const fileTotal = items.reduce((a, x) => a + cents(x.amount), 0);
    const dbTotal = db.reduce((a, x) => a + cents(x.amount), 0);
    const diff = fileTotal - dbTotal;
    const unmatchedSum = unmatched.reduce((a, x) => a + cents(x.amount), 0);
    if (diff === 0) { if (unmatched.length) covered.push({ key, refs: unmatched.map(x => x.ref), amount: unmatchedSum / 100 }); continue; }
    if (diff === unmatchedSum) { inserts.push(...unmatched); continue; }
    const first = items[0];
    const month = key.split('|')[1];
    const c = { ref: `PAY_ID ${month} коррекция ${first.player ?? key.split('|')[0]} до ${fileTotal / 100}`, key, amount: diff / 100, player: first.player, was: dbTotal / 100, now: fileTotal / 100, correction: true };
    inserts.push(c); corrections.push(c);
  }
  return { inserts, covered, corrections };
}
