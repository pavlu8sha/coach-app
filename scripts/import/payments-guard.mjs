// Защита импорта оплат от дублей при сдвиге номеров строк в листе (только чистые функции).
// Ключ платежа legacy_ref содержит номер строки игрока в группе («№12»). Если в листе добавили или убрали игрока, номера ниже сдвигаются,
// ключи меняются, и уже внесённые платежи выглядят новыми: деньги задваиваются.
// Признак: «новый» платёж (ключа нет в базе), а в базе уже есть платёж с другим ключом PAY_ID того же игрока, месяца и суммы.

// candidates: [{ ref, player_id, amount, paid_on }] — платежи, которые импорт собирается записать;
// dbPayments: [{ legacy_ref, player_id, amount, paid_on }] — платежи базы с ключом PAY_ID.
export function possibleDuplicates(candidates, dbPayments) {
  const byKey = new Map();
  for (const d of dbPayments) {
    const k = `${d.player_id}|${String(d.paid_on).slice(0, 10)}|${Number(d.amount)}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(d.legacy_ref);
  }
  const out = [];
  for (const c of candidates) {
    const hit = byKey.get(`${c.player_id}|${String(c.paid_on).slice(0, 10)}|${Number(c.amount)}`);
    if (hit?.length) out.push({ ref: c.ref, amount: c.amount, month: String(c.paid_on).slice(0, 7), baseRefs: hit });
  }
  return out;
}
