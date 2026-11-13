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
    expect(text).toBe('U9\n1 — Иванов Пётр\n2 — Сидоров Ян');
  });

  it('платёж: вид, сумма и дата уходят в camp_pay', async () => {
    seed();
    fake.rpc.camp_pay = () => 'new';
    render(<Camps />);
    fireEvent.click(await screen.findByText('Зимний лагерь'));
    fireEvent.click(await screen.findByText('Сидоров Ян'));
    fireEvent.click(await screen.findByRole('tab', { name: 'Оплата' }));
    fireEvent.change(screen.getAllByLabelText('Сумма, ₾')[0], { target: { value: '250,5' } });
    fireEvent.change(screen.getByLabelText(/^Способ/), { target: { value: 'Наличные' } });
    fireEvent.click(screen.getByRole('button', { name: 'Записать платёж' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Записать' }));
    await waitFor(() => expect(fake.rpcCalls('camp_pay')).toHaveLength(1));
    expect(fake.rpcCalls('camp_pay')[0]).toMatchObject({ pid: 'cp2', amt: 250.5, k: 'payment', mth: 'Наличные' });
  });

  it.each([
    ['not registered', 'Запись не активна: платёж не принимается.'],
    ['duplicate payment', 'Такой платёж только что внесён.'],
  ])('платёж: ошибка %s показывается понятным текстом (аудит C-05)', async (code, text) => {
    seed();
    fake.rpc.camp_pay = () => ({ error: { message: code } });
    render(<Camps />);
    fireEvent.click(await screen.findByText('Зимний лагерь'));
    fireEvent.click(await screen.findByText('Сидоров Ян'));
    fireEvent.click(await screen.findByRole('tab', { name: 'Оплата' }));
    fireEvent.change(screen.getAllByLabelText('Сумма, ₾')[0], { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/^Способ/), { target: { value: 'Наличные' } });
    fireEvent.click(screen.getByRole('button', { name: 'Записать платёж' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Записать' }));
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it('отмена платежа и повторная отмена с понятным сообщением', async () => {
    seed();
    fake.rpc.camp_cancel_payment = () => ({ error: { message: 'already cancelled' } });
    render(<Camps />);
    fireEvent.click(await screen.findByText('Зимний лагерь'));
    fireEvent.click(await screen.findByText('Иванов Пётр'));
    const pay = (await screen.findByText(/Бронь · 01.11.2026/)).closest('.ks-card') as HTMLElement;
    fireEvent.click(within(pay).getByRole('button', { name: 'Отменить платёж' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Отменить платёж' }));
    expect(await screen.findByText('Этот платёж уже отменён.')).toBeInTheDocument();
    expect(fake.rpcCalls('camp_cancel_payment')).toEqual([{ payid: 'pay1' }]);
  });

  it('сумма участника ниже оплаченного: понятное сообщение', async () => {
    seed();
    fake.rpc.camp_update_participant = () => ({ error: { message: 'amount below paid' } });
    render(<Camps />);
    fireEvent.click(await screen.findByText('Зимний лагерь'));
    fireEvent.click(await screen.findByText('Иванов Пётр'));
    fireEvent.change(await screen.findByDisplayValue('850'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('Сумма участника не может быть меньше уже оплаченного.')).toBeInTheDocument();
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
  it('отменённая родителем запись: пометка, итоги её не считают, кнопки статуса нет, правка суммы остаётся', async () => {
    seed();
    (fake.db.camp_participants as Array<Record<string, unknown>>)[1].status = 'cancelled';
    fake.rpc.camp_update_participant = () => null;
    render(<Camps />);
    fireEvent.click(await screen.findByText('Зимний лагерь'));
    expect(await screen.findByText('Записано: 1 · оплачено 100 ₾ из 850 ₾')).toBeInTheDocument();
    expect(screen.getByText('Отмена', { selector: 'span' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('Сидоров Ян'));
    expect(await screen.findByText(/отменил родитель/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Отметить отказ' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Вернуть в список' })).toBeNull();
  });
});

describe('«Сборы»: требует внимания (условия 66-67)', () => {
  function seedAttention(deadline: string | null) {
    seed();
    fake.db.camps[0].booking_deadline = deadline;
    fake.db.camp_participants.push(
      {
        id: 'cp4', camp_id: 'c1', player_id: 'p4', tariff_id: 't1', amount: 850, tshirt_size: null, comment: null, status: 'cancelled',
        players: { full_name: 'Отменил Олег', groups: { name: 'U10' } }, camp_tariffs: { name: 'Футболист' },
        camp_payments: [{ id: 'pay4', amount: 300, paid_on: '2026-11-01', kind: 'booking', method: 'Наличные', comment: null }],
      },
      {
        id: 'cp5', camp_id: 'c1', player_id: 'p5', tariff_id: 't1', amount: 850, tshirt_size: null, comment: null, status: 'cancelled',
        players: { full_name: 'Вернули Веня', groups: { name: 'U10' } }, camp_tariffs: { name: 'Футболист' },
        camp_payments: [{ id: 'pay5', amount: 300, paid_on: '2026-11-01', kind: 'booking', method: 'Наличные', comment: null }, { id: 'pay6', amount: -300, paid_on: '2026-11-02', kind: 'refund', method: null, comment: null }],
      },
    );
  }

  it('отмена с внесёнными деньгами попадает в «Возврат не оформлен», полностью возвращённая нет; база не вызывается', async () => {
    seedAttention(null);
    render(<Camps />);
    fireEvent.click(await screen.findByText('Зимний лагерь'));
    const box = await screen.findByRole('region', { name: 'Требует внимания' });
    expect(within(box).getByText('Возврат не оформлен')).toBeInTheDocument();
    expect(within(box).getByText('Отменил Олег')).toBeInTheDocument();
    expect(within(box).getByText('отменил родитель · внесено 300 ₾')).toBeInTheDocument();
    expect(within(box).queryByText('Вернули Веня')).toBeNull();
    expect(within(box).queryByText('Нет брони после срока')).toBeNull();
    expect(screen.getByText('Возврат 300 ₾', { selector: 'span' })).toBeInTheDocument();
    expect(fake.rpcCalls('camp_update_participant')).toHaveLength(0);
    expect(fake.rpcCalls('camp_refund')).toHaveLength(0);
  });

  it('после срока брони записанный без брони в «Нет брони после срока»; внёсший бронь нет; строка открывает карточку', async () => {
    seedAttention('2020-01-01');
    render(<Camps />);
    fireEvent.click(await screen.findByText('Зимний лагерь'));
    const box = await screen.findByRole('region', { name: 'Требует внимания' });
    expect(within(box).getByText('Нет брони после срока')).toBeInTheDocument();
    expect(within(box).getByText('внесено 0 ₾ из 100 ₾ · срок брони 01.01.2020')).toBeInTheDocument();
    expect(within(box).queryByText('Иванов Пётр')).toBeNull();
    fireEvent.click(within(box).getByText('Сидоров Ян'));
    expect(await screen.findByRole('tab', { name: 'Оплата' })).toBeInTheDocument();
  });

  it('срок брони не прошёл и отмен с деньгами нет: блока нет', async () => {
    seed();
    fake.db.camps[0].booking_deadline = '2099-01-01';
    render(<Camps />);
    fireEvent.click(await screen.findByText('Зимний лагерь'));
    await screen.findByText('Записано: 2 · оплачено 100 ₾ из 1700 ₾');
    expect(screen.queryByRole('region', { name: 'Требует внимания' })).toBeNull();
  });
});
