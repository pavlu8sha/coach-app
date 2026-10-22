// Разбор файла оплат за месяц (лист «ОПЛАТЫ • ММ.ГГ» из выгрузки PAY_ID).
// Чистая функция, без сети. Возвращает строки игроков и проблемы.
import { parseCsv } from './registry.mjs';

// «165,00 ₾» → 165 ; пустая ячейка → 0 (не платил / не отмечено)
export function parseAmount(s) {
  const t = String(s || '').replace(/₾/g, '').replace(/ /g, ' ').trim();
  if (!t) return 0;
  if (!/^\d+([.,]\d{1,2})?$/.test(t)) throw new Error('Сумма не распознана: ' + s);
  return Number(t.replace(',', '.'));
}

// «09.26» (из имени файла) → '2026-09-01'
export function monthFromFileName(name) {
  const m = String(name).match(/(\d{2})\.(\d{2})/);
  if (!m) throw new Error('Имя файла должно быть ММ.ГГ: ' + name);
  return `20${m[2]}-${m[1]}-01`;
}

// groups — множество имён групп из реестра. Заголовки локаций (КРАСНЫЙ ПАРК и т.п.)
// в него не входят и просто пропускаются.
export function parsePayMonth(text, fileName, groups) {
  const month = monthFromFileName(fileName);
  const rows = parseCsv(text);
  const out = [];
  const problems = [];
  let group = null;
  rows.forEach((r, i) => {
    const first = (r[0] || '').trim();
    const rest = r.slice(1).some(x => String(x).trim());
    const isNumber = /^\d+$/.test(first);
    if (first && !rest && !isNumber) { group = groups.has(first) ? first : null; return; }
    if (!isNumber || !group) return;
    const name = (r[1] || '').trim();
    if (!name) return; // пустое место под игрока
    try {
      out.push({ no: Number(first), name, group, month, paid: parseAmount(r[3]), line: i + 1 });
    } catch (e) {
      problems.push({ line: i + 1, name, error: e.message });
    }
  });
  return { month, rows: out, problems };
}
