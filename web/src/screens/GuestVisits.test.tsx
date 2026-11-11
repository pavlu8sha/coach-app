import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import { today } from '../lib/coach';
import GuestVisits from './GuestVisits';

// Условия приёмки: docs/GUEST_VISIT_ACCEPTANCE.md (разовые посещения тренировок другой группы)
const guest = (over: Record<string, unknown> = {}) => ({ session_id: 'sid-1', player_id: 'p9', amount: 15, paid: false, paid_amount: null, method: null, players: { full_name: 'Смирнов Тимофей', groups: { name: 'U9-A' } }, ...over });
beforeEach(() => {
  fake.db.sessions = [{ id: 'sid-1', group_id: 'g1', source_key: `ATT|${today()}` }];
  fake.db.session_guests = [];
  fake.db.players = [
    { id: 'p1', full_name: 'Иванов Пётр', group_id: 'g1', status: 'active', groups: { name: 'U9-B' } },
    { id: 'p9', full_name: 'Смирнов Тимофей', group_id: 'g2', status: 'active', groups: { name: 'U9-A' } },
    { id: 'p8', full_name: 'Смирнова Ксения', group_id: 'g2', status: 'paused', groups: { name: 'U9-A' } },
  ];
  fake.rpc.open_session = () => 'sid-1';
  fake.rpc.session_guest_add = () => null;
  fake.rpc.session_guest_set_paid = () => null;
  fake.rpc.session_guest_remove = () => null;
});

describe('«Разовые посещения»', () => {
  it('поиск находит игрока только другой группы и только занимающегося; добавление идёт через функцию базы', async () => {
    render(<GuestVisits gid="g1" date={today()} />);
    fireEvent.change(await screen.findByLabelText('Добавить гостя'), { target: { value: 'смирнов' } });
    expect(await screen.findByText('Смирнов Тимофей')).toBeInTheDocument();
    expect(screen.queryByText('Иванов Пётр')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
    await waitFor(() => expect(fake.rpcCalls('session_guest_add')).toEqual([{ s: 'sid-1', p: 'p9' }]));
    expect(await screen.findByText(/добавлен как гость/)).toBeInTheDocument();
  });

  it('если занятие ещё не открыто, оно открывается так же, как при сохранении отметок', async () => {
    fake.db.sessions = [];
    render(<GuestVisits gid="g1" date={today()} />);
    fireEvent.change(await screen.findByLabelText('Добавить гостя'), { target: { value: 'тимофей' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Добавить' }));
    await waitFor(() => expect(fake.rpcCalls('session_guest_add')).toHaveLength(1));
    expect(fake.rpcCalls('open_session')).toEqual([{ g: 'g1', d: today() }]);
  });

  it('гость показан с группой, суммой и статусом; оплата с подтверждением и способом', async () => {
    fake.db.session_guests = [guest()];
    render(<GuestVisits gid="g1" date={today()} />);
    expect(await screen.findByText('Смирнов Тимофей')).toBeInTheDocument();
    expect(screen.getByText(/U9-A · 15 ₾/)).toBeInTheDocument();
    expect(screen.getByText('Не оплачено')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Перевод' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Принять оплату' }));
    await waitFor(() => expect(fake.rpcCalls('session_guest_set_paid')).toEqual([{ s: 'sid-1', p: 'p9', is_paid: true, mth: 'Перевод' }]));
  });

  it('отказ в подтверждении оплату не записывает', async () => {
    fake.db.session_guests = [guest()];
    render(<GuestVisits gid="g1" date={today()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Наличные' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Отмена|Отменить/ }));
    expect(fake.rpcCalls('session_guest_set_paid')).toHaveLength(0);
  });

  it('оплаченного гостя убрать нельзя, отмену оплаты видит только администратор', async () => {
    fake.db.session_guests = [guest({ paid: true, paid_amount: 15, method: 'Наличные' })];
    const { unmount } = render(<GuestVisits gid="g1" date={today()} />);
    expect(await screen.findByText('Оплачено (Наличные)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Убрать' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Отменить оплату' })).not.toBeInTheDocument();
    unmount();
    render(<GuestVisits gid="g1" date={today()} admin />);
    fireEvent.click(await screen.findByRole('button', { name: 'Отменить оплату' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Отменить оплату' }));
    await waitFor(() => expect(fake.rpcCalls('session_guest_set_paid')).toEqual([{ s: 'sid-1', p: 'p9', is_paid: false }]));
  });

  it('неоплаченного гостя можно убрать после подтверждения', async () => {
    fake.db.session_guests = [guest()];
    render(<GuestVisits gid="g1" date={today()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Убрать' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Убрать' }));
    await waitFor(() => expect(fake.rpcCalls('session_guest_remove')).toEqual([{ s: 'sid-1', p: 'p9' }]));
  });

  it('ошибка базы показывается понятным текстом, список не меняется молча', async () => {
    fake.rpc.session_guest_add = () => ({ data: null, error: { message: 'date in the future' } });
    render(<GuestVisits gid="g1" date={today()} />);
    fireEvent.change(await screen.findByLabelText('Добавить гостя'), { target: { value: 'тимофей' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Добавить' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Нельзя отметить занятие, которое ещё не прошло.');
  });

  it('уже добавленный гость в результатах поиска не предлагается второй раз', async () => {
    fake.db.session_guests = [guest()];
    render(<GuestVisits gid="g1" date={today()} />);
    await screen.findByText('Не оплачено');
    fireEvent.change(screen.getByLabelText('Добавить гостя'), { target: { value: 'тимофей' } });
    await waitFor(() => expect(screen.getAllByText('Смирнов Тимофей')).toHaveLength(1));
    expect(screen.queryByRole('button', { name: 'Добавить' })).not.toBeInTheDocument();
  });
});
