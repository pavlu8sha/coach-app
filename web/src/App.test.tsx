import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
