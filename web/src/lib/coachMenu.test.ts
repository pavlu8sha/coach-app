import { describe, expect, it } from 'vitest';
import { COACH_BAR, coachBar } from './coachMenu';

describe('нижняя панель тренера', () => {
  it('без детей: пять пунктов, включая «Посещаемость» и «Учёт»', () => {
    expect(coachBar(false).map(x => x.label)).toEqual(['Занятия', 'Посещаемость', 'Учёт', 'Матчи', 'Группа']);
    expect(coachBar(false)).toBe(COACH_BAR);
  });

  it('тренер-родитель: «Ребёнок» занимает место «Посещаемости», пунктов по-прежнему пять', () => {
    const bar = coachBar(true);
    expect(bar.map(x => x.label)).toEqual(['Занятия', 'Ребёнок', 'Учёт', 'Матчи', 'Группа']);
    expect(bar.find(x => x.value === 'attendance')).toBeUndefined();
  });

  it('значения пунктов уникальны и не больше пяти', () => {
    for (const hasKids of [false, true]) {
      const values = coachBar(hasKids).map(x => x.value);
      expect(values.length).toBeLessThanOrEqual(5);
      expect(new Set(values).size).toBe(values.length);
    }
  });
});
