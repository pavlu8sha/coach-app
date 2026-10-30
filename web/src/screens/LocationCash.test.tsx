import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import LocationCash from './LocationCash';

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

  it('кнопка «Выйти» есть на экране', () => {
    render(<LocationCash locations={['Исани']} />);
    expect(screen.getByRole('button', { name: 'Выйти' })).toBeInTheDocument();
  });
});
