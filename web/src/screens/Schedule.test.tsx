import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import Schedule from './Schedule';

describe('расписание групп родителя', () => {
  beforeEach(() => {
    fake.reset();
    fake.db.player_guardians = [{
      user_id: 'u',
      players: { full_name: 'Тимофей', group_id: 'g1', groups: { name: 'U10-A' } },
    }];
    fake.db.weekly_schedule = [{ id: 's1', group_id: 'g1', weekday: 2, starts_at: '17:00', ends_at: '18:30', location: 'Красный парк', kind: 'Групповая', coaches: null }];
  });

  it('у U10-A видны ближайшие матчи команды U10 (без суффикса группы)', async () => {
    const future = new Date(Date.now() + 5 * 86400000).toLocaleDateString('en-CA');
    fake.db.matches = [
      { id: 'm1', team: 'U10', played_on: future, opponent: 'FC Morkinali', goals_for: null, goals_against: null },
      { id: 'm2', team: 'U11', played_on: future, opponent: 'Чужой', goals_for: null, goals_against: null },
    ];
    render(<Schedule />);
    expect(await screen.findByText('FC Morkinali')).toBeInTheDocument();
    expect(screen.queryByText('Чужой')).toBeNull();
  });

  it('правка 4: «Последние результаты» видны родителю с детьми и скрыты, если results=false (гость)', async () => {
    const past = new Date(Date.now() - 5 * 86400000).toLocaleDateString('en-CA');
    fake.db.matches = [{ id: 'm3', team: 'U10', played_on: past, opponent: 'FC Прошлый', goals_for: 2, goals_against: 1 }];
    const { unmount } = render(<Schedule />);
    expect(await screen.findByText('Последние результаты')).toBeInTheDocument();
    unmount();
    render(<Schedule results={false} />);
    await screen.findByText('Красный парк');
    expect(screen.queryByText('Последние результаты')).toBeNull();
    expect(screen.queryByText('FC Прошлый')).toBeNull();
  });
});
