import { describe, expect, it } from 'vitest';
import { kitIssued, orderMatchesIssue } from './equipment';

const lines = [{ kit: 'Игровая форма', quantity: 1 }, { kit: 'Спортивный костюм', quantity: 1 }];

describe('orderMatchesIssue: выдача по вещи', () => {
  const formOnly = [{ kit: 'Игровая форма' }];
  it('вещь выбрана: форма выдана, костюм нет', () => {
    expect(kitIssued(formOnly, 'Игровая форма')).toBe(true);
    expect(orderMatchesIssue(lines, formOnly, false, 'Игровая форма')).toBe(false);
    expect(orderMatchesIssue(lines, formOnly, true, 'Игровая форма')).toBe(true);
    expect(orderMatchesIssue(lines, formOnly, false, 'Спортивный костюм')).toBe(true);
  });
  it('вещь не выбрана: заказ целиком, частично выданный = не выдано', () => {
    expect(orderMatchesIssue(lines, formOnly, false)).toBe(true);
    expect(orderMatchesIssue(lines, formOnly, true)).toBe(false);
    expect(orderMatchesIssue(lines, [...formOnly, { kit: 'Спортивный костюм' }], true)).toBe(true);
  });
});
