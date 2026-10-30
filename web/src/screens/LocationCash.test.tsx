import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { closeApp } from '../lib/telegram';
import { fake } from '../test/fakeSupabase';
import LocationCash from './LocationCash';

vi.mock('../lib/telegram', () => ({ closeApp: vi.fn() }));

describe('Касса локального администратора', () => {
  beforeEach(() => {
    fake.reset();
    fake.rpc.cash_report = () => ({ data: { total: 0, by_method: [], by_staff: [], rows: [] }, error: null });
  });

  it('показывает только свои локации и вкладки кассы и отчёта', async () => {
    render(<LocationCash locations={['Исани', 'Отрачала']} />);
    expect(screen.getByText('Касса: Исани, Отрачала')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Приём оплат' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Отчёт' }));
    await waitFor(() => expect(fake.rpcCalls('cash_report')).toHaveLength(1));
    expect(await screen.findByRole('heading', { name: 'Кассовый отчёт' })).toBeInTheDocument();
  });

  it('«Выйти» закрывает сессию и сбрасывает приложение', async () => {
    render(<LocationCash locations={['Исани']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));
    await waitFor(() => expect(closeApp).toHaveBeenCalledTimes(1));
    expect(fake.calls.some(c => c.name === 'auth.signOut')).toBe(true);
  });
});
