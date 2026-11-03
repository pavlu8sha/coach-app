import { describe, expect, it } from 'vitest';
import { pausedMonthTest } from './playerStatus';

describe('pausedMonthTest: месяцы целиком на паузе не оплачиваются', () => {
  it('пауза с 30.09 без возвращения: октябрь и дальше без оплаты, сентябрь платный', () => {
    const t = pausedMonthTest([{ status: 'paused', on_date: '2026-09-30' }]);
    expect(t('2026-09-01')).toBe(false);
    expect(t('2026-10-01')).toBe(true);
    expect(t('2026-12-01')).toBe(true);
  });
  it('вернулся 01.11: октябрь без оплаты, ноябрь платный', () => {
    const t = pausedMonthTest([{ status: 'paused', on_date: '2026-09-30' }, { status: 'active', on_date: '2026-11-01' }]);
    expect(t('2026-10-01')).toBe(true);
    expect(t('2026-11-01')).toBe(false);
  });
  it('вернулся посреди ноября: ноябрь платный', () => {
    const t = pausedMonthTest([{ status: 'paused', on_date: '2026-09-30' }, { status: 'active', on_date: '2026-11-15' }]);
    expect(t('2026-10-01')).toBe(true);
    expect(t('2026-11-01')).toBe(false);
  });
  it('пауза началась посреди месяца: этот месяц платный', () => {
    const t = pausedMonthTest([{ status: 'paused', on_date: '2026-10-15' }]);
    expect(t('2026-10-01')).toBe(false);
    expect(t('2026-11-01')).toBe(true);
  });
  it('без журнала паузы нет', () => {
    expect(pausedMonthTest([])('2026-10-01')).toBe(false);
  });
});
