import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import Individual from './Individual';

describe('Индивидуальные: вкладка шаблонов', () => {
  it('открывает управление шаблонами', async () => {
    fake.db.individual_templates = [{ id: 't1', club_id: 'c1', isodow: 6, start_time: '19:00:00', end_time: '20:00:00', goalkeepers: false, active: true }];
    fake.db.clubs = [{ id: 'c1' }];
    fake.db.individual_sessions = [];
    fake.db.individual_bookings = [];
    render(<Individual />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Шаблоны' }));
    expect(await screen.findByRole('button', { name: 'Новый шаблон' })).toBeInTheDocument();
    expect(screen.getByText('Суббота 19:00–20:00 · Индивидуальные')).toBeInTheDocument();
  });
});
