import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import Camps from './Camps';

const base = { camp_id: 'c1', tariff_id: 't1', amount: 850, tshirt_size: null, comment: null, status: 'registered', camp_tariffs: { name: 'Футболист' } };

function seed() {
  fake.reset();
  fake.db.camps = [{ id: 'c1', name: 'Зимний лагерь', location: 'Бакуриани', starts_on: '2027-01-02', ends_on: '2027-01-09', booking_fee: 100, booking_deadline: null, full_payment_deadline: null, active: true }];
  fake.db.camp_tariffs = [{ id: 't1', camp_id: 'c1', name: 'Футболист', price: 850, active: true }];
  fake.db.camp_participants = [
    { ...base, id: 'cp1', player_id: 'p1', guest_name: null, guest_contact: null, players: { full_name: 'Иванов Пётр', groups: { name: 'U9-A' } }, camp_payments: [{ id: 'pay1', amount: 100, paid_on: '2026-11-01', kind: 'booking', method: 'Наличные', comment: null }] },
    { ...base, id: 'cpG', player_id: null, guest_name: 'Гость Иван', guest_contact: '+995 555 00 00 00', players: null, camp_payments: [{ id: 'payG', amount: 300, paid_on: '2026-11-02', kind: 'payment', method: 'Перевод', comment: null }] },
  ];
}

describe('Сборы: гости (#337)', () => {
  beforeEach(seed);

  it('гость виден в отдельной группе, его оплата входит в итоги сбора', async () => {
    render(<Camps />);
    fireEvent.click(await screen.findByText('Зимний лагерь'));
    expect(await screen.findByText('Записано: 2 · оплачено 400 ₾ из 1700 ₾')).toBeInTheDocument();
    expect(screen.getByText('Гости')).toBeInTheDocument();
    expect(screen.getByText('Гость Иван')).toBeInTheDocument();
  });

  it('в списке для отправки гости идут отдельной группой', async () => {
    render(<Camps />);
    fireEvent.click(await screen.findByText('Зимний лагерь'));
    fireEvent.click(await screen.findByRole('tab', { name: 'Список' }));
    expect((screen.getByLabelText('Список') as HTMLTextAreaElement).value).toBe('Гости\n1 — Гость Иван\n\nU9\n1 — Иванов Пётр');
  });

  it('запись гостя: имя и контакт уходят в camp_register_guest; без имени кнопка недоступна', async () => {
    fake.rpc.camp_register_guest = () => 'new';
    render(<Camps />);
    fireEvent.click(await screen.findByText('Зимний лагерь'));
    fireEvent.click(await screen.findByRole('button', { name: 'Записать игрока' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Гость' }));
    const save = screen.getByRole('button', { name: 'Записать' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Имя гостя'), { target: { value: 'Гость Пётр' } });
    fireEvent.change(screen.getByLabelText('Контакт (телефон или Telegram)'), { target: { value: '+995 599 11 22 33' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(fake.rpcCalls('camp_register_guest')).toEqual([{ cid: 'c1', nm: 'Гость Пётр', contact: '+995 599 11 22 33', tid: 't1', amt: null, tshirt: '', cmt: '' }]));
    expect(fake.rpcCalls('camp_register')).toHaveLength(0);
  });

  it('повторная запись гостя: понятное сообщение', async () => {
    fake.rpc.camp_register_guest = () => ({ error: { message: 'already registered' } });
    render(<Camps />);
    fireEvent.click(await screen.findByText('Зимний лагерь'));
    fireEvent.click(await screen.findByRole('button', { name: 'Записать игрока' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Гость' }));
    fireEvent.change(screen.getByLabelText('Имя гостя'), { target: { value: 'Гость Иван' } });
    fireEvent.click(screen.getByRole('button', { name: 'Записать' }));
    expect(await screen.findByText('Уже записан на этот сбор.')).toBeInTheDocument();
  });

  it('карточка гостя: имя, контакт, правка через camp_update_guest; у игрока клуба такого блока нет', async () => {
    fake.rpc.camp_update_guest = () => null;
    render(<Camps />);
    fireEvent.click(await screen.findByText('Зимний лагерь'));
    fireEvent.click(await screen.findByText('Гость Иван'));
    expect(await screen.findByText(/гость · \+995 555 00 00 00/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Имя гостя'), { target: { value: 'Иван Гость' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить имя и контакт' }));
    await waitFor(() => expect(fake.rpcCalls('camp_update_guest')).toEqual([{ pid: 'cpG', nm: 'Иван Гость', contact: '+995 555 00 00 00' }]));
  });

  it('у игрока клуба блока «Гость» нет', async () => {
    render(<Camps />);
    fireEvent.click(await screen.findByText('Зимний лагерь'));
    fireEvent.click(await screen.findByText('Иванов Пётр'));
    await screen.findByText('Платежи');
    expect(screen.queryByRole('button', { name: 'Сохранить имя и контакт' })).not.toBeInTheDocument();
  });
});
