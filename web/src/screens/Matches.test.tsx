import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import Matches, { teamNames } from './Matches';

function seed() {
  fake.user = { id: 'u1' } as any;
  fake.db.player_guardians = [{ user_id: 'u1', consent_revoked_at: null, players: { id: 'p1', full_name: 'Иванов Пётр', groups: { name: 'U9' } } }];
  fake.db.match_players = [];
  fake.db.matches = [
    { id: 'm1', team: 'U9', played_on: '2026-10-01', opponent: 'Олимп', goals_for: 3, goals_against: 1 },
    { id: 'm2', team: 'U9', played_on: '2026-10-05', opponent: 'Динамо', goals_for: 0, goals_against: 2 },
    { id: 'm3', team: 'U9', played_on: '2026-10-09', opponent: 'Локомотив', goals_for: 4, goals_against: 0 },
  ];
  fake.rpc.match_tournaments = () => [
    { match_id: 'm1', tournament_name: 'Чемпионат 1', tournament_kind: 'championship', match_kind: 'game' },
    { match_id: 'm2', tournament_name: 'Чемпионат 1', tournament_kind: 'championship', match_kind: 'game' },
    { match_id: 'm3', tournament_name: null, tournament_kind: null, match_kind: 'friendly' },
  ];
  fake.rpc.my_tournaments = () => [];
}

describe('«Матчи» родителя: итоги и турнир', () => {
  it('показывает командные итоги без личных голов других детей', async () => {
    seed();
    render(<Matches />);
    const card = await screen.findByLabelText('Итоги команды');
    expect(within(card).getByText('Сыграно: 3')).toBeInTheDocument();
    expect(within(card).getByText(/Побед 2 · Ничьих 0 · Поражений 1/)).toBeInTheDocument();
    expect(within(card).getByText('Мячи: 7:3')).toBeInTheDocument();
    expect(within(card).getByText(/Лучший матч: Локомотив/)).toBeInTheDocument();
    expect(within(card).getAllByRole('listitem').map(e => e.getAttribute('aria-label'))).toEqual(['Победа', 'Поражение', 'Победа']);
  });

  it('фильтр по турниру сужает список и итоги', async () => {
    seed();
    render(<Matches />);
    fireEvent.change(await screen.findByLabelText('Турнир'), { target: { value: 'Чемпионат 1' } });
    await waitFor(() => expect(screen.queryByText('Локомотив', { selector: 'span, div, b, strong' })).not.toBeInTheDocument());
    const card = screen.getByLabelText('Итоги команды');
    expect(within(card).getByText('Сыграно: 2')).toBeInTheDocument();
    expect(within(card).getByText('Мячи: 3:3')).toBeInTheDocument();
  });

  it('показывает турнир без матчей и не дублирует турнир с играми', async () => {
    seed();
    fake.rpc.my_tournaments = () => [
      { id: 't1', team: 'U12', kind: 'cup', name: 'Newton cup 2014-2015', starts_on: '2026-06-14', games: 0 },
      { id: 't2', team: 'U9', kind: 'championship', name: 'Чемпионат 1', starts_on: '2026-06-01', games: 3 },
    ];
    render(<Matches />);
    expect(await screen.findByText('Newton cup 2014-2015')).toBeInTheDocument();
    expect(screen.getByText('14.06.2026')).toBeInTheDocument();
    expect(screen.getByText('U12')).toBeInTheDocument();
    expect(screen.getByText('Матчей пока нет')).toBeInTheDocument();
    expect(screen.queryByText('01.06.2026')).not.toBeInTheDocument();
  });

  it('без данных о турнирах фильтра нет', async () => {
    seed();
    fake.rpc.match_tournaments = () => ({ error: { message: 'x' } });
    render(<Matches />);
    await screen.findByLabelText('Итоги команды');
    expect(screen.queryByLabelText('Турнир')).not.toBeInTheDocument();
  });
});

describe('«Матчи» родителя: команда без суффикса группы', () => {
  function seedGroup(group: string) {
    fake.user = { id: 'u1' } as any;
    fake.db.player_guardians = [{ user_id: 'u1', consent_revoked_at: null, players: { id: 'p1', full_name: 'Иванов Пётр', groups: { name: group } } }];
    fake.db.match_players = [];
    fake.db.matches = [
      { id: 'm1', team: 'U10', played_on: '2026-10-01', opponent: 'Олимп', goals_for: 3, goals_against: 1 },
      { id: 'm2', team: 'U13-A', played_on: '2026-10-05', opponent: 'Динамо', goals_for: 0, goals_against: 2 },
      { id: 'm3', team: 'U9', played_on: '2026-10-09', opponent: 'Локомотив', goals_for: 4, goals_against: 0 },
    ];
    fake.rpc.match_tournaments = () => [];
  }

  it('ребёнок из U10-A видит матч команды U10, но не U13-A и не U9', async () => {
    seedGroup('U10-A');
    render(<Matches />);
    await screen.findByLabelText('Итоги команды');
    expect(screen.getAllByText('Олимп', { exact: false }).length).toBeGreaterThan(0);
    expect(screen.queryByText('Динамо', { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByText('Локомотив', { exact: false })).not.toBeInTheDocument();
  });

  it('ребёнок из Ortachala U9 не видит матч команды U9 (суффикса нет, не склеивается с U9-A/U9-B)', async () => {
    seedGroup('Ortachala U9');
    render(<Matches />);
    await waitFor(() => expect(screen.queryByLabelText('Итоги команды')).not.toBeInTheDocument());
    expect(screen.queryByText('Локомотив', { exact: false })).not.toBeInTheDocument();
  });

  it('teamNames: название группы и название без суффикса -A/-B/-C только в конце', () => {
    expect(teamNames(['U10-A', 'U10-B'])).toEqual(['U10-A', 'U10', 'U10-B']);
    expect(teamNames(['U13-C'])).toEqual(['U13-C', 'U13']);
    expect(teamNames(['Ortachala U9', 'U11', 'weekends'])).toEqual(['Ortachala U9', 'U11', 'weekends']);
    expect(teamNames(['U9-AB', 'A-B-x'])).toEqual(['U9-AB', 'A-B-x']);
  });
});
