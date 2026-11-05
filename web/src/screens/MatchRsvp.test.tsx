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

describe('Тренер: матчи с подтверждением', () => {
  const groups = [{ id: 'g1', name: 'U9' }] as any;
  it('создаёт черновик с временем по Тбилиси', async () => {
    fake.db.matches = [];
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
});
