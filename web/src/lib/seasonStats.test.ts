import { describe, expect, it } from 'vitest';
import { matchHighlights, seasonStart } from './seasonStats';

const m = (d: string, a: number | null, b: number | null) => ({ played_on: d, goals_for: a, goals_against: b });

describe('matchHighlights', () => {
  it('серия считается от последнего матча, ничья и поражение её обрывают', () => {
    expect(matchHighlights([m('2026-10-01', 1, 0), m('2026-10-08', 2, 2), m('2026-10-15', 3, 0), m('2026-10-22', 1, 0)]).streak).toBe(2);
    expect(matchHighlights([m('2026-10-01', 1, 0), m('2026-10-08', 0, 2)]).streak).toBe(0);
  });
  it('лучший матч: наибольшая разница, при равенстве — больше забито; матчи без счёта пропускаются', () => {
    const r = matchHighlights([m('2026-10-01', 5, 2), m('2026-10-08', 4, 1), m('2026-10-09', null, null), m('2026-10-10', 0, 4)]);
    expect(r.best?.played_on).toBe('2026-10-01');
    expect(matchHighlights([m('2026-10-10', 0, 4)]).best).toBeNull();
  });
});

describe('seasonStart', () => {
  it('сезон начинается 1 сентября', () => {
    expect(seasonStart('2026-11-01')).toBe('2026-09-01');
    expect(seasonStart('2026-03-10')).toBe('2025-09-01');
  });
});
