import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import Camps from './Camps';

function seed() {
  fake.db.camps = [{ id: 'c1', name: 'Зимний лагерь', location: 'Бакуриани', starts_on: '2027-01-02', ends_on: '2027-01-09', booking_fee: 100, booking_deadline: null, full_payment_deadline: null, active: true }];
  fake.db.camp_tariffs = [{ id: 't1', camp_id: 'c1', name: 'Футболист', price: 850, active: true }, { id: 't2', camp_id: 'c1', name: 'Старый', price: 700, active: false }];
  fake.db.camp_participants = [
    {
      id: 'cp1', camp_id: 'c1', player_id: 'p1', tariff_id: 't1', amount: 850, tshirt_size: 'M', comment: null, status: 'registered',
      players: { full_name: 'Иванов Пётр', groups: { name: 'U9-A' } }, camp_tariffs: { name: 'Футболист' },
      camp_payments: [{ id: 'pay1', amount: 100, paid_on: '2026-11-01', kind: 'booking', method: 'Наличные', comment: null }],
    },
    {
      id: 'cp2', camp_id: 'c1', player_id: 'p2', tariff_id: 't1', amount: 850, tshirt_size: null, comment: null, status: 'registered',
      players: { full_name: 'Сидоров Ян', groups: { name: 'U9-B' } }, camp_tariffs: { name: 'Футболист' }, camp_payments: [],
    },
    {
      id: 'cp3', camp_id: 'c1', player_id: 'p3', tariff_id: 't1', amount: 850, tshirt_size: null, comment: 'отказ', status: 'declined',
      players: { full_name: 'Отказался', groups: { name: 'U11' } }, camp_tariffs: { name: 'Футболист' }, camp_payments: [],
    },
  ];
}

describe('«Сборы»', () => {
  it('сбор открывается; итоги не считают отказавшегося', async () => {
    seed();
    render(<Camps />);
    fireEvent.click(await screen.findByText('Зимний лагерь'));
    expect(await screen.findByText('Записано: 2 · оплачено 100 ₾ из 1700 ₾')).toBeInTheDocument();
    expect(screen.getByText('Отказ', { selector: 'span' })).toBeInTheDocument();
  });

  it('список для отправки объединяет U9-A и U9-B и не включает отказавшихся', async () => {
    seed();
    render(<Camps />);
    fireEvent.click(await screen.findByText('Зимний лагерь'));
    fireEvent.click(await screen.findByRole('tab', { name: 'Список' }));
    const text = (screen.getByLabelText('Список') as HTMLTextAreaElement).value;
    expect(text).toBe('U9\n1. Иванов Пётр\n2. Сидоров Ян');
  });

  it('платёж: вид, сумма и дата уходят в camp_pay', async () => {
    seed();
    fake.rpc.camp_pay = () => 'new';
    render(<Camps />);
    fireEvent.click(await screen.findByText('Зимний лагерь'));
    fireEvent.click(await screen.findByText('Сидоров Ян'));
    fireEvent.click(await screen.findByRole('tab', { name: 'Оплата' }));
    fireEvent.change(screen.getAllByLabelText('Сумма, ₾')[0], { target: { value: '250,5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Записать платёж' }));
    await waitFor(() => expect(fake.rpcCalls('camp_pay')).toHaveLength(1));
    expect(fake.rpcCalls('camp_pay')[0]).toMatchObject({ pid: 'cp2', amt: 250.5, k: 'payment', mth: 'Наличные' });
  });

  it('отмена платежа и повторная отмена с понятным сообщением', async () => {
    seed();
    fake.rpc.camp_cancel_payment = () => ({ error: { message: 'already cancelled' } });
    render(<Camps />);
    fireEvent.click(await screen.findByText('Зимний лагерь'));
    fireEvent.click(await screen.findByText('Иванов Пётр'));
    const pay = (await screen.findByText(/Бронь · 01.11.2026/)).closest('.ks-card') as HTMLElement;
    fireEvent.click(within(pay).getByRole('button', { name: 'Отменить платёж' }));
    expect(await screen.findByText('Этот платёж уже отменён.')).toBeInTheDocument();
    expect(fake.rpcCalls('camp_cancel_payment')).toEqual([{ payid: 'pay1' }]);
  });

  it('уже отменённый платёж помечен и повторно отменить его кнопкой нельзя', async () => {
    seed();
    fake.db.camp_participants[0].camp_payments.push({ id: 'pay1x', amount: -100, paid_on: '2026-11-02', kind: 'refund', method: 'Наличные', comment: 'Отмена платежа', legacy_ref: 'cancel:pay1' });
    render(<Camps />);
    fireEvent.click(await screen.findByText('Зимний лагерь'));
    fireEvent.click(await screen.findByText('Иванов Пётр'));
    const pay = (await screen.findByText(/Бронь · 01.11.2026/)).closest('.ks-card') as HTMLElement;
    expect(within(pay).getByText('Отменён')).toBeInTheDocument();
    expect(within(pay).queryByRole('button', { name: 'Отменить платёж' })).not.toBeInTheDocument();
  });

  it('запись игрока только на активный тариф', async () => {
    seed();
    fake.db.players = [{ id: 'p9', full_name: 'Новенький Нил' }];
    fake.rpc.camp_register = () => 'cp9';
    render(<Camps />);
    fireEvent.click(await screen.findByText('Зимний лагерь'));
    fireEvent.click(await screen.findByRole('button', { name: 'Записать игрока' }));
    fireEvent.change(screen.getByLabelText('Найти игрока'), { target: { value: 'Новен' } });
    fireEvent.click(await screen.findByText('Новенький Нил'));
    const options = within(screen.getByLabelText('Тариф')).getAllByRole('option').map(o => o.textContent);
    expect(options).toEqual(['Футболист — 850 ₾']);
    fireEvent.click(screen.getByRole('button', { name: 'Записать' }));
    await waitFor(() => expect(fake.rpcCalls('camp_register')).toHaveLength(1));
    expect(fake.rpcCalls('camp_register')[0]).toMatchObject({ cid: 'c1', p: 'p9', tid: 't1', amt: null });
  });
});
