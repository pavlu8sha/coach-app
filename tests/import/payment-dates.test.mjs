import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isoDate, parseJournalDated, planPaymentDates, datesSql } from '../../scripts/import/payment-dates.mjs';

test('дата журнала: ISO, с временем, ДД.ММ.ГГГГ; несуществующая и пустая — null', () => {
  assert.equal(isoDate('2026-10-20'), '2026-10-20');
  assert.equal(isoDate('2026-10-20 14:03:11'), '2026-10-20');
  assert.equal(isoDate('7.10.2026'), '2026-10-07');
  assert.equal(isoDate('2026-02-31'), null);
  assert.equal(isoDate(''), null);
});

const head = 'Время,Дата,ID игрока,ФИ,Месяц,Группа,Сумма,Тип,Комментарий,Способ\n';
const journal = parseJournalDated(head
  + 'x,2026-10-01,KS-1,A,10.26,U9,"130,00 ₾",Частичный,,Наличные\n'
  + 'x,2026-10-07,KS-1,A,10.26,U9,"35,00 ₾",Оплата,,Перевод\n'
  + 'x,2026-10-25,KS-2,B,11.26,U9,"165,00 ₾",Оплата,,Наличные\n'
  + 'x,2026-10-02,KS-3,C,10.26,U9,"100,00 ₾",Оплата,,Перевод\n'
  + 'x,2026-10-03,KS-3,C,10.26,U9,"-100,00 ₾",Отмена,,Перевод\n'
  + 'x,2026-10-05,KS-4,D,10.26,U9,"50,00 ₾",Оплата,,Наличные\n'
  + 'x,2026-10-06,KS-5,E,10.26,U9,"80,00 ₾",Оплата,,Наличные\n');

const pay = (id, ext, month, amount, ref) => ({ id, player_id: `pid-${ext}`, player_ext: ext, subscription_id: `sub-${ext}`, month, amount, legacy_ref: ref });
const db = [
  pay('a1', 'KS-1', '2026-10-01', '130.00', 'PAY_ID 2026-10 weekends №9 kiriiak vova'),
  pay('a2', 'KS-1', '2026-10-01', '35.00', 'PAY_ID 2026-10 коррекция KS-1 до 165'),
  pay('b1', 'KS-2', '2026-11-01', '165.00', 'PAY_ID 2026-11 U9 №2 b'),
  pay('c1', 'KS-3', '2026-10-01', '0.00', 'PAY_ID 2026-10 U9 №3 c'),
  pay('d1', 'KS-4', '2026-10-01', '60.00', 'PAY_ID 2026-10 U9 №4 d'),
  pay('e1', 'KS-6', '2026-10-01', '90.00', 'PAY_ID 2026-10 U9 №6 f'),
];

test('точное совпадение: основной платёж обновляется, остальное добавляется, коррекция удаляется', () => {
  const { ops, skipped } = planPaymentDates({ journal, db });
  const o1 = ops.find(o => o.key === 'KS-1|2026-10-01');
  assert.deepEqual(o1.update, { id: 'a1', amount: 130, paid_on: '2026-10-01', for_month: null, method: 'Наличные', legacy_ref: 'PAY_ID 2026-10 weekends №9 kiriiak vova' });
  assert.deepEqual(o1.inserts, [{ amount: 35, paid_on: '2026-10-07', for_month: null, method: 'Перевод', legacy_ref: 'PAY_ID 2026-10 weekends №9 kiriiak vova #2' }]);
  assert.deepEqual(o1.deleteIds, ['a2']);
  assert.ok(skipped.length >= 3);
});

test('оплата вперёд: дата в другом месяце → for_month остаётся месяцем абонемента', () => {
  const { ops } = planPaymentDates({ journal, db });
  const o = ops.find(x => x.key === 'KS-2|2026-11-01');
  assert.equal(o.update.paid_on, '2026-10-25');
  assert.equal(o.update.for_month, '2026-11-01');
});

test('отмена в журнале, расхождение сумм и игрок без журнала не трогаются, причина названа', () => {
  const { ops, skipped } = planPaymentDates({ journal, db });
  assert.deepEqual(ops.map(o => o.key), ['KS-1|2026-10-01', 'KS-2|2026-11-01']);
  const why = Object.fromEntries(skipped.map(s => [s.key, s.reason]));
  assert.equal(why['KS-3|2026-10-01'], 'нет записей журнала'); // оплата и её отмена погасили друг друга
  assert.equal(why['KS-4|2026-10-01'], 'суммы не совпали');
  assert.equal(why['KS-6|2026-10-01'], 'нет записей журнала');
});

test('оплата, повторная оплата и отмена одной из них: остаётся одна запись', () => {
  const j = parseJournalDated(head
    + 'x,2026-10-01,KS-7,G,10.26,U9,"165,00 ₾",Оплата,,Наличные\n'
    + 'x,2026-10-02,KS-7,G,10.26,U9,"165,00 ₾",Оплата,,Наличные\n'
    + 'x,2026-10-03,KS-7,G,10.26,U9,"-165,00 ₾",Отмена,,Наличные\n');
  const { ops } = planPaymentDates({ journal: j, db: [pay('g1', 'KS-7', '2026-10-01', '165.00', 'PAY_ID 2026-10 U9 №7 g')] });
  assert.equal(ops.length, 1);
  assert.equal(ops[0].update.paid_on, '2026-10-01');
  assert.equal(ops[0].inserts.length, 0);
});

test('непонятная дата журнала не пропускается молча', () => {
  const j = parseJournalDated(head + 'x,вчера,KS-9,Z,10.26,U9,"40,00 ₾",Оплата,,Наличные\n');
  const { ops, skipped } = planPaymentDates({ journal: j, db: [pay('z1', 'KS-9', '2026-10-01', '40.00', 'PAY_ID 2026-10 U9 №9 z')] });
  assert.equal(ops.length, 0);
  assert.match(skipped[0].reason, /непонятная дата «вчера»/);
});

test('SQL: уведомления выключены на время замены, транзакция заканчивается откатом, кавычки экранируются', () => {
  const { ops } = planPaymentDates({ journal, db });
  const sql = datesSql(ops);
  assert.match(sql, /^-- /);
  assert.match(sql, /alter table payments disable trigger payments_notify;/);
  assert.match(sql, /alter table payments enable trigger payments_notify;/);
  assert.match(sql, /update payments set amount = 130, paid_on = '2026-10-01', for_month = null, method = 'Наличные' where id = 'a1';/);
  assert.match(sql, /insert into payments .* values \('pid-KS-1', 'sub-KS-1', 35, '2026-10-07', null, 'Перевод', 'PAY_ID 2026-10 weekends №9 kiriiak vova #2'\);/);
  assert.match(sql, /delete from payments where id in \('a2'\);/);
  assert.match(sql.trimEnd().split('\n').pop(), /^rollback;/);
  assert.equal(datesSql([{ ...ops[0], update: { ...ops[0].update, method: "О'Нил" } }]).includes("'О''Нил'"), true);
});
