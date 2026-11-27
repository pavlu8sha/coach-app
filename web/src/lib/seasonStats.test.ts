import { describe, expect, it } from 'vitest';
import { matchHighlights, prevWeek, seasonStart, thisWeek } from './seasonStats';

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

  it('эта неделя: с понедельника по сегодня, в том числе в понедельник и воскресенье', () => {
    expect(thisWeek('2026-11-23')).toEqual({ f: '2026-11-23', t: '2026-11-23' }); // понедельник
    expect(thisWeek('2026-11-27')).toEqual({ f: '2026-11-23', t: '2026-11-27' }); // пятница
    expect(thisWeek('2026-11-29')).toEqual({ f: '2026-11-23', t: '2026-11-29' }); // воскресенье
  });

  it('прошлая неделя: понедельник–воскресенье, через границу месяца и года', () => {
    expect(prevWeek('2026-11-27')).toEqual({ f: '2026-11-16', t: '2026-11-22' });
    expect(prevWeek('2026-11-23')).toEqual({ f: '2026-11-16', t: '2026-11-22' }); // понедельник
    expect(prevWeek('2026-11-29')).toEqual({ f: '2026-11-16', t: '2026-11-22' }); // воскресенье
    expect(prevWeek('2026-12-02')).toEqual({ f: '2026-11-23', t: '2026-11-29' });
    expect(prevWeek('2027-01-04')).toEqual({ f: '2026-12-28', t: '2027-01-03' });
  });
});
