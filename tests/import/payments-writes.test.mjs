import test from 'node:test';
import assert from 'node:assert/strict';
import { planPaymentWrites } from '../../scripts/import/payments-plan.mjs';

const f = (ref, key, amount) => ({ ref, key, amount });

test('новая строка на недостающую сумму пишется как раньше', () => {
  const r = planPaymentWrites({ file: [f('A', 'p1|2026-11', 165)], existing: [] });
  assert.deepEqual(r.inserts.map(x => [x.ref, x.amount]), [['A', 165]]);
  assert.equal(r.corrections.length, 0);
});

test('повторный запуск ничего не пишет', () => {
  const r = planPaymentWrites({ file: [f('A', 'p1|2026-11', 165)], existing: [f('A', 'p1|2026-11', 165)] });
  assert.equal(r.inserts.length, 0);
});

test('строка перенесена в другую группу (ссылка сменилась, сумма та же): второй платёж не пишется', () => {
  const r = planPaymentWrites({ file: [f('PAY_ID 2026-10 U9-B №13 kiriiak vova', 'p1|2026-10', 165)], existing: [f('PAY_ID 2026-10 weekends №9 kiriiak vova', 'p1|2026-10', 165)] });
  assert.equal(r.inserts.length, 0);
  assert.equal(r.covered.length, 1);
});

test('строку дополнили в листе: пишется коррекция на разницу, повторно не пишется', () => {
  const file = [{ ref: 'PAY_ID 2026-10 Isani №9 kuznetsov filipp', key: 'p2|2026-10', amount: 160, player: 'KS-0001' }];
  const existing = [f('PAY_ID 2026-10 Isani №9 kuznetsov filipp', 'p2|2026-10', 120)];
  const r = planPaymentWrites({ file, existing });
  assert.equal(r.inserts.length, 1);
  assert.equal(r.inserts[0].amount, 40);
  assert.equal(r.inserts[0].ref, 'PAY_ID 2026-10 коррекция KS-0001 до 160');
  const again = planPaymentWrites({ file, existing: [...existing, f(r.inserts[0].ref, 'p2|2026-10', 40)] });
  assert.equal(again.inserts.length, 0);
});

test('в файле меньше, чем в базе: коррекция с минусом', () => {
  const r = planPaymentWrites({ file: [f('A', 'p3|2026-10', 100)], existing: [f('A', 'p3|2026-10', 130)] });
  assert.equal(r.inserts[0].amount, -30);
});

test('две новые строки игрока в разных группах пишутся обе', () => {
  const r = planPaymentWrites({ file: [f('A', 'p4|2026-11', 100), f('B', 'p4|2026-11', 50)], existing: [] });
  assert.deepEqual(r.inserts.map(x => x.ref), ['A', 'B']);
});

test('новая строка и доплата в старой одновременно: одна коррекция на сумму', () => {
  const r = planPaymentWrites({ file: [f('A', 'p5|2026-10', 140), f('B', 'p5|2026-10', 50)], existing: [f('A', 'p5|2026-10', 100)] });
  assert.equal(r.inserts.length, 1);
  assert.equal(r.inserts[0].amount, 90);
});

test('копейки не накапливают ошибку', () => {
  const r = planPaymentWrites({ file: [f('A', 'p6|2026-10', 0.1), f('B', 'p6|2026-10', 0.2)], existing: [f('A', 'p6|2026-10', 0.1), f('B', 'p6|2026-10', 0.2)] });
  assert.equal(r.inserts.length, 0);
});
