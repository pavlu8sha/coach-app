import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fake } from '../test/fakeSupabase';
import CoachMatches from './CoachMatches';

const groups = [{ id: 'g1', name: 'U9' }];
const allGroups = [{ id: 'g1', name: 'U9' }, { id: 'g2', name: 'U11' }];

function seed() {
  fake.db.matches = [{ id: 'm1', team: 'U9', played_on: '2026-10-10', opponent: 'Олимп', goals_for: 3, goals_against: 1 }];
  fake.db.players = [
    { id: 'p1', full_name: 'Иванов Пётр', group_id: 'g1', status: 'active' },
    { id: 'p2', full_name: 'Сидоров Ян', group_id: 'g1', status: 'active' },
    { id: 'p9', full_name: 'Гость Игорь', group_id: 'g2', status: 'active' },
  ];
  fake.db.match_players = [{ match_id: 'm1', player_id: 'p1', played: true, goals: 2, best: false }, { match_id: 'm1', player_id: 'p9', played: true, goals: 0, best: false }];
  fake.rpc.save_match = a => a.m ?? 'm-new';
}
const stepper = (name: string, label: string) => within(screen.getByRole('group', { name })).getByRole('button', { name: label });

describe('«Матчи» тренера', () => {
  it('лучший игрок уходит в запрос, играющие и голы сохраняются', async () => {
    seed();
    render(<CoachMatches groups={groups} />);
    fireEvent.click(await screen.findByText('Олимп'));
    await screen.findByText('Иванов Пётр');
    fireEvent.click(screen.getByRole('button', { name: 'Назначить лучшим игроком' })); // кнопка есть только у сыгравшего
    fireEvent.click(screen.getByText('Сохранить матч'));
    await waitFor(() => expect(fake.rpcCalls('save_match')).toHaveLength(1));
    const a = fake.rpcCalls('save_match')[0];
    expect(a).toMatchObject({ m: 'm1', g: 'g1', d: '2026-10-10', opp: 'Олимп', gf: 3, ga: 1 });
    expect(a.roster).toEqual([
      { player_id: 'p1', played: true, goals: 2, best: true },
      { player_id: 'p2', played: false, goals: 0, best: false },
    ]);
  });

  it('у тренера нет поиска игроков и удаления матча, а чужих игроков он не видит', async () => {
    seed();
    render(<CoachMatches groups={groups} />);
    fireEvent.click(await screen.findByText('Олимп'));
    await screen.findByText('Иванов Пётр');
    expect(screen.queryByLabelText('Найти игрока')).toBeNull();
    expect(screen.queryByText('Удалить матч')).toBeNull();
    expect(screen.queryByText('Гость Игорь')).toBeNull();
  });

  it('новый матч: голов у игроков больше счёта — ошибка до обращения к базе', async () => {
    seed();
    render(<CoachMatches groups={groups} />);
    fireEvent.click(await screen.findByText('Добавить матч'));
    await screen.findByText('Иванов Пётр');
    fireEvent.change(screen.getByLabelText('Забила наша команда'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Забил соперник'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Иванов Пётр' }));
    fireEvent.click(stepper('Голы: Иванов Пётр', 'Больше'));
    fireEvent.click(stepper('Голы: Иванов Пётр', 'Больше'));
    fireEvent.click(screen.getByText('Сохранить матч'));
    expect(await screen.findByText('Голов у игроков больше, чем забила команда.')).toBeInTheDocument();
    expect(fake.rpcCalls('save_match')).toHaveLength(0);
  });

  it('счёт из одного числа отклоняется', async () => {
    seed();
    render(<CoachMatches groups={groups} />);
    fireEvent.click(await screen.findByText('Добавить матч'));
    await screen.findByText('Иванов Пётр');
    fireEvent.change(screen.getByLabelText('Забила наша команда'), { target: { value: '2' } });
    fireEvent.click(screen.getByText('Сохранить матч'));
    expect(await screen.findByText(/оба числа счёта/)).toBeInTheDocument();
    expect(fake.rpcCalls('save_match')).toHaveLength(0);
  });

  it('снятие отметки «играл» снимает и лучшего игрока', async () => {
    seed();
    render(<CoachMatches groups={groups} />);
    fireEvent.click(await screen.findByText('Олимп'));
    await screen.findByText('Иванов Пётр');
    fireEvent.click(screen.getByRole('button', { name: 'Назначить лучшим игроком' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Иванов Пётр' }));
    fireEvent.click(screen.getByText('Сохранить матч'));
    await waitFor(() => expect(fake.rpcCalls('save_match')).toHaveLength(1));
    expect(fake.rpcCalls('save_match')[0].roster[0]).toEqual({ player_id: 'p1', played: false, goals: 0, best: false });
  });

  it('ошибку базы показывает по-русски', async () => {
    seed();
    fake.rpc.save_match = () => ({ error: { message: 'only one best player' } });
    render(<CoachMatches groups={groups} />);
    fireEvent.click(await screen.findByText('Олимп'));
    await screen.findByText('Иванов Пётр');
    fireEvent.click(screen.getByText('Сохранить матч'));
    expect(await screen.findByText('Лучший игрок может быть только один.')).toBeInTheDocument();
  });
});

describe('«Матчи» администратора', () => {
  it('видит игроков не из группы, ищет и добавляет любого игрока клуба, передаёт группу пустой для чужой команды', async () => {
    seed();
    fake.db.matches.push({ id: 'm2', team: 'Ушедшая команда', played_on: '2026-09-01', opponent: 'Старый', goals_for: 1, goals_against: 0 });
    render(<CoachMatches groups={allGroups} admin />);
    expect(await screen.findByText('Старый')).toBeInTheDocument(); // видны матчи всех команд
    fireEvent.click(screen.getByText('Олимп'));
    expect(await screen.findByText('Гость Игорь')).toBeInTheDocument(); // игрок из состава, не из группы
    fake.db.players.push({ id: 'p8', full_name: 'Иваненко Олег', group_id: 'g2', status: 'active' });
    fireEvent.change(screen.getByLabelText('Найти игрока'), { target: { value: 'иванен' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Добавить' }));
    expect(await screen.findByRole('checkbox', { name: 'Иваненко Олег' })).toBeInTheDocument();
  });

  it('удаляет матч после подтверждения', async () => {
    seed();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<CoachMatches groups={allGroups} admin />);
    fireEvent.click(await screen.findByText('Олимп'));
    fireEvent.click(await screen.findByText('Удалить матч'));
    await waitFor(() => expect(fake.rpcCalls('delete_match')).toEqual([{ m: 'm1' }]));
  });

  it('не удаляет, если администратор отказался в подтверждении', async () => {
    seed();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<CoachMatches groups={allGroups} admin />);
    fireEvent.click(await screen.findByText('Олимп'));
    fireEvent.click(await screen.findByText('Удалить матч'));
    expect(fake.rpcCalls('delete_match')).toHaveLength(0);
  });

  it('тренер видит матчи всех команд и может фильтровать по команде', async () => {
    seed();
    fake.db.matches = [...(fake.db.matches as any[]), { id: 'm2', team: 'U11', played_on: '2026-10-12', opponent: 'Спартак', goals_for: 1, goals_against: 0 }];
    render(<CoachMatches groups={allGroups} allTeams />);
    expect(await screen.findByText('Олимп')).toBeInTheDocument();
    expect(screen.getByText('Спартак')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Команда'), { target: { value: 'U11' } });
    expect(screen.queryByText('Олимп')).not.toBeInTheDocument();
    expect(screen.getByText('Спартак')).toBeInTheDocument();
  });
});
