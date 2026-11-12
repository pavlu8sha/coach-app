import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DEBT_START } from '../lib/debtSeason';
import { fake } from '../test/fakeSupabase';
import PlayerCard from './PlayerCard';

const player = { id: 'p1', full_name: 'Иванов Пётр', birth_date: '2017-03-10', group_id: 'g1', status: 'active' as const, external_id: 'KS-001', group_name: 'U9-A' };
function seed() {
  fake.db.prices = [{ group_id: null, kind: 'subscription', amount: 165, valid_from: '2026-09-01', valid_to: null }];
  fake.db.payments = [];
  fake.db.subscriptions = [];
  fake.db.individual_bookings = [
    { session_id: 'i1', player_id: 'p1', amount: 50, paid: false, attended: true, individual_sessions: { starts_at: '2026-10-10T12:00:00', goalkeepers: true, topic: 'Ловля' } },
    { session_id: 'i2', player_id: 'p2', amount: 50, paid: false, attended: null, individual_sessions: { starts_at: '2026-10-11T12:00:00', goalkeepers: false, topic: null } },
  ];
  fake.db.extra_bookings = [{ session_id: 'e1', player_id: 'p1', paid: true, paid_amount: 20, attended: null, extra_sessions: { starts_on: '2026-10-15', amount: 20, place: 'Зал' } }];
  fake.db.equipment_orders = [{ id: 'o1', player_id: 'p1', ordered_on: '2026-09-10', total: 160, paid: 100, installment: true, number: '7', equipment_order_lines: [{ kit: 'Форма', size: '128', quantity: 1 }, { kit: 'Куртка', size: '128', quantity: 1 }], equipment_issues: [{ kit: 'Форма', issued_on: '2026-09-20' }] }];
  fake.db.match_players = [
    { match_id: 'm1', player_id: 'p1', played: true, goals: 2, matches: { played_on: '2026-10-05', team: 'U9-A', opponent: 'Динамо', goals_for: 3, goals_against: 1 } },
    { match_id: 'm2', player_id: 'p1', played: false, goals: 0, matches: { played_on: '2026-10-12', team: 'U9-A', opponent: 'Другие', goals_for: 0, goals_against: 0 } },
  ];
  fake.db.points_ledger = [
    { id: 'l1', player_id: 'p1', points: 2, event_date: '2026-10-05', source_type: 'match', reason_code: 'match', components: { result: 'win', base: 2, goals: 0, best: 0 }, status: 'active' },
    { id: 'l2', player_id: 'p1', points: 3, event_date: '2026-10-06', source_type: 'group_session', reason_code: 'attended', components: { class: 'regular', base: 3 }, status: 'active' },
  ];
}
const open = (name: string) => fireEvent.click(screen.getByRole('tab', { name }));

describe('карточка игрока: вкладки', () => {
  it('абонемент начинается с DEBT_START; августа нет', async () => {
    seed();
    render(<PlayerCard player={player} onBack={() => {}} onEdit={() => {}} />);
    expect(await screen.findByText(/Сентябрь 2026/)).toBeInTheDocument();
    expect(screen.queryByText(/Август 2026/)).toBeNull();
  });

  it('«Занятия»: индивидуальные и допы игрока по датам, чужие записи не попадают', async () => {
    seed();
    render(<PlayerCard player={player} onBack={() => {}} onEdit={() => {}} />);
    open('Занятия');
    expect(await screen.findByText(/10.10.2026 · Вратари/)).toBeInTheDocument();
    expect(screen.getByText(/15.10.2026 · Дополнительная тренировка/)).toBeInTheDocument();
    expect(screen.queryByText(/11.10.2026/)).not.toBeInTheDocument();
    expect(screen.getByText('Всего: 2 · не оплачено: 1')).toBeInTheDocument();
  });

  it('«Экипировка»: заказ, оплата и выдача', async () => {
    seed();
    render(<PlayerCard player={player} onBack={() => {}} onEdit={() => {}} />);
    open('Экипировка');
    expect(await screen.findByText('Форма + Куртка')).toBeInTheDocument();
    expect(screen.getByText('100 ₾ из 160 ₾')).toBeInTheDocument();
    expect(screen.getByText('Выдано: 1 из 2')).toBeInTheDocument();
  });

  it('#471 Ф9: отменённый заказ подписан «Отменён», долгом не считается', async () => {
    seed();
    (fake.db.equipment_orders as Record<string, unknown>[]).push({ id: 'o9', player_id: 'p1', ordered_on: '2026-09-12', total: 300, paid: 50, installment: false, number: '9', status: 'cancelled', equipment_order_lines: [{ kit: 'Дождевик', size: '140', quantity: 1 }], equipment_issues: [] });
    render(<PlayerCard player={player} onBack={() => {}} onEdit={() => {}} />);
    open('Экипировка');
    expect(await screen.findByText('Отменён, оплачено 50 ₾')).toBeInTheDocument();
    expect(screen.getByText('Номер игрока:')).toHaveTextContent('7'); // номер отменённого заказа не берётся
    expect(screen.getByText('100 ₾ из 160 ₾')).toBeInTheDocument();
  });

  it('«Матчи»: сыгранные матчи, счёт и голы', async () => {
    seed();
    render(<PlayerCard player={player} onBack={() => {}} onEdit={() => {}} />);
    open('Матчи');
    expect(await screen.findByText(/05.10.2026 · U9-A — Динамо/)).toBeInTheDocument();
    expect(screen.getByText('3:1')).toBeInTheDocument();
    expect(screen.getByText('Матчей: 1 · голов: 2')).toBeInTheDocument();
    expect(screen.queryByText(/Другие/)).not.toBeInTheDocument(); // не играл и без голов
  });

  it('«Баллы»: только новый журнал, сумма накопленных баллов', async () => {
    seed();
    render(<PlayerCard player={player} onBack={() => {}} onEdit={() => {}} />);
    open('Баллы');
    expect(await screen.findByText('Всего накоплено: 5 баллов')).toBeInTheDocument();
  });

  it('«К оплате» встроен в карточку: долг по абонементу и экипировке', async () => {
    seed();
    render(<PlayerCard player={player} onBack={() => {}} onEdit={() => {}} />);
    open('К оплате');
    expect(await screen.findByText(/к оплате:/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Экипировка' })).toBeInTheDocument();
    expect(screen.getByText(/Внесено 100 ₾ из 160 ₾/)).toBeInTheDocument();
  });

  it('«К оплате»: форма оплаты вратарской занимает всю ширину, способ не прижат к краю', async () => {
    seed();
    render(<PlayerCard player={player} onBack={() => {}} onEdit={() => {}} />);
    open('К оплате');
    const card = (await screen.findByText(/Вратари/)).closest('.ks-card') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: 'Принять оплату' }));
    const field = within(card).getByLabelText('Способ').closest('.field') as HTMLElement;
    expect(field.parentElement?.querySelector('span:empty')).toBeNull();
  });

  it('«Баллы»: без начислений в новом журнале показывает «Баллов пока нет»', async () => {
    seed();
    fake.db.points_ledger = [];
    render(<PlayerCard player={player} onBack={() => {}} onEdit={() => {}} />);
    open('Баллы');
    expect(await screen.findByText('Баллов пока нет')).toBeInTheDocument();
  });
});

