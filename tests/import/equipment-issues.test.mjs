import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIssues, planIssues } from '../../scripts/import/equipment-issues.mjs';

const text = 'ID заказа,Вещь,Дата выдачи,Кто выдал,ID игрока,ФИ,Отмечено\n'
  + 'ORD-1,Игровая форма,23.10.2026,Павел,KS-1,A,x\nORD-1,Тренировочная форма,2026-10-24,,KS-1,A,x\nORD-2,Игровая форма,вчера,Гио,KS-2,B,x\nORD-9,Игровая форма,23.10.2026,,KS-9,Z,x\nORD-1,Куртка,23.10.2026,,KS-1,A,x\n';

test('разбор ВЫДАЧИ: даты, кто выдал', () => {
  const r = parseIssues(text);
  assert.equal(r.length, 5);
  assert.deepEqual([r[0].date, r[0].who, r[1].date, r[1].who], ['2026-10-23', 'Павел', '2026-10-24', null]);
  assert.equal(r[2].date, null);
});

test('добавляются только недостающие выдачи; нет заказа, не та вещь, плохая дата — в отчёт', () => {
  const orders = new Map([['ORD-1', { id: 'o1', kits: new Set(['Игровая форма', 'Тренировочная форма']) }], ['ORD-2', { id: 'o2', kits: new Set(['Игровая форма']) }]]);
  const have = new Set(['o1|Игровая форма']);
  const { add, skipped } = planIssues({ issues: parseIssues(text), orders, have });
  assert.deepEqual(add.map(a => `${a.ord}|${a.kit}|${a.issued_on}`), ['ORD-1|Тренировочная форма|2026-10-24', 'ORD-2|Игровая форма|null']);
  assert.deepEqual([...skipped.noOrder], ['ORD-9']);
  assert.deepEqual(skipped.noKit, [{ ord: 'ORD-1', kit: 'Куртка' }]);
  assert.equal(skipped.badDate.length, 1);
});
