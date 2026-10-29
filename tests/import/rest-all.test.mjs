import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getAll } from '../../scripts/import/rest-all.mjs';
import { startFake, runScript } from './fake-rest.mjs';

test('getAll читает все страницы и не теряет строки на границе', async () => {
  const rows = Array.from({ length: 2500 }, (_, i) => ({ id: i }));
  const seen = [];
  const rest = async (_m, p) => {
    seen.push(p);
    const q = new URLSearchParams(p.split('?')[1]);
    return rows.slice(Number(q.get('offset')), Number(q.get('offset')) + Number(q.get('limit')));
  };
  const got = await getAll(rest, 'players?select=id');
  assert.equal(got.length, 2500);
  assert.equal(seen.length, 3);
  assert.ok(seen.every(p => p.includes('order=id')));
  // ровно кратное число строк: последняя пустая страница завершает чтение
  assert.equal((await getAll(async (_m, p) => { const o = Number(p.match(/offset=(\d+)/)[1]); return o === 0 ? rows.slice(0, 1000) : []; }, 'x')).length, 1000);
});

test('run-payments: уже записанные платежи за пределами первых 1000 строк не дублируются', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pay-'));
  const reg = path.join(dir, 'reg.csv'), month = path.join(dir, '09.26.csv');
  fs.writeFileSync(reg, 'a\nb\nc\nKS-0001,Ivanov Ivan,U9-A,Park,Активен,01.09.2026,,\n');
  fs.writeFileSync(month, 'U9-A\n№,ФИ,Дата,Оплата\n1,Ivanov Ivan,,165\n');
  const target = 'PAY_ID 2026-09 U9-A №1 ivanov ivan';
  const refs = Array.from({ length: 1200 }, (_, i) => ({ id: i, legacy_ref: i === 1100 ? target : `PAY_ID 2026-08 X №${i} n${i}` }));
  const fake = await startFake({
    players: [{ id: 'p1', full_name: 'Ivanov Ivan' }], groups: [{ id: 'g1', name: 'U9-A' }],
    subscriptions: [{ id: 's1', player_id: 'p1', month: '2026-09-01' }], payments: refs,
  });
  try {
    const r = await runScript('run-payments.mjs', ['--registry', reg, month, '--write'], fake.url);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(fake.writes().filter(c => c.table === 'payments').length, 0, 'платёж записан повторно');
    assert.match(r.stdout, /платежей 0/);
  } finally { await fake.close(); }
});
