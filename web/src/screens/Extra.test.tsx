import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
    expect(await screen.findByText('Иванов Пётр')).toBeInTheDocument();
    expect(screen.getByText(/01.01.2020 · Дополнительная/)).toBeInTheDocument(); // видно, за какую тренировку долг
  });

  it('долг гасится из вкладки «Долги» со способом оплаты', async () => {
    seed();
    fake.rpc.extra_set_paid = () => null;
    render(<Extra />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Долги' }));
    fireEvent.click(await screen.findByRole('button', { name: /Перевод: Иванов Пётр/ }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Принять оплату' }));
    await waitFor(() => expect(fake.rpcCalls('extra_set_paid')).toHaveLength(1));
    expect(fake.rpcCalls('extra_set_paid')[0]).toMatchObject({ p: 'p1', is_paid: true, mth: 'Перевод' });
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

  it('время тренировки: начало и окончание сохраняются отдельно; ошибка базы — понятным текстом', async () => {
    seed();
    fake.rpc.extra_set_time = () => null;
    render(<Extra />);
    fireEvent.click(await screen.findByText('10.01.2099 · 20 ₾'));
    fireEvent.change(await screen.findByLabelText('Начало'), { target: { value: '19:00' } });
    fireEvent.change(screen.getByLabelText('Окончание'), { target: { value: '20:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить время' }));
    await waitFor(() => expect(fake.rpcCalls('extra_set_time')).toEqual([{ s: 'e1', t_start: '19:00', t_end: '20:30' }]));
    fake.rpc.extra_set_time = () => ({ error: { message: 'end before start' } });
    fireEvent.change(screen.getByLabelText('Окончание'), { target: { value: '18:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить время' }));
    expect(await screen.findByText('Окончание должно быть позже начала.')).toBeInTheDocument();
  });

  it('вместимость: сохраняется, перебор показывается предупреждением', async () => {
    seed();
    fake.rpc.extra_set_capacity = () => 2;
    render(<Extra />);
    fireEvent.click(await screen.findByText('10.01.2099 · 20 ₾'));
    fireEvent.change(await screen.findByLabelText(/Мест \(пусто/), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить вместимость' }));
    await waitFor(() => expect(fake.rpcCalls('extra_set_capacity')).toEqual([{ s: 'e1', cap: 1 }]));
    expect(await screen.findByText(/записано на 2 больше лимита/)).toBeInTheDocument();
  });

  it('вместимость вне 1–100 не отправляется', async () => {
    seed();
    fake.rpc.extra_set_capacity = () => 0;
    render(<Extra />);
    fireEvent.click(await screen.findByText('10.01.2099 · 20 ₾'));
    fireEvent.change(await screen.findByLabelText(/Мест \(пусто/), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить вместимость' }));
    expect(await screen.findByText('Вместимость: число от 1 до 100.')).toBeInTheDocument();
    expect(fake.rpcCalls('extra_set_capacity')).toEqual([]);
  });

  it('отмена: подтверждение, затем extra_cancel_session с причиной; дата с оплатами редактируема', async () => {
    seed();
    fake.rpc.extra_cancel_session = () => null;
    render(<Extra />);
    fireEvent.click(await screen.findByText('10.01.2099 · 20 ₾'));
    expect(await screen.findByLabelText('Дата')).not.toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Причина/), { target: { value: 'Дождь' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отменить тренировку' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Отменить тренировку', hidden: false, description: undefined }).catch(() => screen.getAllByRole('button', { name: 'Отменить тренировку' }).slice(-1)[0]));
    await waitFor(() => expect(fake.rpcCalls('extra_cancel_session')).toEqual([{ s: 'e1', p_reason: 'Дождь' }]));
  });

  it('отменённая тренировка: пометка в списке, в карточке нет управления записями', async () => {
    seed();
    fake.db.extra_sessions[0].cancelled_at = '2099-01-01T00:00:00Z';
    fake.db.extra_sessions[0].cancel_reason = 'Дождь';
    render(<Extra />);
    expect(await screen.findByText(/Отменена/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('10.01.2099 · 20 ₾'));
    expect(await screen.findByText(/Тренировка отменена: Дождь/)).toBeInTheDocument();
    expect(screen.queryByText('Записать игрока')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Отметить оплату' })).toBeNull();
  });
});
