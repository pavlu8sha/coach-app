import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
    { session_id: 'old', player_id: 'p1', amount: 50, paid: false, players: { full_name: 'Иванов Пётр' }, individual_sessions: { starts_at: past, goalkeepers: false, topic: null } },
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
    expect(await screen.findByText('Иванов Пётр')).toBeInTheDocument();
    expect(screen.getByText('100 ₾')).toBeInTheDocument();
    expect(screen.getAllByText(/10.01.2020 12:00 · Индивидуальные/)).toHaveLength(2); // видно, за какие занятия долг
    expect(screen.queryByText('Будущий')).not.toBeInTheDocument();
  });

  it('долг гасится прямо из вкладки «Долги» по конкретному занятию', async () => {
    seed();
    fake.rpc.ind_set_paid = () => null;
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<Individual />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Долги' }));
    fireEvent.change(screen.getByLabelText(/^Способ оплаты/), { target: { value: 'Перевод' } });
    fireEvent.click((await screen.findAllByRole('button', { name: /Принять оплату: Иванов Пётр/ }))[0]);
    await waitFor(() => expect(fake.rpcCalls('ind_set_paid')).toHaveLength(1));
    expect(fake.rpcCalls('ind_set_paid')[0]).toMatchObject({ p: 'p1', is_paid: true, mth: 'Перевод' });
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
    fireEvent.change(screen.getByLabelText(/^Способ оплаты/), { target: { value: 'Наличные' } });
    fireEvent.click(within(ivan).getByRole('button', { name: 'Отметить оплату' }));
    await waitFor(() => expect(fake.rpcCalls('ind_set_paid')).toEqual([{ s: 's1', p: 'p1', is_paid: true, mth: 'Наличные' }]));
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

describe('«Индивидуальные»: сводка как в прежнем приложении', () => {
  it('над списком видна сводка «Должники», сумма оплаты у занятия и копирование списка записавшихся', async () => {
    seed();
    const writes: string[] = [];
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t: string) => { writes.push(t); return Promise.resolve(); } }, configurable: true });
    render(<Individual />);
    expect(await screen.findByText('Игроков: 1')).toBeInTheDocument();
    expect(screen.getByText('100 ₾')).toBeInTheDocument(); // долг по прошедшим
    expect(screen.getByText('50 ₾')).toBeInTheDocument(); // оплачено на занятии
    fireEvent.click(await screen.findByText('10.01.2099 12:00 · Индивидуальные'));
    fireEvent.click(await screen.findByRole('button', { name: 'Скопировать список записавшихся' }));
    await waitFor(() => expect(writes).toEqual(['1 — Иванов Пётр\n2 — Сидоров Ян']));
  });
});

describe('«Индивидуальные»: история не обрезается', () => {
  it('при более чем 60 занятиях показывает кнопку «Показать ещё» и доходит до самого раннего', async () => {
    const day = (i: number) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    fake.db.individual_sessions = Array.from({ length: 65 }, (_, i) => ({
      id: `s${i}`, starts_at: `${day(i)}T12:00:00`, topic: null, goalkeepers: false, individual_bookings: [],
    }));
    fake.db.individual_bookings = [];
    render(<Individual />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Прошедшие' }));
    expect(await screen.findByText('06.03.2026 12:00 · Индивидуальные')).toBeInTheDocument();
    expect(screen.queryByText('01.01.2026 12:00 · Индивидуальные')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё' }));
    expect(await screen.findByText('01.01.2026 12:00 · Индивидуальные')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Показать ещё' })).not.toBeInTheDocument());
  });
});

describe('«Индивидуальные»: постоянные по месяцам', () => {
  const month = new Date().toISOString().slice(0, 7);
  it('вкладка показывает слоты и постоянных месяца, добавление и снятие уходят в ind_slot_member_set', async () => {
    seed();
    fake.db.individual_templates = [
      { id: 't1', isodow: 6, start_time: '19:00:00', goalkeepers: false, active: true },
      { id: 't3', isodow: 7, start_time: '19:00:00', goalkeepers: true, active: true },
    ];
    fake.db.individual_slot_members = [{ template_id: 't3', player_id: 'p2', month: `${month}-01`, players: { full_name: 'Сидоров Ян' } }];
    fake.db.players = [{ id: 'p5', full_name: 'Петров Олег', status: 'active' }];
    fake.rpc.ind_slot_member_set = () => null;
    render(<Individual />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Постоянные' }));
    expect(await screen.findByRole('heading', { name: 'Суббота 19:00 · Индивидуальные' })).toBeInTheDocument();
    expect(await screen.findByText('Сидоров Ян')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Убрать: Сидоров Ян/ }));
    await waitFor(() => expect(fake.rpcCalls('ind_slot_member_set')).toEqual([{ tpl: 't3', p: 'p2', mth: `${month}-01`, on_: false }]));
    fireEvent.change(screen.getByLabelText('Найти игрока'), { target: { value: 'Петр' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Добавить' }));
    await waitFor(() => expect(fake.rpcCalls('ind_slot_member_set')[1]).toEqual({ tpl: 't1', p: 'p5', mth: `${month}-01`, on_: true }));
  });

  it('кнопка «Создать занятия на выходные сейчас» вызывает ind_autocreate_now и сообщает число', async () => {
    seed();
    fake.db.individual_templates = [{ id: 't1', isodow: 6, start_time: '19:00:00', goalkeepers: false, active: true }];
    fake.db.individual_slot_members = [];
    fake.rpc.ind_autocreate_now = () => 3;
    render(<Individual />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Постоянные' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Создать занятия на выходные сейчас' }));
    expect(await screen.findByText('Создано занятий: 3.')).toBeInTheDocument();
  });
});
