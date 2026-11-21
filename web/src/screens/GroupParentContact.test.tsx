import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fake } from '../test/fakeSupabase';
import Group from './Group';

// A2-A4 (docs/acceptance/parent-tg-username-2026-11-21.md): кнопка «Написать в Telegram» ведёт на ник родителя.
const groups = [{ id: 'g1', name: 'U9' }];
function seed() {
  fake.db.players = [{ id: 'p1', full_name: 'Иванов Пётр', group_id: 'g1', status: 'active' }];
  fake.db.points_ledger = [];
  fake.rpc.group_parents = () => [{ player_id: 'p1', parent_name: 'Мама Пети', telegram_id: 4242 }];
  fake.rpc.points_manual_status = () => ({ active: false });
}
const open = async () => {
  render(<Group groups={groups} />);
  fireEvent.click(await screen.findByText('Иванов Пётр'));
  await screen.findByText('Мама Пети');
};
afterEach(() => { delete (window as any).Telegram; });

describe('«Родители» в карточке игрока: ник', () => {
  it('A2: с ником кнопка ведёт на t.me/<ник>', async () => {
    seed();
    fake.rpc.group_parent_usernames = () => [{ telegram_id: 4242, username: 'Mama_One' }];
    await open();
    expect(await screen.findByRole('link', { name: 'Написать в Telegram' })).toHaveAttribute('href', 'https://t.me/Mama_One');
    expect(screen.queryByText(/Ника в Telegram нет/)).toBeNull();
    expect(fake.rpcCalls('group_parent_usernames')).toContainEqual({ g: 'g1' });
  });
  it('A2: внутри Telegram ссылка открывается через openTelegramLink', async () => {
    seed();
    fake.rpc.group_parent_usernames = () => [{ telegram_id: 4242, username: 'Mama_One' }];
    const openTg = vi.fn();
    (window as any).Telegram = { WebApp: { initData: 'x', openTelegramLink: openTg } };
    await open();
    fireEvent.click(await screen.findByRole('link', { name: 'Написать в Telegram' }));
    expect(openTg).toHaveBeenCalledWith('https://t.me/Mama_One');
  });
  it('A3: без ника кнопки нет, есть подсказка и ID', async () => {
    seed();
    fake.rpc.group_parent_usernames = () => [];
    await open();
    expect(await screen.findByText(/Ника в Telegram нет. Напишите через администратора клуба./)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Написать в Telegram' })).toBeNull();
    expect(screen.getByText('Telegram ID 4242')).toBeInTheDocument();
  });
  it('A4: функции нет в базе или ошибка: список родителей остаётся, без ошибки пользователю', async () => {
    seed();
    fake.rpc.group_parent_usernames = () => ({ error: { message: 'Could not find the function public.group_parent_usernames', code: 'PGRST202' } });
    await open();
    expect(await screen.findByText(/Ника в Telegram нет/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
