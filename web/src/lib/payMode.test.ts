import { describe, expect, it } from 'vitest';
import { perVisitMonth } from './payMode';

// Условия приёмки: docs/PAY_MODE_RETURN_AND_NEXT_MONTH_ACCEPTANCE.md, часть A, п. 3 и 5 (то же правило, что player_per_visit_month в базе, 0229)
describe('perVisitMonth: период «за визит»', () => {
  const back = { pay_mode: 'subscription', pay_mode_from: '2026-11-01', pay_mode_until: '2026-12-01' };
  it('идёт с месяца начала, пока режим per_visit', () => {
    const pm = { pay_mode: 'per_visit', pay_mode_from: '2026-11-10', pay_mode_until: null };
    expect(perVisitMonth(pm, '2026-10-01')).toBe(false);
    expect(perVisitMonth(pm, '2026-11-01')).toBe(true);
    expect(perVisitMonth(pm, '2027-03-01')).toBe(true);
  });
  it('после возврата месяцы до месяца возврата остаются «за визит», месяц возврата — абонемент', () => {
    expect(perVisitMonth(back, '2026-10-01')).toBe(false);
    expect(perVisitMonth(back, '2026-11-01')).toBe(true);
    expect(perVisitMonth(back, '2026-12-01')).toBe(false);
  });
  it('возврат с середины месяца: месяц возврата целиком абонементный', () => {
    const pm = { pay_mode: 'subscription', pay_mode_from: '2026-11-01', pay_mode_until: '2026-12-15' };
    expect(perVisitMonth(pm, '2026-11-01')).toBe(true);
    expect(perVisitMonth(pm, '2026-12-01')).toBe(false);
  });
  it('обычный абонемент и отсутствие данных: не «за визит» (без 0200 и 0229 поведение прежнее)', () => {
    expect(perVisitMonth({ pay_mode: 'subscription', pay_mode_from: null, pay_mode_until: null }, '2026-11-01')).toBe(false);
    expect(perVisitMonth({ pay_mode: 'per_visit', pay_mode_from: '2026-11-01' }, '2026-11-01')).toBe(true);
    expect(perVisitMonth(null, '2026-11-01')).toBe(false);
  });
});
