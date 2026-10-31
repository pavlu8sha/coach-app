import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseParticipation, missingFromParticipation } from '../../scripts/import/participation-fill.mjs';

const text = 'Событие,Игрок,ФИ,Играл,ft,f,g,h,i,j,Голы\n'
  + 'E-1,KS-1,A,TRUE,,,,,,,2\nE-1,KS-2,B,TRUE,,,,,,,\nE-1,KS-3,C,FALSE,,,,,,,\nE-2,KS-1,A,TRUE,,,,,,,\nE-9,KS-1,A,TRUE,,,,,,,\nE-1,KS-8,Z,TRUE,,,,,,,\n';

test('разбор УЧАСТИЯ: играл и голы', () => {
  const r = parseParticipation(text);
  assert.equal(r.length, 6);
  assert.deepEqual(r[0], { event: 'E-1', player: 'KS-1', played: true, goals: 2 });
  assert.equal(r[2].played, false);
});

test('дописываются только отсутствующие игравшие; существующие и отметки FALSE не трогаются; нет матча/игрока — в отчёт', () => {
  const mids = { 'E-1': 'm1', 'E-2': 'm2' }, pids = { 'KS-1': 'p1', 'KS-2': 'p2', 'KS-3': 'p3' };
  const dbLineups = new Map([['m1', new Map([['p1', { played: true, goals: 2 }]])], ['m2', new Map()]]);
  const { add, skipped } = missingFromParticipation({ rows: parseParticipation(text), midOf: e => mids[e], pidOf: p => pids[p], dbLineups });
  assert.deepEqual(add.map(a => `${a.event}|${a.player_id}`), ['E-1|p2', 'E-2|p1']);
  assert.deepEqual([...skipped.noMatch], ['E-9']);
  assert.deepEqual([...skipped.noPlayer], ['KS-8']);
});
