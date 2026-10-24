import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import Profile from './Profile';

describe('«Профиль»', () => {
  it('тема сохраняется на устройстве и применяется сразу; «Авто» возвращает тему устройства', async () => {
    fake.db.users = [{ id: 'u', notifications_enabled: true }];
    render(<Profile />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Тёмная' }));
    expect(localStorage.getItem('ks-theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    fireEvent.click(screen.getByRole('tab', { name: 'Светлая' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    fireEvent.click(screen.getByRole('tab', { name: 'Авто' }));
    expect(localStorage.getItem('ks-theme')).toBeNull();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('переключатель уведомлений вызывает функцию и при ошибке возвращается назад', async () => {
    fake.db.users = [{ id: 'u', notifications_enabled: true }];
    render(<Profile />);
    const sw = await screen.findByRole('switch');
    expect(sw).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(sw);
    await waitFor(() => expect(fake.rpcCalls('set_notifications')).toEqual([{ on_: false }]));
    expect(sw).toHaveAttribute('aria-checked', 'false');
    fake.rpc.set_notifications = () => ({ error: { message: 'oops' } });
    fireEvent.click(sw);
    expect(await screen.findByText('Не удалось сохранить настройку.')).toBeInTheDocument();
    expect(sw).toHaveAttribute('aria-checked', 'false');
  });

  it('если настройки уведомлений нет в базе (миграция не применена), переключателя нет', async () => {
    fake.db.users = [];
    render(<Profile />);
    await screen.findByText('Мои дети');
    expect(screen.queryByRole('switch')).toBeNull();
  });
});
