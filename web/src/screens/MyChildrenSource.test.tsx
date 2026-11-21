// Условия приёмки: docs/acceptance/my-children-client-2026-11-20.md (К1-К6). Экраны берут детей из my_children() (0215), а не из player_guardians.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import App from '../App';
import Home from './Home';
import ParentCalendar from './ParentCalendar';
import Schedule from './Schedule';
import { fake } from '../test/fakeSupabase';
import Matches from './Matches';
import MyKids from './MyKids';
import Payments from './Payments';

const KID = { player_id: 'p1', full_name: 'Аня Серверная', group_id: 'g1', group_name: 'U9' };
// строка связи, которую прежний клиентский фильтр скрыл бы (старое поле отзыва не пустое): сервер её допускает; другая строка в таблице сервером не названа
const TABLE_ONLY = { user_id: 'u', consent_revoked_at: '2026-11-01T00:00:00Z', players: { id: 'p9', full_name: 'Только в таблице', groups: { name: 'U10' } } };
const noTableReads = () => expect(fake.calls.filter(c => c.name === 'player_guardians')).toHaveLength(0);

beforeEach(() => {
  fake.reset();
  fake.db.player_guardians = [TABLE_ONLY];
  fake.db.payments = [];
  fake.db.match_players = [];
  fake.db.matches = [];
  fake.rpc.parent_debts = () => [];
  fake.rpc.parent_dues = () => [];
  fake.rpc.match_tournaments = () => [];
  fake.rpc.my_tournaments = () => [];
  fake.rpc.child_linked = () => false;
});

describe('К1: список детей из my_children()', () => {
  it('Оплата: ребёнок сервера виден, ребёнок только из таблицы нет', async () => {
    fake.rpc.my_children = () => [KID];
    render(<Payments />);
    expect(await screen.findByText('Аня Серверная')).toBeInTheDocument();
    expect(screen.queryByText('Только в таблице')).toBeNull();
    expect(fake.rpcCalls('my_children')).toHaveLength(1);
    noTableReads();
  });

  it('Мои дети: ребёнок сервера с группой виден, таблица не читается', async () => {
    fake.rpc.my_children = () => [KID];
    render(<MyKids onBack={() => {}} />);
    expect(await screen.findByText('Аня Серверная')).toBeInTheDocument();
    expect(screen.queryByText('Только в таблице')).toBeNull();
    noTableReads();
  });

  it('Матчи: ребёнок сервера с группой даёт матчи группы, таблица не читается', async () => {
    fake.db.matches = [{ id: 'm1', team: 'U9', played_on: '2026-10-01', opponent: 'Олимп', goals_for: 3, goals_against: 1 }];
    fake.rpc.my_children = () => [KID];
    render(<Matches />);
    expect(await screen.findByLabelText('Итоги команды')).toBeInTheDocument();
    expect(screen.queryByText('Группа ещё не назначена')).toBeNull();
    noTableReads();
  });

  it('App: вкладка «Ребёнок» открывается по списку сервера, а не по таблице связей', async () => {
    fake.db.users = [{ id: 'u', is_admin: false, chosen_role: 'parent' }];
    fake.db.player_guardians = []; // таблица пуста: прежний счётчик показал бы 0 детей
    fake.rpc.my_children = () => [KID];
    render(<App />);
    const nav = await screen.findByRole('navigation', { name: 'Разделы' });
    expect(within(nav).getByRole('button', { name: 'Ребёнок' })).toBeInTheDocument();
    noTableReads();
  });

  it('App: родитель без детей по серверу (таблица со связью, сервер отказал) не получает вкладку «Ребёнок»', async () => {
    fake.db.users = [{ id: 'u', is_admin: false, chosen_role: 'child' }];
    fake.rpc.my_children = () => [];
    render(<App />);
    const nav = await screen.findByRole('navigation', { name: 'Разделы' });
    expect(within(nav).queryByRole('button', { name: 'Ребёнок' })).toBeNull();
  });
});

