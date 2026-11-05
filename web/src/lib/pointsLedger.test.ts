import { describe, expect, it } from 'vitest';
import { grandTotal, latestMonth, ledgerLabel, monthLabel, monthTotal, shiftMonth, type LedgerRow } from './pointsLedger';

const row = (o: Partial<LedgerRow>): LedgerRow => ({ id: 'x', event_date: '2026-12-03', points: 1, source_type: 'group_session', reason_code: 'attended', components: {}, ...o });

describe('подписи начислений', () => {
  it('тренировки по видам', () => {
    expect(ledgerLabel(row({ components: { class: 'regular' } })).title).toBe('Тренировка — посещение');
    expect(ledgerLabel(row({ components: { class: 'moved' } })).title).toBe('Перенесённая тренировка — посещение');
    expect(ledgerLabel(row({ components: { class: 'unscheduled' } })).title).toBe('Внеплановая тренировка — посещение');
    expect(ledgerLabel(row({ source_type: 'individual' })).title).toBe('Индивидуальная тренировка — посещение');
    expect(ledgerLabel(row({ source_type: 'goalkeeper' })).title).toBe('Вратарская тренировка — посещение');
    expect(ledgerLabel(row({ source_type: 'extra' })).title).toBe('Дополнительная тренировка — посещение');
  });
  it('матч: результат, из чего сложились баллы и ограничение', () => {
    const l = ledgerLabel(row({ source_type: 'match', points: 5, components: { result: 'win', base: 2, goals: 3, best: 2, before_cap: 7, cap: 5 } }));
    expect(l.title).toBe('Матч — победа');
    expect(l.detail).toBe('участие +2, голы +3, лучший игрок +2 · ограничено максимумом 5 за матч');
  });
  it('матч без ограничения и без голов', () => {
    const l = ledgerLabel(row({ source_type: 'match', points: 1, components: { result: 'loss', base: 1, goals: 0, best: 0, before_cap: 1, cap: 5 } }));
    expect(l).toEqual({ title: 'Матч — поражение', detail: 'участие +1' });
  });
  it('серия и ручные баллы', () => {
    expect(ledgerLabel(row({ source_type: 'series_bonus', components: { threshold: 12 } })).title).toBe('Серия: 12 тренировок подряд');
    expect(ledgerLabel(row({ source_type: 'manual', components: { note: 'Старание' } })).title).toBe('От тренера: Старание');
  });
});

describe('месяцы и итоги', () => {
  const rows = [row({ event_date: '2026-12-10', points: 2 }), row({ event_date: '2026-12-03', points: 1 }), row({ event_date: '2027-01-02', points: 4 })];
  it('итог за месяц и всего', () => {
    expect(monthTotal(rows, '2026-12')).toBe(3);
    expect(monthTotal(rows, '2026-11')).toBe(0);
    expect(grandTotal(rows)).toBe(7);
  });
  it('названия и переход между годами', () => {
    expect(monthLabel('2026-12')).toBe('Декабрь 2026');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2027-01', -1)).toBe('2026-12');
  });
  it('последний месяц с начислениями', () => {
    expect(latestMonth(rows, '2026-12')).toBe('2027-01');
    expect(latestMonth([], '2026-12')).toBe('2026-12');
  });
});
