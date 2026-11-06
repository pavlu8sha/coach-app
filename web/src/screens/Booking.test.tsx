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
    expect(screen.getByText('Записаны:')).toBeInTheDocument();
    expect(screen.getByText('Боря Второй').tagName).toBe('LI');
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

  it('оплаченную запись можно отменить: оплата сохранится, решит администратор', async () => {
    fake.db.player_guardians = [{ user_id: 'u', consent_revoked_at: null, players: { id: 'p1', full_name: 'Аня Первая' } }];
    fake.rpc.booking_board = () => board([{ player_id: 'p1', name: 'Аня Первая', paid: true, amount: 50 }], ['Аня Первая']);
    fake.rpc.booking_cancel = () => null;
    render(<Booking />);
    expect(await screen.findByText('Оплачено')).toBeInTheDocument();
    expect(screen.getByText(/Оплата сохранится: администратор решит/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Отменить запись: Аня Первая' }));
    await waitFor(() => expect(fake.rpcCalls('booking_cancel')).toEqual([{ k: 'individual', s: 's1', p: 'p1' }]));
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

  it('дополнительная тренировка с окончанием: в карточке «19:00–20:30»', async () => {
    fake.db.player_guardians = [{ user_id: 'u', consent_revoked_at: null, players: { id: 'p1', full_name: 'Аня Первая' } }];
    const day = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    fake.rpc.booking_board = () => [{ kind: 'extra', session_id: 'x1', starts_at: `${day}T19:00:00`, ends_at: `${day}T20:30:00`, title: 'Дополнительная тренировка', place: 'Зал', capacity: null, amount: 20, booked: [], mine: [] }];
    render(<Booking />);
    expect(await screen.findByText(/Дополнительная: .*19:00–20:30/)).toBeInTheDocument();
  });

  it('мест нет: вместо записи кнопка очереди, вставание в очередь уходит в функцию', async () => {
    fake.db.player_guardians = [{ user_id: 'u', consent_revoked_at: null, players: { id: 'p1', full_name: 'Аня Первая' } }];
    fake.rpc.booking_board = () => [{ ...board([], ['А', 'Б', 'В'])[0] }];
    fake.rpc.waitlist_board = () => [];
    fake.rpc.waitlist_join = () => null;
    render(<Booking />);
    const card = (await screen.findByText('Мест нет')).closest('section') as HTMLElement;
    expect(within(card).queryByRole('button', { name: 'Записать: Аня Первая' })).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: 'Встать в очередь: Аня Первая' }));
    await waitFor(() => expect(fake.rpcCalls('waitlist_join')).toEqual([{ k: 'individual', s: 's1', p: 'p1' }]));
  });

  it('в очереди: позиция; при свободном месте можно занять, выйти можно всегда', async () => {
    fake.db.player_guardians = [{ user_id: 'u', consent_revoked_at: null, players: { id: 'p1', full_name: 'Аня Первая' } }];
    fake.rpc.booking_board = () => [{ ...board([], ['А', 'Б', 'В'])[0] }];
    fake.rpc.waitlist_board = () => [{ kind: 'individual', session_id: 's1', player_id: 'p1', pos: 2, total: 3, offer: false }];
    fake.rpc.waitlist_leave = () => null;
    render(<Booking />);
    expect(await screen.findByText('В очереди: 2 из 3')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Занять место: Аня Первая' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Выйти из очереди: Аня Первая' }));
    await waitFor(() => expect(fake.rpcCalls('waitlist_leave')).toHaveLength(1));
  });

  it('есть предложение: кнопка «Занять место»; проигравшему гонку понятный текст', async () => {
    fake.db.player_guardians = [{ user_id: 'u', consent_revoked_at: null, players: { id: 'p1', full_name: 'Аня Первая' } }];
    fake.rpc.booking_board = () => board([], ['А', 'Б']);
    fake.rpc.waitlist_board = () => [{ kind: 'individual', session_id: 's1', player_id: 'p1', pos: 1, total: 1, offer: true }];
    fake.rpc.waitlist_claim = () => ({ error: { message: 'session full' } });
    render(<Booking />);
    fireEvent.click(await screen.findByRole('button', { name: 'Занять место: Аня Первая' }));
    expect(await screen.findByText(/место успел занять другой родитель/)).toBeInTheDocument();
    expect(fake.rpcCalls('waitlist_claim')).toEqual([{ k: 'individual', s: 's1', p: 'p1' }]);
  });

  it('пустая доска: понятное пустое состояние', async () => {
    fake.db.player_guardians = [];
    fake.rpc.booking_board = () => [];
    render(<Booking />);
    expect(await screen.findByText('Занятий для записи пока нет')).toBeInTheDocument();
  });

  it('ребёнок не в статусе «Занимается»: понятное сообщение', async () => {
    fake.db.player_guardians = [{ user_id: 'u', consent_revoked_at: null, players: { id: 'p1', full_name: 'Аня Первая' } }];
    fake.rpc.booking_board = () => board([], []);
    fake.rpc.booking_signup = () => ({ error: { message: 'player not active' } });
    render(<Booking />);
    fireEvent.click(await screen.findByRole('button', { name: 'Записать: Аня Первая' }));
    expect(await screen.findByText(/ребёнок сейчас не в статусе «Занимается»/)).toBeInTheDocument();
  });

  it('дополнительная для целевых групп: кнопка записи только у допущенных детей', async () => {
    fake.db.player_guardians = [
      { user_id: 'u', consent_revoked_at: null, players: { id: 'p1', full_name: 'Аня Первая' } },
      { user_id: 'u', consent_revoked_at: null, players: { id: 'p2', full_name: 'Боря Второй' } },
    ];
    fake.rpc.booking_board = () => [{ kind: 'extra', session_id: 'e1', starts_at: start, title: 'Дополнительная тренировка', place: 'Зал', capacity: 5, amount: 20, booked: [], mine: [], eligible: ['p1'] }];
    render(<Booking />);
    expect(await screen.findByRole('button', { name: 'Записать: Аня Первая' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Записать: Боря Второй' })).toBeNull();
  });

  it('«not eligible» объясняется понятным текстом', async () => {
    fake.db.player_guardians = [{ user_id: 'u', consent_revoked_at: null, players: { id: 'p1', full_name: 'Аня Первая' } }];
    fake.rpc.booking_board = () => board([], []);
    fake.rpc.booking_signup = () => ({ error: { message: 'not eligible' } });
    render(<Booking />);
    fireEvent.click(await screen.findByRole('button', { name: 'Записать: Аня Первая' }));
    expect(await screen.findByText(/не для группы ребёнка/)).toBeInTheDocument();
  });

  it('пересечение: предупреждение перед записью, запись по подтверждению', async () => {
    fake.db.player_guardians = [{ user_id: 'u', consent_revoked_at: null, players: { id: 'p1', full_name: 'Аня Первая' } }];
    fake.rpc.booking_board = () => board();
    fake.rpc.waitlist_board = () => [];
    fake.rpc.booking_conflicts = () => [{ kind: 'training', label: 'Тренировка группы', starts_at: '2099-01-01T18:30:00', ends_at: null }];
    fake.rpc.booking_signup = () => null;
    render(<Booking />);
    fireEvent.click(await screen.findByRole('button', { name: 'Записать: Аня Первая' }));
    expect(await screen.findByText(/уже есть: Тренировка группы \(18:30\)/)).toBeInTheDocument();
    expect(fake.rpcCalls('booking_signup')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Всё равно записать: Аня Первая' }));
    await waitFor(() => expect(fake.rpcCalls('booking_signup')).toHaveLength(1));
  });
});