describe('visibleMonths', () => {
  it('история начинается с месяца прихода игрока', async () => {
    const { visibleMonths } = await import('./PlayerCard');
    const ms = ['2027-01-01', '2026-12-01', '2026-11-01', '2026-10-01', '2026-09-01'];
    expect(visibleMonths(ms, '2026-12-01')).toEqual(['2027-01-01', '2026-12-01']);
    expect(visibleMonths(ms, '2026-09-01')).toEqual(ms);
  });
});

describe('месяцы ушедшего игрока', () => {
  it('после последнего абонемента или платежа месяцы не показываются', async () => {
    const { visibleMonths, lastMonth } = await import('./PlayerCard');
    const ms = ['2026-12-01', '2026-11-01', '2026-10-01', '2026-09-01'];
    const end = lastMonth(['2026-09-01'], [{ month: '2026-09-01' }], '2026-09-01');
    expect(end).toBe('2026-09-01');
    expect(visibleMonths(ms, '2026-09-01', end)).toEqual(['2026-09-01']);
    expect(visibleMonths(ms, '2026-09-01', null)).toEqual(ms);
  });
});

describe('карточка игрока на паузе', () => {
  it('месяцы после начала паузы без платежей не рисуются', async () => {
    seed();
    fake.db.payments = [{ amount: 165, paid_on: '2026-09-05', pay_month: '2026-09-01' }];
    fake.db.player_status_log = [{ player_id: 'p1', status: 'paused', on_date: '2026-09-30', created_at: '2026-11-02T17:00:00Z' }];
    render(<PlayerCard player={{ ...player, status: 'paused' }} onBack={() => {}} onEdit={() => {}} />);
    expect(await screen.findByText(/Сентябрь 2026/)).toBeInTheDocument();
    expect(screen.queryByText(/Октябрь 2026/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Ноябрь 2026/)).not.toBeInTheDocument();
  });
});

describe('карточка ушедшего игрока', () => {
  it('месяцы после ухода без платежей не рисуются, даже если строка абонемента есть', async () => {
    seed();
    fake.db.players = [{ id: 'p1', created_at: '2026-09-01T00:00:00Z', ends_on: '2026-09-30' }];
    fake.db.payments = [{ amount: 165, paid_on: '2026-09-05', pay_month: '2026-09-01' }];
    fake.db.subscriptions = [{ player_id: 'p1', month: '2026-10-01', group_id: 'g1', discount: false, written_off: false }];
    render(<PlayerCard player={{ ...player, status: 'inactive' }} onBack={() => {}} onEdit={() => {}} />);
    expect(await screen.findByText(/Сентябрь 2026/)).toBeInTheDocument();
    expect(screen.queryByText(/Октябрь 2026/)).not.toBeInTheDocument();
  });
});

describe('firstMonth', () => {
  it('платёж и его отмена не открывают месяц', async () => {
    const { firstMonth } = await import('./PlayerCard');
    const pays = [{ amount: 130, month: '2026-10-01' }, { amount: -130, month: '2026-10-01' }, { amount: 130, month: '2026-11-01' }];
    expect(firstMonth([], pays, '2026-11-01', DEBT_START)).toBe('2026-11-01');
    expect(firstMonth([], [{ amount: 130, month: '2026-10-01' }], '2026-11-01', DEBT_START)).toBe('2026-10-01');
    expect(firstMonth([], [], null, DEBT_START)).toBe(DEBT_START);
  });
});
