import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fake } from '../test/fakeSupabase';
import { today } from '../lib/coach';
import { NavProvider, NavRoot, useActiveRoot } from '../nav';
import CashDesk from './CashDesk';
import Money from './Money';
import Players from './Players';
import Sessions from './Sessions';

const month = today().slice(0, 7) + '-01';
const inApp = (root: string, ui: React.ReactNode) => (
  <NavProvider initial={root}>
    <NavRoot root={root}>{ui}</NavRoot>
  </NavProvider>
);
function seedPlayers() {
  fake.db.groups = [{ id: 'g1', name: 'U10-B', club_id: 'c1' }, { id: 'g2', name: 'U7-A', club_id: 'c1' }];
  fake.db.players = [
    { id: 'p1', full_name: 'Amodeo Nolan', group_id: 'g1', birth_date: '2016-09-05', status: 'active', external_id: 'KS-0002' },
    { id: 'p2', full_name: 'Andreev Boris', group_id: 'g2', birth_date: '2020-02-15', status: 'active', external_id: 'KS-0004' },
    { id: 'p3', full_name: 'Старый Игрок', group_id: 'g2', birth_date: null, status: 'inactive', external_id: 'KS-0009' },
  ];
  fake.db.prices = [{ group_id: null, amount: 165, valid_from: '2026-01-01', valid_to: null, kind: 'subscription' }];
  fake.db.payments = [{ player_id: 'p1', amount: 165, paid_on: month }];
  fake.db.subscriptions = [];
}

