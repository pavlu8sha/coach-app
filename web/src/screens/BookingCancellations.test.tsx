import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import BookingCancellations from './BookingCancellations';

const row = (o: Record<string, unknown>) => ({
  id: 'c1', kind: 'individual', session_id: 's1', starts_at: '2099-01-10T19:00:00', label: 'Тема', amount: 50, status: 'awaiting',
  cancelled_at: '2099-01-01T10:00:00Z', decided_at: null, note: null, players: { full_name: 'Иванов Пётр' }, ...o,
});


describe('«Отмены»: решения по оплате', () => {
  it('ждущие решения и история показаны раздельно', async () => {
    fake.db.booking_cancellations = [row({}), row({ id: 'c2', status: 'cancelled', amount: 0, players: { full_name: 'Сидоров Ян' } }), row({ id: 'c3', status: 'refunded', players: { full_name: 'Петров Лев' } })];
    render(<BookingCancellations />);
    expect(await screen.findByText('Ждут решения по оплате')).toBeInTheDocument();
    expect(screen.getByText('Иванов Пётр')).toBeInTheDocument();
    expect(screen.getByText('История отмен')).toBeInTheDocument();
    expect(screen.getByText('Отменена')).toBeInTheDocument();
    expect(screen.getByText(/Возврат · 50 ₾/)).toBeInTheDocument();
  });

  it('оставить клубу: подтверждение и вызов функции', async () => {
    fake.db.booking_cancellations = [row({})];
    fake.rpc.booking_transfer_targets = () => [];
    fake.rpc.booking_cancel_keep = () => null;
    render(<BookingCancellations />);
    fireEvent.click(await screen.findByText('Иванов Пётр'));
    fireEvent.click(await screen.findByRole('button', { name: 'Оставить клубу' }));
    const btns = await screen.findAllByRole('button', { name: 'Оставить клубу' });
    fireEvent.click(btns[btns.length - 1]);
    await waitFor(() => expect(fake.rpcCalls('booking_cancel_keep')).toEqual([{ c: 'c1' }]));
  });

  it('возврат требует способ; перенос — выбора занятия, при несовпадении суммы показывается понятная ошибка', async () => {
    fake.db.booking_cancellations = [row({})];
    fake.rpc.booking_transfer_targets = () => [{ kind: 'individual', session_id: 's2', starts_at: '2099-01-12T19:00:00', label: null, amount: 50 }];
    fake.rpc.booking_cancel_refund = () => null;
    fake.rpc.booking_cancel_transfer = () => ({ error: { message: 'amount mismatch' } });
    render(<BookingCancellations />);
    fireEvent.click(await screen.findByText('Иванов Пётр'));
    const refund = await screen.findByRole('button', { name: 'Вернуть' });
    expect(refund).toBeDisabled();
    const move = screen.getByRole('button', { name: 'Перенести' });
    expect(move).toBeDisabled();
    await waitFor(() => expect(screen.getByRole('option', { name: /12\.01\.2099/ })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Перенести на занятие'), { target: { value: 's2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Перенести' }));
    const btns = await screen.findAllByRole('button', { name: 'Перенести' });
    fireEvent.click(btns[btns.length - 1]);
    expect(await screen.findByText(/Сумма на выбранном занятии другая/)).toBeInTheDocument();
    expect(fake.rpcCalls('booking_cancel_transfer')).toEqual([{ c: 'c1', tk: 'individual', ts: 's2' }]);
  });
});
