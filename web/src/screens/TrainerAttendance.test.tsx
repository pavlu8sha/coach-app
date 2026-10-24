import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import TrainerAttendance from './TrainerAttendance';

describe('посещаемость тренеров (просмотр)', () => {
  it('показывает, кто и когда проводил занятия, без часов и кнопок правки', async () => {
    fake.rpc.trainer_attendance = () => [
      { held_on: '2026-10-12', coach: 'Дима', group_label: 'U9', kind: 'Групповая', starts_at: '17:00:00', ends_at: '18:30:00', location: 'Школа 159', held: true },
      { held_on: '2026-10-12', coach: 'Руслан', group_label: 'U11', kind: 'Групповая', starts_at: '18:30:00', ends_at: null, location: null, held: false },
    ];
    render(<TrainerAttendance />);
    expect(await screen.findByText('Дима')).toBeInTheDocument();
    expect(screen.getByText('Проведена')).toBeInTheDocument();
    expect(screen.getByText('Не проведена')).toBeInTheDocument();
    expect(screen.queryByText(/ч\b|час/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /удал|добав|измен|сохран/i })).not.toBeInTheDocument();
    expect(fake.rpcCalls('trainer_attendance')).toHaveLength(1);
  });
  it('пустой журнал — подсказка', async () => {
    fake.rpc.trainer_attendance = () => [];
    render(<TrainerAttendance />);
    expect(await screen.findByText('Нет записей')).toBeInTheDocument();
  });
});