describe('«Игроки»: возврат из карточки и правки', () => {
  it('поиск и фильтры списка сохраняются после «Назад» из карточки', async () => {
    seedPlayers();
    render(inApp('players', <Players />));
    fireEvent.change(await screen.findByLabelText('Поиск игроков'), { target: { value: 'andr' } });
    fireEvent.change(screen.getByLabelText('Статус'), { target: { value: 'all' } });
    const push = vi.spyOn(window.history, 'pushState');
    fireEvent.click(await screen.findByText('Andreev Boris'));
    expect(await screen.findByRole('button', { name: 'Изменить данные' })).toBeInTheDocument();
    expect(push).toHaveBeenCalledTimes(1); // карточка = одна запись истории, «Назад» не дублируется
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(await screen.findByLabelText('Поиск игроков')).toHaveValue('andr');
    expect(screen.getByLabelText('Статус')).toHaveValue('all');
    expect(screen.getByText('Andreev Boris')).toBeInTheDocument();
    expect(screen.queryByText('Amodeo Nolan')).not.toBeInTheDocument();
  });

  it('вкладка карточки сохраняется после «Назад» из правки; из правки нового игрока «Отмена» ведёт в список', async () => {
    seedPlayers();
    render(inApp('players', <Players />));
    fireEvent.click(await screen.findByText('Amodeo Nolan'));
    fireEvent.click(await screen.findByRole('tab', { name: 'Матчи' }));
    fireEvent.click(screen.getByRole('button', { name: 'Изменить данные' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Отмена' }));
    await screen.findByRole('button', { name: 'Изменить данные' });
    expect(screen.getByRole('tab', { name: 'Матчи' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    fireEvent.click(await screen.findByRole('button', { name: '+ Добавить' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Отмена' }));
    expect(await screen.findByText('Amodeo Nolan')).toBeInTheDocument();
  });

  it('позиция прокрутки списка возвращается после «Назад»', async () => {
    seedPlayers();
    const scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);
    Object.defineProperty(window, 'scrollY', { value: 640, configurable: true });
    render(inApp('players', <Players />));
    fireEvent.click(await screen.findByText('Amodeo Nolan')); // уходим: запоминается 640
    await screen.findByRole('button', { name: 'Изменить данные' });
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    scrollTo.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    await screen.findByLabelText('Поиск игроков');
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 640));
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  });
});

describe('«Занятия»: возврат из индивидуальной отметки', () => {
  it('вкладка «Индивидуальные» и дата сохраняются после «Назад»', async () => {
    const t = today();
    fake.db.weekly_schedule = [1, 2, 3, 4, 5, 6, 7].map(w => ({ group_id: 'g1', weekday: w, starts_at: '18:00:00', location: 'Стадион', kind: 'Групповая' }));
    fake.db.players = [];
    fake.rpc.ind_roster_list = () => [{ session_id: 's1', starts_at: `${t}T19:00:00`, topic: 'Дриблинг', goalkeepers: true, player_id: 'p1', full_name: 'Иванов Пётр', attended: null }];
    fake.rpc.extra_roster_list = () => [];
    render(inApp('sessions', <Sessions groups={[{ id: 'g1', name: 'U9' }]} />));
    fireEvent.click(await screen.findByRole('tab', { name: 'Индивидуальные' }));
    fireEvent.click(await screen.findByText('Записано: 1'));
    expect(await screen.findByText('Иванов Пётр')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(await screen.findByText('Записано: 1')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Индивидуальные' })).toHaveAttribute('aria-selected', 'true');
  });
});

// Раздел → другой раздел → обратно: экран монтируется заново, состояние берётся из стека раздела
function TwoTabs({ children }: { children: React.ReactNode }) {
  const [tab, select] = useActiveRoot<'money' | 'other'>('money');
  return (
    <>
      <button onClick={() => select('other')}>to-other</button>
      <button onClick={() => select('money')}>to-money</button>
      <NavRoot root={tab}>{tab === 'money' ? children : <p>other</p>}</NavRoot>
    </>
  );
}

describe('«Оплаты»: возврат на вкладку', () => {
  it('подраздел, месяц, поиск и фильтр «Только должники» сохраняются после ухода в другой раздел', async () => {
    seedPlayers();
    fake.db.club_settings = [];
    render(
      <NavProvider initial="money">
        <TwoTabs>
          <Money />
        </TwoTabs>
      </NavProvider>,
    );
    fireEvent.click(await screen.findByRole('tab', { name: 'По месяцам' }));
    fireEvent.change(await screen.findByLabelText('Поиск по ФИ'), { target: { value: 'andr' } });
    fireEvent.click(screen.getByLabelText('Только должники'));
    fireEvent.change(screen.getByLabelText('Месяц'), { target: { value: screen.getByLabelText('Месяц').querySelectorAll('option')[1].getAttribute('value') } });
    const month = (screen.getByLabelText('Месяц') as HTMLSelectElement).value;
    fireEvent.click(screen.getByText('to-other'));
    expect(screen.getByText('other')).toBeInTheDocument();
    fireEvent.click(screen.getByText('to-money'));
    expect(await screen.findByRole('tab', { name: 'По месяцам' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Поиск по ФИ')).toHaveValue('andr');
    expect(screen.getByLabelText('Только должники')).toBeChecked();
    expect((screen.getByLabelText('Месяц') as HTMLSelectElement).value).toBe(month);
  });
});

describe('«Приём оплат»: выбранный игрок', () => {
  it('остаётся выбранным после ухода в другой раздел; «Сменить» сбрасывает выбор', async () => {
    fake.db.players = [{ id: 'p1', full_name: 'Иванов Пётр', group_id: 'g1', groups: { name: 'U9-A' } }];
    fake.db.prices = [{ group_id: null, kind: 'subscription', amount: 165, valid_from: '2026-09-01', valid_to: null }];
    for (const t of ['payments', 'subscriptions', 'equipment_orders', 'individual_bookings', 'extra_bookings', 'camp_participants', 'camp_payments']) fake.db[t] = [];
    render(
      <NavProvider initial="money">
        <TwoTabs>
          <CashDesk />
        </TwoTabs>
      </NavProvider>,
    );
    fireEvent.change(screen.getByLabelText(/^Игрок/), { target: { value: 'Иванов' } });
    fireEvent.click(await screen.findByRole('button', { name: /Иванов Пётр/ }));
    await screen.findByRole('button', { name: 'Сменить' });
    fireEvent.click(screen.getByText('to-other'));
    fireEvent.click(screen.getByText('to-money'));
    fireEvent.click(await screen.findByRole('button', { name: 'Сменить' }));
    expect(await screen.findByLabelText(/^Игрок/)).toBeInTheDocument();
  });
});
