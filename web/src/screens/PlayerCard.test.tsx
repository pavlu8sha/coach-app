import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
  fake.db.point_events = [
    { id: 'e1', player_id: 'p1', points: 2, explanation: 'Победа в матче', occurred_on: '2026-10-05', source_type: 'match' },
    { id: 'e2', player_id: 'p1', points: 3, explanation: 'Гол: 2', occurred_on: '2026-10-05', source_type: 'match' },
  ];
}
const open = (name: string) => fireEvent.click(screen.getByRole('tab', { name }));

describe('карточка игрока: вкладки', () => {
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

  it('«Матчи»: сыгранные матчи, счёт и голы', async () => {
    seed();
    render(<PlayerCard player={player} onBack={() => {}} onEdit={() => {}} />);
    open('Матчи');
    expect(await screen.findByText(/05.10.2026 · U9-A — Динамо/)).toBeInTheDocument();
    expect(screen.getByText('3:1')).toBeInTheDocument();
    expect(screen.getByText('Матчей: 1 · голов: 2')).toBeInTheDocument();
    expect(screen.queryByText(/Другие/)).not.toBeInTheDocument(); // не играл и без голов
  });

  it('«Баллы»: сумма и список начислений', async () => {
    seed();
    render(<PlayerCard player={player} onBack={() => {}} onEdit={() => {}} />);
    open('Баллы');
    expect(await screen.findByText('Всего: 5 баллов · начислений: 2')).toBeInTheDocument();
    expect(screen.getByText('Победа в матче')).toBeInTheDocument();
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
    expect(field.parentElement?.classList.contains('two')).toBe(false);
    expect(field.parentElement?.querySelector('span:empty')).toBeNull();
  });

  it('ошибка базы показывается понятным текстом', async () => {
    seed();
    fake.errors.point_events = 'permission denied';
    render(<PlayerCard player={player} onBack={() => {}} onEdit={() => {}} />);
    open('Баллы');
    expect(await screen.findByText('permission denied')).toBeInTheDocument();
  });
});
