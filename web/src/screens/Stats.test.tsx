import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import { addDays, today } from '../lib/coach';
import Stats from './Stats';

describe('«Статистика»', () => {
  it('посещаемость: группы, игроки по возрастанию, красным ниже порога; период — текущий месяц', async () => {
    fake.rpc.attendance_stats = () => [
      { group_id: 'g1', group_name: 'U9', player_id: 'p1', full_name: 'Аня', attended: 2, total: 4 },
      { group_id: 'g1', group_name: 'U9', player_id: 'p2', full_name: 'Боря', attended: 1, total: 4 },
      { group_id: 'g2', group_name: 'U11', player_id: 'p3', full_name: 'Вика', attended: 4, total: 4 },
    ];
    render(<Stats />);
    expect(await screen.findByText(/Занятий: 4 · игроков: 2 · посещаемость 37.5%/)).toBeInTheDocument();
    expect(screen.getByText('1 из 4 · 25%')).toBeInTheDocument();
    expect(screen.getByText('4 из 4 · 100%')).toBeInTheDocument();
    const names = screen.getAllByText(/^(Аня|Боря)$/).map(e => e.textContent);
    expect(names).toEqual(['Боря', 'Аня']); // меньше посещений — выше
    const args = fake.rpcCalls('attendance_stats')[0];
    expect(args.p_from <= args.p_to).toBe(true);
    expect(args.p_from.endsWith('-01')).toBe(true);
  });

  it('пустой период и слишком большой период — понятные сообщения', async () => {
    fake.rpc.attendance_stats = () => [];
    const { unmount } = render(<Stats />);
    expect(await screen.findByText('Нет проведённых занятий')).toBeInTheDocument();
    unmount();
    fake.rpc.attendance_stats = () => ({ error: { message: 'period too large' } });
    render(<Stats />);
    expect(await screen.findByText(/не больше 13 месяцев/)).toBeInTheDocument();
  });

  it('матчи: команда с результатами и игроки по голам', async () => {
    fake.rpc.attendance_stats = () => [];
    fake.rpc.match_stats = () => [
      { kind: 'team', team: 'U9', name: null, games: 3, wins: 2, draws: 1, losses: 0, goals_for: 7, goals_against: 2, played: null, goals: null },
      { kind: 'player', team: 'U9', name: 'Аня', games: null, wins: null, draws: null, losses: null, goals_for: null, goals_against: null, played: 3, goals: 1 },
      { kind: 'player', team: 'U9', name: 'Боря', games: null, wins: null, draws: null, losses: null, goals_for: null, goals_against: null, played: 2, goals: 4 },
    ];
    render(<Stats />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Матчи' }));
    expect(await screen.findByText('Забито')).toBeInTheDocument();
    expect(screen.getByText('Разница').parentElement).toHaveTextContent('+5');
    expect(screen.getByText('Победы').parentElement).toHaveTextContent('2');
    expect(screen.getAllByText(/^(Аня|Боря)$/).map(e => e.textContent)).toEqual(['Боря', 'Аня']);
    expect(fake.rpcCalls('match_stats')).toHaveLength(1);
  });

  it('матчи: серия побед и лучший матч считаются по матчам команды', async () => {
    fake.rpc.attendance_stats = () => [];
    fake.rpc.match_stats = () => [{ kind: 'team', team: 'U9', name: null, games: 3, wins: 2, draws: 0, losses: 1, goals_for: 12, goals_against: 5, played: null, goals: null }];
    fake.db.matches = [
      { team: 'U9', played_on: addDays(today(), -4), opponent: 'А', goals_for: 0, goals_against: 3 },
      { team: 'U9', played_on: addDays(today(), -3), opponent: 'Гладани', goals_for: 8, goals_against: 1 },
      { team: 'U9', played_on: addDays(today(), -2), opponent: 'Б', goals_for: 4, goals_against: 1 },
      { team: 'U11', played_on: addDays(today(), -1), opponent: 'В', goals_for: 0, goals_against: 5 },
    ];
    render(<Stats />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Матчи' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Сезон' }));
    expect(await screen.findByText('Серия побед')).toBeInTheDocument();
    expect(screen.getByText('Серия побед').parentElement).toHaveTextContent('2');
    const d = addDays(today(), -3);
    expect(screen.getByText(`Лучший матч: 8:1 с Гладани, ${d.slice(8, 10)}.${d.slice(5, 7)}`)).toBeInTheDocument();
  });

  it('тренер: если по его группам данных нет — понятное сообщение; администратору прежний текст', async () => {
    fake.rpc.attendance_stats = () => [];
    fake.rpc.match_stats = () => [];
    const { unmount } = render(<Stats own />);
    expect(await screen.findByText('Нет проведённых занятий в ваших группах')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Матчи' }));
    expect(await screen.findByText('Нет матчей ваших команд')).toBeInTheDocument();
    unmount();
    render(<Stats />);
    expect(await screen.findByText('Нет проведённых занятий')).toBeInTheDocument();
  });
});
