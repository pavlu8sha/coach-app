import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startFake, runScript } from './fake-rest.mjs';

// Реестр: один игрок в U9-B. Лист 10.26: строка в U9-B, 165 ₾.
function fixture(amount = '165,00') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pay-'));
  const f = (n, t) => { fs.writeFileSync(path.join(dir, n), t); return path.join(dir, n); };
  return {
    reg: f('reg.csv', 'a\nb\nc\nKS-0001,Ivanov Ivan,U9-B,Park,Активен,01.09.2026,,\n'),
    month: f('10.26.csv', `FC KICKSTART • ОПЛАТЫ • 10.26,,,\nU9-B,,,\n№,Имя и фамилия,Дата,"Оплата, ₾"\n1,Ivanov Ivan,,"${amount} ₾"\n`),
  };
}
const tables = payments => ({
  players: [{ id: 'p1', full_name: 'Ivanov Ivan' }], groups: [{ id: 'g1', name: 'U9-B' }],
  subscriptions: [{ id: 's1', player_id: 'p1', month: '2026-10-01' }], payments,
});
const run = (x, fake) => runScript('run-payments.mjs', ['--registry', x.reg, x.month, '--write'], fake.url);
const paymentWrites = fake => fake.writes().filter(c => c.table === 'payments').flatMap(c => c.body);

test('платёж перенесён в другую группу (ссылка сменилась): второй платёж не пишется', async () => {
  const fake = await startFake(tables([{ legacy_ref: 'PAY_ID 2026-10 weekends №9 ivanov ivan', amount: '165.00', player_id: 'p1' }]));
  try {
    const r = await run(fixture(), fake);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(paymentWrites(fake).length, 0);
    assert.match(r.stdout, /второй платёж не пишем/);
  } finally { await fake.close(); }
});

test('строку дополнили в листе: пишется коррекция на разницу', async () => {
  const fake = await startFake(tables([{ legacy_ref: 'PAY_ID 2026-10 U9-B №1 ivanov ivan', amount: '120.00', player_id: 'p1' }]));
  try {
    const r = await run(fixture('160,00'), fake);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(paymentWrites(fake).map(p => [p.legacy_ref, p.amount, p.player_id, p.subscription_id, p.paid_on]),
      [['PAY_ID 2026-10 коррекция KS-0001 до 160', 40, 'p1', 's1', '2026-10-01']]);
  } finally { await fake.close(); }
});

test('нового платежа нет в базе: пишется обычная строка', async () => {
  const fake = await startFake(tables([]));
  try {
    const r = await run(fixture(), fake);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(paymentWrites(fake).map(p => [p.legacy_ref, p.amount]), [['PAY_ID 2026-10 U9-B №1 ivanov ivan', 165]]);
  } finally { await fake.close(); }
});

test('повторный запуск после коррекции ничего не пишет', async () => {
  const fake = await startFake(tables([
    { legacy_ref: 'PAY_ID 2026-10 U9-B №1 ivanov ivan', amount: '120.00', player_id: 'p1' },
    { legacy_ref: 'PAY_ID 2026-10 коррекция KS-0001 до 160', amount: '40.00', player_id: 'p1' }]));
  try {
    const r = await run(fixture('160,00'), fake);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(paymentWrites(fake).length, 0);
  } finally { await fake.close(); }
});

test('оплата с ФИО не из реестра: проверка и запись останавливаются, с --accept-unmatched идут дальше', async () => {
  const x = fixture();
  fs.appendFileSync(x.month, '2,Petrov Petr,,"100,00 ₾"\n');
  const fake = await startFake(tables([]));
  try {
    const dry = await runScript('run-payments.mjs', ['--registry', x.reg, x.month], fake.url);
    assert.equal(dry.code, 1);
    assert.match(dry.stdout, /Не найдены в реестре \(не запишутся\): 1/);
    const wr = await run(x, fake);
    assert.equal(wr.code, 1);
    assert.equal(fake.writes().length, 0);
    const ok = await runScript('run-payments.mjs', ['--registry', x.reg, x.month, '--accept-unmatched', '--write'], fake.url);
    assert.equal(ok.code, 0, ok.stderr);
    assert.deepEqual(paymentWrites(fake).map(p => p.amount), [165]);
  } finally { await fake.close(); }
});
