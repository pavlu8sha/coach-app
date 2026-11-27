import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import { fetchLedgerTotals, grandTotal, latestMonth, ledgerLabel, monthLabel, monthTotal, shiftMonth, type LedgerRow } from './pointsLedger';

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
  it('матч: оценка тренера и бонус лучшего игрока', () => {
    const l = ledgerLabel(row({ source_type: 'match', points: 6, components: { model: 'rating', rating: 5, best: true, best_bonus: 1, before_cap: 6, cap: 6, technical: false } }));
    expect(l).toEqual({ title: 'Матч — оценка тренера 5', detail: 'лучший игрок +1' });
  });
  it('матч без бонуса: только оценка, без побед, голов и ограничения', () => {
    const l = ledgerLabel(row({ source_type: 'match', points: 3, components: { model: 'rating', rating: 3, best: false, best_bonus: 0, before_cap: 3, cap: 6 } }));
    expect(l).toEqual({ title: 'Матч — оценка тренера 3', detail: undefined });
  });
  it('матч: если до ограничения было больше, это видно в основании', () => {
    const l = ledgerLabel(row({ source_type: 'match', points: 6, components: { model: 'rating', rating: 6, best: true, best_bonus: 1, before_cap: 7, cap: 6 } }));
    expect(l.detail).toBe('лучший игрок +1 · ограничено максимумом 6 за матч');
  });
  it('старая запись за матч (победа, голы) показывается без расшифровки по старой формуле', () => {
    const l = ledgerLabel(row({ source_type: 'match', points: 5, components: { result: 'win', base: 2, goals: 3, best: 2, before_cap: 7, cap: 5 } }));
    expect(l).toEqual({ title: 'Матч (по прежним правилам)' });
    const text = JSON.stringify(l);
    expect(text).not.toMatch(/победа|ничья|поражение|голы|участие/);
  });
  it('матч: ни победа, ни голы в подписи не участвуют', () => {
    const l = ledgerLabel(row({ source_type: 'match', points: 4, components: { model: 'rating', rating: 4, best: false, best_bonus: 0, result: 'win', goals: 5 } }));
    expect(JSON.stringify(l)).not.toMatch(/победа|ничья|поражение|голы/);
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

describe('fetchLedgerTotals: итог по журналу любой длины', () => {
  const bulk = (n: number, player: string, status = 'active') => Array.from({ length: n }, (_, i) => ({ id: `${player}-${String(i).padStart(5, '0')}`, player_id: player, status, points: 1 }));
  it.each([999, 1000, 1001, 2500])('%i действующих записей суммируются полностью; отменённые не входят', async n => {
    fake.db.points_ledger = [...bulk(n, 'p1'), ...bulk(5, 'p1x', 'cancelled').map(r => ({ ...r, player_id: 'p1' })), ...bulk(3, 'p2')];
    const r = await fetchLedgerTotals(['p1', 'p2']);
    expect(r.error).toBeNull();
    expect(r.totals.p1).toBe(n);
    expect(r.totals.p2).toBe(3);
  });
  it('ошибка чтения возвращается строкой, а не нулевой суммой', async () => {
    fake.db.points_ledger = bulk(3, 'p1');
    fake.errors.points_ledger = 'сбой';
    const r = await fetchLedgerTotals(['p1']);
    expect(r.error).toBeTruthy();
  });
  it('запись, появившаяся между страницами, не задваивает итог', async () => {
    fake.db.points_ledger = bulk(1500, 'p1').map((r, i) => ({ ...r, id: `m${String(i + 100).padStart(5, '0')}` }));
    const a = fake.hold('points_ledger');
    const b = fake.hold('points_ledger');
    const run = fetchLedgerTotals(['p1']);
    await new Promise(r => setTimeout(r, 10));
    a.release();
    await new Promise(r => setTimeout(r, 10));
    fake.db.points_ledger = [...(fake.db.points_ledger as object[]), { id: 'm00001', player_id: 'p1', status: 'active', points: 1 }];
    b.release();
    const r = await run;
    expect(r.totals.p1).toBe(1500); // прежние 1500 ровно по разу; новая запись прочитана или нет — зависит от id, но дубля нет
  });
});
