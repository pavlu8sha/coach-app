import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import Admin from './Admin';

describe('Запросы → Родители', () => {
  it('показывает, кто привязал ребёнка, кто ждёт подтверждения, кто нет и детей без родителя', async () => {
    fake.db.link_requests = [];
    fake.db.data_requests = [];
    fake.db.users = [
      { id: 'u1', display_name: 'Анна', telegram_id: 1, chosen_role: 'parent', is_admin: false },
      { id: 'u2', display_name: 'Борис', telegram_id: 2, chosen_role: 'parent', is_admin: false },
      { id: 'u3', display_name: 'Вера', telegram_id: 3, chosen_role: 'parent', is_admin: false },
      { id: 'u4', display_name: 'Тренер', telegram_id: 4, chosen_role: 'coach', is_admin: false },
    ];
    fake.db.players = [
      { id: 'p1', full_name: 'Алексей Петров', group_id: 'g1', status: 'active' },
      { id: 'p2', full_name: 'Мария Сидорова', group_id: 'g1', status: 'active' },
      { id: 'p3', full_name: 'Олег Иванов', group_id: null, status: 'active' },
    ];
    fake.db.player_guardians = [{ user_id: 'u1', player_id: 'p1' }];
    fake.db.groups = [{ id: 'g1', name: 'U9' }];
    render(<Admin />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Родители' }));
    expect(await screen.findByText('Привязали ребёнка (1)')).toBeInTheDocument();
    expect(screen.getByText('Анна')).toBeInTheDocument();
    expect(screen.getByText('Алексей Петров')).toBeInTheDocument();
    expect(screen.getByText('Вошли, но ребёнка не привязали')).toBeInTheDocument();
    expect(screen.getByText('Борис')).toBeInTheDocument();
    expect(screen.queryByText('Тренер')).toBeNull();
    expect(screen.getByText('Дети без привязанного родителя (2)')).toBeInTheDocument();
    expect(screen.getByText('Олег Иванов')).toBeInTheDocument();
  });
});
