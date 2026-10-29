import { render, screen, waitFor } from '@testing-library/react';
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
});