describe('К2: пустой список ≠ ошибка', () => {
  it('Оплата: пустой список сервера — «нет детей», не ошибка', async () => {
    fake.rpc.my_children = () => [];
    render(<Payments />);
    await waitFor(() => expect(fake.rpcCalls('my_children')).toHaveLength(1));
    expect(screen.queryByText('Не удалось загрузить оплаты')).toBeNull();
  });
});

describe('К3: ошибка сервера и сбой сети показываются как ошибка с повтором, без сырого текста', () => {
  const RAW = 'function public.my_children() does not exist (42883)';

  it('Оплата: ошибка → «Не удалось загрузить оплаты», повтор восстанавливает', async () => {
    fake.rpc.my_children = () => ({ error: { message: RAW } });
    const { container } = render(<Payments />);
    expect(await screen.findByText('Не удалось загрузить оплаты')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/42883|my_children/);
    fake.rpc.my_children = () => [KID];
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Аня Серверная')).toBeInTheDocument();
  });

  it('Мои дети: ошибка → «Не удалось загрузить детей», без сырого текста', async () => {
    fake.rpc.my_children = () => ({ error: { message: RAW } });
    const { container } = render(<MyKids onBack={() => {}} />);
    expect(await screen.findByText('Не удалось загрузить детей')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/42883|my_children/);
    expect(screen.queryByText('Нет привязанных детей')).toBeNull();
  });

  it('Матчи: ошибка → «Не удалось загрузить матчи», без сырого текста', async () => {
    fake.rpc.my_children = () => ({ error: { message: RAW } });
    const { container } = render(<Matches />);
    expect(await screen.findByText('Не удалось загрузить матчи')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/42883|my_children/);
    expect(screen.queryByText('Пока пусто')).toBeNull();
  });
});

