import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import ChildMatches from './ChildMatches';

const player = { id: 'p1', group: 'U10' } as any;

describe('экран ребёнка «Матчи»: светофор, участие, оценка (PARENT_MATCHES_VISUAL_ACCEPTANCE, Р1)', () => {
  it('результаты со светофором, «Не играл», оценкой и звездой', async () => {
    fake.db.matches = [
      { id: 'm1', team: 'U10', played_on: '2026-10-01', opponent: 'Олимп', goals_for: 3, goals_against: 1 },
      { id: 'm2', team: 'U10', played_on: '2026-10-05', opponent: 'Динамо', goals_for: 0, goals_against: 2 },
      { id: 'm3', team: 'U10', played_on: '2026-10-09', opponent: 'Локо', goals_for: 2, goals_against: 2 },
    ];
    fake.db.match_players = [
      { match_id: 'm1', player_id: 'p1', played: true, goals: 1, best: true, performance_rating: 4 },
      { match_id: 'm2', player_id: 'p1', played: false, goals: 0, best: false, performance_rating: null },
      { match_id: 'm3', player_id: 'pX', played: true, goals: 7, best: true, performance_rating: 5 },
    ];
    render(<ChildMatches player={player} />);
    fireEvent.click(await screen.findByText('Результаты'));
    const row = async (t: string) => (await screen.findByText(t, { selector: '.ks-row-title' })).closest('.ks-mres') as HTMLElement;
    const o = await row('Олимп');
    expect(o).toHaveClass('w');
    expect(o).toHaveTextContent('Играл · голы: 1');
    expect(o).toHaveTextContent('★ Лучший');
    expect(within(o).getByRole('img', { name: 'Оценка 4 из 5' })).toBeInTheDocument();
    expect(o).toHaveTextContent('+5 б.');
    expect(await row('Динамо')).toHaveClass('l');
    expect(await row('Динамо')).toHaveTextContent('Не играл');
    expect(await row('Локо')).toHaveClass('d');
    expect(await row('Локо')).toHaveTextContent('Не играл'); // запись другого ребёнка не считается
    expect(within(await row('Локо')).queryByRole('img', { name: /Оценка/ })).toBeNull();
  });
});
