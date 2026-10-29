// Сверка заказов экипировки: лист (СЕЗОН.csv) против выгрузки из новой базы (только чтение, чистые функции).
// Ключ — ID заказа (ORD-xxxx). База считается эталоном только до даты миграции: заказы и оплаты после неё дадут расхождения.
import { parseCsv } from './registry.mjs';

// Выгрузка из базы: ord,player_ext,inscription,number,installment,total,paid,location,lines; lines = JSON [{"kit","size","quantity"}]
export function parseDbExport(text) {
  const [head, ...rows] = parseCsv(text).filter(r => r.some(x => String(x).trim()));
  const H = head.map(h => h.trim());
  return rows.map(r => {
    const o = Object.fromEntries(H.map((h, i) => [h, (r[i] ?? '').trim()]));
    return {
      ext_id: o.ord, player_ext: o.player_ext, inscription: o.inscription || null, number: o.number || null,
      installment: o.installment === 't' || o.installment === 'true', total: Number(o.total) || 0, paid: Number(o.paid) || 0,
      lines: o.lines ? JSON.parse(o.lines).map(l => ({ kit: String(l.kit).trim(), size: String(l.size ?? '').trim() || null, quantity: Number(l.quantity) || 1 })) : [],
    };
  });
}

const sig = lines => lines.map(l => `${l.kit}|${l.size || ''}|${l.quantity}`).sort().join('; ');
const same = (a, b) => String(a ?? '') === String(b ?? '');

// sheet — parseSeason().orders, db — parseDbExport(). Возвращает расхождения по ID заказа.
export function compareWithDb(sheet, db) {
  const dbById = new Map(db.map(o => [o.ext_id, o]));
  const diffs = [], onlySheet = [], seen = new Set();
  for (const s of sheet) {
    const d = dbById.get(s.ext_id);
    if (!d) { onlySheet.push(s.ext_id); continue; }
    seen.add(s.ext_id);
    const cmp = [
      ['player_ext', s.player_ext, d.player_ext], ['inscription', s.inscription, d.inscription], ['number', s.number, d.number],
      ['installment', s.installment, d.installment], ['kit', sig(s.lines), sig(d.lines)],
    ];
    for (const [field, a, b] of cmp) if (!same(a, b)) diffs.push({ ord: s.ext_id, field, sheet: a, db: b });
    if (Math.abs(s.total - d.total) > 0.005) diffs.push({ ord: s.ext_id, field: 'total', sheet: s.total, db: d.total });
    if (Math.abs(s.paid - d.paid) > 0.005) diffs.push({ ord: s.ext_id, field: 'paid', sheet: s.paid, db: d.paid });
  }
  const onlyDb = db.filter(o => !seen.has(o.ext_id)).map(o => o.ext_id);
  return { diffs, onlySheet, onlyDb };
}
