import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fake } from '../test/fakeSupabase';
import { addPayment, paymentKey } from '../lib/paymentAdd';
import MonthPayments from './MonthPayments';
import AdminPayments from './AdminPayments';

// Условия приёмки docs/acceptance/payment-idempotency-724-2026-11-20.md, п. 11-14 (клиент).
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date(2026, 9, 15, 12, 0, 0));
afterEach(() => vi.setSystemTime(new Date(2026, 9, 15, 12, 0, 0)));

const seed = () => {
  fake.db.groups = [{ id: 'g1', name: 'U9' }];
  fake.db.prices = [{ group_id: null, kind: 'subscription', amount: 165, valid_from: '2026-09-01', valid_to: null }];
  fake.db.players = [{ id: 'p1', full_name: 'Иванов Пётр', group_id: 'g1', status: 'active' }];
  fake.db.payments = [];
  fake.db.subscriptions = [];
};
const pay = async (amount: string) => {
  fireEvent.click(await screen.findByRole('button', { name: 'Внести платёж' }));
  fireEvent.change(screen.getByLabelText(/Сумма/), { target: { value: amount } });
  fireEvent.change(screen.getByLabelText(/^Способ/), { target: { value: 'Наличные' } });
  fireEvent.click(screen.getByRole('button', { name: 'Записать платёж' }));
};
const ok = { data: { id: 'x1', duplicate: false } };
const input = { player_id: 'p1', amount: 165, paid_on: '2026-10-15', method: 'Перевод', for_month: '2026-10-01' };

describe('payment_add: ключ операции', () => {
  it('повтор с теми же данными после ошибки уходит с тем же ключом, после успеха ключ новый', async () => {
    let n = 0;
    fake.rpc.payment_add = () => (++n === 1 ? { error: { message: 'Failed to fetch' } } : ok);
    const a = await addPayment(input);
    const b = await addPayment(input); // повтор после потери ответа
    await addPayment(input); // второй легальный платёж после успеха
    const keys = fake.paymentKeys();
    expect(a.error).not.toBeNull();
    expect(b.error).toBeNull();
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[1]);
  });

  it('другие данные получают другой ключ', async () => {
    fake.rpc.payment_add = () => ({ error: { message: 'Failed to fetch' } });
    await addPayment(input);
    await addPayment({ ...input, amount: 170 });
    const k = fake.paymentKeys();
    expect(k[0]).not.toBe(k[1]);
  });

  it('ключ живёт не дольше 30 минут и не пишется в браузерное хранилище', () => {
    const set = vi.spyOn(Storage.prototype, 'setItem');
    const k1 = paymentKey(input);
    expect(paymentKey(input)).toBe(k1);
    expect(set).not.toHaveBeenCalled();
    vi.setSystemTime(new Date(2026, 9, 15, 12, 31, 0));
    expect(paymentKey(input)).not.toBe(k1);
  });

  it('ответ сервера передаёт признак duplicate; ключ сбрасывается и при duplicate', async () => {
    fake.rpc.payment_add = () => ({ data: { id: 'x1', duplicate: true } });
    const r = await addPayment(input);
    expect(r).toEqual({ error: null, duplicate: true });
    expect(paymentKey(input)).not.toBe(fake.paymentKeys()[0]);
  });

  it('вызов функции: сумма округляется до копеек, поля как у прямого INSERT', async () => {
    fake.rpc.payment_add = () => ok;
    await addPayment({ ...input, amount: 10.456 });
    expect(fake.rpcCalls('payment_add')[0]).toMatchObject({ pid: 'p1', amt: 10.46, d: '2026-10-15', mth: 'Перевод', fm: '2026-10-01' });
    expect(fake.writes('payments')).toHaveLength(0);
  });
});

describe('«Оплаты за месяц»: повтор платежа', () => {
  it('ошибка сети, затем повтор: тот же ключ; после успеха следующий платёж с новым ключом', async () => {
    seed();
    let n = 0;
    fake.rpc.payment_add = () => (++n === 1 ? { error: { message: 'Failed to fetch' } } : ok);
    render(<MonthPayments />);
    await pay('65');
    expect(await screen.findByText(/Нет связи/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Записать платёж' }));
    await waitFor(() => expect(fake.rpcCalls('payment_add')).toHaveLength(2));
    const [k1, k2] = fake.paymentKeys();
    expect(k1).toBe(k2);
    expect(fake.writes('payments')).toHaveLength(0);
  });

  it('сервер ответил duplicate: понятное сообщение, не ошибка', async () => {
    seed();
    fake.rpc.payment_add = () => ({ data: { id: 'x1', duplicate: true } });
    render(<MonthPayments />);
    await pay('65');
    expect(await screen.findByText('Этот платёж уже был записан ранее, второй не создан.')).toBeInTheDocument();
    expect(document.querySelector('.error')).toBeNull();
  });

  it('ключ, использованный с другими данными: понятный текст без кода', async () => {
    seed();
    fake.rpc.payment_add = () => ({ error: { message: 'request id reused' } });
    render(<MonthPayments />);
    await pay('65');
    expect(await screen.findByText(/уже записан с другими параметрами/)).toBeInTheDocument();
    expect(screen.queryByText(/request id/)).not.toBeInTheDocument();
  });
});

describe('«Платежи игрока»: повтор после потери ответа', () => {
  it('подтверждение, ошибка, повтор: оба вызова с одним ключом', async () => {
    fake.db.players = [{ id: 'p1', full_name: 'Иванов Пётр', groups: { name: 'U9' } }];
    fake.db.payments = [];
    let n = 0;
    fake.rpc.payment_add = () => (++n === 1 ? { error: { message: 'Failed to fetch' } } : ok);
    render(<AdminPayments />);
    fireEvent.change(screen.getByLabelText('Найти игрока'), { target: { value: 'иван' } });
    fireEvent.click(await screen.findByText('Иванов Пётр'));
    await screen.findByText('Внести платёж', { selector: 'h3' });
    fireEvent.change(screen.getByLabelText(/Сумма/), { target: { value: '165' } });
    fireEvent.change(screen.getByLabelText(/^Способ/), { target: { value: 'Наличные' } });
    for (let i = 0; i < 2; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'Внести платёж' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Записать платёж' }));
      await waitFor(() => expect(fake.rpcCalls('payment_add')).toHaveLength(i + 1));
    }
    const [k1, k2] = fake.paymentKeys();
    expect(k1).toBe(k2);
    expect(await screen.findByText('Платёж записан.')).toBeInTheDocument();
  });
});
