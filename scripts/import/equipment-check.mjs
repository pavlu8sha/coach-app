// Проверка заказов экипировки ПЕРЕД записью (только чтение, чистые функции).
// Ловит последствия записи по устаревшему номеру строки (#277): заказ у чужого игрока, дубли, расхождение с эталонной копией.
import { parseRegistry } from './registry.mjs';
import { parseSeason } from './equipment.mjs';

const norm = s => String(s || '').toLowerCase().replace(/[^a-zа-яё0-9]+/gi, ' ').trim().split(' ').sort().join(' ');
const FIELDS = ['player_ext', 'inscription', 'number', 'total', 'paid', 'kit_text'];

// season, baseline — разобранные заказы (parseSeason), registry — players из parseRegistry.
// Возвращает { errors, warnings, diffs }: errors блокируют запись, warnings — на решение владельца.
export function checkEquipment({ season, registry, baseline }) {
  const errors = [], warnings = [], diffs = [];
  const names = new Map(registry.map(p => [p.external_id, p.full_name]));
  const seen = new Map();
  for (const o of season) {
    if (!o.ext_id) { errors.push({ row: o.src_row, kind: 'нет ID заказа' }); continue; }
    if (seen.has(o.ext_id)) errors.push({ row: o.src_row, ord: o.ext_id, kind: `дубль ID заказа (строка ${seen.get(o.ext_id)})` });
    seen.set(o.ext_id, o.src_row);
    if (!names.has(o.player_ext)) { errors.push({ row: o.src_row, ord: o.ext_id, kind: `ID игрока ${o.player_ext || '—'} нет в реестре` }); continue; }
    // ФИ в заказе и ФИ владельца ID в реестре должны совпадать: расхождение — признак заказа «у чужого игрока»
    if (o.name && norm(o.name) !== norm(names.get(o.player_ext))) {
      warnings.push({ row: o.src_row, ord: o.ext_id, kind: 'ФИ в заказе не совпадает с реестром', order: o.name, registry: names.get(o.player_ext), id: o.player_ext });
    }
    if (o.paid - o.total > 0.005) warnings.push({ row: o.src_row, ord: o.ext_id, kind: 'оплачено больше суммы', total: o.total, paid: o.paid });
  }
  if (baseline) {
    const base = new Map(baseline.map(o => [o.ext_id, o]));
    for (const o of season) {
      const b = base.get(o.ext_id);
      if (!b) { diffs.push({ ord: o.ext_id, kind: 'нет в эталоне' }); continue; }
      for (const f of FIELDS) if (String(o[f] ?? '') !== String(b[f] ?? '')) diffs.push({ ord: o.ext_id, field: f, current: o[f], baseline: b[f] });
    }
    for (const b of baseline) if (!seen.has(b.ext_id)) diffs.push({ ord: b.ext_id, kind: 'есть в эталоне, нет в текущем' });
  }
  return { errors, warnings, diffs };
}

export { parseSeason, parseRegistry };
