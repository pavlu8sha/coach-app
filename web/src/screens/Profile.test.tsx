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

  it('настройки по направлениям: показываются при включённых сообщениях, сохраняются, при ошибке откатываются', async () => {
    fake.db.users = [{ id: 'u', notifications_enabled: true }];
    fake.rpc.notify_prefs_get = () => [
      { direction: 'ind_sat', enabled: false }, { direction: 'ind_sun', enabled: false },
      { direction: 'goalkeeper', enabled: false }, { direction: 'extra', enabled: true },
    ];
    fake.rpc.notify_pref_set = () => null;
    render(<Profile />);
    const sat = await screen.findByRole('switch', { name: 'Индивидуальные тренировки: суббота' });
    expect(sat).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch', { name: 'Дополнительные тренировки' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(sat);
    await waitFor(() => expect(fake.rpcCalls('notify_pref_set')).toEqual([{ d: 'ind_sat', on_: true }]));
    expect(sat).toHaveAttribute('aria-checked', 'true');
    fake.rpc.notify_pref_set = () => ({ error: { message: 'oops' } });
    fireEvent.click(sat);
    expect(await screen.findByText('Не удалось сохранить настройку.')).toBeInTheDocument();
    expect(sat).toHaveAttribute('aria-checked', 'true');
    // общий выключатель выключен — настройки направлений скрыты
    fireEvent.click(screen.getByRole('switch', { name: 'Сообщения от бота в Telegram' }));
    await waitFor(() => expect(screen.queryByRole('switch', { name: 'Дополнительные тренировки' })).toBeNull());
  });

  it('родителю открываются материалы клуба и возвращаются в профиль', async () => {
    fake.db.users = [{ id: 'u' }];
    fake.db.club_articles = [];
    render(<Profile />);
    fireEvent.click(await screen.findByRole('button', { name: /^Материалы клуба/ }));
    expect(await screen.findByRole('heading', { name: 'Материалы клуба' })).toBeInTheDocument();
    expect(await screen.findByText('Материалы скоро появятся')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(await screen.findByRole('button', { name: 'Мои дети' })).toBeInTheDocument();
  });

  it('если настройки уведомлений нет в базе (миграция не применена), переключателя нет', async () => {
    fake.db.users = [];
    render(<Profile />);
    await screen.findByText('Мои дети');
    expect(screen.queryByRole('switch')).toBeNull();
  });
});
