import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import Extra from './Extra';

const future = '2099-01-10';
function seed() {
  fake.db.extra_sessions = [{ id: 'e1', starts_on: future, amount: 20, place: 'Зал', extra_bookings: [] }];
  fake.db.extra_bookings = [
    { session_id: 'e1', player_id: 'p1', paid: false, attended: null, paid_amount: null, method: null, players: { full_name: 'Иванов Пётр' } },
    { session_id: 'e1', player_id: 'p2', paid: true, attended: true, paid_amount: 20, method: 'Наличные', players: { full_name: 'Сидоров Ян' } },
    { session_id: 'old', player_id: 'p1', paid: false, extra_sessions: { starts_on: '2020-01-01', amount: 20 }, players: { full_name: 'Иванов Пётр' } },
  ];
  fake.db.extra_sessions[0].extra_bookings = fake.db.extra_bookings.filter(b => b.session_id === 'e1');
}

describe('«Дополнительные»', () => {
  it('предстоящие: дата, сумма, место и счётчики', async () => {
    seed();
    render(<Extra />);
    expect(await screen.findByText('10.01.2099 · 20 ₾')).toBeInTheDocument();
    expect(screen.getByText('Записано: 2, оплатили: 1')).toBeInTheDocument();
  });

  it('долги: неоплаченные прошедшие тренировки по игроку', async () => {
    seed();
    render(<Extra />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Долги' }));
    expect(await screen.findByText('Неоплаченных тренировок: 1')).toBeInTheDocument();
    expect(screen.getByText('20 ₾')).toBeInTheDocument();
  });

  it('создание: сумма с запятой превращается в число; дубль даты — сообщение', async () => {
    seed();
    fake.rpc.extra_create_session = () => ({ error: { message: 'session exists' } });
    render(<Extra />);
    fireEvent.click(await screen.findByRole('button', { name: 'Новая тренировка' }));
    fireEvent.change(screen.getByLabelText('Дата'), { target: { value: '2099-02-01' } });
    fireEvent.change(screen.getByLabelText('Сумма с игрока, ₾'), { target: { value: '12,5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    expect(await screen.findByText('Тренировка на эту дату уже есть.')).toBeInTheDocument();
    expect(fake.rpcCalls('extra_create_session')[0]).toMatchObject({ d: '2099-02-01', amt: 12.5 });
  });

  it('оплата со способом, посещение; у тренировки с оплатой удаление закрыто', async () => {
    seed();
    fake.rpc.extra_set_paid = () => null;
    fake.rpc.extra_set_attended = () => null;
    render(<Extra />);
    fireEvent.click(await screen.findByText('10.01.2099 · 20 ₾'));
    fireEvent.change(await screen.findByLabelText('Способ оплаты'), { target: { value: 'Перевод' } });
    const ivan = (await screen.findByText('Иванов Пётр')).closest('.ks-card') as HTMLElement;
    fireEvent.click(within(ivan).getByRole('button', { name: 'Отметить оплату' }));
    await waitFor(() => expect(fake.rpcCalls('extra_set_paid')).toEqual([{ s: 'e1', p: 'p1', is_paid: true, mth: 'Перевод' }]));
    fireEvent.click(within(ivan).getByRole('tab', { name: 'Нет' }));
    await waitFor(() => expect(fake.rpcCalls('extra_set_attended')).toEqual([{ s: 'e1', p: 'p1', was: false }]));
    expect(screen.getByRole('button', { name: 'Удалить нельзя: есть оплаты' })).toBeDisabled();
  });
});
