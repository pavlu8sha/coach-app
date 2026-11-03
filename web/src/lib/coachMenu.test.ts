import { describe, expect, it } from 'vitest';
import { COACH_BAR, coachBar } from './coachMenu';

describe('нижняя панель тренера', () => {
  it('без детей: шесть пунктов, включая «Посещаемость», «Учёт» и «Статьи»', () => {
    expect(coachBar(false).map(x => x.label)).toEqual(['Занятия', 'Матчи', 'Посещаемость', 'Учёт', 'Группа', 'Статьи']);
    expect(coachBar(false)).toBe(COACH_BAR);
  });

  it('тренер-родитель: «Ребёнок» занимает место «Посещаемости», пунктов по-прежнему шесть', () => {
    const bar = coachBar(true);
    expect(bar.map(x => x.label)).toEqual(['Занятия', 'Матчи', 'Ребёнок', 'Учёт', 'Группа', 'Статьи']);
    expect(bar.find(x => x.value === 'attendance')).toBeUndefined();
  });

  it('значения пунктов уникальны и не больше шести', () => {
    for (const hasKids of [false, true]) {
      const values = coachBar(hasKids).map(x => x.value);
      expect(values.length).toBeLessThanOrEqual(6);
      expect(new Set(values).size).toBe(values.length);
    }
  });
});
