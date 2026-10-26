import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import { today } from '../lib/coach';
import Sessions, { groupExtraRoster, groupRoster } from './Sessions';

const groups = [{ id: 'g1', name: 'U9' }];
function seed() {
  fake.db.weekly_schedule = [1, 2, 3, 4, 5, 6, 7].map(w => ({ group_id: 'g1', weekday: w, starts_at: '18:00:00', location: 'Стадион', kind: 'Групповая' }));
  fake.db.players = [
    { id: 'p1', full_name: 'Иванов Пётр', group_id: 'g1', status: 'active' },
    { id: 'p2', full_name: 'Сидоров Ян', group_id: 'g1', status: 'active' },
  ];
  fake.db.sessions = [];
  fake.db.attendance = [];
  fake.rpc.open_session = () => 'sid-1';
}

describe('«Занятия»', () => {
  it('тренер отмечает всех и сохраняет: сначала открывается занятие, затем уходят отметки', async () => {
    seed();
    render(<Sessions groups={groups} />);
    fireEvent.click(await screen.findByText('Сегодня'));
    fireEvent.click(await screen.findByText('Отметить всех «Был»'));
    fireEvent.click(screen.getByText('Сохранить отметки'));
    await waitFor(() => expect(fake.rpcCalls('mark_attendance')).toHaveLength(1));
    expect(fake.rpcCalls('open_session')).toEqual([{ g: 'g1', d: today() }]);
    expect(fake.rpcCalls('mark_attendance')[0]).toEqual({
      s: 'sid-1',
      marks: [{ player_id: 'p1', status: 'present' }, { player_id: 'p2', status: 'present' }],
    });
    expect(await screen.findByText(/Отметки сохранены/)).toBeInTheDocument();
  });

  it('прежние отметки подгружаются, сохранять без изменений нельзя', async () => {
    seed();
    fake.db.sessions = [{ id: 'sid-1', group_id: 'g1', source_key: `ATT|${today()}` }];
    fake.db.attendance = [{ session_id: 'sid-1', player_id: 'p1', status: 'excused' }];
    render(<Sessions groups={groups} />);
    fireEvent.click(await screen.findByText('Сегодня'));
    await screen.findByText('Иванов Пётр');
    expect(screen.getByText('Сохранить отметки')).toBeDisabled();
    expect(fake.rpcCalls('open_session')).toHaveLength(0); // просмотр занятие не создаёт
  });

  it('если нет занятий в расписании, показывает пустое состояние', async () => {
    fake.db.weekly_schedule = [];
    render(<Sessions groups={groups} />);
    expect(await screen.findByText('Нет занятий в расписании')).toBeInTheDocument();
  });

  it('у группы без групповых тренировок вместо состава показывает занятия (пока их нет — пояснение)', async () => {
    seed();
    fake.rpc.ind_roster_list = () => [];
    fake.db.weekly_schedule = [1, 2, 3, 4, 5, 6, 7].map(w => ({ group_id: 'g1', weekday: w, starts_at: '19:00:00', location: 'Красный парк', kind: 'Вратарская' }));
    render(<Sessions groups={groups} />);
    expect(await screen.findByText('Занятий нет')).toBeInTheDocument();
    expect(screen.queryByText('Иванов Пётр')).toBeNull();
  });

  it('ошибку базы переводит в понятный текст', async () => {
    seed();
    fake.rpc.mark_attendance = () => ({ error: { message: 'player not in group' } });
    render(<Sessions groups={groups} />);
    fireEvent.click(await screen.findByText('Сегодня'));
    fireEvent.click(await screen.findByText('Отметить всех «Был»'));
    fireEvent.click(screen.getByText('Сохранить отметки'));
    expect(await screen.findByText('Игрок не из этой группы.')).toBeInTheDocument();
  });
});

