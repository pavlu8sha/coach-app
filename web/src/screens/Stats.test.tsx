import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import { addDays, today } from '../lib/coach';
import Stats from './Stats';
import { resetDetachedNav } from '../nav';

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
    expect(screen.getByLabelText('Лучшие бомбардиры')).toHaveTextContent(/1\. Боря.*4 ⚽.*2\. Аня.*1 ⚽/);
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

  it('бомбардиры: не больше пяти, игроки без голов не попадают', async () => {
    fake.rpc.attendance_stats = () => [];
    const pl = (name: string, goals: number) => ({ kind: 'player', team: 'U9', name, games: null, wins: null, draws: null, losses: null, goals_for: null, goals_against: null, played: 3, goals });
    fake.rpc.match_stats = () => [
      { kind: 'team', team: 'U9', name: null, games: 3, wins: 3, draws: 0, losses: 0, goals_for: 9, goals_against: 0, played: null, goals: null },
      ...['А1', 'Б2', 'В3', 'Г4', 'Д5', 'Е6'].map((n, i) => pl(n, 6 - i)), pl('Ноль', 0),
    ];
    render(<Stats />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Матчи' }));
    const box = await screen.findByLabelText('Лучшие бомбардиры');
    expect(box).toHaveTextContent('5. Д5');
    expect(box).not.toHaveTextContent('Е6');
    expect(box).not.toHaveTextContent('Ноль');
  });

  it('посещаемость: сводка по клубу, группы раскрываются с полосой, период «Прошлая неделя»', async () => {
    fake.rpc.attendance_stats = () => [
      { group_id: 'g1', group_name: 'U9', player_id: 'p1', full_name: 'Аня', attended: 2, total: 4 },
      { group_id: 'g1', group_name: 'U9', player_id: 'p2', full_name: 'Боря', attended: 1, total: 4 },
      { group_id: 'g2', group_name: 'U11', player_id: 'p3', full_name: 'Вика', attended: 4, total: 4 },
    ];
    render(<Stats />);
    const sum = await screen.findByLabelText('Сводка посещаемости');
    expect(sum).toHaveTextContent('8групповых тренировок');
    expect(sum).toHaveTextContent('7 из 12отметок «был»');
    expect(sum).toHaveTextContent('58.3%посещаемость');
    const g = screen.getByText('U9').closest('details') as HTMLDetailsElement;
    expect(g).toHaveTextContent('37.5%');
    expect(g.querySelector('.ks-bar i')).toHaveStyle({ width: '37.5%' });
    expect(g.open).toBe(false);
    fireEvent.click(within(g).getByText('U9'));
    expect(g.open).toBe(true);
    fireEvent.click(await screen.findByRole('tab', { name: 'Прошлая неделя' }));
    await waitFor(() => expect(fake.rpcCalls('attendance_stats').length).toBeGreaterThan(1));
    const a = fake.rpcCalls('attendance_stats').at(-1);
    const mon = new Date(a.p_from + 'T12:00:00');
    expect(mon.getDay()).toBe(1);
    expect(a.p_to).toBe(addDays(a.p_from, 6));
    expect(a.p_to < addDays(today(), 0)).toBe(true);
    expect(addDays(a.p_to, 1) > addDays(today(), -7)).toBe(true);
  });

  it('матчи: сводка по командам, значки В/Н/П, «Последние матчи», фильтр по команде; бомбардиры на месте', async () => {
    fake.rpc.attendance_stats = () => [];
    const pl = { kind: 'player', team: 'U9', name: 'Боря', games: null, wins: null, draws: null, losses: null, goals_for: null, goals_against: null, played: 2, goals: 4 };
    fake.rpc.match_stats = () => [
      { kind: 'team', team: 'U9', name: null, games: 3, wins: 2, draws: 1, losses: 0, goals_for: 7, goals_against: 2, played: null, goals: null },
      pl,
      { kind: 'team', team: 'U11', name: null, games: 2, wins: 0, draws: 0, losses: 2, goals_for: 1, goals_against: 6, played: null, goals: null },
    ];
    fake.db.matches = [
      { team: 'U9', played_on: addDays(today(), -3), opponent: 'Динамо', goals_for: 4, goals_against: 1 },
      { team: 'U9', played_on: addDays(today(), -2), opponent: 'Мерани', goals_for: 3, goals_against: 3 },
      { team: 'U11', played_on: addDays(today(), -1), opponent: 'Басиани', goals_for: 1, goals_against: 5 },
      { team: 'U11', played_on: addDays(today(), -1), opponent: 'Без счёта', goals_for: null, goals_against: null },
    ];
    render(<Stats />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Матчи' }));
    const sum = await screen.findByLabelText('Сводка матчей');
    expect(sum).toHaveTextContent('5игр');
    expect(sum).toHaveTextContent('8:8голы');
    expect(sum).toHaveTextContent('0разница голов');
    expect(sum).toHaveTextContent('2побед');
    expect(sum).toHaveTextContent('1ничьих');
    expect(sum).toHaveTextContent('2поражений');
    const last = screen.getByText('Последние матчи').closest('details') as HTMLElement;
    const items = within(last).getAllByRole('listitem').map(e => e.textContent);
    expect(items).toHaveLength(3); // матч без счёта не показывается
    expect(items[0]).toMatch(/U11 — Басиани1:5П$/);
    expect(items[2]).toMatch(/U9 — Динамо4:1В$/);
    expect(items[1]).toMatch(/3:3Н$/);
    fireEvent.change(screen.getByLabelText('Команда'), { target: { value: 'U9' } });
    expect(screen.getByLabelText('Сводка матчей')).toHaveTextContent('3игр');
    expect(screen.getByLabelText('Сводка матчей')).toHaveTextContent('7:2голы');
    expect(within(screen.getByText('Последние матчи').closest('details') as HTMLElement).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByRole('heading', { name: 'U11' })).toBeNull();
    expect(screen.getByLabelText('Лучшие бомбардиры')).toHaveTextContent('Боря');
  });

  it('матчи: при выбранном виде матчей список последних матчей не показывается', async () => {
    fake.rpc.attendance_stats = () => [];
    fake.rpc.match_stats = () => [{ kind: 'team', team: 'U9', name: null, games: 1, wins: 1, draws: 0, losses: 0, goals_for: 2, goals_against: 0, played: null, goals: null }];
    fake.db.matches = [{ team: 'U9', played_on: addDays(today(), -1), opponent: 'X', goals_for: 2, goals_against: 0 }];
    render(<Stats />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Матчи' }));
    expect(await screen.findByText('Последние матчи')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Вид матчей'), { target: { value: 'cup' } });
    expect(await screen.findByLabelText('Сводка матчей')).toHaveTextContent('1игр');
    await waitFor(() => expect(screen.queryByText('Последние матчи')).toBeNull());
  });

  it('тренер: если по его группам данных нет — понятное сообщение; администратору прежний текст', async () => {
    fake.rpc.attendance_stats = () => [];
    fake.rpc.match_stats = () => [];
    const { unmount } = render(<Stats own />);
    expect(await screen.findByText('Нет проведённых занятий в ваших группах')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Матчи' }));
    expect(await screen.findByText('Нет матчей ваших команд')).toBeInTheDocument();
    unmount();
    resetDetachedNav(); // второй экран — как новый вход: состояние вкладок прежнего не наследует
    render(<Stats />);
    expect(await screen.findByText('Нет проведённых занятий')).toBeInTheDocument();
  });
});
