import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import Matches from './Matches';
import CoachRsvp from './CoachRsvp';

window.scrollTo = (() => {}) as typeof window.scrollTo;
const future = new Date(Date.now() + 5 * 86400000).toISOString();
const row = (o: Record<string, unknown> = {}) => ({
  match_id: 'r1', lifecycle_status: 'published', kind: 'friendly', team: 'U9', opponent: 'Олимп', starts_at: future, venue: 'Стадион', address: null, notes: null,
  rescheduled: false, player_id: 'p1', player_name: 'Иванов Пётр', response: null, responded_by_name: null, responded_at: null, answer_until: future, can_answer: true, ...o,
});
function seedParent(rows: unknown[]) {
  fake.user = { id: 'u1' } as any;
  fake.db.player_guardians = [{ user_id: 'u1', consent_revoked_at: null, players: { id: 'p1', full_name: 'Иванов Пётр', groups: { name: 'U9' } } }];
  fake.db.match_players = [];
  fake.db.matches = [];
  fake.rpc.match_tournaments = () => [];
  fake.rpc.my_tournaments = () => [];
  fake.rpc.match_rsvp_my_matches = () => rows;
}

describe('«Матчи» родителя: подтверждение участия', () => {
  it('родитель отвечает «Будет» за ребёнка', async () => {
    seedParent([row()]);
    render(<Matches />);
    fireEvent.click(await screen.findByRole('button', { name: 'Иванов Пётр: Будет' }));
    await waitFor(() => expect(fake.rpcCalls('match_rsvp_answer')).toEqual([{ m: 'r1', p_player: 'p1', p_response: 'yes' }]));
  });

  it('когда приём ответов закрыт, кнопок нет', async () => {
    seedParent([row({ can_answer: false, response: 'no' })]);
    render(<Matches />);
    expect(await screen.findByText(/Приём ответов закрыт/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Иванов Пётр: Будет' })).toBeNull();
  });

  it('если функция базы недоступна, экран работает как раньше', async () => {
    seedParent([]);
    fake.rpc.match_rsvp_my_matches = () => ({ error: { message: 'boom' } });
    render(<Matches />);
    expect(await screen.findByText(/Матчей пока нет|Нет матчей|пока нет/i)).toBeInTheDocument();
  });
});

describe('Карточка матча родителя: оформление', () => {
  it('ссылка в адресе кликабельна, заметка и место подписаны', async () => {
    seedParent([row({ venue: 'Isani', address: 'https://maps.app.goo.gl/abc', notes: 'Форма синяя' })]);
    render(<Matches />);
    const link = await screen.findByRole('link', { name: 'Открыть на карте' });
    expect(link).toHaveAttribute('href', 'https://maps.app.goo.gl/abc');
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.getByText('Где играем')).toBeInTheDocument();
    expect(screen.getByText('От тренера')).toBeInTheDocument();
  });
});

describe('Тренер: матчи с подтверждением', () => {
  const groups = [{ id: 'g1', name: 'U9' }] as any;
  it('создаёт черновик с временем по Тбилиси', async () => {
    fake.db.matches = [matchRow({ id: 'new1', lifecycle_status: 'draft' })];
    fake.db.clubs = [{ id: 'c1' }];
    fake.rpc.event_list = () => [];
    fake.rpc.match_rsvp_create_draft = () => 'new1';
    render(<CoachRsvp groups={groups} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Новый матч' }));
    fireEvent.change(await screen.findByLabelText('Соперник'), { target: { value: 'Динамо' } });
    fireEvent.change(screen.getByLabelText('Дата и время (Тбилиси)'), { target: { value: '2026-11-20T11:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать черновик' }));
    await waitFor(() => expect(fake.rpcCalls('match_rsvp_create_draft')).toHaveLength(1));
    expect(fake.rpcCalls('match_rsvp_create_draft')[0]).toMatchObject({ p_club: 'c1', p_kind: 'friendly', p_team: 'U9', p_opponent: 'Динамо', p_starts_at: '2026-11-20T11:00:00+04:00', p_tournament: null });
    // состав добавляется сразу: у команды одна группа, берём её
    await waitFor(() => expect(fake.rpcCalls('match_rsvp_seed')).toEqual([{ m: 'new1', p_group: 'g1' }]));
    expect(await screen.findByText(/Черновик создан, но в выбранных группах нет активных игроков/)).toBeInTheDocument();
  });

  it('если состав не добавился, тренер видит понятную ошибку на экране матча', async () => {
    fake.db.matches = [matchRow({ id: 'new4', lifecycle_status: 'draft' })];
    fake.db.clubs = [{ id: 'c1' }];
    fake.rpc.event_list = () => [];
    fake.rpc.match_rsvp_create_draft = () => 'new4';
    fake.rpc.match_rsvp_seed = () => ({ data: null, error: { message: 'forbidden' } });
    render(<CoachRsvp groups={groups} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Новый матч' }));
    fireEvent.change(await screen.findByLabelText('Дата и время (Тбилиси)'), { target: { value: '2026-11-20T11:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать черновик' }));
    expect(await screen.findByText(/Черновик создан, но состав не добавлен: Нет доступа/)).toBeInTheDocument();
  });

  it('после автозаполнения показывается число добавленных игроков', async () => {
    fake.db.matches = [matchRow({ id: 'new5', lifecycle_status: 'draft' })];
    fake.db.clubs = [{ id: 'c1' }];
    fake.rpc.event_list = () => [];
    fake.rpc.match_rsvp_create_draft = () => 'new5';
    fake.rpc.match_rsvp_seed = () => 12;
    render(<CoachRsvp groups={groups} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Новый матч' }));
    fireEvent.change(await screen.findByLabelText('Дата и время (Тбилиси)'), { target: { value: '2026-11-20T11:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать черновик' }));
    expect(await screen.findByText('Черновик создан, в состав добавлено игроков: 12')).toBeInTheDocument();
  });

  it('товарищеский матч: можно выбрать основную группу, состав берётся только из неё', async () => {
    fake.db.matches = [matchRow({ id: 'new2', lifecycle_status: 'draft' })];
    fake.db.clubs = [{ id: 'c1' }];
    fake.rpc.event_list = () => [];
    fake.rpc.match_rsvp_create_draft = () => 'new2';
    fake.rpc.match_rsvp_seed = () => 3;
    const two = [{ id: 'g1', name: 'U9-A' }, { id: 'g2', name: 'U9-B' }] as any;
    render(<CoachRsvp groups={two} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Новый матч' }));
    fireEvent.change(await screen.findByLabelText('Основная группа'), { target: { value: 'g2' } });
    fireEvent.change(screen.getByLabelText('Дата и время (Тбилиси)'), { target: { value: '2026-11-20T11:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать черновик' }));
    await waitFor(() => expect(fake.rpcCalls('match_rsvp_seed')).toEqual([{ m: 'new2', p_group: 'g2' }]));
  });

  it('матч чемпионата с выбранным событием: состав берётся из списка события', async () => {
    fake.db.matches = [matchRow({ id: 'new3', lifecycle_status: 'draft' })];
    fake.db.clubs = [{ id: 'c1' }];
    fake.rpc.event_list = () => [{ id: 'e1', team: 'U9', title: 'Кубок', kind: 'tournament', status: 'active' }];
    fake.rpc.match_rsvp_create_draft = () => 'new3';
    fake.rpc.match_rsvp_seed = () => 5;
    render(<CoachRsvp groups={groups} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Новый матч' }));
    fireEvent.change(await screen.findByLabelText('Тип'), { target: { value: 'game' } });
    await waitFor(() => expect(screen.getByLabelText('Чемпионат или фестиваль').querySelectorAll('option').length).toBeGreaterThan(1));
    fireEvent.change(screen.getByLabelText('Чемпионат или фестиваль'), { target: { value: 'e1' } });
    fireEvent.change(screen.getByLabelText('Дата и время (Тбилиси)'), { target: { value: '2026-11-20T11:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать черновик' }));
    await waitFor(() => expect(fake.rpcCalls('match_rsvp_seed')).toEqual([{ m: 'new3' }]));
  });

  it('в карточке опубликованного матча видны сводка и состав, можно отметить за родителя', async () => {
    fake.db.matches = [{ id: 'm1', team: 'U9', opponent: 'Олимп', starts_at: future, lifecycle_status: 'published', kind: 'friendly', venue: null, address: null, notes: null, tournament_id: null }];
    fake.rpc.match_rsvp_summary = () => [{ invited: 2, yes: 1, no: 0, unanswered: 1, reminders: 0, last_reminder_at: null }];
    fake.rpc.match_rsvp_roster = () => [
      { player_id: 'p1', full_name: 'Иванов Пётр', group_name: 'U9', status: 'invited', response: 'yes', responded_by_name: 'Мама', responded_by_coach: false, responded_at: null, answer_until: future },
      { player_id: 'p2', full_name: 'Сидоров Иван', group_name: 'U9', status: 'invited', response: null, responded_by_name: null, responded_by_coach: false, responded_at: null, answer_until: future },
    ];
    render(<CoachRsvp groups={groups} onBack={() => {}} />);
    fireEvent.click(await screen.findByText('U9 · Олимп'));
    const sum = await screen.findByLabelText('Сводка ответов');
    expect(within(sum).getByText(/Приглашено: 2 · Будут: 1 · Не будут: 0 · Не ответили: 1/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Сидоров Иван: Не будет' }));
    await waitFor(() => expect(fake.rpcCalls('match_rsvp_coach_set')).toEqual([{ m: 'm1', p_player: 'p2', p_response: 'no' }]));
  });

  it('напоминание требует подтверждения', async () => {
    fake.db.matches = [{ id: 'm1', team: 'U9', opponent: 'Олимп', starts_at: future, lifecycle_status: 'published', kind: 'friendly', venue: null, address: null, notes: null, tournament_id: null }];
    fake.rpc.match_rsvp_summary = () => [{ invited: 1, yes: 0, no: 0, unanswered: 1, reminders: 0, last_reminder_at: null }];
    fake.rpc.match_rsvp_roster = () => [];
    fake.rpc.match_rsvp_remind_unanswered = () => [{ queued: 1, skipped: 0 }];
    render(<CoachRsvp groups={groups} onBack={() => {}} />);
    fireEvent.click(await screen.findByText('U9 · Олимп'));
    fireEvent.click(await screen.findByRole('button', { name: 'Напомнить не ответившим' }));
    expect(fake.rpcCalls('match_rsvp_remind_unanswered')).toHaveLength(0);
    fireEvent.click(await screen.findByRole('button', { name: 'Напомнить' }));
    await waitFor(() => expect(fake.rpcCalls('match_rsvp_remind_unanswered')).toHaveLength(1));
    expect(await screen.findByText(/Поставлено в очередь: 1/)).toBeInTheDocument();
  });

  const matchRow = (o: Record<string, unknown> = {}) => ({ id: 'm1', team: 'U9', opponent: 'Олимп', starts_at: future, lifecycle_status: 'published', kind: 'friendly', venue: 'Стадион', address: null, notes: null, tournament_id: null, ...o });
  const rosterRows = [
    { player_id: 'p1', full_name: 'Иванов Пётр', group_name: 'U9', status: 'invited', response: null, responded_by_name: null, responded_by_coach: false, responded_at: null, answer_until: future },
    { player_id: 'p9', full_name: 'Убранный Игрок', group_name: 'U9', status: 'removed', response: null, responded_by_name: null, responded_by_coach: false, responded_at: null, answer_until: future },
  ];
  const openMatch = async () => {
    render(<CoachRsvp groups={groups} onBack={() => {}} />);
    fireEvent.click(await screen.findByText('U9 · Олимп'));
  };

  it('правка данных матча отправляет только изменённые поля', async () => {
    fake.db.matches = [matchRow()];
    fake.rpc.match_rsvp_summary = () => [{ invited: 1, yes: 0, no: 0, unanswered: 1, reminders: 0, last_reminder_at: null }];
    fake.rpc.match_rsvp_roster = () => rosterRows;
    await openMatch();
    fireEvent.click(await screen.findByRole('button', { name: 'Изменить данные матча' }));
    fireEvent.change(await screen.findByLabelText('Соперник'), { target: { value: 'Динамо' } });
    fireEvent.change(screen.getByLabelText('Адрес или ссылка на карту'), { target: { value: 'https://maps.app.goo.gl/x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(fake.rpcCalls('match_rsvp_update')).toEqual([{ m: 'm1', p: { opponent: 'Динамо', address: 'https://maps.app.goo.gl/x' } }]));
  });

  it('исключённые игроки в составе не показываются, активного можно убрать', async () => {
    fake.db.matches = [matchRow()];
    fake.rpc.match_rsvp_summary = () => [{ invited: 1, yes: 0, no: 0, unanswered: 1, reminders: 0, last_reminder_at: null }];
    fake.rpc.match_rsvp_roster = () => rosterRows;
    await openMatch();
    expect(await screen.findByText('Иванов Пётр')).toBeInTheDocument();
    expect(screen.queryByText('Убранный Игрок')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Убрать из состава: Иванов Пётр' }));
    expect(fake.rpcCalls('match_rsvp_remove')).toHaveLength(0);
    fireEvent.click(await screen.findByRole('button', { name: 'Убрать' }));
    await waitFor(() => expect(fake.rpcCalls('match_rsvp_remove')).toEqual([{ m: 'm1', p_players: ['p1'] }]));
  });

  it('игрока можно найти по фамилии и добавить в состав', async () => {
    fake.db.matches = [matchRow()];
    fake.db.players = [{ id: 'p5', full_name: 'Сидоров Иван' }, { id: 'p1', full_name: 'Иванов Пётр' }];
    fake.rpc.match_rsvp_summary = () => [{ invited: 1, yes: 0, no: 0, unanswered: 1, reminders: 0, last_reminder_at: null }];
    fake.rpc.match_rsvp_roster = () => rosterRows;
    await openMatch();
    fireEvent.change(await screen.findByLabelText('Добавить игрока в состав'), { target: { value: 'ван' } });
    // Иванов уже в составе: предлагается только Сидоров
    const card = await screen.findByLabelText('Добавить игрока');
    fireEvent.click(await within(card).findByRole('button', { name: 'Добавить' }));
    await waitFor(() => expect(fake.rpcCalls('match_rsvp_invite')).toEqual([{ m: 'm1', p_players: ['p5'] }]));
  });

  it('состав черновика товарищеского матча берётся из групп команды', async () => {
    fake.db.matches = [matchRow({ lifecycle_status: 'draft' })];
    fake.rpc.match_rsvp_summary = () => [{ invited: 0, yes: 0, no: 0, unanswered: 0, reminders: 0, last_reminder_at: null }];
    fake.rpc.match_rsvp_roster = () => [];
    fake.rpc.match_rsvp_seed = () => 7;
    await openMatch();
    fireEvent.click(await screen.findByRole('button', { name: 'Заполнить состав команды' }));
    await waitFor(() => expect(fake.rpcCalls('match_rsvp_seed')).toEqual([{ m: 'm1', p_group: 'g1' }]));
    expect(await screen.findByText('Добавлено игроков: 7')).toBeInTheDocument();
  });

  it('состав матча чемпионата берётся из списка события', async () => {
    fake.db.matches = [matchRow({ lifecycle_status: 'draft', kind: 'game', tournament_id: 't1' })];
    fake.rpc.match_rsvp_summary = () => [{ invited: 0, yes: 0, no: 0, unanswered: 0, reminders: 0, last_reminder_at: null }];
    fake.rpc.match_rsvp_roster = () => [];
    fake.rpc.match_rsvp_seed = () => 5;
    await openMatch();
    fireEvent.click(await screen.findByRole('button', { name: 'Заполнить состав из события' }));
    await waitFor(() => expect(fake.rpcCalls('match_rsvp_seed')).toEqual([{ m: 'm1' }]));
  });

  it('начавшийся опубликованный матч можно отменить и перенести, но не править состав и не напоминать', async () => {
    const started = new Date(Date.now() - 3600_000).toISOString();
    fake.db.matches = [matchRow({ starts_at: started })];
    fake.rpc.match_rsvp_summary = () => [{ invited: 1, yes: 0, no: 0, unanswered: 1, reminders: 0, last_reminder_at: null }];
    fake.rpc.match_rsvp_roster = () => rosterRows;
    render(<CoachRsvp groups={groups} onBack={() => {}} />);
    fireEvent.click(await screen.findByText('U9 · Олимп'));
    expect(await screen.findByRole('button', { name: 'Отменить матч' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Перенести матч' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Напомнить не ответившим' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Изменить данные матча' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Убрать из состава/ })).toBeNull();
  });

  it('фильтр сводки показывает только выбранную группу', async () => {
    fake.db.matches = [matchRow()];
    fake.rpc.match_rsvp_summary = () => [{ invited: 2, yes: 1, no: 0, unanswered: 1, reminders: 0, last_reminder_at: null }];
    fake.rpc.match_rsvp_roster = () => [
      { ...rosterRows[0], response: 'yes' },
      { ...rosterRows[0], player_id: 'p2', full_name: 'Сидоров Иван', response: null },
    ];
    await openMatch();
    expect(await screen.findByText('Иванов Пётр')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Не ответили \(1\)/ }));
    expect(screen.queryByText('Иванов Пётр')).toBeNull();
    expect(screen.getByText('Сидоров Иван')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Не будут \(0\)/ }));
    expect(screen.getByText('В этой группе никого нет.')).toBeInTheDocument();
  });

  it('история действий показывается по кнопке', async () => {
    fake.db.matches = [matchRow()];
    fake.db.match_activity = [{ id: 1, match_id: 'm1', action: 'published', created_at: future }];
    fake.rpc.match_rsvp_summary = () => [{ invited: 1, yes: 0, no: 0, unanswered: 1, reminders: 0, last_reminder_at: null }];
    fake.rpc.match_rsvp_roster = () => rosterRows;
    await openMatch();
    fireEvent.click(await screen.findByRole('button', { name: 'Показать историю действий' }));
    expect(await screen.findByText(/Матч опубликован/)).toBeInTheDocument();
  });

  it('после переноса с отметками можно вернуть отметки из снимка', async () => {
    fake.db.matches = [matchRow()];
    fake.db.match_mark_snapshots = [{ id: 's1', match_id: 'm1', restored_at: null, taken_at: future }];
    fake.rpc.match_rsvp_summary = () => [{ invited: 1, yes: 0, no: 0, unanswered: 1, reminders: 0, last_reminder_at: null }];
    fake.rpc.match_rsvp_roster = () => rosterRows;
    fake.rpc.match_rsvp_restore_marks = () => null;
    await openMatch();
    fireEvent.click(await screen.findByRole('button', { name: 'Вернуть отметки до переноса' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Вернуть' }));
    await waitFor(() => expect(fake.rpcCalls('match_rsvp_restore_marks')).toEqual([{ p_snapshot: 's1' }]));
  });
});
