import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import More from './More';

describe('Администратор: «Посмотреть как»', () => {
  it('пункты предпросмотра вызывают смену режима', async () => {
    const calls: string[] = [];
    render(<More groups={[]} bar={[]} onMenuChanged={() => {}} onPreview={r => calls.push(r)} />);
    fireEvent.click(screen.getByText('Гость'));
    fireEvent.click(screen.getByText('Родитель'));
    fireEvent.click(screen.getByText('Ребёнок'));
    await waitFor(() => expect(calls).toEqual(['guest', 'parent', 'child']));
  });
});

describe('Предпросмотр в приложении', () => {
  it('администратор открывает «О клубе» как гость и выходит обратно', async () => {
    const { fake } = await import('../test/fakeSupabase');
    const { Shell } = await import('../App');
    fake.db.users = [{ id: 'u', is_admin: true, chosen_role: null }];
    fake.db.player_guardians = [];
    fake.db.coach_groups = [];
    fake.db.groups = [];
    fake.db.link_requests = [];
    fake.db.data_requests = [];
    render(<Shell />);
    fireEvent.click(await screen.findByRole('button', { name: /Ещё/ }));
    fireEvent.click(await screen.findByText('Гость'));
    expect(await screen.findByText('Режим просмотра: Гость')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /^Филиалы/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));
    await waitFor(() => expect(screen.queryByText('Режим просмотра: Гость')).toBeNull());
  });
});
