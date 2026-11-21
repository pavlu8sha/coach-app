import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { fake } from './test/fakeSupabase';

const CG = [{ user_id: 'u', groups: { id: 'g1', name: 'U9' } }];
const GROUPS = [{ id: 'g1', name: 'U9' }];

// Панель видна после загрузки роли; подписи пунктов в порядке показа
async function bar() {
  const nav = await screen.findByRole('navigation', { name: 'Разделы' });
  return within(nav);
}
const labels = async () => (await bar()).getAllByRole('button').map(b => b.textContent);
const current = async () => (await bar()).getAllByRole('button').filter(b => b.getAttribute('aria-current') === 'page').map(b => b.textContent);

describe('нижняя панель по ролям', () => {
  it('тренер видит «Посещаемость» и «Учёт», активный пункт подсвечен', async () => {
    fake.db.users = [{ id: 'u', is_admin: false, chosen_role: 'coach' }];
    fake.db.coach_groups = CG;
    fake.db.groups = GROUPS;
    render(<App />);
    expect(await labels()).toEqual(['Занятия', 'Матчи', 'Посещаемость', 'Учёт', 'Группа']);
    expect(await current()).toEqual(['Занятия']);
    fireEvent.click((await bar()).getByRole('button', { name: 'Посещаемость' }));
    expect(await current()).toEqual(['Посещаемость']);
  });

  it('«Посещаемость» открывает статистику групп, «Учёт» — журнал тренеров только для просмотра', async () => {
    fake.db.users = [{ id: 'u', is_admin: false, chosen_role: 'coach' }];
    fake.db.coach_groups = CG;
    fake.db.groups = GROUPS;
    render(<App />);
    fireEvent.click((await bar()).getByRole('button', { name: 'Посещаемость' }));
    expect(await screen.findByRole('tab', { name: 'Матчи' })).toBeInTheDocument();
    fireEvent.click((await bar()).getByRole('button', { name: 'Учёт' }));
    expect(await screen.findByRole('heading', { name: 'Учёт' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Месяц' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Проведена|Изменить/ })).not.toBeInTheDocument();
    expect(await current()).toEqual(['Учёт']);
  });

  it('тренер-родитель: панель тренера прежняя, «Посещаемость» на месте, есть переключатель', async () => {
    try { localStorage.removeItem('ks.parentMode'); } catch { /* нет хранилища */ }
    fake.db.users = [{ id: 'u', is_admin: false, chosen_role: 'coach' }];
    fake.db.coach_groups = CG;
    fake.db.groups = GROUPS;
    fake.db.player_guardians = [{ user_id: 'u', player_id: 'p1', consent_revoked_at: null }];
    render(<App />);
    expect(await labels()).toEqual(['Занятия', 'Матчи', 'Посещаемость', 'Учёт', 'Группа']);
    expect(screen.getByText('Режим: тренер')).toBeInTheDocument();
  });

  it('тренер-родитель: переключение в кабинет родителя и обратно, выбор запоминается', async () => {
    try { localStorage.removeItem('ks.parentMode'); } catch { /* нет хранилища */ }
    fake.db.users = [{ id: 'u', is_admin: false, chosen_role: 'coach' }];
    fake.db.coach_groups = CG;
    fake.db.groups = GROUPS;
    fake.db.player_guardians = [{ user_id: 'u', player_id: 'p1', consent_revoked_at: null }];
    const { unmount } = render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Кабинет родителя' }));
    expect(await labels()).toEqual(['Ребёнок', 'Расписание', 'Матчи', 'Оплата', 'Профиль']);
    expect(screen.getByText('Режим: родитель')).toBeInTheDocument();
    unmount();
    render(<App />);
    expect(await labels()).toEqual(['Ребёнок', 'Расписание', 'Матчи', 'Оплата', 'Профиль']);
    fireEvent.click(await screen.findByRole('button', { name: 'Вернуться к тренеру' }));
    expect(await labels()).toEqual(['Занятия', 'Матчи', 'Посещаемость', 'Учёт', 'Группа']);
    expect(await current()).toEqual(['Занятия']);
    try { localStorage.removeItem('ks.parentMode'); } catch { /* нет хранилища */ }
  });

  it('обычный тренер, обычный родитель и администратор переключателя не видят', async () => {
    try { localStorage.setItem('ks.parentMode', '1'); } catch { /* нет хранилища */ }
    fake.db.users = [{ id: 'u', is_admin: false, chosen_role: 'coach' }];
    fake.db.coach_groups = CG;
    fake.db.groups = GROUPS;
    const a = render(<App />);
    expect(await labels()).toEqual(['Занятия', 'Матчи', 'Посещаемость', 'Учёт', 'Группа']);
    expect(screen.queryByText(/Режим:/)).not.toBeInTheDocument();
    a.unmount();
    fake.db.coach_groups = [];
    fake.db.users = [{ id: 'u', is_admin: false, chosen_role: 'parent' }];
    fake.db.player_guardians = [{ user_id: 'u', player_id: 'p1', consent_revoked_at: null }];
    const b = render(<App />);
    expect(await labels()).toEqual(['Ребёнок', 'Расписание', 'Матчи', 'Оплата', 'Профиль']);
    expect(screen.queryByText(/Режим:/)).not.toBeInTheDocument();
    b.unmount();
    fake.db.users = [{ id: 'u', is_admin: true, chosen_role: null }];
    render(<App />);
    expect(await labels()).toContain('Ещё');
    expect(screen.queryByText(/Режим:/)).not.toBeInTheDocument();
    try { localStorage.removeItem('ks.parentMode'); } catch { /* нет хранилища */ }
  });

  it('тренер с локациями Гио: разделы тренера и «Касса» на нижней панели', async () => {
    fake.db.users = [{ id: 'u', is_admin: false, chosen_role: 'coach' }];
    fake.db.coach_groups = CG;
    fake.db.groups = GROUPS;
    fake.rpc.my_locations = () => ['Исани', 'Отрачала'];
    render(<App />);
    expect(await labels()).toEqual(['Занятия', 'Матчи', 'Посещаемость', 'Учёт', 'Группа', 'Касса']);
    fireEvent.click((await bar()).getByRole('button', { name: 'Касса' }));
    expect(await screen.findByText('Касса: Исани, Отрачала')).toBeInTheDocument();
  });

  it('администратор не получает пункты тренера на нижней панели', async () => {
    fake.db.users = [{ id: 'u', is_admin: true, chosen_role: null }];
    fake.db.groups = GROUPS;
    render(<App />);
    const l = await labels();
    expect(l).not.toContain('Учёт');
    expect(l).not.toContain('Посещаемость');
    expect(l).toContain('Ещё');
  });

  it('гость без групп видит только «О клубе» и «Расписание»', async () => {
    fake.db.users = [{ id: 'u', is_admin: false, chosen_role: 'guest' }];
    render(<App />);
    expect(await labels()).toEqual(['О клубе', 'Расписание']);
  });
});

// Условия приёмки: docs/ROLE_SELECT_ACCEPTANCE.md (#704 №8, №9; #705 №13, №14)
describe('первый вход: выбор роли и переход в гостя', () => {
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { spy = vi.spyOn(console, 'error').mockImplementation(() => undefined); });
  afterEach(() => spy.mockRestore());
  const saves = () => {
    fake.rpc.set_my_role = (a: { r: string }) => {
      const row = (fake.db.users ?? []).find(u => u.id === 'u');
      if (row) row.chosen_role = a.r;
      return null;
    };
  };
  const guestBar = () => waitFor(async () => expect(await labels()).toEqual(['О клубе', 'Расписание']));
  const WELCOME = 'Добро пожаловать в FC KickStart';

  it('новый пользователь выбирает «Родитель» и идёт в кабинет родителя; после повторного открытия остаётся в роли', async () => {
    fake.db.users = [{ id: 'u', is_admin: false, chosen_role: null }];
    saves();
    const first = render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /^Родитель/ }));
    expect(await screen.findByRole('heading', { name: 'Подключите профиль ребёнка' })).toBeInTheDocument();
    expect(screen.queryByText(WELCOME)).toBeNull();
    expect(fake.db.users[0].chosen_role).toBe('parent');
    first.unmount();
    // обновление страницы: роль читается из базы
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Подключите профиль ребёнка' })).toBeInTheDocument();
    expect(screen.queryByText(WELCOME)).toBeNull();
  });

  it('роль не сохранилась (нет строки профиля): остаёмся на выборе роли с понятной ошибкой, повтор возможен', async () => {
    fake.db.users = [{ id: 'u', is_admin: false, chosen_role: null }];
    fake.rpc.set_my_role = () => ({ error: { message: 'profile_missing', code: 'P0002' } });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /^Родитель/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось найти ваш профиль');
    expect(screen.getByText(WELCOME)).toBeInTheDocument();
    saves();
    fireEvent.click(screen.getByRole('button', { name: /^Родитель/ }));
    expect(await screen.findByRole('heading', { name: 'Подключите профиль ребёнка' })).toBeInTheDocument();
  });

  const parentNoKids = () => { fake.db.users = [{ id: 'u', is_admin: false, chosen_role: 'parent' }]; };
  const guestLink = async () => screen.findByRole('button', { name: 'Просто посмотреть клуб' });

  it('becomeGuest: успех переводит в «О клубе» (путь не сломан)', async () => {
    parentNoKids();
    saves();
    render(<App />);
    fireEvent.click(await guestLink());
    await guestBar();
    expect(fake.rpcCalls('set_my_role')).toEqual([{ r: 'guest' }]);
  });

  it('becomeGuest: ошибка RPC — понятное сообщение, роль не меняется, повтор работает', async () => {
    parentNoKids();
    fake.rpc.set_my_role = () => ({ error: { message: 'permission denied for function set_my_role', code: '42501' } });
    render(<App />);
    fireEvent.click(await guestLink());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Не удалось');
    expect(document.body.textContent).not.toMatch(/set_my_role|permission denied|42501/);
    expect(screen.getByRole('heading', { name: 'Подключите профиль ребёнка' })).toBeInTheDocument();
    saves();
    fireEvent.click(screen.getByRole('button', { name: 'Просто посмотреть клуб' }));
    await guestBar();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('becomeGuest: отклонённый Promise — сообщение про соединение, без необработанного отказа, повтор работает', async () => {
    parentNoKids();
    fake.rpc.set_my_role = () => Promise.reject(new TypeError('Failed to fetch'));
    render(<App />);
    fireEvent.click(await guestLink());
    expect(await screen.findByRole('alert')).toHaveTextContent('Проверьте соединение');
    expect(document.body.textContent).not.toContain('Failed to fetch');
    saves();
    fireEvent.click(screen.getByRole('button', { name: 'Просто посмотреть клуб' }));
    await guestBar();
  });

  it('becomeGuest: двойное нажатие во время запроса не отправляет второй запрос', async () => {
    parentNoKids();
    let done!: () => void;
    fake.rpc.set_my_role = (a: { r: string }) => new Promise(res => { done = () => { fake.db.users[0].chosen_role = a.r; res(null); }; });
    render(<App />);
    const b = await guestLink();
    fireEvent.click(b);
    fireEvent.click(b);
    await waitFor(() => expect(fake.rpcCalls('set_my_role')).toHaveLength(1));
    done();
    await guestBar();
    expect(fake.rpcCalls('set_my_role')).toHaveLength(1);
  });
});
