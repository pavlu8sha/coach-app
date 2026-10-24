import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import RecalcPoints from './RecalcPoints';

describe('пересчёт баллов за матчи', () => {
  it('пересчёт только после подтверждения; показывает число матчей', async () => {
    fake.rpc.recalc_match_points = () => 4;
    render(<RecalcPoints />);
    fireEvent.click(screen.getByRole('button', { name: 'Пересчитать баллы за матчи' }));
    expect(fake.rpcCalls('recalc_match_points')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Пересчитать' }));
    expect(await screen.findByText('Готово. Пересчитано матчей: 4.')).toBeInTheDocument();
  });
  it('без прав и без функции — понятные сообщения', async () => {
    fake.rpc.recalc_match_points = () => ({ error: { message: 'forbidden' } });
    const { unmount } = render(<RecalcPoints />);
    fireEvent.click(screen.getByRole('button', { name: 'Пересчитать баллы за матчи' }));
    fireEvent.click(screen.getByRole('button', { name: 'Пересчитать' }));
    expect(await screen.findByText(/Нет прав/)).toBeInTheDocument();
    unmount();
    fake.rpc.recalc_match_points = () => ({ error: { message: 'Could not find the function public.recalc_match_points' } });
    render(<RecalcPoints />);
    fireEvent.click(screen.getByRole('button', { name: 'Пересчитать баллы за матчи' }));
    fireEvent.click(screen.getByRole('button', { name: 'Пересчитать' }));
    expect(await screen.findByText(/миграция 0027/)).toBeInTheDocument();
  });
});
