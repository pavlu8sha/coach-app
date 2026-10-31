// Настоящие даты оплат абонементов из журнала «АБОНЕМЕНТЫ» старого приложения. Только чистые функции.
// Импорт (run-payments.mjs) писал платёж за месяц первым числом месяца: в листах «ММ.ГГ» даты оплаты нет.
// Здесь платёж «игрок × месяц» заменяется записями журнала с их датами и способами, но только когда суммы совпали точно.
import { parseCsv } from './registry.mjs';
import { monthFromFileName } from './payments.mjs';

const r2 = x => Math.round(x * 100) / 100;
const money = s => {
  const t = String(s || '').replace(/₾/g, '').replace(/\s| /g, '').replace(',', '.');
  if (!t) return 0;
  const n = Number(t);
  if (Number.isNaN(n)) throw new Error('Сумма не распознана: ' + s);
  return n;
};

/** Дата журнала → ГГГГ-ММ-ДД или null. Понимает 2026-10-20, 2026-10-20 14:03 и 20.10.2026. */
export function isoDate(s) {
  const t = String(s || '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return valid(m[1], m[2], m[3]);
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(t);
  if (m) return valid(m[3], m[2].padStart(2, '0'), m[1].padStart(2, '0'));
  return null;
}
function valid(y, mo, d) {
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (dt.getUTCFullYear() !== Number(y) || dt.getUTCMonth() !== Number(mo) - 1 || dt.getUTCDate() !== Number(d)) return null;
  return `${y}-${mo}-${d}`;
}

/** Журнал «АБОНЕМЕНТЫ» (Время,Дата,ID игрока,ФИ,Месяц,Группа,Сумма,Тип,Комментарий,Способ) → Map «ID|месяц» → записи в порядке строк. */
export function parseJournalDated(text) {
  const [, ...rows] = parseCsv(text).filter(r => r.some(x => String(x).trim()));
  const byKey = new Map();
  rows.forEach((r, i) => {
    const id = (r[2] || '').trim(), mon = (r[4] || '').trim();
    if (!id || !/^\d{2}\.\d{2}$/.test(mon)) return;
    const key = `${id}|${monthFromFileName(mon)}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push({ line: i + 2, amount: r2(money(r[6])), kind: (r[7] || '').trim(), date: isoDate(r[1]), rawDate: (r[1] || '').trim(), method: (r[9] || '').trim() || null });
  });
  return byKey;
}

const monthOf = iso => `${iso.slice(0, 7)}-01`;
const isCorrection = ref => /коррекция/.test(ref || '');

/**
 * db — платежи импорта: [{ id, player_id, player_ext, subscription_id, month, amount, legacy_ref }] (только PAY_ID…).
 * Результат: ops (замены), skipped (почему не тронуты).
 * Точное совпадение сумм журнала и платежей и ни одной отмены/нулевой записи → платёж заменяется записями журнала:
 * первая запись обновляет основной платёж (его legacy_ref сохраняется), остальные добавляются с ref «<основной> #N»,
 * платежи-коррекции удаляются (их сумма уже входит в записи журнала). Иначе ничего не трогаем и пишем причину.
 */
export function planPaymentDates({ journal, db }) {
  const groups = new Map();
  for (const p of db) {
    const key = `${p.player_ext}|${p.month}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const ops = [], skipped = [];
  for (const [key, rows] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const total = r2(rows.reduce((a, p) => a + Number(p.amount), 0));
    const entries = journal.get(key) || [];
    const money_ = entries.filter(e => e.kind !== 'Скидка');
    if (!money_.length) { skipped.push({ key, reason: 'нет записей журнала', db: total }); continue; }
    if (money_.some(e => e.kind === 'Отмена' || e.amount <= 0)) { skipped.push({ key, reason: 'в журнале отмена или нулевая запись', db: total, journal: money_.map(e => e.amount) }); continue; }
    const bad = money_.find(e => !e.date);
    if (bad) { skipped.push({ key, reason: `непонятная дата «${bad.rawDate}» (строка журнала ${bad.line})`, db: total }); continue; }
    const sum = r2(money_.reduce((a, e) => a + e.amount, 0));
    if (sum !== total) { skipped.push({ key, reason: 'суммы не совпали', db: total, journal: money_.map(e => e.amount), journalSum: sum }); continue; }
    const main = rows.find(p => !isCorrection(p.legacy_ref)) ?? rows[0];
    const month = main.month;
    const entryRow = (e, ref) => ({ amount: e.amount, paid_on: e.date, for_month: monthOf(e.date) === month ? null : month, method: e.method, legacy_ref: ref });
    ops.push({
      key, player_id: main.player_id, subscription_id: main.subscription_id ?? null,
      update: { id: main.id, ...entryRow(money_[0], main.legacy_ref) },
      inserts: money_.slice(1).map((e, i) => entryRow(e, `${main.legacy_ref} #${i + 2}`)),
      deleteIds: rows.filter(p => p.id !== main.id).map(p => p.id),
    });
  }
  return { ops, skipped };
}

const q = v => v === null || v === undefined ? 'null' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;

/** SQL для Supabase SQL Editor: в одной транзакции, уведомления родителям выключены на время замены, в конце rollback. */
export function datesSql(ops) {
  const out = [
    '-- Настоящие даты оплат абонементов из журнала «АБОНЕМЕНТЫ». Сначала запустить как есть (rollback), смотреть итог, затем заменить rollback на commit.',
    'begin;',
    '-- вставка платежа шлёт родителям уведомление «Получена оплата»: на время замены отключаем',
    'alter table payments disable trigger payments_notify;',
  ];
  for (const o of ops) {
    const u = o.update;
    out.push(`update payments set amount = ${q(u.amount)}, paid_on = ${q(u.paid_on)}, for_month = ${q(u.for_month)}, method = ${q(u.method)} where id = ${q(u.id)};`);
    for (const i of o.inserts) {
      out.push(`insert into payments (player_id, subscription_id, amount, paid_on, for_month, method, legacy_ref) values (${q(o.player_id)}, ${q(o.subscription_id)}, ${q(i.amount)}, ${q(i.paid_on)}, ${q(i.for_month)}, ${q(i.method)}, ${q(i.legacy_ref)});`);
    }
    if (o.deleteIds.length) out.push(`delete from payments where id in (${o.deleteIds.map(q).join(', ')});`);
  }
  out.push(
    'alter table payments enable trigger payments_notify;',
    '-- итоги по месяцам должны остаться теми же, что до запуска; число платежей может вырасти',
    'select pay_month, count(*) as платежей, sum(amount) as сумма from payments group by pay_month order by pay_month;',
    'rollback;  -- заменить на commit после проверки',
  );
  return out.join('\n') + '\n';
}
