import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import Matches from './Matches';

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

  it('без данных о турнирах фильтра нет', async () => {
    seed();
    fake.rpc.match_tournaments = () => ({ error: { message: 'x' } });
    render(<Matches />);
    await screen.findByLabelText('Итоги команды');
    expect(screen.queryByLabelText('Турнир')).not.toBeInTheDocument();
  });
});
