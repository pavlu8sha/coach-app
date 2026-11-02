import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import IndMarks, { type IndSession } from './IndMarks';

const session: IndSession = {
  id: 's1',
  starts_at: '2026-11-03T18:00:00',
  topic: null,
  goalkeepers: false,
  individual_bookings: [
    { player_id: 'p1', attended: null, players: { full_name: 'Иванов Пётр' } },
    { player_id: 'p2', attended: null, players: { full_name: 'Сидоров Ян' } },
  ],
};

describe('Отметки индивидуального занятия', () => {
  it('сохранить можно только когда отмечены все, как в групповых', async () => {
    fake.rpc.ind_set_attended = () => null;
    render(<IndMarks session={session} onBack={() => {}} />);
    const save = screen.getByText('Сохранить отметки');
    expect(save).toBeDisabled();
    fireEvent.click(screen.getAllByText('Был')[0]);
    expect(save).toBeDisabled();
    fireEvent.click(screen.getAllByText('Не был')[1]);
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(fake.rpcCalls('ind_set_attended')).toHaveLength(2));
    expect(await screen.findByText('Отметки сохранены.')).toBeInTheDocument();
  });
});
