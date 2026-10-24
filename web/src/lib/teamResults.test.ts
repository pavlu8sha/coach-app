import { describe, expect, it } from 'vitest';
import { teamResults } from './teamResults';

const m = (played_on: string, goals_for: number, goals_against: number, opponent = 'X') => ({ played_on, opponent, goals_for, goals_against });

describe('teamResults', () => {
  it('пусто: нули и без лучшего матча', () => {
    expect(teamResults([])).toMatchObject({ games: 0, wins: 0, unbeaten: 0, best: null });
  });
  it('считает победы, ничьи, поражения и мячи', () => {
    const r = teamResults([m('2026-10-01', 3, 1), m('2026-10-05', 2, 2), m('2026-10-09', 0, 1)]);
    expect(r).toMatchObject({ games: 3, wins: 1, draws: 1, losses: 1, goalsFor: 5, goalsAgainst: 4 });
  });
  it('серия без поражений считается от последнего матча, независимо от порядка входных данных', () => {
    const r = teamResults([m('2026-10-09', 1, 1), m('2026-10-01', 0, 5), m('2026-10-05', 2, 0), m('2026-10-12', 4, 0)]);
    expect(r.unbeaten).toBe(3);
  });
  it('лучший матч — самая крупная победа', () => {
    const r = teamResults([m('2026-10-01', 11, 0, 'Kvartali'), m('2026-10-05', 12, 5), m('2026-10-09', 1, 0)]);
    expect(r.best?.opponent).toBe('Kvartali');
  });
  it('без побед лучшего матча нет', () => {
    expect(teamResults([m('2026-10-01', 1, 1), m('2026-10-05', 0, 2)]).best).toBeNull();
  });
  it('форма: пять последних исходов, свежий первым', () => {
    const r = teamResults([m('2026-10-01', 0, 1), m('2026-10-02', 1, 0), m('2026-10-03', 1, 1), m('2026-10-04', 2, 0), m('2026-10-05', 0, 3), m('2026-10-06', 5, 0)]);
    expect(r.form).toEqual(['w', 'l', 'w', 'd', 'w']);
  });
});
