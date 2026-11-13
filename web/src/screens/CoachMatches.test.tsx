import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fake } from '../test/fakeSupabase';
import CoachMatches from './CoachMatches';
import { resetDetachedNav } from '../nav';

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

describe('«Матчи» по категориям', () => {
  it('чемпионаты и фестивали идут отдельными разделами, товарищеские и кубки одним', async () => {
    fake.db.matches = [
      { id: 'a', team: 'U9', played_on: '2026-10-10', opponent: 'Олимп', goals_for: 3, goals_against: 1 },
      { id: 'b', team: 'U9', played_on: '2026-10-03', opponent: 'Динамо', goals_for: 0, goals_against: 0 },
      { id: 'c', team: 'U9', played_on: '2026-09-05', opponent: 'Локо', goals_for: 2, goals_against: 2 },
      { id: 'd', team: 'U9', played_on: '2026-08-16', opponent: 'Newton', goals_for: 1, goals_against: 0 },
    ];
    fake.rpc.match_tournaments = () => [
      { match_id: 'a', tournament_id: 't1', tournament_name: 'Championship 1', tournament_kind: 'championship', match_kind: 'game' },
      { match_id: 'b', tournament_id: 't1', tournament_name: 'Championship 1', tournament_kind: 'championship', match_kind: 'game' },
      { match_id: 'c', tournament_id: null, tournament_name: null, tournament_kind: null, match_kind: 'friendly' },
      { match_id: 'd', tournament_id: 't9', tournament_name: 'Newton cup', tournament_kind: 'cup', match_kind: 'game' },
    ];
    render(<CoachMatches groups={groups} />);
    expect(await screen.findByText('Championship 1')).toBeInTheDocument();
    expect(screen.getByText('Товарищеские и кубки')).toBeInTheDocument();
    expect(screen.getByText(/Newton cup/)).toBeInTheDocument();
  });
});

