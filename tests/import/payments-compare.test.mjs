import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDbPayments, parseJournal, comparePayments } from '../../scripts/import/payments-compare.mjs';

const db = parseDbPayments('player_ext,month,paid,payments,discount,amount_due\nKS-1,2026-10-01,165.00,1,f,165\nKS-2,2026-10-01,100.00,1,f,100\nKS-3,2026-10-01,80.00,2,f,80\n');
const journal = parseJournal('Время,Дата,ID игрока,ФИ,Месяц,Группа,Сумма,Тип,Комментарий,Способ\nx,2026-10-20,KS-2,B,10.26,U7,"65,00 ₾",Частичный,,Перевод\nx,2026-10-21,KS-2,B,10.26,U7,"-20,00 ₾",Отмена,,Перевод\n');

test('совпавшие суммы и платежи после миграции, объяснённые последними записями журнала', () => {
  const r = comparePayments({ filePaid: new Map([['KS-1|2026-10-01', 165], ['KS-2|2026-10-01', 145]]), db: [...db.slice(0, 2)], journal });
  assert.equal(r.same, 1);
  assert.deepEqual(r.explained.map(x => [x.key, x.diff, x.lastN]), [['KS-2|2026-10-01', 45, 2]]);
  assert.deepEqual([r.unexplained, r.onlyFile, r.onlyDb], [[], [], []]);
});

test('расхождение без записей журнала и игрок только в базе или только в файле выделяются', () => {
  const r = comparePayments({ filePaid: new Map([['KS-1|2026-10-01', 200], ['KS-9|2026-10-01', 50]]), db, journal });
  assert.deepEqual(r.unexplained.map(x => [x.key, x.diff]), [['KS-1|2026-10-01', 35]]);
  assert.deepEqual(r.onlyFile.map(x => x.key), ['KS-9|2026-10-01']);
  assert.deepEqual(r.onlyDb.map(x => x.key), ['KS-2|2026-10-01', 'KS-3|2026-10-01']);
});
