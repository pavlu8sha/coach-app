import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import Schedule from './Schedule';

describe('расписание групп родителя', () => {
  beforeEach(() => {
    fake.reset();
    fake.db.player_guardians = [{
      user_id: 'u',
      players: { id: 'p1', full_name: 'Тимофей', group_id: 'g1', groups: { name: 'U10-A' } },
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

// #733: привязанный ребёнок без группы отличается от «нет привязанных детей»
describe('расписание групп родителя: ребёнок без группы (#733)', () => {
  const kid = (name: string, group: string | null) => ({
    user_id: 'u',
    consent_revoked_at: null,
    players: { id: `k-${name}`, full_name: name, group_id: group ? `g-${group}` : null, groups: group ? { name: group } : null },
  });
  const noLink = /подтвердит связь/;

  beforeEach(() => {
    fake.reset();
    fake.db.weekly_schedule = [{ id: 's1', group_id: 'g-U10-A', weekday: 2, starts_at: '17:00', ends_at: '18:30', location: 'Красный парк', kind: 'Групповая', coaches: null }];
    fake.db.matches = [];
  });

  it('нет привязанных детей: прежнее пустое состояние (#730 не меняется)', async () => {
    fake.db.player_guardians = [];
    render(<Schedule />);
    expect(await screen.findByText('Пока пусто')).toBeInTheDocument();
    expect(screen.getByText(noLink)).toBeInTheDocument();
    expect(screen.queryByText('Группа ещё не назначена')).toBeNull();
  });

  it('один ребёнок без группы: состояние «Группа ещё не назначена», без слов о неподтверждённой связи', async () => {
    fake.db.player_guardians = [kid('Тимофей Иванов', null)];
    render(<Schedule />);
    expect(await screen.findByText('Группа ещё не назначена')).toBeInTheDocument();
    expect(screen.getByText(/Тимофей Иванов/)).toBeInTheDocument();
    expect(screen.queryByText(noLink)).toBeNull();
    expect(screen.queryByText('Пока пусто')).toBeNull();
  });

  it('несколько детей, один без группы: группа показана, ребёнок без группы не исчезает и не получает чужое расписание', async () => {
    fake.db.player_guardians = [kid('Тимофей Иванов', 'U10-A'), kid('Мария Иванова', null)];
    render(<Schedule />);
    expect(await screen.findByText('Красный парк')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'U10-A' })).toBeInTheDocument();
    const card = screen.getByText('Группа ещё не назначена').closest('section')!;
    expect(card).toHaveTextContent('Мария Иванова');
    expect(card).not.toHaveTextContent('Красный парк');
    expect(card).not.toHaveTextContent('Тимофей Иванов');
    expect(screen.queryByText(noLink)).toBeNull();
  });

  it('все дети с группами: карточки групп как раньше, заметки нет', async () => {
    fake.db.player_guardians = [kid('Тимофей Иванов', 'U10-A')];
    render(<Schedule />);
    expect(await screen.findByText('Красный парк')).toBeInTheDocument();
    expect(screen.queryByText('Группа ещё не назначена')).toBeNull();
  });

  it('администратор (all): карточка «Группа ещё не назначена» не показывается', async () => {
    fake.db.groups = [{ id: 'g-U10-A', name: 'U10-A' }];
    fake.db.player_guardians = [kid('Мария Иванова', null)];
    render(<Schedule all editable={false} />);
    expect(await screen.findByText('Красный парк')).toBeInTheDocument();
    expect(screen.queryByText('Группа ещё не назначена')).toBeNull();
  });
});
