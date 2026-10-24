import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import { today } from '../lib/coach';
import Sessions from './Sessions';

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

  it('у группы без групповых тренировок показывает индивидуальные и вратарские', async () => {
    seed();
    fake.db.weekly_schedule = [1, 2, 3, 4, 5, 6, 7].map(w => ({ group_id: 'g1', weekday: w, starts_at: '19:00:00', location: 'Красный парк', kind: 'Вратарская' }));
    render(<Sessions groups={groups} />);
    expect(await screen.findByText('Сегодня')).toBeInTheDocument();
    expect(screen.getAllByText(/Вратарская/).length).toBeGreaterThan(0);
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