describe('«Занятия» группы «Индивидуальные / Вратарские»', () => {
  it('вместо состава группы показываются записавшиеся на занятие, отметка идёт в ind_set_attended', async () => {
    const t = today();
    fake.db.weekly_schedule = [{ group_id: 'gi', weekday: 7, starts_at: '19:00:00', location: null, kind: 'Вратари' }];
    fake.db.players = [{ id: 'pa', full_name: 'Постоянный Гость', group_id: 'gi', status: 'active' }];
    fake.rpc.ind_roster_list = () => [
      { session_id: 's1', starts_at: `${t}T19:00:00`, topic: 'Дриблинг', goalkeepers: true, player_id: 'p1', full_name: 'Иванов Пётр', attended: null },
      { session_id: 's1', starts_at: `${t}T19:00:00`, topic: 'Дриблинг', goalkeepers: true, player_id: 'p2', full_name: 'Сидоров Ян', attended: false },
    ];
    fake.rpc.ind_set_attended = () => null;
    render(<Sessions groups={[{ id: 'gi', name: 'Индивидуальные / Вратарские' }]} />);
    fireEvent.click(await screen.findByText('Записано: 2'));
    expect(await screen.findByText('Иванов Пётр')).toBeInTheDocument();
    expect(screen.queryByText('Постоянный Гость')).toBeNull(); // игрок группы, но не записан на занятие
    fireEvent.click(within(screen.getByRole('group', { name: 'Посещаемость: Иванов Пётр' })).getByRole('button', { name: 'Был' }));
    fireEvent.click(screen.getByText('Сохранить отметки'));
    await waitFor(() => expect(fake.rpcCalls('ind_set_attended')).toEqual([{ s: 's1', p: 'p1', was: true }]));
  });
});

describe('groupRoster (строки функции ind_roster_list → занятия)', () => {
  it('группирует по занятию, сохраняет порядок и не теряет занятие без записавшихся', () => {
    const rows = [
      { session_id: 'b', starts_at: '2026-10-21T12:00:00', topic: null, goalkeepers: false, player_id: null, full_name: null, attended: null },
      { session_id: 'a', starts_at: '2026-10-20T12:00:00', topic: 'Ловля', goalkeepers: true, player_id: 'p1', full_name: 'Аня', attended: true },
      { session_id: 'a', starts_at: '2026-10-20T12:00:00', topic: 'Ловля', goalkeepers: true, player_id: 'p2', full_name: 'Боря', attended: null },
    ];
    const out = groupRoster(rows);
    expect(out.map(s => s.id)).toEqual(['b', 'a']);
    expect(out[0].individual_bookings).toEqual([]);
    expect(out[1].individual_bookings.map(b => [b.player_id, b.attended, b.players?.full_name])).toEqual([['p1', true, 'Аня'], ['p2', null, 'Боря']]);
    expect(out[1].goalkeepers).toBe(true);
  });
});

describe('дополнительные тренировки в «Занятиях» тренера (0057)', () => {
  it('в одном списке с индивидуальными; отметка идёт в extra_set_attended', async () => {
    const t = today();
    fake.db.weekly_schedule = [{ group_id: 'gi', weekday: 7, starts_at: '19:00:00', location: null, kind: 'Вратари' }];
    fake.rpc.ind_roster_list = () => [];
    fake.rpc.extra_roster_list = () => [
      { session_id: 'e1', starts_on: t, place: 'Зал на Сабуртало', player_id: 'p1', full_name: 'Иванов Пётр', attended: null },
      { session_id: 'e1', starts_on: t, place: 'Зал на Сабуртало', player_id: 'p2', full_name: 'Сидоров Ян', attended: null },
    ];
    fake.rpc.extra_set_attended = () => null;
    render(<Sessions groups={[{ id: 'gi', name: 'Индивидуальные / Вратарские' }]} />);
    expect(await screen.findByText(/Дополнительная/)).toBeInTheDocument();
    expect(screen.getByText('Зал на Сабуртало')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Записано: 2'));
    fireEvent.click(within(await screen.findByRole('group', { name: 'Посещаемость: Сидоров Ян' })).getByRole('button', { name: 'Не был' }));
    fireEvent.click(screen.getByText('Сохранить отметки'));
    await waitFor(() => expect(fake.rpcCalls('extra_set_attended')).toEqual([{ s: 'e1', p: 'p2', was: false }]));
    expect(fake.rpcCalls('ind_set_attended')).toHaveLength(0);
  });
});

describe('groupExtraRoster', () => {
  it('группирует по тренировке; место становится темой; тренировка без записавшихся не теряется', () => {
    const out = groupExtraRoster([
      { session_id: 'b', starts_on: '2026-10-21', place: null, player_id: null, full_name: null, attended: null },
      { session_id: 'a', starts_on: '2026-10-20', place: 'Зал', player_id: 'p1', full_name: 'Аня', attended: true },
    ]);
    expect(out.map(s => [s.id, s.kind, s.topic, s.individual_bookings.length])).toEqual([['b', 'extra', null, 0], ['a', 'extra', 'Зал', 1]]);
    expect(out[1].starts_at).toBe('2026-10-20T00:00:00');
  });
});
