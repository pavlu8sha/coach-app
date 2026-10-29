import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import Booking from './Booking';

const start = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 16);
const board = (mine: unknown[] = [], booked: string[] = []) => [{ kind: 'individual', session_id: 's1', starts_at: start, title: 'Индивидуальная тренировка', place: null, capacity: 3, amount: 50, booked, mine }];

describe('Запись на занятия', () => {
  it('родитель видит места и записавшихся и записывает ребёнка', async () => {
    fake.db.player_guardians = [{ user_id: 'u', consent_revoked_at: null, players: { id: 'p1', full_name: 'Аня Первая' } }];
    fake.rpc.booking_board = () => board([], ['Боря Второй']);
    fake.rpc.booking_signup = () => null;
    render(<Booking />);
    expect(await screen.findByText('Мест: 2')).toBeInTheDocument();
    expect(screen.getByText('Записаны: Боря Второй')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Записать: Аня Первая' }));
    await waitFor(() => expect(fake.rpcCalls('booking_signup')).toEqual([{ k: 'individual', s: 's1', p: 'p1' }]));
  });

  it('записанный ребёнок: видна оплата, запись можно отменить', async () => {
    fake.db.player_guardians = [{ user_id: 'u', consent_revoked_at: null, players: { id: 'p1', full_name: 'Аня Первая' } }];
    fake.rpc.booking_board = () => board([{ player_id: 'p1', name: 'Аня Первая', paid: false, amount: 50 }], ['Аня Первая']);
    fake.rpc.booking_cancel = () => null;
    render(<Booking />);
    expect(await screen.findByText('Не оплачено 50 ₾')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Отменить запись: Аня Первая' }));
    await waitFor(() => expect(fake.rpcCalls('booking_cancel')).toEqual([{ k: 'individual', s: 's1', p: 'p1' }]));
  });

  it('оплаченную запись отменить нельзя — понятное сообщение', async () => {
    fake.db.player_guardians = [{ user_id: 'u', consent_revoked_at: null, players: { id: 'p1', full_name: 'Аня Первая' } }];
    fake.rpc.booking_board = () => board([{ player_id: 'p1', name: 'Аня Первая', paid: true, amount: 50 }], ['Аня Первая']);
    fake.rpc.booking_cancel = () => ({ error: { message: 'booking is paid' } });
    render(<Booking />);
    expect(await screen.findByText('Оплачено')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Отменить запись: Аня Первая' }));
    expect(await screen.findByText(/Запись оплачена: отменить её может администратор/)).toBeInTheDocument();
  });

  it('начавшееся занятие и отмеченная запись: родитель видит понятный отказ', async () => {
    fake.db.player_guardians = [{ user_id: 'u', consent_revoked_at: null, players: { id: 'p1', full_name: 'Аня Первая' } }];
    fake.rpc.booking_board = () => board([{ player_id: 'p1', name: 'Аня Первая', paid: false, amount: 50 }], ['Аня Первая']);
    fake.rpc.booking_cancel = () => ({ error: { message: 'session already started' } });
    render(<Booking />);
    fireEvent.click(await screen.findByRole('button', { name: 'Отменить запись: Аня Первая' }));
    expect(await screen.findByText(/Занятие уже началось/)).toBeInTheDocument();
    fake.rpc.booking_cancel = () => ({ error: { message: 'attendance marked' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отменить запись: Аня Первая' }));
    expect(await screen.findByText(/На занятии уже отмечена посещаемость/)).toBeInTheDocument();
  });

  it('дополнительная тренировка со временем: в карточке видно время начала', async () => {
    fake.db.player_guardians = [{ user_id: 'u', consent_revoked_at: null, players: { id: 'p1', full_name: 'Аня Первая' } }];
    const day = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    fake.rpc.booking_board = () => [{ kind: 'extra', session_id: 'x1', starts_at: `${day}T19:00:00`, title: 'Дополнительная тренировка', place: 'Зал', capacity: null, amount: 20, booked: [], mine: [] }];
    render(<Booking />);
    expect(await screen.findByText(/Дополнительная: .*19:00/)).toBeInTheDocument();
  });

  it('мест нет: кнопка записи недоступна', async () => {
    fake.db.player_guardians = [{ user_id: 'u', consent_revoked_at: null, players: { id: 'p1', full_name: 'Аня Первая' } }];
    fake.rpc.booking_board = () => [{ ...board([], ['А', 'Б', 'В'])[0] }];
    render(<Booking />);
    const card = (await screen.findByText('Мест нет')).closest('section') as HTMLElement;
    expect(within(card).getByRole('button', { name: 'Записать: Аня Первая' })).toBeDisabled();
  });

  it('пустая доска: понятное пустое состояние', async () => {
    fake.db.player_guardians = [];
    fake.rpc.booking_board = () => [];
    render(<Booking />);
    expect(await screen.findByText('Занятий для записи пока нет')).toBeInTheDocument();
  });
});
