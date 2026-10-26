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
    fireEvent.click(screen.getByText('Записать оплату (1)'));
    await waitFor(() => expect(fake.rpcCalls('event_pay')).toHaveLength(1));
    expect(fake.rpcCalls('event_pay')[0]).toMatchObject({ t: 'e1', ids: ['p2'], amt: null, mth: 'Наличные' });
  });

  it('скидка и отмена оплаты уходят в базу', async () => {
    setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<CoachMatches groups={groups} admin />);
    fireEvent.click(await screen.findByText('Состав и игры события'));
    await screen.findByText('Долг 30 ₾');
    fireEvent.click(screen.getByLabelText('Скидка: Сидоров Ян'));
    fireEvent.change(screen.getByLabelText('Сумма к оплате'), { target: { value: '40' } });
    fireEvent.click(screen.getByText('Применить'));
    await waitFor(() => expect(fake.rpcCalls('event_discount')).toHaveLength(1));
    expect(fake.rpcCalls('event_discount')[0]).toMatchObject({ t: 'e1', pid: 'p2', due: 40 });
    fireEvent.click(screen.getByLabelText('Отменить оплату: Иванов Пётр'));
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
    fireEvent.click(screen.getByText(/Записать оплату/));
    await waitFor(() => expect(fake.rpcCalls('match_pay')).toHaveLength(1));
    expect(fake.rpcCalls('match_pay')[0]).toMatchObject({ m: 'm1', amt: null });
  });

  it('тренеру блок взносов не показывается, у чемпионата взнос на событие', async () => {
    seed();
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
    expect(opts).toEqual(['Ortachala U9', 'U10', 'U13', 'U7']);
  });
});
