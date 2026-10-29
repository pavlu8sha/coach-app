// Сверка оплат абонементов: файл оплат (листы «ММ.ГГ») против выгрузки платежей из базы, с журналом «АБОНЕМЕНТЫ» как объяснением.
// Только чтение, чистые функции. Ключ — ID игрока и месяц, не номер строки и не ФИО.
import { parseCsv } from './registry.mjs';
import { monthFromFileName } from './payments.mjs';

const money = s => {
  const t = String(s || '').replace(/₾/g, '').replace(/\s| /g, '').replace(',', '.');
  if (!t) return 0;
  const n = Number(t);
  if (Number.isNaN(n)) throw new Error('Сумма не распознана: ' + s);
  return n;
};
const r2 = x => Math.round(x * 100) / 100;

// Выгрузка из базы: player_ext,month,paid,payments,discount,amount_due
export function parseDbPayments(text) {
  const [head, ...rows] = parseCsv(text).filter(r => r.some(x => String(x).trim()));
  const H = head.map(h => h.trim());
  return rows.map(r => {
    const o = Object.fromEntries(H.map((h, i) => [h, (r[i] ?? '').trim().replace(/^null$/i, '')]));
    return { key: `${o.player_ext}|${String(o.month).slice(0, 10)}`, player_ext: o.player_ext, month: String(o.month).slice(0, 10), paid: r2(money(o.paid)) };
  });
}

// Журнал «АБОНЕМЕНТЫ» (CSV листа): Время,Дата,ID игрока,ФИ,Месяц,Группа,Сумма,Тип,Комментарий,Способ → записи по ключу в порядке строк.
export function parseJournal(text) {
  const [, ...rows] = parseCsv(text).filter(r => r.some(x => String(x).trim()));
  const byKey = new Map();
  rows.forEach((r, i) => {
    const id = (r[2] || '').trim(), mon = (r[4] || '').trim();
    if (!id || !/^\d{2}\.\d{2}$/.test(mon)) return;
    const key = `${id}|${monthFromFileName(mon)}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push({ line: i + 2, amount: r2(money(r[6])), kind: (r[7] || '').trim(), date: (r[1] || '').trim() });
  });
  return byKey;
}

// filePaid — Map «ID|месяц» → сумма в файле оплат (plan.subs из payments-plan), db — parseDbPayments, journal — parseJournal.
// Разница «файл − база» объяснена, если равна сумме последних N записей журнала по этому игроку и месяцу (платежи после миграции).
export function comparePayments({ filePaid, db, journal = new Map() }) {
  const dbBy = new Map(db.map(d => [d.key, d.paid]));
  const keys = new Set([...filePaid.keys(), ...dbBy.keys()]);
  const out = { same: 0, explained: [], unexplained: [], onlyFile: [], onlyDb: [] };
  for (const key of [...keys].sort()) {
    const f = filePaid.has(key) ? r2(filePaid.get(key)) : null, d = dbBy.has(key) ? dbBy.get(key) : null;
    if (f === null) { if (d !== 0) out.onlyDb.push({ key, db: d }); continue; }
    if (d === null) { if (f !== 0) out.onlyFile.push({ key, file: f, journal: (journal.get(key) || []).map(e => e.amount) }); continue; }
    const diff = r2(f - d);
    if (diff === 0) { out.same++; continue; }
    const entries = journal.get(key) || [];
    let sum = 0, hit = null;
    for (let n = 1; n <= entries.length; n++) {
      sum = r2(sum + entries[entries.length - n].amount);
      if (sum === diff) { hit = n; break; }
    }
    (hit ? out.explained : out.unexplained).push({ key, file: f, db: d, diff, journal: entries.map(e => e.amount), lastN: hit });
  }
  return out;
}
