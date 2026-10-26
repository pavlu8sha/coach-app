import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { today } from '../lib/coach';
import { fake } from '../test/fakeSupabase';
import CashDesk from './CashDesk';
import { monthIso, nextMonth } from './MonthPayments';

const M = monthIso(new Date());
function seed() {
  fake.db.players = [{ id: 'p1', full_name: 'Иванов Пётр', group_id: 'g1', groups: { name: 'U9-A' } }];
  fake.db.prices = [{ group_id: null, kind: 'subscription', amount: 165, valid_from: '2026-09-01', valid_to: null }];
  fake.db.payments = [{ id: 'x1', player_id: 'p1', amount: 50, paid_on: M, method: 'Наличные', players: { full_name: 'Иванов Пётр' } }];
  fake.db.subscriptions = [];
  fake.db.equipment_orders = [{ id: 'o1', player_id: 'p1', ordered_on: '2026-09-10', total: 160, paid: 60, equipment_order_lines: [{ kit: 'Форма' }, { kit: 'Куртка' }] }];
  fake.db.individual_bookings = [
    { session_id: 'i1', player_id: 'p1', amount: 50, paid: false, individual_sessions: { starts_at: '2020-01-10T12:00:00', goalkeepers: true } },
    { session_id: 'i2', player_id: 'p1', amount: 50, paid: false, individual_sessions: { starts_at: '2099-01-10T12:00:00', goalkeepers: false } }, // будущее — не долг
  ];
  fake.db.extra_bookings = [{ session_id: 'e1', player_id: 'p1', paid: false, extra_sessions: { starts_on: '2020-02-01', amount: 20 } }];
  fake.db.camp_participants = [{ id: 'cp1', player_id: 'p1', amount: 850, status: 'registered', camps: { name: 'Зимний лагерь' }, camp_payments: [{ amount: 100 }] }];
}
async function openPlayer() {
  render(<CashDesk />);
  fireEvent.change(screen.getByLabelText(/^Игрок/), { target: { value: 'Иванов' } });
  fireEvent.click(await screen.findByRole('button', { name: /Иванов Пётр/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Наличные' }));
}
const card = (t: string | RegExp) => screen.getByText(t).closest('.ks-card') as HTMLElement;

describe('«Приём оплат»', () => {
  it('показывает всё, что к оплате, по разделам; будущие занятия не считаются долгом', async () => {
    seed();
    await openPlayer();
    expect(await screen.findByText(/к оплате: 1035 ₾/)).toBeInTheDocument(); // 115 + 100 + 50 + 20 + 750
    for (const h of ['Абонемент', 'Экипировка', 'Индивидуальные и вратари', 'Дополнительные тренировки', 'Сборы']) expect(screen.getByRole('heading', { name: h })).toBeInTheDocument();
    expect(await screen.findByText(/Внесено 50 ₾ из 165 ₾/)).toBeInTheDocument();
    expect(screen.getByText(/Внесено 60 ₾ из 160 ₾/)).toBeInTheDocument();
    expect(screen.getByText(/Вратари 10.01.2020/)).toBeInTheDocument();
    expect(screen.queryByText(/10.01.2099/)).not.toBeInTheDocument();
  });

  it('абонемент: частичный платёж идёт в журнал со способом и датой', async () => {
    seed();
    await openPlayer();
    await screen.findByText(/Внесено 50 ₾ из 165 ₾/);
    const sub = card(/Внесено 50 ₾ из 165 ₾/);
    fireEvent.click(within(sub).getByRole('button', { name: 'Принять оплату' }));
    expect(within(sub).getByLabelText(/Сумма/)).toHaveValue('115');
    fireEvent.change(within(sub).getByLabelText(/Сумма/), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: 'Перевод' }));
    fireEvent.click(within(sub).getByRole('button', { name: 'Записать платёж' }));
    await waitFor(() => expect(fake.writes('payments', 'insert')).toHaveLength(1));
    expect(fake.writes('payments', 'insert')[0]).toMatchObject({ player_id: 'p1', amount: 60, method: 'Перевод', paid_on: today() });
  });

  it('экипировка, индивидуальные, доп. тренировки и сборы платятся через свои функции', async () => {
    seed();
    fake.rpc.eq_add_payment = () => 160;
    fake.rpc.ind_set_paid = () => null;
    fake.rpc.extra_set_paid = () => null;
    fake.rpc.camp_pay = () => 'id';
    await openPlayer();
    await screen.findByText(/к оплате:/);
    const pay = async (title: string | RegExp, btn: string) => {
      await screen.findByText(title);
      const c = card(title);
      fireEvent.click(within(c).getByRole('button', { name: 'Принять оплату' }));
      fireEvent.click(within(c).getByRole('button', { name: btn }));
    };
    await pay('Форма + Куртка', 'Записать платёж');
    await waitFor(() => expect(fake.rpcCalls('eq_add_payment')).toEqual([{ o: 'o1', amt: 100 }]));
    await pay(/Вратари 10.01.2020/, 'Отметить оплаченным (50 ₾)');
    await waitFor(() => expect(fake.rpcCalls('ind_set_paid')).toEqual([{ s: 'i1', p: 'p1', is_paid: true }]));
    await pay(/Доп. тренировка 01.02.2020/, 'Записать платёж');
    await waitFor(() => expect(fake.rpcCalls('extra_set_paid')[0]).toMatchObject({ s: 'e1', p: 'p1', is_paid: true, amt: 20 }));
    await pay('Зимний лагерь', 'Записать платёж');
    await waitFor(() => expect(fake.rpcCalls('camp_pay')[0]).toMatchObject({ pid: 'cp1', amt: 750, k: 'payment' }));
  });

  it('списанный месяц и месяц со скидкой и оплатой в долги не попадают; ошибка базы показывается', async () => {
    seed();
    fake.db.subscriptions = [{ player_id: 'p1', month: M, group_id: null, discount: true, written_off: false }];
    fake.db.equipment_orders = [];
    fake.db.individual_bookings = [];
    fake.db.extra_bookings = [];
    fake.db.camp_participants = [];
    await openPlayer();
    expect(await screen.findByText(/Долгов нет/)).toBeInTheDocument(); // скидка и что-то внесено — месяц закрыт
  });

  it('оплата вперёд: следующий месяц виден, в сумму долга не входит, платёж с реальной датой и месяцем-назначением', async () => {
    seed();
    fake.db.equipment_orders = [];
    fake.db.individual_bookings = [];
    fake.db.extra_bookings = [];
    fake.db.camp_participants = [];
    fake.db.payments = [{ id: 'x1', player_id: 'p1', amount: 165, paid_on: M, method: 'Наличные', players: { full_name: 'Иванов Пётр' } }];
    await openPlayer();
    expect(await screen.findByText(/Долгов нет/)).toBeInTheDocument();
    const next = nextMonth(M);
    const c = card(/\(вперёд\)/);
    fireEvent.click(within(c).getByRole('button', { name: 'Принять оплату' }));
    fireEvent.click(screen.getByRole('button', { name: 'Перевод' }));
    fireEvent.click(within(c).getByRole('button', { name: 'Записать платёж' }));
    await waitFor(() => expect(fake.writes('payments', 'insert')).toHaveLength(1));
    expect(fake.writes('payments', 'insert')[0]).toMatchObject({ player_id: 'p1', amount: 165, paid_on: today(), for_month: next, method: 'Перевод' });
  });

  it('«Внесено» за выбранную дату: платежи абонемента и сборов, итог по дню', async () => {
    seed();
    fake.db.payments = [
      { id: 'a1', player_id: 'p1', amount: 100, paid_on: '2026-10-05', method: 'Наличные', players: { full_name: 'Иванов Пётр' } },
      { id: 'a2', player_id: 'p2', amount: -20, paid_on: '2026-10-05', method: 'Исправление', players: { full_name: 'Сидоров Ян' } },
      { id: 'a3', player_id: 'p3', amount: 999, paid_on: '2026-10-06', method: 'Наличные', players: { full_name: 'Другой День' } },
    ];
    fake.db.camp_payments = [{ id: 'c1', player_id: 'p1', amount: 250, paid_on: '2026-10-05', method: 'Перевод', kind: 'payment', players: { full_name: 'Иванов Пётр' } }];
    render(<CashDesk />);
    fireEvent.change(screen.getByLabelText('Дата платежей'), { target: { value: '2026-10-05' } });
    expect(await screen.findByRole('heading', { name: /Внесено 05.10.2026.*330 ₾/ })).toBeInTheDocument();
    expect(screen.getByText('Абонемент · Наличные')).toBeInTheDocument();
    expect(screen.getByText('Сбор · Перевод')).toBeInTheDocument();
    expect(screen.queryByText('Другой День')).not.toBeInTheDocument();
  });

  it('без выбранного способа вверху экрана платёж не записывается', async () => {
    seed();
    render(<CashDesk />);
    fireEvent.change(screen.getByLabelText(/^Игрок/), { target: { value: 'Иванов' } });
    fireEvent.click(await screen.findByRole('button', { name: /^Иванов Пётр/ }));
    await screen.findByText(/Внесено 50 ₾ из 165 ₾/);
    const sub = card(/Внесено 50 ₾ из 165 ₾/);
    fireEvent.click(within(sub).getByRole('button', { name: 'Принять оплату' }));
    fireEvent.click(within(sub).getByRole('button', { name: 'Записать платёж' }));
    expect(await screen.findByText(/Выберите способ оплаты вверху экрана/)).toBeInTheDocument();
    expect(fake.writes('payments', 'insert')).toHaveLength(0);
  });

  it('будущая дата платежа отклоняется без записи; «Внесено сегодня» показывает итог', async () => {
    seed();
    fake.db.payments = [{ id: 'x1', player_id: 'p1', amount: 50, paid_on: today(), method: 'Наличные', players: { full_name: 'Иванов Пётр' } }];
    render(<CashDesk />);
    expect(await screen.findByRole('heading', { name: /Внесено сегодня.*50 ₾/ })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Игрок/), { target: { value: 'Иванов' } });
    fireEvent.click(await screen.findByRole('button', { name: /^Иванов Пётр/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Наличные' }));
    await screen.findByText(/Внесено 50 ₾ из 165 ₾/);
    const sub = card(/Внесено 50 ₾ из 165 ₾/);
    fireEvent.click(within(sub).getByRole('button', { name: 'Принять оплату' }));
    fireEvent.change(within(sub).getByLabelText('Дата'), { target: { value: '2999-01-05' } });
    fireEvent.click(within(sub).getByRole('button', { name: 'Записать платёж' }));
    expect(await screen.findByText(/Дата платежа не может быть в будущем/)).toBeInTheDocument();
    expect(fake.writes('payments', 'insert')).toHaveLength(0);
  });
});

describe('«Приём оплат»: платежи дня', () => {
  it('показывает наличные/перевод и отменяет оплату записью с минусом', async () => {
    seed();
    fake.db.payments = [{ id: 'x1', player_id: 'p1', amount: 50, paid_on: today(), method: 'Наличные', players: { full_name: 'Иванов Пётр' } }];
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<CashDesk />);
    await screen.findByRole('heading', { name: /Внесено сегодня.*50 ₾/ });
    expect(screen.getByText('Наличные').nextSibling?.textContent).toBe('50 ₾');
    fireEvent.click(screen.getByRole('button', { name: 'Отменить оплату: Иванов Пётр' }));
    await waitFor(() => expect(fake.writes('payments', 'insert')).toEqual([expect.objectContaining({ player_id: 'p1', amount: -50, paid_on: today(), method: 'Исправление' })]));
  });
  it('отмена платежа вперёд записывается в тот же месяц; отменённый платёж не отменить дважды', async () => {
    seed();
    fake.db.payments = [{ id: 'a1', player_id: 'p1', amount: 165, paid_on: today(), for_month: '2099-11-01', method: 'Перевод', players: { full_name: 'Иванов Пётр' } }];
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<CashDesk />);
    await screen.findByRole('heading', { name: /Внесено сегодня.*165 ₾/ });
    fireEvent.click(screen.getByRole('button', { name: 'Отменить оплату: Иванов Пётр' }));
    await waitFor(() => expect(fake.writes('payments', 'insert')).toEqual([expect.objectContaining({ amount: -165, for_month: '2099-11-01', method: 'Исправление' })]));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Отменить оплату: Иванов Пётр' })).toBeNull());
  });
});
