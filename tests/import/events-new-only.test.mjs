import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chunkByMatch } from '../../scripts/import/rest-all.mjs';
import { startFake, runScript } from './fake-rest.mjs';

// Минимальная выгрузка: один турнир, одна игра U9-A 03.10 со счётом 2:1, в составе Ivanov Ivan, голы — у него же.
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-'));
  fs.mkdirSync(path.join(dir, 'GAMES_ID'));
  const f = (n, t) => { fs.writeFileSync(path.join(dir, n), t); return path.join(dir, n); };
  return {
    reg: f('reg.csv', 'a\nb\nc\nKS-0001,Ivanov Ivan,U9-A,Park,Активен,01.09.2026,,\n'),
    events: f('events.csv', 'ID,Команда,Тип,Название,Дата,Взнос,Турнир,Соперник,ГЗ,ГП\nT-1,U9-A,Чемпионат,Cup,01.10.2026,,,,,\nE-1,U9-A,Игра,,03.10.2026,,T-1,Dynamo,,\n'),
    fees: f('fees.csv', 'Событие,ID,ФИ,Оплачено,Сумма\n'),
    log: f('log.csv', 'Дата,Команда,Соперник,Счёт,Голы,Сотрудник,Роль,Регламент\n03.10.2026,U9-A,Dynamo,2:1,Ivanov Ivan - 2,,,\n'),
    games: (() => { fs.writeFileSync(path.join(dir, 'GAMES_ID', 'U9-A.csv'), ',,,\n,,03.10,\n№,ФИ,Paid,Played\n1,Ivanov Ivan,,TRUE\n'); return path.join(dir, 'GAMES_ID'); })(),
  };
}
const args = x => ['--registry', x.reg, '--events', x.events, '--fees', x.fees, '--games', x.games, '--log', x.log, '--new-only', '--write'];
const base = { players: [{ id: 'p1', external_id: 'KS-0001' }], tournaments: [{ id: 't1', external_id: 'T-1' }], match_staff: [] };

test('--new-only: матч есть, состава в базе нет (прошлый запуск оборвался) — состав и голы дописываются, матч не трогается', async () => {
  const fake = await startFake({ ...base, matches: [{ id: 'm1', external_id: 'E-1' }], match_players: [] });
  try {
    const r = await runScript('run-events.mjs', args(fixture()), fake.url);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(fake.writes().filter(c => c.table === 'matches').length, 0, 'существующий матч перезаписан');
    const mp = fake.writes().filter(c => c.table === 'match_players');
    assert.equal(mp.length, 1);
    assert.deepEqual(mp[0].body, [{ match_id: 'm1', player_id: 'p1', played: true, goals: 2 }]);
  } finally { await fake.close(); }
});

test('--new-only: у существующего матча состав уже есть (правили в приложении) — ничего не пишется', async () => {
  const fake = await startFake({ ...base, matches: [{ id: 'm1', external_id: 'E-1' }], match_players: [{ match_id: 'm1', player_id: 'p9' }] });
  try {
    const r = await runScript('run-events.mjs', args(fixture()), fake.url);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(fake.writes().filter(c => ['matches', 'match_players'].includes(c.table)).length, 0);
  } finally { await fake.close(); }
});

test('--staff-only пишет только match_staff и ничего больше', async () => {
  const x = fixture();
  fs.writeFileSync(x.log, 'Дата,Команда,Соперник,Счёт,Голы,Сотрудник,Роль,Регламент\n03.10.2026,U9-A,Dynamo,2:1,,Павел,Тренер,Да\n');
  const fake = await startFake({ ...base, matches: [{ id: 'm1', external_id: 'E-1' }], match_players: [] });
  try {
    const r = await runScript('run-events.mjs', ['--registry', x.reg, '--events', x.events, '--fees', x.fees, '--games', x.games, '--log', x.log, '--staff-only', '--write'], fake.url);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual([...new Set(fake.writes().map(c => c.table))], ['match_staff']);
  } finally { await fake.close(); }
});

test('без --write ничего не пишется', async () => {
  const x = fixture();
  const fake = await startFake({ ...base, matches: [], match_players: [] });
  try {
    const r = await runScript('run-events.mjs', args(x).filter(a => a !== '--write'), fake.url);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(fake.calls.length, 0);
  } finally { await fake.close(); }
});

test('chunkByMatch не режет состав одного матча между пачками', () => {
  const rows = [...Array(6).fill(0).map((_, i) => ({ match_id: 'a', i })), ...Array(5).fill(0).map((_, i) => ({ match_id: 'b', i }))];
  const ch = chunkByMatch(rows, 8);
  assert.deepEqual(ch.map(c => c.length), [6, 5]);
  assert.ok(ch.every(c => new Set(c.map(r => r.match_id)).size === 1));
  assert.deepEqual(chunkByMatch(rows, 100).map(c => c.length), [11]);
});