describe('«Матчи»: сколько сыграло', () => {
  it('в списке и в заголовке состава показано число игравших', async () => {
    seed();
    render(<CoachMatches groups={groups} />);
    expect(await screen.findByText(/играло 2/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Олимп'));
    expect(await screen.findByRole('heading', { name: /Состав · играло 2/ })).toBeInTheDocument();
  });
});

describe('«Матчи» тренера', () => {
  it('лучший игрок уходит в запрос, играющие и голы сохраняются', async () => {
    seed();
    fake.db.match_players = (fake.db.match_players as { player_id: string }[]).filter(r => r.player_id !== 'p9');
    render(<CoachMatches groups={groups} />);
    fireEvent.click(await screen.findByText('Олимп'));
    await screen.findByText('Иванов Пётр');
    fireEvent.click(within(screen.getByText('Иванов Пётр').closest('.ks-card') as HTMLElement).getByRole('button', { name: 'Назначить лучшим игроком' }));
    fireEvent.click(screen.getByText('Сохранить матч'));
    await waitFor(() => expect(fake.rpcCalls('save_match')).toHaveLength(1));
    const a = fake.rpcCalls('save_match')[0];
    expect(a).toMatchObject({ m: 'm1', g: 'g1', d: '2026-10-10', opp: 'Олимп', gf: 3, ga: 1 });
    expect(a.roster).toEqual([
      { player_id: 'p1', played: true, goals: 2, best: true },
      { player_id: 'p2', played: false, goals: 0, best: false },
    ]);
  });

  it('технический результат: смена признака сохраняется вместе с матчем одним запросом, без изменений обычное сохранение (#504)', async () => {
    seed();
    fake.rpc.save_match_tech = () => 'm1';
    fake.rpc.set_match_technical = () => null;
    render(<CoachMatches groups={groups} />);
    fireEvent.click(await screen.findByText('Олимп'));
    await screen.findByText('Иванов Пётр');
    fireEvent.click(screen.getByText('Сохранить матч'));
    await waitFor(() => expect(fake.rpcCalls('save_match')).toHaveLength(1));
    expect(fake.rpcCalls('save_match_tech')).toHaveLength(0);
    fireEvent.click(screen.getByLabelText('Технический результат (матч не играли)'));
    expect(screen.getByText(/баллы игрокам не начисляются/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Сохранить матч'));
    await waitFor(() => expect(fake.rpcCalls('save_match_tech')).toHaveLength(1));
    expect(fake.rpcCalls('save_match_tech')[0]).toMatchObject({ m: 'm1', g: 'g1', tm: null, d: '2026-10-10', opp: 'Олимп', tech: true });
    expect(fake.rpcCalls('save_match')).toHaveLength(1);
    expect(fake.rpcCalls('set_match_technical')).toHaveLength(0);
  });

  it('в форме матча нет текста о старых правилах баллов (#504)', async () => {
    seed();
    render(<CoachMatches groups={groups} />);
    fireEvent.click(await screen.findByText('Олимп'));
    await screen.findByText('Иванов Пётр');
    expect(screen.queryByText(/лучшему игроку — 3/)).toBeNull();
    expect(screen.getByText(/не больше 5 за матч/)).toBeInTheDocument();
  });

  it('у тренера есть поиск игроков клуба, но нет удаления матча', async () => {
    seed();
    render(<CoachMatches groups={groups} />);
    fireEvent.click(await screen.findByText('Олимп'));
    await screen.findByText('Иванов Пётр');
    expect(screen.getByLabelText('Найти игрока')).toBeInTheDocument();
    expect(screen.queryByText('Удалить матч')).toBeNull();
    expect(screen.getByText('Гость Игорь')).toBeInTheDocument(); // игрок из состава, не из группы
  });

  it('новый матч: голов у игроков больше счёта — ошибка до обращения к базе', async () => {
    seed();
    render(<CoachMatches groups={groups} />);
    fireEvent.click(await screen.findByText('Добавить матч'));
    fireEvent.click(within(screen.getByLabelText('Добавить матч')).getByText('U9'));
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
    fireEvent.click(within(screen.getByLabelText('Добавить матч')).getByText('U9'));
    await screen.findByText('Иванов Пётр');
    fireEvent.change(screen.getByLabelText('Забила наша команда'), { target: { value: '2' } });
    fireEvent.click(screen.getByText('Сохранить матч'));
    expect(await screen.findByText(/оба числа счёта/)).toBeInTheDocument();
    expect(fake.rpcCalls('save_match')).toHaveLength(0);
  });

  it('снятие отметки «играл» снимает и лучшего игрока', async () => {
    seed();
    fake.db.match_players = (fake.db.match_players as { player_id: string }[]).filter(r => r.player_id !== 'p9');
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
    render(<CoachMatches groups={allGroups} admin />);
    fireEvent.click(await screen.findByText('Олимп'));
    fireEvent.click(await screen.findByText('Удалить матч'));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(fake.rpcCalls('delete_match')).toEqual([{ m: 'm1' }]));
  });

  const removeRpc = () => {
    fake.rpc.remove_match_player = a => {
      fake.db.match_players = (fake.db.match_players as { match_id: string; player_id: string }[]).filter(r => !(r.match_id === a.m && r.player_id === a.p));
      return null;
    };
  };

  it('администратор убирает из матча ушедшего игрока через remove_match_player', async () => {
    seed();
    removeRpc();
    render(<CoachMatches groups={allGroups} admin />);
    fireEvent.click(await screen.findByText('Олимп'));
    await screen.findByText('Гость Игорь');
    expect(screen.queryByRole('button', { name: /Убрать из матча/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Править состав' }));
    fireEvent.click(screen.getByRole('button', { name: 'Убрать из матча: Гость Игорь' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Убрать' }));
    await waitFor(() => expect(screen.queryByText('Гость Игорь')).not.toBeInTheDocument());
    expect(fake.rpcCalls('remove_match_player')).toEqual([{ m: 'm1', p: 'p9' }]);
    expect((fake.db.match_players as { player_id: string }[]).some(r => r.player_id === 'p9')).toBe(false);
    expect(await screen.findByText('Гость Игорь убран из матча.')).toBeInTheDocument();
  });

  it('тренер видит «Править состав» и убирает игрока через remove_match_player', async () => {
    seed();
    removeRpc();
    render(<CoachMatches groups={groups} />);
    fireEvent.click(await screen.findByText('Олимп'));
    await screen.findByText('Иванов Пётр');
    expect(screen.queryByRole('button', { name: /Убрать из матча/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Править состав' }));
    fireEvent.click(screen.getByRole('button', { name: 'Убрать из матча: Иванов Пётр' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Убрать' }));
    await waitFor(() => expect(screen.queryByText('Иванов Пётр')).not.toBeInTheDocument());
    expect(fake.rpcCalls('remove_match_player')).toEqual([{ m: 'm1', p: 'p1' }]);
    expect(fake.rpcCalls('save_match')).toHaveLength(0);
    expect(await screen.findByText('Иванов Пётр убран из матча.')).toBeInTheDocument();
  });

  it('при отказе функции игрок остаётся в составе и показана ошибка', async () => {
    seed();
    fake.rpc.remove_match_player = () => ({ data: null, error: { message: 'forbidden' } });
    render(<CoachMatches groups={groups} />);
    fireEvent.click(await screen.findByText('Олимп'));
    await screen.findByText('Иванов Пётр');
    fireEvent.click(screen.getByRole('button', { name: 'Править состав' }));
    fireEvent.click(screen.getByRole('button', { name: 'Убрать из матча: Иванов Пётр' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Убрать' }));
    expect(await screen.findByText('Нет прав на это действие для выбранной группы.')).toBeInTheDocument();
    expect(screen.getByText('Иванов Пётр')).toBeInTheDocument();
  });

  it('не удаляет, если администратор отказался в подтверждении', async () => {
    seed();
    render(<CoachMatches groups={allGroups} admin />);
    fireEvent.click(await screen.findByText('Олимп'));
    fireEvent.click(await screen.findByText('Удалить матч'));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Отмена' }));
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

  it('список команд в фильтре идёт в едином порядке групп', async () => {
    seed();
    fake.db.matches = ['U9-B', 'Ortachala U12', 'U13-A', 'U9', 'U7', 'U10'].map((team, i) => ({ id: 'o' + i, team, played_on: '2026-10-1' + i, opponent: 'Т' + i, goals_for: 1, goals_against: 0 }));
    render(<CoachMatches groups={allGroups} allTeams />);
    const sel = await screen.findByLabelText('Команда');
    expect(Array.from(sel.querySelectorAll('option')).map(o => o.textContent)).toEqual(['Все команды', 'U7', 'U9', 'U9-B', 'U10', 'U13-A', 'Ortachala U12']);
  });
});

describe('«Новое событие»', () => {
  it('событие без игр показывается со счётчиками, состав открывается и меняется', async () => {
    fake.db.matches = [];
    fake.db.players = [{ id: 'p1', full_name: 'Иванов Пётр', group_id: 'g1', status: 'active' }];
    let roster = [{ player_id: 'p2', full_name: 'Сидоров Ян', group_name: 'U9' }];
    fake.rpc.event_list = () => [{ id: 'e1', team: 'U9', kind: 'festival', name: 'Фестиваль осени', starts_on: '2026-11-01', players: roster.length, games: 0 }];
    fake.rpc.event_roster = () => roster;
    fake.rpc.event_roster_add = a => { roster = [...roster, { player_id: (a.ids as string[])[0], full_name: 'Иванов Пётр', group_name: 'U9' }]; return null; };
    render(<CoachMatches groups={groups} allTeams />);
    expect(await screen.findByText('Фестиваль осени · U9')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Состав и игры события'));
    await screen.findByText('Сидоров Ян');
    fireEvent.click(screen.getByText('Добавить всю команду U9'));
    await waitFor(() => expect(fake.rpcCalls('event_roster_add')).toHaveLength(1));
    expect(await screen.findByText('Иванов Пётр')).toBeInTheDocument();
  });

  it('«Добавить матч»: одно окно; чемпионат открывает событие, где добавляется игра', async () => {
    fake.db.matches = [];
    fake.rpc.event_list = () => [{ id: 'e1', team: 'U9', kind: 'championship', name: 'Чемпионат осени', starts_on: '2026-10-01', players: 0, games: 0 }];
    fake.rpc.event_roster = () => [];
    render(<CoachMatches groups={groups} />);
    fireEvent.click(await screen.findByText('Добавить матч'));
    const card = screen.getByLabelText('Добавить матч');
    expect(within(card).getByText('Товарищеский или кубковый матч')).toBeInTheDocument();
    fireEvent.click(within(card).getByText('Чемпионат осени'));
    expect(await screen.findByRole('button', { name: 'Добавить игру' })).toBeInTheDocument();
    expect(screen.queryByText('Сохранить матч')).not.toBeInTheDocument();
  });

  it('«Добавить матч»: команда для товарищеского выбирается сразу, форма открывается с этой группой', async () => {
    seed();
    render(<CoachMatches groups={allGroups} allTeams />);
    fireEvent.click(await screen.findByText('Добавить матч'));
    fireEvent.click(within(screen.getByLabelText('Добавить матч')).getByText('U11'));
    expect(await screen.findByRole('heading', { name: 'Новый матч' })).toBeInTheDocument();
    expect(screen.getByLabelText('Группа')).toHaveValue('g2');
  });

  it('«Добавить матч»: галочка «Матч только этой группы» оставляет в составе детей группы и вызывает set_match_team_group', async () => {
    seed();
    const ab = [{ id: 'g1', name: 'U13-A' }, { id: 'g2', name: 'U13-B' }];
    fake.db.matches = [];
    fake.db.groups = ab;
    fake.db.players = [
      { id: 'pa', full_name: 'Алиев Анар', group_id: 'g1', status: 'active' },
      { id: 'pb', full_name: 'Беридзе Бека', group_id: 'g2', status: 'active' },
    ];
    fake.rpc.save_match = () => 'm-b';
    fake.rpc.set_match_team_group = () => null;
    render(<CoachMatches groups={ab} allTeams />);
    fireEvent.click(await screen.findByText('Добавить матч'));
    fireEvent.click(within(screen.getByLabelText('Добавить матч')).getByText('U13'));
    expect(await screen.findByRole('heading', { name: 'Новый матч' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Группа'), { target: { value: 'g2' } });
    const box = await screen.findByRole('checkbox', { name: 'Матч только этой группы (U13-B)' });
    expect(box).not.toBeChecked(); // по умолчанию поведение прежнее: команда U13
    expect(await screen.findByText('Беридзе Бека')).toBeInTheDocument();
    expect(screen.getByText('Алиев Анар')).toBeInTheDocument();
    fireEvent.click(box);
    await waitFor(() => expect(screen.queryByText('Алиев Анар')).not.toBeInTheDocument());
    expect(screen.getByText('Беридзе Бека')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить матч' }));
    await waitFor(() => expect(fake.rpcCalls('set_match_team_group')).toHaveLength(1));
    expect(fake.rpcCalls('set_match_team_group')[0]).toEqual({ m: 'm-b', g: 'g2', exact: true });
  });

  it('«Добавить матч»: без галочки set_match_team_group не вызывается', async () => {
    seed();
    const ab = [{ id: 'g1', name: 'U13-A' }, { id: 'g2', name: 'U13-B' }];
    fake.db.matches = [];
    fake.rpc.save_match = () => 'm-b';
    fake.rpc.set_match_team_group = () => null;
    render(<CoachMatches groups={ab} allTeams />);
    fireEvent.click(await screen.findByText('Добавить матч'));
    fireEvent.click(within(screen.getByLabelText('Добавить матч')).getByText('U13'));
    await screen.findByRole('heading', { name: 'Новый матч' });
    fireEvent.change(screen.getByLabelText('Группа'), { target: { value: 'g2' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Сохранить матч' }));
    await waitFor(() => expect(fake.rpcCalls('save_match')).toHaveLength(1));
    expect(fake.rpcCalls('set_match_team_group')).toHaveLength(0);
  });

  it('«Добавить матч»: команда без своей группы (U12 из кубка) не подменяется первой группой', async () => {
    seed();
    fake.rpc.event_list = () => [{ id: 'e5', team: 'U12', kind: 'cup', name: 'Newton cup', starts_on: '2026-06-14', players: 0, games: 0, status: 'finished' }];
    render(<CoachMatches groups={allGroups} allTeams />);
    fireEvent.click(await screen.findByText('Добавить матч'));
    fireEvent.click(within(screen.getByLabelText('Добавить матч')).getByText('U12'));
    expect(await screen.findByRole('heading', { name: 'Новый матч' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Группа')).not.toBeInTheDocument();
    expect(screen.getByText(/В клубе нет группы «U12»/)).toBeInTheDocument();
  });

  it('«Добавить матч»: администратор создаёт матч команды без группы через save_match_team', async () => {
    seed();
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    fake.rpc.event_list = () => [{ id: 'e5', team: 'U12', kind: 'cup', name: 'Newton cup', starts_on: '2026-06-14', players: 0, games: 0, status: 'finished' }];
    fake.rpc.save_match_team = a => { calls.push({ name: 'save_match_team', args: a }); return 'm-u12'; };
    fake.rpc.save_match = a => { calls.push({ name: 'save_match', args: a }); return 'm-x'; };
    render(<CoachMatches groups={allGroups} admin />);
    fireEvent.click(await screen.findByText('Добавить матч'));
    fireEvent.click(within(screen.getByLabelText('Добавить матч')).getByText('U12'));
    expect(await screen.findByText(/состав собирайте поиском/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить матч' }));
    await waitFor(() => expect(calls.some(c => c.name === 'save_match_team' && c.args.tm === 'U12')).toBe(true));
    expect(calls.some(c => c.name === 'save_match')).toBe(false);
  });

  it('«Добавить матч»: завершённые соревнования не предлагаются, в списке они помечены', async () => {
    fake.db.matches = [];
    fake.rpc.event_list = () => [
      { id: 'e1', team: 'U9', kind: 'championship', name: 'Championship 2', starts_on: '2026-10-20', players: 0, games: 0, status: 'active' },
      { id: 'e2', team: 'U9', kind: 'championship', name: 'Championship 1', starts_on: '2026-09-01', players: 0, games: 0, status: 'finished' },
    ];
    render(<CoachMatches groups={groups} />);
    fireEvent.click(await screen.findByText('Добавить матч'));
    const card = screen.getByLabelText('Добавить матч');
    expect(within(card).getByText('Championship 2')).toBeInTheDocument();
    expect(within(card).queryByText('Championship 1')).not.toBeInTheDocument();
    expect(screen.getByText('завершено')).toBeInTheDocument();
  });

  it('администратор завершает и возвращает соревнование, тренеру кнопки нет', async () => {
    fake.db.matches = [];
    fake.rpc.event_list = () => [{ id: 'e1', team: 'U9', kind: 'championship', name: 'Championship 2', starts_on: '2026-10-20', players: 0, games: 0, status: 'active' }];
    fake.rpc.event_roster = () => [];
    fake.rpc.event_set_status = () => null;
    const first = render(<CoachMatches groups={groups} admin />);
    fireEvent.click(await screen.findByText('Состав и игры события'));
    fireEvent.click(await screen.findByRole('button', { name: 'Завершить соревнование' }));
    await waitFor(() => expect(fake.rpcCalls('event_set_status')).toEqual([{ t: 'e1', s: 'finished' }]));
    expect(await screen.findByRole('button', { name: 'Вернуть в работу' })).toBeInTheDocument();
    first.unmount();
    resetDetachedNav(); // второй экран — как новый вход
    render(<CoachMatches groups={groups} />);
    fireEvent.click(await screen.findByText('Состав и игры события'));
    await screen.findByText('Добавить игру', { selector: 'h2' });
    expect(screen.queryByRole('button', { name: /Завершить соревнование|Вернуть в работу/ })).not.toBeInTheDocument();
  });

  describe('матч чемпионата и ушедшие игроки', () => {
    const setupChamp = (rows: Record<string, unknown>[]) => {
      fake.db.matches = [{ id: 'm1', team: 'U9', played_on: '2026-11-02', opponent: 'Олимп', goals_for: null, goals_against: null }];
      fake.db.players = [
        { id: 'p1', full_name: 'Иванов Пётр', group_id: 'g1', status: 'active' },
        { id: 'p2', full_name: 'Сидоров Ян', group_id: 'g1', status: 'inactive' },
      ];
      fake.db.match_players = rows;
      fake.rpc.match_tournaments = () => [{ match_id: 'm1', tournament_id: 't1', tournament_name: 'Ч1', tournament_kind: 'championship', match_kind: 'game' }];
      fake.rpc.event_roster = () => [{ player_id: 'p1', full_name: 'Иванов Пётр', group_name: 'U9' }, { player_id: 'p2', full_name: 'Сидоров Ян', group_name: 'U9' }];
    };

    it('игрок со статусом «не занимается» не предлагается в составе матча события', async () => {
      setupChamp([]);
      render(<CoachMatches groups={groups} />);
      fireEvent.click(await screen.findByText('Олимп'));
      await screen.findByText('Иванов Пётр');
      expect(screen.queryByText('Сидоров Ян')).not.toBeInTheDocument();
    });

    it('если у ушедшего игрока уже есть запись в этом матче, он остаётся в нём', async () => {
      setupChamp([{ match_id: 'm1', player_id: 'p2', played: true, goals: 0, best: false }]);
      render(<CoachMatches groups={groups} />);
      fireEvent.click(await screen.findByText('Олимп'));
      expect(await screen.findByText('Сидоров Ян')).toBeInTheDocument();
    });
  });

  it('в составе события у каждого игрока кнопка «Убрать», пометки «играл в матче» нет', async () => {
    fake.db.matches = [];
    fake.rpc.event_list = () => [{ id: 'e1', team: 'U9', kind: 'championship', name: 'Ч2', starts_on: '2026-11-01', players: 2, games: 0 }];
    fake.rpc.event_roster = () => [
      { player_id: 'p1', full_name: 'Иванов Пётр', group_name: 'U9' },
      { player_id: 'p2', full_name: 'Руб Дан', group_name: 'U10' },
    ];
    render(<CoachMatches groups={groups} allTeams />);
    fireEvent.click(await screen.findByText('Состав и игры события'));
    await screen.findByText('Руб Дан');
    expect(screen.getByRole('button', { name: 'Убрать: Иванов Пётр' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Убрать: Руб Дан' })).toBeInTheDocument();
    expect(screen.queryByText('играл в матче')).toBeNull();
  });

  it('создание события уходит в базу без взноса от тренера', async () => {
    fake.db.matches = [];
    fake.rpc.event_list = () => [];
    fake.rpc.event_create = () => 'e-new';
    render(<CoachMatches groups={groups} />);
    fireEvent.click(await screen.findByText('Новое событие'));
    fireEvent.change(await screen.findByLabelText('Название'), { target: { value: 'Чемпионат 2' } });
    expect(screen.queryByLabelText(/Взнос/)).toBeNull();
    fireEvent.click(screen.getByText('Создать событие'));
    await waitFor(() => expect(fake.rpcCalls('event_create')).toHaveLength(1));
    expect(fake.rpcCalls('event_create')[0]).toMatchObject({ k: 'championship', tm: 'U9', nm: 'Чемпионат 2', fee: null });
  });

  it('администратор: взнос за чемпионат подставляется из настроек клуба (свой у команды или общий), введённый вручную важнее (#339)', async () => {
    fake.db.matches = [];
    fake.db.clubs = [{ id: 'c1' }];
    fake.db.club_settings = [
      { club_id: 'c1', key: 'matches.champFee', scope: '', value: '200' },
      { club_id: 'c1', key: 'matches.champFee', scope: 'U9', value: '300' },
    ];
    fake.rpc.event_list = () => [];
    fake.rpc.event_create = () => 'e-new';
    render(<CoachMatches groups={groups} allTeams admin />);
    fireEvent.click(await screen.findByText('Новое событие'));
    fireEvent.change(await screen.findByLabelText('Название'), { target: { value: 'Чемпионат 2' } });
    await waitFor(() => expect(screen.getByLabelText(/Взнос/)).toHaveAttribute('placeholder', '300'));
    fireEvent.click(screen.getByText('Создать событие'));
    await waitFor(() => expect(fake.rpcCalls('event_create')).toHaveLength(1));
    expect(fake.rpcCalls('event_create')[0]).toMatchObject({ tm: 'U9', fee: 300 });
  });

  it('состав копируется из выбранного события, по умолчанию не копируется', async () => {
    fake.db.matches = [];
    fake.rpc.event_list = () => [{ id: 'e1', team: 'U9', kind: 'championship', name: 'Ч1', starts_on: '2026-11-01', players: 2, games: 0 }];
    fake.rpc.event_create = () => 'e-new';
    render(<CoachMatches groups={groups} />);
    fireEvent.click(await screen.findByText('Новое событие'));
    fireEvent.change(await screen.findByLabelText('Название'), { target: { value: 'Ч2' } });
    fireEvent.click(screen.getByText('Создать событие'));
    await waitFor(() => expect(fake.rpcCalls('event_create')).toHaveLength(1));
    expect(fake.rpcCalls('event_create')[0]).toMatchObject({ copy_from: null });
    fireEvent.click(await screen.findByText('Новое событие'));
    fireEvent.change(await screen.findByLabelText('Название'), { target: { value: 'Ч3' } });
    fireEvent.change(screen.getByLabelText('Скопировать состав из события'), { target: { value: 'e1' } });
    fireEvent.click(screen.getByText('Создать событие'));
    await waitFor(() => expect(fake.rpcCalls('event_create')).toHaveLength(2));
    expect(fake.rpcCalls('event_create')[1]).toMatchObject({ nm: 'Ч3', copy_from: 'e1' });
  });
});

describe('Взносы события (администратор)', () => {
  const setup = () => {
    fake.db.matches = [];
    fake.rpc.event_list = () => [{ id: 'e1', team: 'U9', kind: 'championship', name: 'Ч1', starts_on: '2026-11-01', players: 2, games: 0 }];
    fake.rpc.event_roster = () => [{ player_id: 'p1', full_name: 'Иванов Пётр', group_name: 'U9' }, { player_id: 'p2', full_name: 'Сидоров Ян', group_name: 'U9' }];
    fake.rpc.event_fees = () => [
      { player_id: 'p1', full_name: 'Иванов Пётр', group_name: 'U9', due: 50, paid: 50 },
      { player_id: 'p2', full_name: 'Сидоров Ян', group_name: 'U9', due: 50, paid: 20 },
    ];
    fake.rpc.event_payments = () => [{ id: 'x1', player_id: 'p1', full_name: 'Иванов Пётр', amount: 50, paid_on: '2026-10-20', method: 'Перевод', comment: null, cancelled: false }];
    fake.rpc.event_pay = () => 1;
    fake.rpc.event_discount = () => null;
    fake.rpc.event_cancel_payment = () => null;
  };

  it('показывает долги и записывает оплату выбранным со способом и датой', async () => {
    setup();
    render(<CoachMatches groups={groups} admin />);
    fireEvent.click(await screen.findByText('Состав и игры события'));
    expect(await screen.findByText('Долг 30 ₾')).toBeInTheDocument();
    expect(screen.getByText('Оплачен')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Платит: Сидоров Ян'));
    fireEvent.change(screen.getByLabelText('Способ'), { target: { value: 'Наличные' } });
    fireEvent.change(screen.getByLabelText(/^Способ/), { target: { value: 'Наличные' } });
    fireEvent.click(screen.getByText('Записать оплату (1)'));
    await waitFor(() => expect(fake.rpcCalls('event_pay')).toHaveLength(1));
    expect(fake.rpcCalls('event_pay')[0]).toMatchObject({ t: 'e1', ids: ['p2'], amt: null, mth: 'Наличные' });
  });

  it('показывает причину, прежнюю сумму и автора последней скидки', async () => {
    setup();
    fake.rpc.fee_discounts = () => [{ player_id: 'p2', old_amount: 50, new_amount: 40, reason: 'договорённость с родителем', by_name: 'Админ', at: '2026-11-02T10:00:00+04:00' }];
    render(<CoachMatches groups={groups} admin />);
    fireEvent.click(await screen.findByText('Состав и игры события'));
    expect(await screen.findByText(/Скидка: было 50 ₾, стало 40 ₾ · договорённость с родителем · Админ/)).toBeInTheDocument();
    expect(fake.rpcCalls('fee_discounts')[0]).toEqual({ k: 'event', ref: 'e1' });
  });

  it('скидка и отмена оплаты уходят в базу', async () => {
    setup();
    render(<CoachMatches groups={groups} admin />);
    fireEvent.click(await screen.findByText('Состав и игры события'));
    await screen.findByText('Долг 30 ₾');
    fireEvent.click(screen.getByLabelText('Скидка: Сидоров Ян'));
    fireEvent.change(screen.getByLabelText('Сумма к оплате'), { target: { value: '40' } });
    fireEvent.click(screen.getByText('Применить'));
    // без причины скидка не уходит в базу
    const dlg = within(await screen.findByRole('dialog'));
    expect(dlg.getByRole('button', { name: 'Применить скидку' })).toBeDisabled();
    expect(fake.rpcCalls('event_discount')).toHaveLength(0);
    fireEvent.change(dlg.getByLabelText(/Причина/), { target: { value: 'договорённость с родителем' } });
    fireEvent.click(dlg.getByRole('button', { name: 'Применить скидку' }));
    await waitFor(() => expect(fake.rpcCalls('event_discount')).toHaveLength(1));
    expect(fake.rpcCalls('event_discount')[0]).toMatchObject({ t: 'e1', pid: 'p2', due: 40, why: 'договорённость с родителем' });
    fireEvent.click(screen.getByLabelText('Отменить оплату: Иванов Пётр'));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Отменить оплату' }));
    await waitFor(() => expect(fake.rpcCalls('event_cancel_payment')).toHaveLength(1));
  });

  it('тренер блока взносов не видит', async () => {
    setup();
    render(<CoachMatches groups={groups} allTeams />);
    fireEvent.click(await screen.findByText('Состав и игры события'));
    await screen.findByText('Сидоров Ян');
    expect(screen.queryByText('Взносы')).toBeNull();
  });
});

describe('Взносы за матч (администратор)', () => {
  it('у товарищеского матча можно назначить взнос играющим и принять оплату', async () => {
    seed();
    let fees: { player_id: string; full_name: string; group_name: string; due: number; paid: number }[] = [];
    fake.rpc.match_fees_list = () => fees;
    fake.rpc.match_payments_list = () => [];
    fake.rpc.match_fee_add = a => { fees = (a.ids as string[]).map(id => ({ player_id: id, full_name: id === 'p1' ? 'Иванов Пётр' : 'Гость Игорь', group_name: 'U9', due: Number(a.amt), paid: 0 })); return fees.length; };
    fake.rpc.match_pay = () => 1;
    render(<CoachMatches groups={groups} admin />);
    fireEvent.click(await screen.findByText('Олимп'));
    await screen.findByText('Взносы');
    fireEvent.change(screen.getByLabelText('Взнос с игрока, ₾'), { target: { value: '20' } });
    fireEvent.click(await screen.findByText(/Добавить игроков состава во взнос/));
    await waitFor(() => expect(fake.rpcCalls('match_fee_add')).toHaveLength(1));
    expect(fake.rpcCalls('match_fee_add')[0]).toMatchObject({ m: 'm1', ids: ['p9', 'p1'], amt: 20 });
    fireEvent.click(await screen.findByLabelText('Платит: Иванов Пётр'));
    fireEvent.change(screen.getByLabelText(/^Способ/), { target: { value: 'Наличные' } });
    fireEvent.click(screen.getByText(/Записать оплату/));
    await waitFor(() => expect(fake.rpcCalls('match_pay')).toHaveLength(1));
    expect(fake.rpcCalls('match_pay')[0]).toMatchObject({ m: 'm1', amt: null });
  });

  it('тренер принимает взносы за товарищеский матч, без скидки и отмены платежа', async () => {
    seed();
    fake.rpc.match_fees_list = () => [{ player_id: 'p1', full_name: 'Иванов Пётр', group_name: 'U9', due: 20, paid: 0 }];
    fake.rpc.match_payments_list = () => [{ id: 'x1', player_id: 'p1', full_name: 'Иванов Пётр', amount: 5, paid_on: '2026-10-10', method: 'Наличные', comment: null, cancelled: false }];
    fake.rpc.match_pay = () => 1;
    render(<CoachMatches groups={groups} />);
    fireEvent.click(await screen.findByText('Олимп'));
    await screen.findByText('Взносы');
    expect(screen.queryByLabelText('Скидка: Иванов Пётр')).toBeNull();
    expect(screen.queryByLabelText('Отменить оплату: Иванов Пётр')).toBeNull();
    fireEvent.click(await screen.findByLabelText('Платит: Иванов Пётр'));
    fireEvent.change(screen.getByLabelText(/^Способ/), { target: { value: 'Перевод' } });
    fireEvent.click(screen.getByText(/Записать оплату/));
    await waitFor(() => expect(fake.rpcCalls('match_pay')).toHaveLength(1));
  });

  it('у матча чемпионата администратор видит взнос гостя (играл, но не заявлен в этом чемпионате)', async () => {
    seed();
    fake.rpc.match_tournaments = () => [{ match_id: 'm1', tournament_id: 't1', tournament_name: 'Ч1', tournament_kind: 'championship', match_kind: 'game' }];
    fake.rpc.event_roster = () => [{ player_id: 'p1', full_name: 'Иванов Пётр', group_name: 'U9' }];
    fake.rpc.champ_guest_ids = () => [{ player_id: 'p9' }];
    fake.rpc.match_fees_list = () => [{ player_id: 'p9', full_name: 'Гость Игорь', group_name: 'U11', due: 25, paid: 0 }];
    fake.rpc.match_payments_list = () => [];
    fake.rpc.fee_discounts = () => [];
    render(<CoachMatches groups={groups} admin />);
    fireEvent.click(await screen.findByText('Олимп'));
    await screen.findByText('Взносы');
    expect(screen.getByText(/Не заявлены в этом чемпионате, разовый взнос за матч: Гость Игорь/)).toBeInTheDocument();
    expect(screen.getByText('Долг 25 ₾')).toBeInTheDocument();
  });

  it('у матча чемпионата тренеру взносов нет: только посещаемость и состав', async () => {
    seed();
    fake.rpc.match_tournaments = () => [{ match_id: 'm1', tournament_id: 't1', tournament_name: 'Ч1', tournament_kind: 'championship', match_kind: 'game' }];
    fake.rpc.event_roster = () => [{ player_id: 'p1', full_name: 'Иванов Пётр', group_name: 'U9' }];
    render(<CoachMatches groups={groups} />);
    fireEvent.click(await screen.findByText('Олимп'));
    await screen.findByText('Иванов Пётр');
    expect(screen.queryByText('Взносы')).toBeNull();
  });
});

describe('Команды для матчей и событий', () => {
  it('в «Новом событии» нет индивидуальных, вратарских, weekends, Isani и суффиксов -A/-B', async () => {
    fake.db.matches = [];
    fake.rpc.event_list = () => [];
    const all = ['Isani', 'Ortachala U9', 'U10-A', 'U10-B', 'U7-A', 'U7-B', 'U13-C', 'weekends', 'Индивидуальные / Вратарские'].map((name, i) => ({ id: `g${i}`, name }));
    render(<CoachMatches groups={all} admin />);
    fireEvent.click(await screen.findByText('Новое событие'));
    const opts = within(await screen.findByLabelText('Команда')).getAllByRole('option').map(o => o.textContent);
    expect(opts).toEqual(['U7', 'U10', 'U13', 'Ortachala U9']);
  });
});

describe('Состав сохранённого матча', () => {
  it('после сохранения видны только сыгравшие; остальных можно показать кнопкой', async () => {
    seed();
    render(<CoachMatches groups={groups} />);
    fireEvent.click(await screen.findByText('Олимп'));
    expect(await screen.findByRole('checkbox', { name: 'Иванов Пётр' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Сидоров Ян' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Показать всех игроков команды/ }));
    expect(await screen.findByRole('checkbox', { name: 'Сидоров Ян' })).toBeInTheDocument();
  });
});

describe('«Матчи» тренера и матчи с подтверждением участия', () => {
  const past = new Date(Date.now() - 3600_000).toISOString();
  const future = new Date(Date.now() + 5 * 86400_000).toISOString();
  const rsvp = (id: string, opponent: string, lifecycle_status: string, starts_at: string) => ({ id, team: 'U9', played_on: '2026-11-07', opponent, goals_for: null, goals_against: null, lifecycle_status, starts_at });

  it('черновик, будущий и отменённый матчи в старом списке не видны, начавшийся виден для отметок', async () => {
    fake.db.matches = [
      rsvp('d1', 'Черновик-соперник', 'draft', future),
      rsvp('f1', 'Будущий-соперник', 'published', future),
      rsvp('c1', 'Отменённый-соперник', 'cancelled', past),
      rsvp('s1', 'Начавшийся-соперник', 'published', past),
      { id: 'l1', team: 'U9', played_on: '2026-10-10', opponent: 'Старый-соперник', goals_for: 1, goals_against: 0 },
    ];
    fake.db.players = [];
    fake.db.match_players = [];
    render(<CoachMatches groups={groups} />);
    expect(await screen.findByText(/Начавшийся-соперник/)).toBeInTheDocument();
    expect(screen.getByText(/Старый-соперник/)).toBeInTheDocument();
    for (const hidden of ['Черновик-соперник', 'Будущий-соперник', 'Отменённый-соперник']) expect(screen.queryByText(new RegExp(hidden))).toBeNull();
  });

  it('у начавшегося матча с подтверждением дата и соперник закрыты для правки', async () => {
    fake.db.matches = [rsvp('s1', 'Начавшийся-соперник', 'published', past)];
    fake.db.players = [];
    fake.db.match_players = [];
    render(<CoachMatches groups={groups} />);
    fireEvent.click(await screen.findByText(/Начавшийся-соперник/));
    expect(await screen.findByLabelText('Дата')).toBeDisabled();
    expect(screen.getByPlaceholderText('Название команды')).toBeDisabled();
    expect(screen.getByText(/меняются в разделе «Матчи с подтверждением»/)).toBeInTheDocument();
  });
});
