// «Игроки»: реестр получается один раз за запрос; даты рождения — те же, что раньше. Перенос из perf-phase1 без замеров.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const REG = { players: [
  { id: 'KS-1', name: 'Ana', group: 'U9-A', loc: 'Парк', status: 'Активен', start: '', end: '', extras: [] },
  { id: 'KS-2', name: 'Bob', group: 'U9-B', loc: 'Парк', status: 'Ушёл', start: '', end: '', extras: ['weekends'] },
  { id: 'KS-3', name: 'Cid', group: 'U7-A', loc: 'Парк', status: 'Активен', start: '', end: '', extras: [] },
], l: { groups: ['U9-A'], statuses: ['Активен'] } };

function env() {
  let regCalls = 0;
  const ctx = { console: { log() {} }, CONFIG: { DRY_RUN: false } };
  vm.createContext(ctx);
  for (const f of ['Players.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  Object.assign(ctx, {
    checkAdmin_() {}, norm: s => String(s || '').trim().toLowerCase(),
    regData_: () => { regCalls++; return JSON.parse(JSON.stringify(REG)); },
    birthOverrides_: () => ({ 'KS-3': '03.03.2017' }),
    birthByName_: () => ({ ana: '01.01.2016', cid: '05.05.2017' }),
  });
  return { ctx, calls: () => regCalls };
}

test('appAdminInit: один regData_ на запрос, даты рождения — как при прежнем birthById_()', () => {
  const e = env();
  const r = JSON.parse(JSON.stringify(e.ctx.appAdminInit('9')));
  assert.equal(e.calls(), 1);
  assert.deepEqual(r.players.map(p => [p.id, p.birth]), [['KS-1', '01.01.2016'], ['KS-2', ''], ['KS-3', '03.03.2017']]);
  const old = env();
  assert.deepEqual(JSON.parse(JSON.stringify(old.ctx.birthById_())), Object.fromEntries(r.players.map(p => [p.id, p.birth])));
  assert.equal(old.calls(), 1);                                   // без аргумента — читает реестр сам, как раньше
  assert.deepEqual(r.groups, ['U9-A']);
});
