import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import Admin from './Admin';

// Условия приёмки: в карточке запроса админ видит, кто уже привязан к ребёнку и сколько детей у родителя.
function seed() {
  fake.db.link_requests = [{
    id: 'r1', created_at: '2026-11-16T10:00:00Z', status: 'pending', player_id: 'p1', user_id: 'u1',
    users: { display_name: 'Мария', telegram_id: 1 }, players: { full_name: 'Алексей Петров', groups: { name: 'U9' } },
  }];
  fake.db.data_requests = [];
}

describe('Запросы родителей: подсказка админу', () => {
  it('показывает уже привязанных опекунов и число детей родителя', async () => {
    seed();
    fake.db.player_guardians = [
      { player_id: 'p1', user_id: 'u2', consent_revoked_at: null, users: { display_name: 'Ольга' }, players: { full_name: 'Алексей Петров' } },
      { player_id: 'p2', user_id: 'u1', consent_revoked_at: null, users: { display_name: 'Мария' }, players: { full_name: 'Иван Сидоров' } },
    ];
    render(<Admin />);
    expect(await screen.findByText(/У ребёнка уже привязаны: Ольга\./)).toBeInTheDocument();
    expect(screen.getByText(/У этого родителя уже привязано детей: 1\./)).toBeInTheDocument();
  });

  it('без связей: пишет, что привязок нет', async () => {
    seed();
    fake.db.player_guardians = [];
    render(<Admin />);
    expect(await screen.findByText(/У ребёнка пока нет привязанных родителей\./)).toBeInTheDocument();
    expect(screen.getByText(/Это первая привязка родителя\./)).toBeInTheDocument();
  });
});
