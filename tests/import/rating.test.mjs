import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES, computeEvents, summarize } from '../../scripts/import/rating.mjs';

const rulesByCode = Object.fromEntries(RULES.map((r, i) => [r.code, { id: 'R' + i, ...r }]));
const base = {
  rulesByCode,
  sessions: [{ id: 'S1', starts_at: '2026-10-19T23:30:00+04:00' }, { id: 'S2', starts_at: '2026-10-20T00:30:00+04:00' }],
  attendance: [
    { session_id: 'S1', player_id: 'P1', status: 'present' },
    { session_id: 'S1', player_id: 'P2', status: 'absent' },
    { session_id: 'S2', player_id: 'P1', status: 'excused' },
  ],
  matches: [
    { id: 'M1', played_on: '2026-10-10', goals_for: 3, goals_against: 1 },
    { id: 'M2', played_on: '2026-10-11', goals_for: 2, goals_against: 2 },
    { id: 'M3', played_on: '2026-10-12', goals_for: 0, goals_against: 4 },
    { id: 'M4', played_on: '2026-10-13', goals_for: null, goals_against: null },
  ],
  matchPlayers: [
    { match_id: 'M1', player_id: 'P1', played: true }, { match_id: 'M1', player_id: 'P2', played: false },
    { match_id: 'M2', player_id: 'P1', played: true }, { match_id: 'M3', player_id: 'P1', played: true }, { match_id: 'M4', player_id: 'P1', played: true },
  ],
};

test('посещаемость: только «пришёл» даёт балл, пропуски — ничего', () => {
  const e = computeEvents(base).filter(x => x.code === 'attendance_present');
  assert.equal(e.length, 1);
  assert.equal(e[0].player_id, 'P1'); assert.equal(e[0].points, 1);
});

test('дата тренировки — по Тбилиси, а не по UTC', () => {
  const e = computeEvents(base).find(x => x.code === 'attendance_present');
  assert.equal(e.occurred_on, '2026-10-19'); // 23:30 по Тбилиси = 19:30 UTC того же дня
});

test('матчи: участие всегда, победа +3, ничья +1, поражение и матч без счёта — только участие', () => {
  const s = summarize(computeEvents(base));
  assert.deepEqual(s.byRule.match_played, { n: 4, points: 8 });
  assert.deepEqual(s.byRule.match_win, { n: 1, points: 3 });
  assert.deepEqual(s.byRule.match_draw, { n: 1, points: 1 });
  assert.equal(s.total, 1 + 8 + 3 + 1);
});

test('не сыгравший (played=false) баллов за матч не получает', () => {
  const e = computeEvents(base).filter(x => x.player_id === 'P2');
  assert.equal(e.length, 0);
});

test('каждое начисление хранит правило, дату и текст', () => {
  for (const e of computeEvents(base)) { assert.ok(e.rule_id && e.occurred_on && e.explanation); }
});

test('нет нужного правила — ошибка, а не молчаливый ноль', () => {
  assert.throws(() => computeEvents({ ...base, rulesByCode: {} }), /Нет правила/);
});
