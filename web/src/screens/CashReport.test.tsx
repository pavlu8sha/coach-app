import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { today } from '../lib/coach';
import { fake } from '../test/fakeSupabase';
import CashReport from './CashReport';

const report = {
  total: 245,
  by_method: [{ method: 'Наличные', sum: 30 }, { method: 'Перевод', sum: 165 }, { method: 'не указан', sum: 50 }],
  by_staff: [{ staff_id: 'a1', name: 'Гил', sum: -100 }, { staff_id: 'a2', name: 'Дима', sum: 245 }, { staff_id: null, name: 'не указан', sum: 100 }],
  rows: [{ id: 'r1', kind: 'Абонемент', player: 'Аня', amount: 165, paid_on: today(), method: 'Перевод', staff: 'Дима', recorded_at: null, location: 'Исани' }],
};

describe('Кассовый отчёт', () => {
  beforeEach(() => fake.reset());

  it('запрашивает отчёт за сегодня и показывает итоги по способам и сотрудникам', async () => {
    fake.rpc.cash_report = () => ({ data: report, error: null });
    render(<CashReport />);
    await waitFor(() => expect(fake.rpcCalls('cash_report')).toHaveLength(1));
    expect(fake.rpcCalls('cash_report')[0]).toMatchObject({ p_from: today(), p_to: today(), p_location: null, p_method: null });
    await screen.findByText('По сотрудникам');
    expect(screen.getByText('Дима')).toBeInTheDocument();
    // «не указан» есть и в итогах по сотрудникам, и в итогах по способам
    expect(screen.getAllByText('не указан').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Наличные').length).toBeGreaterThan(0);
  });

  it('позволяет выбрать конкретный день', async () => {
    fake.rpc.cash_report = () => ({ data: report, error: null });
    render(<CashReport />);
    await screen.findByText('По сотрудникам');
    fireEvent.click(screen.getByRole('tab', { name: 'День' }));
    fireEvent.change(screen.getByLabelText('Дата'), { target: { value: '2026-10-15' } });
    await waitFor(() => expect(fake.rpcCalls('cash_report').at(-1)).toMatchObject({ p_from: '2026-10-15', p_to: '2026-10-15' }));
  });

  it('передаёт фильтры локации и способа в функцию базы', async () => {
    fake.rpc.cash_report = () => ({ data: report, error: null });
    render(<CashReport />);
    await screen.findByText('По сотрудникам');
    fireEvent.change(screen.getByLabelText('Локация'), { target: { value: 'Исани' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Перевод' }));
    await waitFor(() => expect(fake.rpcCalls('cash_report').at(-1)).toMatchObject({ p_location: 'Исани', p_method: 'Перевод' }));
  });

  it('показывает ошибку, если отчёт не открылся', async () => {
    fake.rpc.cash_report = () => ({ data: null, error: { message: 'forbidden' } });
    render(<CashReport />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('По сотрудникам')).not.toBeInTheDocument();
  });
});
