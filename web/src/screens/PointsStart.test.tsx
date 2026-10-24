import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import PointsStart from './PointsStart';

describe('старт подсчёта баллов', () => {
  it('показывает текущую дату и задаёт новую только после подтверждения', async () => {
    let start: string | null = null;
    fake.rpc.points_start = () => start;
    fake.rpc.set_points_start = (a: { d: string | null }) => { start = a.d; return null; };
    render(<PointsStart />);
    expect(await screen.findByText(/ограничения нет/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Дата старта'), { target: { value: '2026-11-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Задать дату старта' }));
    expect(fake.rpcCalls('set_points_start')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Да, задать дату' }));
    expect(await screen.findByText('Баллы считаются с 01.11.2026.')).toBeInTheDocument();
    expect(fake.rpcCalls('set_points_start')[0]).toEqual({ d: '2026-11-01' });
    expect(await screen.findByText('Сейчас: с 01.11.2026')).toBeInTheDocument();
  });
  it('ограничение можно снять; без прав — понятное сообщение', async () => {
    fake.rpc.points_start = () => '2026-11-01';
    fake.rpc.set_points_start = () => ({ error: { message: 'forbidden' } });
    render(<PointsStart />);
    fireEvent.click(await screen.findByRole('button', { name: 'Снять ограничение' }));
    expect(await screen.findByText(/Нет прав/)).toBeInTheDocument();
  });
});
