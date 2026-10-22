// Способ оплаты обязателен в индивидуальных и дополнительных: без «Наличные» по умолчанию.
// Настоящие SubsPay.js (payMethodReq_), Individual.js, Extra.js; запись — заглушки.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function env() {
  const calls = [];
  const ctx = { console: { warn() {}, error() {}, log() {} }, CONFIG: { DRY_RUN: false } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('../PerfLog.js', import.meta.url), 'utf8'), ctx);
  for (const f of ['SubsPay.js', 'Individual.js', 'Extra.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  Object.assign(ctx, {
    checkAdmin_: p => { if (String(p) !== '9') throw new Error('Неверный код администратора'); },
    indLocked_: fn => { calls.push('ind'); return { ok: true }; },
    extraLocked_: fn => { calls.push('extra'); return { ok: true }; },
  });
  return { ctx, calls };
}

for (const bad of ['', null, undefined, 'наличка', 'Карта']) {
  test(`индивидуальные и дополнительные: способ «${bad}» не принимается, запись не начинается`, () => {
    const e = env();
    assert.throws(() => e.ctx.appIndPay('9', 'ev', 'Name', bad), /Выберите способ оплаты/);
    assert.throws(() => e.ctx.appExtraPay('9', 'ev', 'Name', bad, ''), /Выберите способ оплаты/);
    assert.deepEqual([...e.calls], []);
  });
}

test('наличные и перевод принимаются', () => {
  const e = env();
  for (const m of ['Наличные', 'Перевод']) {
    assert.equal(e.ctx.appIndPay('9', 'ev', 'Name', m).ok, true);
    assert.equal(e.ctx.appExtraPay('9', 'ev', 'Name', m, '').ok, true);
  }
  assert.deepEqual([...e.calls], ['ind', 'extra', 'ind', 'extra']);
});
