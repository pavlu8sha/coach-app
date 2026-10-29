import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { possibleDuplicates } from '../../scripts/import/payments-guard.mjs';
import { startFake, runScript } from './fake-rest.mjs';

test('possibleDuplicates: платёж с новым ключом, но тем же игроком, месяцем и суммой, помечается; другая сумма или месяц — нет', () => {
  const db = [{ legacy_ref: 'PAY_ID 2026-09 U9-A №3 ivanov ivan', player_id: 'p1', amount: 165, paid_on: '2026-09-01' }];
  const c = (ref, amount, paid_on) => ({ ref, player_id: 'p1', amount, paid_on });
  assert.deepEqual(possibleDuplicates([c('PAY_ID 2026-09 U9-A №4 ivanov ivan', 165, '2026-09-01')], db).map(d => d.ref), ['PAY_ID 2026-09 U9-A №4 ivanov ivan']);
  assert.deepEqual(possibleDuplicates([c('x', 150, '2026-09-01'), c('y', 165, '2026-10-01')], db), []);
});

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-'));
  const reg = path.join(dir, 'reg.csv'), month = path.join(dir, '09.26.csv');
  fs.writeFileSync(reg, 'a\nb\nc\nKS-0001,Ivanov Ivan,U9-A,Park,Активен,01.09.2026,,\n');
  // игрок теперь стоит под номером 4 (раньше был третьим)
  fs.writeFileSync(month, 'U9-A\n№,ФИ,Дата,Оплата\n4,Ivanov Ivan,,165\n');
  return { reg, month };
}
const tables = (refs) => ({
  players: [{ id: 'p1', full_name: 'Ivanov Ivan' }], groups: [{ id: 'g1', name: 'U9-A' }],
  subscriptions: [{ id: 's1', player_id: 'p1', month: '2026-09-01' }],
  payments: refs.map((legacy_ref, i) => ({ id: i, player_id: 'p1', amount: 165, paid_on: '2026-09-01', legacy_ref })),
});

test('run-payments: сдвиг номера строки (дубль по игроку, месяцу и сумме) останавливает запись до любых записей', async () => {
  const { reg, month } = fixture();
  const fake = await startFake(tables(['PAY_ID 2026-09 U9-A №3 ivanov ivan']));
  try {
    const r = await runScript('run-payments.mjs', ['--registry', reg, month, '--write'], fake.url);
    assert.equal(r.code, 1);
    assert.equal(fake.writes().length, 0);
    assert.match(r.stdout, /возможные дубли \(1\)/);
    const dry = await runScript('run-payments.mjs', ['--registry', reg, month], fake.url);
    assert.equal(dry.code, 1, 'проверка без записи тоже сообщает кодом 1');
    const ok = await runScript('run-payments.mjs', ['--registry', reg, month, '--write', '--accept-possible-duplicates'], fake.url);
    assert.equal(ok.code, 0, ok.stderr);
    assert.equal(fake.writes().filter(c => c.table === 'payments').length, 1);
  } finally { await fake.close(); }
});

test('run-payments: без совпадений запись идёт; без SUPABASE_* проверка без записи завершается кодом 0', async () => {
  const { reg, month } = fixture();
  const fake = await startFake(tables([]));
  try {
    const r = await runScript('run-payments.mjs', ['--registry', reg, month, '--write'], fake.url);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Новых платежей к записи: 1 на 165 ₾/);
    assert.deepEqual(fake.writes().map(c => c.table), ['subscriptions', 'payments']);
  } finally { await fake.close(); }
  const none = await runScript('run-payments.mjs', ['--registry', reg, month], '', { SUPABASE_URL: '', SUPABASE_SERVICE_KEY: '', CLUB_ID: '' });
  assert.equal(none.code, 0);
});
