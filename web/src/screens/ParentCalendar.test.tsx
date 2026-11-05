import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import ParentCalendar from './ParentCalendar';

describe('календарь родителя', () => {
  beforeEach(() => {
    fake.reset();
    fake.db.player_guardians = [{
      user_id: 'u',
      player_id: 'p1',
      consent_revoked_at: null,
      players: { id: 'p1', full_name: 'Аня', groups: { name: 'U9' } },
    }];
  });

  it('загружает календарь выбранного ребёнка и показывает событие на текущую дату', async () => {
    const today = new Date();
    const eventDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    fake.rpc.parent_calendar = () => [{
      event_id: 'match:m1',
      event_date: eventDate,
      event_time: null,
      event_type: 'match',
      title: 'Матч с Динамо',
      location: null,
      event_status: 'upcoming',
      attendance_status: null,
    }];

    render(<ParentCalendar />);
    expect(await screen.findByText('Календарь ребёнка')).toBeInTheDocument();
    expect(await screen.findByText('Матч с Динамо')).toBeInTheDocument();
    await waitFor(() => expect(fake.rpcCalls('parent_calendar')).toEqual([{
      p_player: 'p1',
      p_from: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`,
      p_to: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()}`,
    }]));
  });

  it('не подменяет ошибку загрузки пустым календарём', async () => {
    fake.rpc.parent_calendar = () => ({ data: null, error: { message: 'permission denied' } });
    render(<ParentCalendar />);
    expect(await screen.findByText('События не загрузились')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  });

  it('дни месяца — обычные кнопки в группе, без недопустимых ролей таблицы', async () => {
    fake.rpc.parent_calendar = () => [];
    const { container } = render(<ParentCalendar />);
    await screen.findByText('Календарь ребёнка');
    expect(container.querySelector('[role="grid"], [role="gridcell"], [role="columnheader"]')).toBeNull();
    const days = container.querySelectorAll('button[aria-pressed]');
    expect(days.length).toBeGreaterThanOrEqual(28);
    expect(screen.getByRole('group', { name: /^Дни / })).toBeInTheDocument();
  });
  it('подпись матча: товарищеский или матч чемпионата', async () => {
    const today = new Date();
    const eventDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const ev = (id: string) => ({ event_id: `match:${id}`, event_date: eventDate, event_time: null, event_type: 'match', title: 'Матч', location: null, event_status: 'past', attendance_status: null });
    fake.rpc.parent_calendar = () => [ev('f1'), ev('c1')];
    fake.rpc.match_tournaments = () => [
      { match_id: 'f1', tournament_id: null, tournament_name: null, tournament_kind: null, match_kind: 'friendly' },
      { match_id: 'c1', tournament_id: 't1', tournament_name: 'Tbilisi Challenge Cup', tournament_kind: 'championship', match_kind: null },
    ];
    render(<ParentCalendar />);
    expect(await screen.findByText('Товарищеский матч')).toBeInTheDocument();
    expect(await screen.findByText('Матч чемпионата')).toBeInTheDocument();
    expect(screen.queryByText('Футбольный матч')).toBeNull();
  });

  // листаем назад, пока кнопка доступна, и возвращаем заголовок месяца, на котором остановились
  async function earliestMonth() {
    fake.rpc.parent_calendar = () => [];
    render(<ParentCalendar />);
    await screen.findByText('Календарь ребёнка');
    await new Promise(r => setTimeout(r, 50)); // дать загрузиться первой отметке
    const prev = screen.getByRole('button', { name: 'Предыдущий месяц' });
    for (let i = 0; i < 24 && !(prev as HTMLButtonElement).disabled; i++) fireEvent.click(prev);
    return screen.getAllByRole('heading', { level: 2 })[0].textContent?.toLowerCase();
  }

  it('назад листается до месяца первой отметки ребёнка', async () => {
    fake.rpc.parent_first_attendance = () => '2026-08-20';
    expect(await earliestMonth()).toContain('август');
  });

  it('без отметок календарь начинается с сентября', async () => {
    fake.rpc.parent_first_attendance = () => null;
    expect(await earliestMonth()).toContain('сентябрь');
  });
});
