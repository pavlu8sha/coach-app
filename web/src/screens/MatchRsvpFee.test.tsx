import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import Matches from './Matches';
import CoachRsvp from './CoachRsvp';

// Условия приёмки: docs/MATCH_RSVP_FEE_ACCEPTANCE.md (пп. 15-21)
window.scrollTo = (() => {}) as typeof window.scrollTo;
const future = new Date(Date.now() + 5 * 86400000).toISOString();
const groups = [{ id: 'g1', name: 'U9' }] as any;
const row = (o: Record<string, unknown> = {}) => ({
  match_id: 'r1', lifecycle_status: 'published', kind: 'friendly', team: 'U9', opponent: 'Олимп', starts_at: future, venue: 'Стадион', address: null, notes: null,
  rescheduled: false, player_id: 'p1', player_name: 'Иванов Пётр', response: null, responded_by_name: null, responded_at: null, answer_until: future, can_answer: true, fee: null, ...o,
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

describe('Родитель: взнос за матч в приглашении (п. 20, 21)', () => {
  it('сумма показана один раз на матч, а не для каждого ребёнка', async () => {
    seedParent([row({ fee: 30 }), row({ player_id: 'p2', player_name: 'Иванов Олег', fee: 30 })]);
    render(<Matches />);
    expect(await screen.findByText(/Взнос за матч:\s*30\s*₾/)).toBeInTheDocument();
    expect(screen.getAllByText(/Взнос за матч/)).toHaveLength(1);
  });

  it('сумма с копейками и неразрывным пробелом перед ₾', async () => {
    seedParent([row({ fee: 30.5 })]);
    render(<Matches />);
    const el = await screen.findByText(/Взнос за матч/);
    expect(el.textContent).toContain('30.50 ₾');
  });

  it.each([[null], [0], [undefined]])('без суммы (%s) строки нет', async fee => {
    seedParent([row({ fee })]);
    render(<Matches />);
    await screen.findByText('Олимп');
    expect(screen.queryByText(/Взнос за матч/)).toBeNull();
  });

  it('у отменённого матча суммы нет', async () => {
    seedParent([row({ fee: 30, lifecycle_status: 'cancelled', can_answer: false })]);
    render(<Matches />);
    await screen.findByText('Олимп');
    expect(screen.queryByText(/Взнос за матч/)).toBeNull();
  });

  it('сумма не зависит от ответа родителя', async () => {
    seedParent([row({ fee: 30, response: 'no' })]);
    render(<Matches />);
    expect(await screen.findByText(/Взнос за матч:\s*30\s*₾/)).toBeInTheDocument();
  });
});

describe('Тренер: поле взноса в форме создания (п. 15, 16)', () => {
  const openForm = async () => {
    fake.db.matches = [];
    fake.db.clubs = [{ id: 'c1' }];
    fake.rpc.event_list = () => [
      { id: 'ch1', team: 'U9', kind: 'championship', name: 'Ch', starts_on: null, players: 1, games: 0, status: 'active' },
      { id: 'cup1', team: 'U9', kind: 'cup', name: 'Cup', starts_on: null, players: 1, games: 0, status: 'active' },
    ];
    fake.rpc.match_rsvp_create_draft = () => 'new1';
    fake.rpc.match_rsvp_seed = () => 1;
    render(<CoachRsvp groups={groups} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Новый матч' }));
    await screen.findByLabelText('Соперник');
    fireEvent.change(screen.getByLabelText('Дата и время (Тбилиси)'), { target: { value: '2026-11-20T11:00' } });
  };

  it('у товарищеского матча поле есть, с подсказкой для родителей', async () => {
    await openForm();
    expect(screen.getByLabelText('Взнос за матч, ₾')).toBeInTheDocument();
    expect(screen.getByText('Родители увидят сумму в приглашении')).toBeInTheDocument();
  });

  it('сумма уходит в p_fee, запятая как точка', async () => {
    await openForm();
    fireEvent.change(screen.getByLabelText('Взнос за матч, ₾'), { target: { value: '30,5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать черновик' }));
    await waitFor(() => expect(fake.rpcCalls('match_rsvp_create_draft')).toHaveLength(1));
    expect(fake.rpcCalls('match_rsvp_create_draft')[0]).toMatchObject({ p_fee: 30.5 });
  });

  it('пустое поле: p_fee не передаётся (создание работает и до применения миграции)', async () => {
    await openForm();
    fireEvent.click(screen.getByRole('button', { name: 'Создать черновик' }));
    await waitFor(() => expect(fake.rpcCalls('match_rsvp_create_draft')).toHaveLength(1));
    expect(fake.rpcCalls('match_rsvp_create_draft')[0]).not.toHaveProperty('p_fee');
  });

  it.each([['-5'], ['abc'], ['1e3x']])('значение «%s» не пропускается', async v => {
    await openForm();
    fireEvent.change(screen.getByLabelText('Взнос за матч, ₾'), { target: { value: v } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать черновик' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Взнос/);
    expect(fake.rpcCalls('match_rsvp_create_draft')).toHaveLength(0);
  });

  it('у матча чемпионата поля нет, у матча кубка есть', async () => {
    await openForm();
    fireEvent.change(screen.getByLabelText('Тип'), { target: { value: 'game' } });
    expect(screen.getByLabelText('Взнос за матч, ₾')).toBeInTheDocument(); // игра без события
    fireEvent.change(screen.getByLabelText('Чемпионат или фестиваль'), { target: { value: 'ch1' } });
    expect(screen.queryByLabelText('Взнос за матч, ₾')).toBeNull();
    fireEvent.change(screen.getByLabelText('Чемпионат или фестиваль'), { target: { value: 'cup1' } });
    expect(screen.getByLabelText('Взнос за матч, ₾')).toBeInTheDocument();
  });

  it('сумма, введённая до выбора чемпионата, не отправляется', async () => {
    await openForm();
    fireEvent.change(screen.getByLabelText('Взнос за матч, ₾'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('Тип'), { target: { value: 'game' } });
    fireEvent.change(screen.getByLabelText('Чемпионат или фестиваль'), { target: { value: 'ch1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать черновик' }));
    await waitFor(() => expect(fake.rpcCalls('match_rsvp_create_draft')).toHaveLength(1));
    expect(fake.rpcCalls('match_rsvp_create_draft')[0]).not.toHaveProperty('p_fee');
  });
});

describe('Тренер: взнос в карточке и правке матча (п. 17-19)', () => {
  const matchRow = (o: Record<string, unknown> = {}) => ({ id: 'm1', team: 'U9', opponent: 'Олимп', starts_at: future, lifecycle_status: 'published', kind: 'friendly', venue: 'Стадион', address: null, notes: null, tournament_id: null, fee: 30, ...o });
  const open = async (o: Record<string, unknown> = {}) => {
    fake.db.matches = [matchRow(o)];
    fake.rpc.match_rsvp_summary = () => [{ invited: 1, yes: 0, no: 0, unanswered: 1, reminders: 0, last_reminder_at: null }];
    fake.rpc.match_rsvp_roster = () => [];
    render(<CoachRsvp groups={groups} onBack={() => {}} />);
    fireEvent.click(await screen.findByText('U9 · Олимп'));
  };

  it('в карточке видна сумма взноса', async () => {
    await open();
    expect(await screen.findByText(/Взнос:\s*30\s*₾/)).toBeInTheDocument();
  });

  it('без суммы строки нет', async () => {
    await open({ fee: null });
    await screen.findByRole('button', { name: 'Изменить данные матча' });
    expect(screen.queryByText(/Взнос:/)).toBeNull();
  });

  it('у опубликованного матча смена суммы просит подтверждение и уходит в fee', async () => {
    await open();
    fireEvent.click(await screen.findByRole('button', { name: 'Изменить данные матча' }));
    fireEvent.change(await screen.findByLabelText('Взнос за матч, ₾'), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText(/Сумма изменится у неоплативших/)).toBeInTheDocument();
    expect(fake.rpcCalls('match_rsvp_update')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Изменить сумму' }));
    await waitFor(() => expect(fake.rpcCalls('match_rsvp_update')).toEqual([{ m: 'm1', p: { fee: 40 } }]));
  });

  it('пустое поле у матча с суммой отправляет fee: null', async () => {
    await open({ lifecycle_status: 'draft' });
    fireEvent.click(await screen.findByRole('button', { name: 'Изменить данные матча' }));
    fireEvent.change(await screen.findByLabelText('Взнос за матч, ₾'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(fake.rpcCalls('match_rsvp_update')).toEqual([{ m: 'm1', p: { fee: null } }]));
  });

  it('сумма не менялась: fee не отправляется', async () => {
    await open({ lifecycle_status: 'draft' });
    fireEvent.click(await screen.findByRole('button', { name: 'Изменить данные матча' }));
    fireEvent.change(await screen.findByLabelText('Соперник'), { target: { value: 'Динамо' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(fake.rpcCalls('match_rsvp_update')).toEqual([{ m: 'm1', p: { opponent: 'Динамо' } }]));
  });

  it('у матча чемпионата поля взноса в правке нет', async () => {
    await open({ kind: 'game', tournament_id: 't1', fee: null });
    fireEvent.click(await screen.findByRole('button', { name: 'Изменить данные матча' }));
    await screen.findByLabelText('Соперник');
    expect(screen.queryByLabelText('Взнос за матч, ₾')).toBeNull();
  });

  it('у матча кубка поле взноса в правке есть (единственное место суммы)', async () => {
    fake.rpc.event_list = () => [{ id: 't1', team: 'U9', kind: 'cup', name: 'Cup', starts_on: null, players: 1, games: 0, status: 'active' }];
    await open({ kind: 'game', tournament_id: 't1', fee: 30 });
    fireEvent.click(await screen.findByRole('button', { name: 'Изменить данные матча' }));
    const f = await screen.findByLabelText('Взнос за матч, ₾');
    await waitFor(() => expect(f).toBeInTheDocument());
    fireEvent.change(f, { target: { value: '45' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Изменить сумму' }));
    await waitFor(() => expect(fake.rpcCalls('match_rsvp_update')).toEqual([{ m: 'm1', p: { fee: 45 } }]));
  });

  it('у матча чемпионата (event_list вернул чемпионат) поля нет', async () => {
    fake.rpc.event_list = () => [{ id: 't1', team: 'U9', kind: 'championship', name: 'Ch', starts_on: null, players: 1, games: 0, status: 'active' }];
    await open({ kind: 'game', tournament_id: 't1', fee: null });
    fireEvent.click(await screen.findByRole('button', { name: 'Изменить данные матча' }));
    await screen.findByLabelText('Соперник');
    expect(screen.queryByLabelText('Взнос за матч, ₾')).toBeNull();
  });

  it('ошибка базы показывается по-русски, без технического текста', async () => {
    fake.rpc.match_rsvp_update = () => ({ data: null, error: { message: 'bad fee' } });
    await open({ lifecycle_status: 'draft' });
    fireEvent.click(await screen.findByRole('button', { name: 'Изменить данные матча' }));
    fireEvent.change(await screen.findByLabelText('Взнос за матч, ₾'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText(/Сумма взноса не может быть отрицательной/)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('bad fee');
  });
});
