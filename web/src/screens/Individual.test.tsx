import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import Individual from './Individual';

const future = '2099-01-10T12:00:00';
const past = '2020-01-10T12:00:00';

function seed() {
  fake.db.individual_sessions = [
    {
      id: 's1', starts_at: future, topic: 'Дриблинг', goalkeepers: false,
      individual_bookings: [
        { player_id: 'p1', paid: false, attended: null, amount: 50, players: { full_name: 'Иванов Пётр' } },
        { player_id: 'p2', paid: true, attended: true, amount: 50, players: { full_name: 'Сидоров Ян' } },
      ],
    },
    { id: 's0', starts_at: past, topic: null, goalkeepers: true, individual_bookings: [] },
  ];
  fake.db.individual_bookings = [
    { session_id: 's1', player_id: 'p1', paid: false, attended: null, amount: 50, players: { full_name: 'Иванов Пётр' }, individual_sessions: { starts_at: future, goalkeepers: false } },
    { session_id: 's1', player_id: 'p2', paid: true, attended: true, amount: 50, players: { full_name: 'Сидоров Ян' }, individual_sessions: { starts_at: future, goalkeepers: false } },
    { session_id: 'old', player_id: 'p1', amount: 50, paid: false, players: { full_name: 'Иванов Пётр' }, individual_sessions: { starts_at: past, goalkeepers: false } },
    { session_id: 'old2', player_id: 'p1', amount: 50, paid: false, players: { full_name: 'Иванов Пётр' }, individual_sessions: { starts_at: past, goalkeepers: false } },
    { session_id: 'f', player_id: 'p9', amount: 50, paid: false, players: { full_name: 'Будущий' }, individual_sessions: { starts_at: future, goalkeepers: false } },
  ];
}

describe('«Индивидуальные»', () => {
  it('предстоящие занятия: дата, тип, счётчики записанных и оплативших', async () => {
    seed();
    render(<Individual />);
    expect(await screen.findByText('10.01.2099 12:00 · Индивидуальные')).toBeInTheDocument();
    expect(screen.getByText('Записано: 2, оплатили: 1')).toBeInTheDocument();
    expect(screen.queryByText(/Вратари/)).not.toBeInTheDocument(); // прошедшее вратарское — на другой вкладке
  });

  it('вкладка «Долги» суммирует неоплаченные прошедшие занятия по игроку', async () => {
    seed();
    render(<Individual />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Долги' }));
    expect(await screen.findByText('Неоплаченных занятий: 2')).toBeInTheDocument();
    expect(screen.getByText('100 ₾')).toBeInTheDocument();
    expect(screen.queryByText('Будущий')).not.toBeInTheDocument();
  });

  it('создание занятия: параметры уходят в ind_create_session, дубль даёт понятное сообщение', async () => {
    seed();
    fake.rpc.ind_create_session = () => ({ error: { message: 'session exists' } });
    render(<Individual />);
    fireEvent.click(await screen.findByRole('button', { name: 'Новое занятие' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Вратари' }));
    fireEvent.change(screen.getByLabelText('Дата'), { target: { value: '2099-02-01' } });
    fireEvent.change(screen.getByLabelText('Время'), { target: { value: '10:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    expect(await screen.findByText('Такое занятие уже есть.')).toBeInTheDocument();
    expect(fake.rpcCalls('ind_create_session')[0]).toMatchObject({ d: '2099-02-01', t: '10:30', gk: true });
  });

  it('карточка занятия: оплата, посещение и сообщение, когда база отказывает убрать оплаченного', async () => {
    seed();
    fake.rpc.ind_set_paid = () => null;
    fake.rpc.ind_set_attended = () => null;
    fake.rpc.ind_remove_player = () => ({ error: { message: 'booking is paid' } });
    render(<Individual />);
    fireEvent.click(await screen.findByText('10.01.2099 12:00 · Индивидуальные'));
    const ivan = (await screen.findByText('Иванов Пётр')).closest('.ks-card') as HTMLElement;
    fireEvent.click(within(ivan).getByRole('button', { name: 'Отметить оплату' }));
    await waitFor(() => expect(fake.rpcCalls('ind_set_paid')).toEqual([{ s: 's1', p: 'p1', is_paid: true }]));
    fireEvent.click(within(ivan).getByRole('tab', { name: 'Был(а)' }));
    await waitFor(() => expect(fake.rpcCalls('ind_set_attended')).toEqual([{ s: 's1', p: 'p1', was: true }]));
    fireEvent.click(within(ivan).getByRole('button', { name: 'Убрать' }));
    expect(await screen.findByText('Сначала отмените оплату.')).toBeInTheDocument();
  });

  it('тип занятия меняется в форме: уходит в ind_edit_session, заголовок обновляется', async () => {
    seed();
    fake.rpc.ind_edit_session = () => null;
    render(<Individual />);
    fireEvent.click(await screen.findByText('10.01.2099 12:00 · Индивидуальные'));
    fireEvent.click(await screen.findByRole('tab', { name: 'Вратари' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(fake.rpcCalls('ind_edit_session')).toHaveLength(1));
    expect(fake.rpcCalls('ind_edit_session')[0]).toMatchObject({ s: 's1', gk: true });
    expect(await screen.findByRole('heading', { name: '10.01.2099 12:00 · Вратари' })).toBeInTheDocument();
  });

  it('у занятия с оплатой нельзя удалить, дата и время закрыты', async () => {
    seed();
    render(<Individual />);
    fireEvent.click(await screen.findByText('10.01.2099 12:00 · Индивидуальные'));
    expect(await screen.findByRole('button', { name: 'Удалить нельзя: есть оплаты' })).toBeDisabled();
    expect(screen.getByLabelText('Дата')).toBeDisabled();
  });
});
