import { describe, expect, it } from 'vitest';
import { kitIssued, nextStatus, orderDue, orderMatchesIssue, orderOverpaid, orderStatusLabel, prevStatus } from './equipment';

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

// #471 PR-1 (0185): docs/acceptance/eq-471-pr1-foundation-2026-11-12.md, Ф2, Ф8, Ф9
describe('статусы «Новый» и «Отменён», к оплате и переплата', () => {
  it('Ф2: «Новый» → «Принят в заказ» вперёд, назад в «Новый» нельзя; у отменённого шагов нет', () => {
    expect(orderStatusLabel('new')).toBe('Новый');
    expect(nextStatus('new')).toBe('accepted');
    expect(prevStatus('accepted')).toBeUndefined();
    expect(prevStatus('sewing')).toBe('accepted');
    expect(nextStatus('cancelled')).toBeUndefined();
    expect(prevStatus('cancelled')).toBeUndefined();
  });
  it('Ф9: «Отменён» подписан, неизвестный статус показывается как «Принят в заказ»', () => {
    expect(orderStatusLabel('cancelled')).toBe('Отменён');
    expect(orderStatusLabel('lost')).toBe('Принят в заказ');
    expect(orderStatusLabel(null)).toBe('Принят в заказ');
    expect(nextStatus('lost')).toBeUndefined();
  });
  it('Ф8: к оплате и переплата как eq_order_due / eq_order_overpaid', () => {
    expect(orderDue({ status: 'accepted', total: 300, paid: 100 })).toBe(200);
    expect(orderOverpaid({ status: 'accepted', total: 225, paid: 320 })).toBe(95);
    expect(orderDue({ status: 'accepted', total: 225, paid: 320 })).toBe(0);
    expect(orderDue({ status: 'cancelled', total: 300, paid: 100 })).toBe(0);
    expect(orderOverpaid({ status: 'cancelled', total: 300, paid: 100 })).toBe(100);
    expect(orderDue({ status: 'issued', total: '160.00', paid: '60.00' })).toBe(100);
  });
});
