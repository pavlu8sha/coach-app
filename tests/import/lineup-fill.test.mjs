import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { missingLineup } from '../../scripts/import/lineup-fill.mjs';
import { startFake, runScript } from './fake-rest.mjs';

test('missingLineup: добавляет только отсутствующих в составе существующего матча; матч без состава и существующие строки не трогает', () => {
  const ids = { 'Ivanov Ivan': 'p1', 'Petrov Petr': 'p2', 'Sidorov Yan': 'p3' };
  const r = missingLineup({
    matchPlayers: [{ match_ext: 'E-1', name: 'Ivanov Ivan' }, { match_ext: 'E-1', name: 'Petrov Petr' }, { match_ext: 'E-2', name: 'Ivanov Ivan' }, { match_ext: 'E-3', name: 'Ivanov Ivan' }],
    goalsBy: new Map([['E-1|Sidorov Yan', 2]]),
    midOf: ext => ({ 'E-1': 'm1', 'E-2': 'm2' })[ext], // E-3 в базе нет
    playerId: n => ids[n],
    dbLineups: new Map([['m1', new Set(['p2', 'p9'])]]), // у m2 состава нет вообще
  });
  assert.deepEqual(r.map(x => [x.match_ext, x.name, x.goals]), [['E-1', 'Ivanov Ivan', 0], ['E-1', 'Sidorov Yan', 2]]);
});

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fl-'));
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
const args = (x, ...more) => ['--registry', x.reg, '--events', x.events, '--fees', x.fees, '--games', x.games, '--log', x.log, '--new-only', ...more];
const base = { players: [{ id: 'p1', external_id: 'KS-0001' }], tournaments: [{ id: 't1', external_id: 'T-1' }], match_staff: [], matches: [{ id: 'm1', external_id: 'E-1' }] };

test('--fill-lineups без записи показывает, кого допишет, и ничего не пишет', async () => {
  const fake = await startFake({ ...base, match_players: [{ match_id: 'm1', player_id: 'p9' }] });
  try {
    const r = await runScript('run-events.mjs', args(fixture(), '--fill-lineups'), fake.url);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /1 игроков в 1 матчах/);
    assert.match(r.stdout, /E-1: \+1 — Ivanov Ivan/);
    assert.equal(fake.writes().length, 0);
  } finally { await fake.close(); }
});

test('--fill-lineups с записью дописывает недостающего, строки базы не перезаписывает', async () => {
  const fake = await startFake({ ...base, match_players: [{ match_id: 'm1', player_id: 'p9' }] });
  try {
    const r = await runScript('run-events.mjs', args(fixture(), '--fill-lineups', '--write'), fake.url);
    assert.equal(r.code, 0, r.stderr);
    const mp = fake.writes().filter(c => c.table === 'match_players');
    assert.equal(mp.length, 1);
    assert.deepEqual(mp[0].body, [{ match_id: 'm1', player_id: 'p1', played: true, goals: 2 }]);
    assert.equal(fake.writes().filter(c => c.table === 'matches').length, 0);
  } finally { await fake.close(); }
});

test('без --fill-lineups состав существующего матча не трогается; игрок уже в составе — ничего не пишется', async () => {
  const f1 = await startFake({ ...base, match_players: [{ match_id: 'm1', player_id: 'p9' }] });
  try {
    const r = await runScript('run-events.mjs', args(fixture(), '--write'), f1.url);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(f1.writes().filter(c => c.table === 'match_players').length, 0);
  } finally { await f1.close(); }
  const f2 = await startFake({ ...base, match_players: [{ match_id: 'm1', player_id: 'p1' }] });
  try {
    const r = await runScript('run-events.mjs', args(fixture(), '--fill-lineups', '--write'), f2.url);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(f2.writes().filter(c => c.table === 'match_players').length, 0);
  } finally { await f2.close(); }
});

test('--fill-lineups без --new-only отклоняется', async () => {
  const x = fixture();
  const fake = await startFake({ ...base, match_players: [] });
  try {
    const r = await runScript('run-events.mjs', ['--registry', x.reg, '--events', x.events, '--fees', x.fees, '--games', x.games, '--log', x.log, '--fill-lineups'], fake.url);
    assert.equal(r.code, 2);
  } finally { await fake.close(); }
});
