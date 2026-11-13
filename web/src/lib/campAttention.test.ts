import { describe, expect, it } from 'vitest';
import { campAttention, netPaid, tbilisiToday } from './campAttention';

const camp = { booking_fee: 500, booking_deadline: '2026-12-05' };
const p = (id: string, status: 'registered' | 'declined' | 'cancelled', pays: number[]) => ({ id, status, camp_payments: pays.map(amount => ({ amount })) });

describe('campAttention (условие 66)', () => {
  it('внесено считается с возвратами и отменами (минус)', () => {
    expect(netPaid(p('a', 'cancelled', [500, -200]))).toBe(300);
    expect(netPaid(p('a', 'cancelled', [500, -500]))).toBe(0);
  });

  it('возврат не оформлен: отменённые и отказ с внесёнными деньгами; полностью возвращённые и записанные не попадают', () => {
    const r = campAttention(camp, [p('c1', 'cancelled', [500]), p('c2', 'cancelled', [500, -500]), p('d1', 'declined', [100]), p('d2', 'declined', []), p('r1', 'registered', [800])], '2026-11-12');
    expect(r.refunds.map(x => [x.id, x.paid])).toEqual([['c1', 500], ['d1', 100]]);
  });

  it('нет брони после срока: только записанные, только после срока, только если внесено меньше брони', () => {
    const parts = [p('r0', 'registered', []), p('r1', 'registered', [200]), p('r2', 'registered', [500]), p('c', 'cancelled', [])];
    expect(campAttention(camp, parts, '2026-12-05').noBooking).toEqual([]);
    expect(campAttention(camp, parts, '2026-12-06').noBooking.map(x => [x.id, x.paid])).toEqual([['r0', 0], ['r1', 200]]);
  });

  it('без срока брони или с нулевой бронью вторая часть пустая', () => {
    const parts = [p('r0', 'registered', [])];
    expect(campAttention({ booking_fee: 500, booking_deadline: null }, parts, '2030-01-01').noBooking).toEqual([]);
    expect(campAttention({ booking_fee: 0, booking_deadline: '2026-12-05' }, parts, '2030-01-01').noBooking).toEqual([]);
  });

  it('копейки не дают ложной строки', () => {
    expect(campAttention(camp, [p('c', 'cancelled', [100.1, -100.1])], '2026-11-12').refunds).toEqual([]);
  });

  it('сегодня берётся по Тбилиси, а не по телефону', () => {
    // 2026-12-05 21:30 UTC = 2026-12-06 01:30 в Тбилиси
    expect(tbilisiToday(new Date('2026-12-05T21:30:00Z'))).toBe('2026-12-06');
  });
});
