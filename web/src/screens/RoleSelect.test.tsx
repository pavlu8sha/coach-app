import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RoleSelect from './RoleSelect';
import { fake } from '../test/fakeSupabase';

// Условия приёмки: docs/ROLE_SELECT_ACCEPTANCE.md (#704, #705)
const RAW = 'permission denied for function set_my_role (SQLSTATE 42501) at supabase.co/rest/v1/rpc';

// База «сохраняет» роль, как set_my_role: меняет строку текущего пользователя, если она есть
const saves = () => {
  fake.rpc.set_my_role = (a: { r: string }) => {
    const row = (fake.db.users ?? []).find(u => u.id === 'u');
    if (row) row.chosen_role = a.r;
    return null;
  };
};
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}`) }));
const roleButtons = () => ['Родитель', 'Тренер', 'Ребёнок', 'Гость'].map(n => screen.getByRole('button', { name: new RegExp(`^${n}`) }));
const noTech = () => {
  const body = document.body.textContent ?? '';
  for (const bad of ['set_my_role', 'SQLSTATE', '42501', 'permission denied', 'supabase', 'Failed to fetch', 'stack', 'profile_missing']) expect(body).not.toContain(bad);
};

describe('RoleSelect: выбор роли', () => {
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    fake.db.users = [{ id: 'u', is_admin: false, chosen_role: null }];
    spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => spy.mockRestore());

  it('«Родитель»: роль сохраняется, перечитывается и только потом экран идёт дальше (#704 №1, №7)', async () => {
    saves();
    const onDone = vi.fn();
    render(<RoleSelect onDone={onDone} />);
    click('Родитель');
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('parent'));
    expect(fake.rpcCalls('set_my_role')).toEqual([{ r: 'parent' }]);
    expect(fake.db.users[0].chosen_role).toBe('parent');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('RPC «успешна», но строки профиля нет: ложного успеха нет, понятная ошибка, повтор возможен (#704 №3)', async () => {
    fake.db.users = [];
    fake.rpc.set_my_role = () => null; // старое поведение 0022: update 0 строк без ошибки
    const onDone = vi.fn();
    render(<RoleSelect onDone={onDone} />);
    click('Родитель');
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось найти ваш профиль');
    expect(onDone).not.toHaveBeenCalled();
    roleButtons().forEach(b => expect(b).toBeEnabled());
    noTech();
  });

  it('база вернула другую роль: переход не выполняется (#704 №7)', async () => {
    fake.rpc.set_my_role = () => null; // строка есть, роль осталась null
    const onDone = vi.fn();
    render(<RoleSelect onDone={onDone} />);
    click('Родитель');
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось сохранить роль');
    expect(onDone).not.toHaveBeenCalled();
  });

  it('ошибка RPC: русский текст без технических подробностей, кнопки доступны, повтор сохраняет роль (#704 №9, #705 №10–12)', async () => {
    fake.rpc.set_my_role = () => ({ error: { message: RAW, code: '42501' } });
    const onDone = vi.fn();
    render(<RoleSelect onDone={onDone} />);
    click('Родитель');
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось найти ваш профиль. Закройте приложение и откройте его заново.');
    noTech();
    expect(onDone).not.toHaveBeenCalled();
    roleButtons().forEach(b => expect(b).toBeEnabled());
    expect(spy).toHaveBeenCalled(); // подробности только в журнале
    saves();
    click('Родитель');
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('parent'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('отклонённый Promise (нет сети): сообщение про соединение, busy сброшен, повтор работает (#705 №10–12)', async () => {
    fake.rpc.set_my_role = () => Promise.reject(new TypeError('Failed to fetch'));
    const onDone = vi.fn();
    render(<RoleSelect onDone={onDone} />);
    click('Родитель');
    expect(await screen.findByRole('alert')).toHaveTextContent('Проверьте соединение и попробуйте ещё раз');
    noTech();
    roleButtons().forEach(b => expect(b).toBeEnabled());
    saves();
    click('Родитель');
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('parent'));
  });

  it('прочая ошибка базы: общий текст без сырого сообщения', async () => {
    fake.rpc.set_my_role = () => ({ error: { message: 'bad role', code: '22023' } });
    render(<RoleSelect onDone={() => undefined} />);
    click('Гость');
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось сохранить роль. Попробуйте ещё раз.');
    noTech();
    expect(document.body.textContent).not.toContain('bad role');
  });

  it('во время запроса кнопки заблокированы, второй запрос не уходит', async () => {
    let done!: () => void;
    fake.rpc.set_my_role = (a: { r: string }) => new Promise(res => { done = () => { fake.db.users[0].chosen_role = a.r; res(null); }; });
    const onDone = vi.fn();
    render(<RoleSelect onDone={onDone} />);
    click('Родитель');
    await waitFor(() => roleButtons().forEach(b => expect(b).toBeDisabled()));
    click('Тренер');
    expect(fake.rpcCalls('set_my_role')).toHaveLength(1);
    done();
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('parent'));
  });

  it('нет сессии: профиль недоступен, понятное сообщение', async () => {
    saves();
    fake.user = null;
    const onDone = vi.fn();
    render(<RoleSelect onDone={onDone} />);
    click('Родитель');
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось найти ваш профиль');
    expect(onDone).not.toHaveBeenCalled();
  });
});