describe('К3: отклонённый запрос (сбой сети) не оставляет вечную загрузку', () => {
  const down = () => Promise.reject(new Error('Failed to fetch'));

  it('Оплата: «Не удалось загрузить оплаты», «Нет связи», есть повтор', async () => {
    fake.rpc.my_children = down;
    render(<Payments />);
    expect(await screen.findByText('Не удалось загрузить оплаты')).toBeInTheDocument();
    expect(screen.getByText(/Нет связи/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  });

  it('Мои дети: «Не удалось загрузить детей», «Нет связи»', async () => {
    fake.rpc.my_children = down;
    render(<MyKids onBack={() => {}} />);
    expect(await screen.findByText('Не удалось загрузить детей')).toBeInTheDocument();
    expect(screen.getByText(/Нет связи/)).toBeInTheDocument();
    expect(screen.queryByText('Нет привязанных детей')).toBeNull();
  });

  it('Матчи: «Не удалось загрузить матчи», «Нет связи»', async () => {
    fake.rpc.my_children = down;
    render(<Matches />);
    expect(await screen.findByText('Не удалось загрузить матчи')).toBeInTheDocument();
    expect(screen.getByText(/Нет связи/)).toBeInTheDocument();
    expect(screen.queryByText('Пока пусто')).toBeNull();
  });

  it('App: загрузка завершается, оболочка показана, вкладка «Ребёнок» не открывается по ошибке', async () => {
    fake.db.users = [{ id: 'u', is_admin: false, chosen_role: 'child' }];
    fake.rpc.my_children = down;
    render(<App />);
    const nav = await screen.findByRole('navigation', { name: 'Разделы' });
    expect(within(nav).queryByRole('button', { name: 'Ребёнок' })).toBeNull();
  });
});

// К7-К10: Home, Schedule, ParentCalendar (docs/acceptance/my-children-client-2-2026-11-20.md)
describe('К7: Мой ребёнок, Расписание, Календарь берут детей из my_children()', () => {
  it('Мой ребёнок: ребёнок сервера с группой виден, ребёнок только из таблицы нет', async () => {
    fake.rpc.my_children = () => [KID];
    render(<Home />);
    expect(await screen.findByText('Аня Серверная')).toBeInTheDocument();
    expect(screen.getByText('U9')).toBeInTheDocument();
    expect(screen.queryByText('Только в таблице')).toBeNull();
    noTableReads();
  });

  it('Расписание: группа ребёнка сервера (К8: без группы — отдельной строкой), таблица не читается', async () => {
    fake.rpc.my_children = () => [KID, { player_id: 'p2', full_name: 'Боря Без Группы', group_id: null, group_name: null }];
    render(<Schedule />);
    expect(await screen.findByText(/Аня Серверная/)).toBeInTheDocument();
    expect(screen.getByText(/Боря Без Группы/)).toBeInTheDocument();
    expect(screen.queryByText(/Только в таблице/)).toBeNull();
    noTableReads();
  });

  it('Календарь: ребёнок сервера выбран, таблица не читается', async () => {
    fake.rpc.my_children = () => [KID];
    fake.rpc.parent_calendar = () => [];
    fake.rpc.match_tournaments = () => [];
    render(<ParentCalendar />);
    await waitFor(() => expect(fake.rpcCalls('parent_calendar').length).toBeGreaterThan(0));
    expect(fake.rpcCalls('parent_calendar')[0]).toMatchObject({ p_player: 'p1' });
    noTableReads();
  });
});

describe('К9: пустой список сервера — прежнее «нет детей», не ошибка', () => {
  it('Мой ребёнок', async () => {
    fake.rpc.my_children = () => [];
    render(<Home />);
    expect(await screen.findByRole('heading', { name: 'Подключите профиль ребёнка' })).toBeInTheDocument();
  });

  it('Расписание', async () => {
    fake.rpc.my_children = () => [];
    render(<Schedule />);
    await waitFor(() => expect(fake.rpcCalls('my_children')).toHaveLength(1));
    expect(screen.queryByText('Не удалось загрузить расписание')).toBeNull();
  });
});

describe('К10: ошибка и сбой сети в Мой ребёнок, Расписание, Календарь', () => {
  const RAW = 'function public.my_children() does not exist (42883)';
  const down = () => Promise.reject(new Error('Failed to fetch'));

  it('Мой ребёнок: ошибка и сбой сети — «Нет связи», повтор восстанавливает', async () => {
    fake.rpc.my_children = down;
    const { container } = render(<Home />);
    expect(await screen.findByText(/Нет связи/)).toBeInTheDocument();
    expect(container.textContent).not.toContain('Failed to fetch');
    fake.rpc.my_children = () => [KID];
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Аня Серверная')).toBeInTheDocument();
  });

  it('Мой ребёнок: ответ с ошибкой без сырого текста', async () => {
    fake.rpc.my_children = () => ({ error: { message: RAW } });
    const { container } = render(<Home />);
    expect(await screen.findByRole('button', { name: 'Повторить' })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/42883|my_children/);
  });

  it('Расписание: ошибка и сбой сети — «Не удалось загрузить расписание», без сырого текста', async () => {
    fake.rpc.my_children = () => ({ error: { message: RAW } });
    const a = render(<Schedule />);
    expect(await screen.findByText('Не удалось загрузить расписание')).toBeInTheDocument();
    expect(a.container.textContent).not.toMatch(/42883|my_children/);
    a.unmount();
    fake.rpc.my_children = down;
    render(<Schedule />);
    expect(await screen.findByText('Не удалось загрузить расписание')).toBeInTheDocument();
    expect(screen.getByText(/Нет связи/)).toBeInTheDocument();
  });

  it('Календарь: ошибка и сбой сети — «Не удалось загрузить календарь», не вечная загрузка', async () => {
    fake.rpc.my_children = () => ({ error: { message: RAW } });
    const a = render(<ParentCalendar />);
    expect(await screen.findByText('Не удалось загрузить календарь')).toBeInTheDocument();
    expect(a.container.textContent).not.toMatch(/42883|my_children/);
    a.unmount();
    fake.rpc.my_children = down;
    render(<ParentCalendar />);
    expect(await screen.findByText('Не удалось загрузить календарь')).toBeInTheDocument();
  });
});
