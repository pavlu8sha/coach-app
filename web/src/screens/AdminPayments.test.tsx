import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fake } from '../test/fakeSupabase';
import { today } from '../lib/coach';
import AdminPayments from './AdminPayments';
import AdminPrices from './AdminPrices';

function seedPay() {
  fake.db.players = [{ id: 'p1', full_name: 'Иванов Пётр', groups: { name: 'U9' } }];
  fake.db.payments = [{ id: 'y1', player_id: 'p1', amount: 100, paid_on: '2026-10-01', method: 'Наличные' }];
}
const openPlayer = async () => {
  render(<AdminPayments />);
  fireEvent.change(screen.getByLabelText('Найти игрока'), { target: { value: 'иван' } });
  fireEvent.click(await screen.findByText('Иванов Пётр'));
  await screen.findByText('Внести платёж', { selector: 'h3' });
};

describe('«Платежи» (администратор)', () => {
  it('платёж записывается только после подтверждения, с суммой, датой, способом и автором', async () => {
    seedPay();
    await openPlayer();
    fireEvent.change(screen.getByLabelText(/Сумма/), { target: { value: '65,5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Внести платёж' }));
    expect(await screen.findByText('Выберите способ оплаты.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Способ/), { target: { value: 'Наличные' } });
    fireEvent.click(screen.getByRole('button', { name: 'Внести платёж' }));
    expect(screen.getByText(/Записать 65\.50 ₾/)).toBeInTheDocument();
    expect(fake.writes('payments', 'insert')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Записать платёж' }));
    await waitFor(() => expect(fake.writes('payments', 'insert')).toEqual([{ player_id: 'p1', amount: 65.5, paid_on: today(), method: 'Наличные' }]));
    expect(await screen.findByText('Платёж записан.')).toBeInTheDocument();
  });

  it('пустая сумма, ноль и будущая дата отклоняются', async () => {
    seedPay();
    await openPlayer();
    fireEvent.click(screen.getByRole('button', { name: 'Внести платёж' }));
    expect(await screen.findByText('Введите сумму (не ноль).')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Сумма/), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Внести платёж' }));
    expect(screen.getByText('Введите сумму (не ноль).')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Сумма/), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Дата платежа'), { target: { value: '2999-01-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Внести платёж' }));
    expect(screen.getByText('Дата платежа не может быть в будущем.')).toBeInTheDocument();
    expect(fake.writes('payments', 'insert')).toHaveLength(0);
  });

  it('исправление пишет встречную запись с минусом той же датой', async () => {
    seedPay();
    await openPlayer();
    fireEvent.click(await screen.findByRole('button', { name: 'Исправить (записать с минусом)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Записать исправление' }));
    await waitFor(() => expect(fake.writes('payments', 'insert')).toEqual([{ player_id: 'p1', amount: -100, paid_on: '2026-10-01', method: 'Исправление' }]));
  });
});

describe('«Цены» (администратор)', () => {
  function seedPrices() {
    fake.db.prices = [
      { id: 'r1', group_id: null, kind: 'subscription', amount: 165, valid_from: '2026-09-01', valid_to: null },
      { id: 'r2', group_id: null, kind: 'subscription', amount: 170, valid_from: '2099-01-01', valid_to: null },
    ];
    fake.db.groups = [{ id: 'g1', name: 'U9' }];
    fake.db.clubs = [{ id: 'c1' }];
  }
  it('цену с прошлого месяца добавить нельзя', async () => {
    seedPrices();
    render(<AdminPrices />);
    fireEvent.change(await screen.findByLabelText('Цена, ₾'), { target: { value: '175' } });
    fireEvent.change(screen.getByLabelText('С месяца'), { target: { value: '2026-08' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить цену' }));
    expect(await screen.findByText(/с текущего или будущего месяца/)).toBeInTheDocument();
    expect(fake.writes('prices', 'insert')).toHaveLength(0);
  });
  it('цена со своего будущего месяца добавляется для выбранной группы', async () => {
    seedPrices();
    render(<AdminPrices />);
    fireEvent.change(await screen.findByLabelText('Цена, ₾'), { target: { value: '175' } });
    fireEvent.change(screen.getByLabelText('Группа'), { target: { value: 'g1' } });
    fireEvent.change(screen.getByLabelText('С месяца'), { target: { value: '2098-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить цену' }));
    await waitFor(() => expect(fake.writes('prices', 'insert')).toEqual([{ club_id: 'c1', group_id: 'g1', kind: 'subscription', amount: 175, valid_from: '2098-01-01' }]));
  });
  it('дубликат на тот же месяц отклоняется', async () => {
    seedPrices();
    render(<AdminPrices />);
    fireEvent.change(await screen.findByLabelText('Цена, ₾'), { target: { value: '180' } });
    fireEvent.change(screen.getByLabelText('С месяца'), { target: { value: '2099-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить цену' }));
    expect(await screen.findByText(/уже есть/)).toBeInTheDocument();
  });
  it('удалить можно только будущую цену и после подтверждения', async () => {
    seedPrices();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<AdminPrices />);
    const del = await screen.findAllByRole('button', { name: 'Удалить будущую цену' });
    expect(del).toHaveLength(1); // у действующей цены кнопки нет
    fireEvent.click(del[0]);
    await waitFor(() => expect(fake.calls.some(c => c.kind === 'delete' && c.name === 'prices')).toBe(true));
  });
});
