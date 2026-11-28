import { describe, expect, it } from 'vitest';
import { nextMonthDue } from './nextMonth';

// Условия приёмки: docs/PAY_MODE_RETURN_AND_NEXT_MONTH_ACCEPTANCE.md, часть B, п. 1 и 8 (то же правило, что debt_month_limit в базе, 0230)
describe('nextMonthDue: порог следующего месяца', () => {
  it('до 22-го нет, с 22-го да', () => {
    expect(nextMonthDue(new Date(2026, 10, 21), 22)).toBe(false);
    expect(nextMonthDue(new Date(2026, 10, 22), 22)).toBe(true);
    expect(nextMonthDue(new Date(2026, 10, 30), 22)).toBe(true);
  });
  it('конец года: 22 декабря январь уже долг', () => {
    expect(nextMonthDue(new Date(2026, 11, 21), 22)).toBe(false);
    expect(nextMonthDue(new Date(2026, 11, 22), 22)).toBe(true);
  });
  it('в коротком месяце порог не позже последнего дня (31 в ноябре — 30-го)', () => {
    expect(nextMonthDue(new Date(2026, 10, 29), 31)).toBe(false);
    expect(nextMonthDue(new Date(2026, 10, 30), 31)).toBe(true);
  });
  it('недопустимая настройка (NaN): следующий месяц долгом не считается', () => {
    expect(nextMonthDue(new Date(2026, 10, 30), NaN)).toBe(false);
  });
});
