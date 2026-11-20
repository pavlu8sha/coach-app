import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { today } from '../lib/coach';
import { DEBT_START } from '../lib/debtSeason';
import { fake, supabase } from '../test/fakeSupabase';
import CashDesk, { PlayerDues } from './CashDesk';
import { monthIso, nextMonth } from './MonthPayments';

// Дата зафиксирована в середине месяца: в первый день месяца платёж «за месяц» совпадал с сегодняшним, и тесты падали (1 ноября).
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date(2026, 9, 15, 12, 0, 0));
const M = monthIso(new Date());

/** Первый запрос к таблице отвечает только после release(): так проверяются ответы, пришедшие в обратном порядке. */
function gateFirst(table: string) {
  const real = supabase.from;
  let first = true;
  let release: () => void = () => {};
  const gate = new Promise<void>(r => { release = r; });
  const spy = vi.spyOn(supabase, 'from').mockImplementation(((t: string) => {
    const q = real(t);
    if (t !== table || !first) return q;
    first = false;
    const proxy: any = new Proxy(q, {
      get(target, prop) {
        if (prop === 'then') return (res: any, rej: any) => gate.then(() => target.then(res, rej));
        const v = target[prop];
        return typeof v === 'function' ? (...a: unknown[]) => { const r = v.apply(target, a); return r === target ? proxy : r; } : v;
      },
    });
    return proxy;
  }) as any);
  return { release, restore: () => spy.mockRestore() };
}
function seed() {
  fake.db.players = [{ id: 'p1', full_name: 'Иванов Пётр', group_id: 'g1', groups: { name: 'U9-A' } }];
  fake.db.prices = [{ group_id: null, kind: 'subscription', amount: 165, valid_from: '2026-09-01', valid_to: null }];
  fake.db.payments = [{ id: 'x1', player_id: 'p1', amount: 50, paid_on: M, method: 'Наличные', players: { full_name: 'Иванов Пётр' } }];
  fake.db.subscriptions = [];
  fake.db.equipment_orders = [{ id: 'o1', player_id: 'p1', ordered_on: '2026-09-10', total: 160, paid: 60, equipment_order_lines: [{ kit: 'Форма' }, { kit: 'Куртка' }] }];
  fake.db.individual_bookings = [
    { session_id: 'i1', player_id: 'p1', amount: 50, paid: false, individual_sessions: { starts_at: '2020-01-10T12:00:00', goalkeepers: true } },
    { session_id: 'i2', player_id: 'p1', amount: 50, paid: false, individual_sessions: { starts_at: '2099-01-10T12:00:00', goalkeepers: false } }, // будущее — не долг
  ];
  fake.db.extra_bookings = [{ session_id: 'e1', player_id: 'p1', paid: false, extra_sessions: { starts_on: '2020-02-01', amount: 20 } }];
  fake.db.camp_participants = [{ id: 'cp1', player_id: 'p1', amount: 850, status: 'registered', camps: { name: 'Зимний лагерь' }, camp_payments: [{ amount: 100 }] }];
}
async function openPlayer() {
  render(<CashDesk />);
  fireEvent.change(screen.getByLabelText(/^Игрок/), { target: { value: 'Иванов' } });
  fireEvent.click(await screen.findByRole('button', { name: /Иванов Пётр/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Наличные' }));
}
// отмена оплаты: «⋯» у строки → пункт «Отменить оплату» (окно подтверждения открывается после него)
const rowMenu = (i = 0) => screen.getAllByRole('button', { name: 'Действия: Иванов Пётр' })[i];
function cancelViaMenu(i = 0) {
  fireEvent.click(rowMenu(i));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Отменить оплату' }));
}
const card = (t: string | RegExp) => screen.getByText(t).closest('.ks-card') as HTMLElement;

describe('«Приём оплат»', () => {
  it('показывает всё, что к оплате, по разделам; будущие занятия не считаются долгом', async () => {
    seed();
    await openPlayer();
    expect(await screen.findByText(/к оплате: 1 035 ₾/)).toBeInTheDocument(); // 115 + 100 + 50 + 20 + 750
    for (const h of ['Абонемент', 'Экипировка', 'Индивидуальные и вратари', 'Дополнительные тренировки', 'Сборы']) expect(screen.getByRole('heading', { name: h })).toBeInTheDocument();
    expect(await screen.findByText(/Внесено 50 ₾ из 165 ₾/)).toBeInTheDocument();
    expect(screen.getByText(/Внесено 60 ₾ из 160 ₾/)).toBeInTheDocument();
    expect(screen.getByText(/Вратари 10.01.2020/)).toBeInTheDocument();
    expect(screen.queryByText(/10.01.2099/)).not.toBeInTheDocument();
  });

  it('абонемент начинается с DEBT_START; августа нет', async () => {
    seed();
    fake.db.subscriptions = [{ player_id: 'p1', month: DEBT_START, group_id: null, discount: false, written_off: false }];
    fake.db.payments = [];
    await openPlayer();
    expect(await screen.findByText(/Сентябрь 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Ноябрь 2026.*\(вперёд\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Август 2026/)).toBeNull();
  });

  it('абонемент: частичный платёж идёт в журнал со способом и датой', async () => {
    seed();
    await openPlayer();
    await screen.findByText(/Внесено 50 ₾ из 165 ₾/);
    const sub = card(/Внесено 50 ₾ из 165 ₾/);
    fireEvent.click(within(sub).getByRole('button', { name: 'Принять оплату' }));
    expect(within(sub).getByLabelText(/Сумма/)).toHaveValue('115');
    fireEvent.change(within(sub).getByLabelText(/Сумма/), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: 'Перевод' }));
    fireEvent.click(within(sub).getByRole('button', { name: 'Записать платёж' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Записать' }));
    await waitFor(() => expect(fake.paymentAdds()).toHaveLength(1));
    expect(fake.paymentAdds()[0]).toMatchObject({ player_id: 'p1', amount: 60, method: 'Перевод', paid_on: today() });
  });

  it('абонемент: «Оплатить со скидкой» записывает меньшую сумму и сразу ставит скидку месяца', async () => {
    seed();
    await openPlayer();
    await screen.findByText(/Внесено 50 ₾ из 165 ₾/);
    const sub = card(/Внесено 50 ₾ из 165 ₾/);
    fireEvent.click(within(sub).getByRole('button', { name: 'Принять оплату' }));
    fireEvent.change(within(sub).getByLabelText(/Сумма/), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: 'Перевод' }));
    fireEvent.click(within(sub).getByRole('button', { name: 'Оплатить со скидкой' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Оплатить' }));
    await waitFor(() => expect(fake.writes('subscriptions', 'upsert')).toHaveLength(1));
    expect(fake.paymentAdds()[0]).toMatchObject({ player_id: 'p1', amount: 60, method: 'Перевод', for_month: M });
    expect(fake.writes('subscriptions', 'upsert')[0]).toMatchObject({ player_id: 'p1', month: M, discount: true });
  });

  it('абонемент: сервер ответил duplicate — сообщение «уже был записан», а не «Платёж записан» (#724)', async () => {
    seed();
    fake.rpc.payment_add = () => ({ data: { id: 'x1', duplicate: true } });
    await openPlayer();
    await screen.findByText(/Внесено 50 ₾ из 165 ₾/);
    const sub = card(/Внесено 50 ₾ из 165 ₾/);
    fireEvent.click(within(sub).getByRole('button', { name: 'Принять оплату' }));
    fireEvent.click(screen.getByRole('button', { name: 'Перевод' }));
    fireEvent.click(within(sub).getByRole('button', { name: 'Записать платёж' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Записать' }));
    expect(await screen.findByText('Этот платёж уже был записан ранее, второй не создан.')).toBeInTheDocument();
    expect(screen.queryByText('Платёж записан.')).not.toBeInTheDocument();
  });

  it('абонемент: ключ, использованный с другими данными, показывается понятным текстом (#724)', async () => {
    seed();
    fake.rpc.payment_add = () => ({ error: { message: 'request id reused' } });
    await openPlayer();
    await screen.findByText(/Внесено 50 ₾ из 165 ₾/);
    const sub = card(/Внесено 50 ₾ из 165 ₾/);
    fireEvent.click(within(sub).getByRole('button', { name: 'Принять оплату' }));
    fireEvent.click(screen.getByRole('button', { name: 'Перевод' }));
    fireEvent.click(within(sub).getByRole('button', { name: 'Записать платёж' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Записать' }));
    expect(await screen.findByText(/уже записан с другими параметрами/)).toBeInTheDocument();
    expect(screen.queryByText(/request id/)).not.toBeInTheDocument();
  });

  it('абонемент: «Оплатить со скидкой» при duplicate применяет скидку и сообщает, что платёж не создавался заново (#724)', async () => {
    seed();
    fake.rpc.payment_add = () => ({ data: { id: 'x1', duplicate: true } });
    await openPlayer();
    await screen.findByText(/Внесено 50 ₾ из 165 ₾/);
    const sub = card(/Внесено 50 ₾ из 165 ₾/);
    fireEvent.click(within(sub).getByRole('button', { name: 'Принять оплату' }));
    fireEvent.change(within(sub).getByLabelText(/Сумма/), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: 'Перевод' }));
    fireEvent.click(within(sub).getByRole('button', { name: 'Оплатить со скидкой' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Оплатить' }));
    await waitFor(() => expect(fake.writes('subscriptions', 'upsert')).toHaveLength(1));
    expect(await screen.findByText('Этот платёж уже был записан ранее, второй не создан.')).toBeInTheDocument();
  });

  it('разовое посещение другой группы показано отдельным разделом и платится через session_guest_set_paid', async () => {
    seed();
    fake.db.session_guests = [{ session_id: 's9', player_id: 'p1', paid: false, amount: 15, sessions: { starts_at: '2020-02-03T15:00:00+04:00', groups: { name: 'U9-B' } } }];
    fake.rpc.session_guest_set_paid = () => null;
    await openPlayer();
    await screen.findByText(/к оплате:/);
    const title = /Доп. посещение 03.02.2020 · U9-B/;
    await screen.findByText(title);
    const c = card(title);
    await waitFor(() => expect(within(c).getByRole('button', { name: 'Принять оплату' })).toBeEnabled());
    fireEvent.click(within(c).getByRole('button', { name: 'Принять оплату' }));
    fireEvent.click(within(c).getByRole('button', { name: 'Записать платёж' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Записать' }));
    await waitFor(() => expect(fake.rpcCalls('session_guest_set_paid')[0]).toMatchObject({ s: 's9', p: 'p1', is_paid: true, mth: 'Наличные', amt: 15 }));
  });

  it('оплата за визит показана отдельным разделом и платится через own_visit_set_paid', async () => {
    seed();
    fake.db.own_visits = [{ session_id: 's9', player_id: 'p1', paid: false, amount: 20, sessions: { starts_at: '2020-02-03T15:00:00+04:00', groups: { name: 'U9-B' } } }];
    fake.rpc.own_visit_set_paid = () => null;
    await openPlayer();
    await screen.findByText(/к оплате:/);
    const title = /Оплата за визит 03.02.2020 · U9-B/;
    await screen.findByText(title);
    const c = card(title);
    await waitFor(() => expect(within(c).getByRole('button', { name: 'Принять оплату' })).toBeEnabled());
    fireEvent.click(within(c).getByRole('button', { name: 'Принять оплату' }));
    fireEvent.click(within(c).getByRole('button', { name: 'Записать платёж' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Записать' }));
    await waitFor(() => expect(fake.rpcCalls('own_visit_set_paid')[0]).toMatchObject({ s: 's9', p: 'p1', is_paid: true, mth: 'Наличные', amt: 20 }));
  });

  it('#471 Ф9: отменённый заказ экипировки к оплате не предлагается', async () => {
    seed();
    (fake.db.equipment_orders as Record<string, unknown>[]).push({ id: 'o9', player_id: 'p1', ordered_on: '2026-09-12', total: 300, paid: 0, status: 'cancelled', equipment_order_lines: [{ kit: 'Дождевик' }] });
    await openPlayer();
    expect(await screen.findByText('Форма + Куртка')).toBeInTheDocument();
    expect(screen.queryByText('Дождевик')).not.toBeInTheDocument();
  });

  it('экипировка: платёж уходит с ключом запроса; повтор после ошибки с теми же данными шлёт тот же ключ (#471, 0188)', async () => {
    seed();
    let n = 0;
    fake.rpc.eq_add_payment = () => (++n === 1 ? { error: { message: 'network' } } : 160);
    await openPlayer();
    await screen.findByText(/к оплате:/);
    const c = card('Форма + Куртка');
    const send = async () => {
      await waitFor(() => expect(within(c).getByRole('button', { name: /Принять оплату|Записать платёж/ })).toBeEnabled());
      const open = within(c).queryByRole('button', { name: 'Принять оплату' });
      if (open) fireEvent.click(open);
      fireEvent.click(within(c).getByRole('button', { name: 'Записать платёж' }));
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Записать' }));
    };
    await send();
    await waitFor(() => expect(fake.rpcCalls('eq_add_payment')).toHaveLength(1));
    await send();
    await waitFor(() => expect(fake.rpcCalls('eq_add_payment')).toHaveLength(2));
    const [a, b] = fake.rpcCalls('eq_add_payment') as { req: string }[];
    expect(typeof a.req).toBe('string');
    expect(a.req).toBe(b.req);
  });

  it('экипировка, индивидуальные, доп. тренировки и сборы платятся через свои функции', async () => {
    seed();
    fake.rpc.eq_add_payment = () => 160;
    fake.rpc.ind_set_paid = () => null;
    fake.rpc.extra_set_paid = () => null;
    fake.rpc.camp_pay = () => 'id';
    await openPlayer();
    await screen.findByText(/к оплате:/);
    const pay = async (title: string | RegExp, btn: string) => {
      await screen.findByText(title);
      const c = card(title);
      // после предыдущей оплаты карточки заблокированы на время обновления списка
      await waitFor(() => expect(within(c).getByRole('button', { name: 'Принять оплату' })).toBeEnabled());
      fireEvent.click(within(c).getByRole('button', { name: 'Принять оплату' }));
      fireEvent.click(within(c).getByRole('button', { name: btn }));
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Записать' }));
    };
    await pay('Форма + Куртка', 'Записать платёж');
    await waitFor(() => expect(fake.rpcCalls('eq_add_payment')[0]).toMatchObject({ o: 'o1', amt: 100, mth: 'Наличные' }));
    await pay(/Вратари 10.01.2020/, 'Отметить оплаченным (50 ₾)');
    await waitFor(() => expect(fake.rpcCalls('ind_set_paid')[0]).toMatchObject({ s: 'i1', p: 'p1', is_paid: true, mth: 'Наличные' }));
    await pay(/Доп. тренировка 01.02.2020/, 'Записать платёж');
    await waitFor(() => expect(fake.rpcCalls('extra_set_paid')[0]).toMatchObject({ s: 'e1', p: 'p1', is_paid: true, amt: 20 }));
    await pay('Зимний лагерь', 'Записать платёж');
    await waitFor(() => expect(fake.rpcCalls('camp_pay')[0]).toMatchObject({ pid: 'cp1', amt: 750, k: 'payment' }));
  });

  it('списанный месяц и месяц со скидкой и оплатой в долги не попадают; ошибка базы показывается', async () => {
    seed();
    fake.db.subscriptions = [{ player_id: 'p1', month: M, group_id: null, discount: true, written_off: false }];
    fake.db.equipment_orders = [];
    fake.db.individual_bookings = [];
    fake.db.extra_bookings = [];
    fake.db.camp_participants = [];
    await openPlayer();
    expect(await screen.findByText(/Долгов нет/)).toBeInTheDocument(); // скидка и что-то внесено — месяц закрыт
  });

  it('оплата вперёд: следующий месяц виден, в сумму долга не входит, платёж с реальной датой и месяцем-назначением', async () => {
    seed();
    fake.db.equipment_orders = [];
    fake.db.individual_bookings = [];
    fake.db.extra_bookings = [];
    fake.db.camp_participants = [];
    fake.db.payments = [{ id: 'x1', player_id: 'p1', amount: 165, paid_on: M, method: 'Наличные', players: { full_name: 'Иванов Пётр' } }];
    await openPlayer();
    expect(await screen.findByText(/Долгов нет/)).toBeInTheDocument();
    const next = nextMonth(M);
    const c = card(/\(вперёд\)/);
    fireEvent.click(within(c).getByRole('button', { name: 'Принять оплату' }));
    fireEvent.click(screen.getByRole('button', { name: 'Перевод' }));
    fireEvent.click(within(c).getByRole('button', { name: 'Записать платёж' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Записать' }));
    await waitFor(() => expect(fake.paymentAdds()).toHaveLength(1));
    expect(fake.paymentAdds()[0]).toMatchObject({ player_id: 'p1', amount: 165, paid_on: today(), for_month: next, method: 'Перевод' });
  });

  it('«Внесено» за выбранную дату: платежи абонемента и сборов, итог по дню', async () => {
    seed();
    fake.db.payments = [
      { id: 'a1', player_id: 'p1', amount: 100, paid_on: '2026-10-05', method: 'Наличные', players: { full_name: 'Иванов Пётр' } },
      { id: 'a2', player_id: 'p2', amount: -20, paid_on: '2026-10-05', method: 'Исправление', players: { full_name: 'Сидоров Ян' } },
      { id: 'a3', player_id: 'p3', amount: 999, paid_on: '2026-10-06', method: 'Наличные', players: { full_name: 'Другой День' } },
    ];
    fake.db.camp_payments = [{ id: 'c1', player_id: 'p1', amount: 250, paid_on: '2026-10-05', method: 'Перевод', kind: 'payment', players: { full_name: 'Иванов Пётр' } }];
    render(<CashDesk />);
    fireEvent.change(screen.getByLabelText('Дата платежей'), { target: { value: '2026-10-05' } });
    expect(await screen.findByRole('heading', { name: /Внесено 05.10.2026.*330 ₾/ })).toBeInTheDocument();
    expect(screen.getByText('Абонемент 10.26, U9-A, Оплата, Наличные')).toBeInTheDocument();
    expect(screen.getByText('Сбор, U9-A, Оплата, Перевод')).toBeInTheDocument();
    expect(screen.queryByText('Другой День')).not.toBeInTheDocument();
  });

  it('без выбранного способа вверху экрана платёж не записывается', async () => {
    seed();
    render(<CashDesk />);
    fireEvent.change(screen.getByLabelText(/^Игрок/), { target: { value: 'Иванов' } });
    fireEvent.click(await screen.findByRole('button', { name: /^Иванов Пётр/ }));
    await screen.findByText(/Внесено 50 ₾ из 165 ₾/);
    const sub = card(/Внесено 50 ₾ из 165 ₾/);
    fireEvent.click(within(sub).getByRole('button', { name: 'Принять оплату' }));
    fireEvent.click(within(sub).getByRole('button', { name: 'Записать платёж' }));
    expect(await screen.findByText(/Выберите способ оплаты вверху экрана/)).toBeInTheDocument();
    expect(fake.paymentAdds()).toHaveLength(0);
  });

  it('будущая дата платежа отклоняется без записи; «Внесено сегодня» показывает итог', async () => {
    seed();
    fake.db.payments = [{ id: 'x1', player_id: 'p1', amount: 50, paid_on: today(), method: 'Наличные', players: { full_name: 'Иванов Пётр' } }];
    render(<CashDesk />);
    expect(await screen.findByRole('heading', { name: /Внесено сегодня.*50 ₾/ })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Игрок/), { target: { value: 'Иванов' } });
    fireEvent.click(await screen.findByRole('button', { name: /^Иванов Пётр/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Наличные' }));
    await screen.findByText(/Внесено 50 ₾ из 165 ₾/);
    const sub = card(/Внесено 50 ₾ из 165 ₾/);
    fireEvent.click(within(sub).getByRole('button', { name: 'Принять оплату' }));
    fireEvent.change(within(sub).getByLabelText('Дата'), { target: { value: '2999-01-05' } });
    fireEvent.click(within(sub).getByRole('button', { name: 'Записать платёж' }));
    expect(await screen.findByText(/Дата платежа не может быть в будущем/)).toBeInTheDocument();
    expect(fake.paymentAdds()).toHaveLength(0);
  });

  it('экипировка: дата платежа выбирается, уходит в eq_add_payment, будущая дата отклоняется', async () => {
    seed();
    fake.rpc.eq_add_payment = () => 160;
    await openPlayer();
    await screen.findByText('Форма + Куртка');
    const c = card('Форма + Куртка');
    fireEvent.click(within(c).getByRole('button', { name: 'Принять оплату' }));
    fireEvent.change(within(c).getByLabelText('Дата'), { target: { value: '2999-01-05' } });
    fireEvent.click(within(c).getByRole('button', { name: 'Записать платёж' }));
    expect(await screen.findByText(/Дата платежа не может быть в будущем/)).toBeInTheDocument();
    expect(fake.rpcCalls('eq_add_payment')).toHaveLength(0);
    fireEvent.change(within(c).getByLabelText('Дата'), { target: { value: '2026-10-13' } });
    fireEvent.click(within(c).getByRole('button', { name: 'Записать платёж' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Записать' }));
    await waitFor(() => expect(fake.rpcCalls('eq_add_payment')[0]).toMatchObject({ o: 'o1', d: '2026-10-13' }));
  });
});

describe('«Приём оплат»: платежи дня', () => {
  it('строка платежа: месяц абонемента, группа по абонементу, вид оплаты и способ', async () => {
    seed();
    fake.db.payments = [{ id: 'm1', player_id: 'p1', amount: 20, paid_on: today(), pay_month: '2026-10-01', method: 'Перевод', players: { full_name: 'Иванов Пётр' } }];
    fake.db.subscriptions = [{ id: 's1', player_id: 'p1', month: '2026-10-01', group_id: 'g0', groups: { name: 'U7-A' } }];
    render(<CashDesk />);
    expect(await screen.findByText('Абонемент 10.26, U7-A, Оплата, Перевод')).toBeInTheDocument();
  });

  it('оплаты экипировки и занятий дня попадают в «Внесено», без кнопки отмены', async () => {
    seed();
    fake.db.payments = [];
    fake.rpc.cash_day_service = () => [{ id: 's1', amount: 40, method: 'Перевод', what: 'Экипировка', player_id: 'p1', full_name: 'Иванов Пётр' }];
    render(<CashDesk />);
    await screen.findByRole('heading', { name: /Внесено сегодня.*40 ₾/ });
    expect(screen.getByText('Экипировка: Форма + Куртка, Перевод')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Действия: Иванов Пётр' })).not.toBeInTheDocument();
  });

  it('взнос матча попадает в «Внесено» с датой и соперником', async () => {
    seed();
    fake.db.payments = [];
    fake.rpc.cash_day_service = () => [{ id: 'm1', amount: 25, method: 'Наличные', what: 'Взнос матча', player_id: 'p1', full_name: 'Иванов Пётр', detail: '07.11 FC Morkinali' }];
    render(<CashDesk />);
    await screen.findByRole('heading', { name: /Внесено сегодня.*25 ₾/ });
    expect(screen.getByText(/Взнос матча.*07\.11 FC Morkinali/)).toBeInTheDocument();
  });

  it('оплаты занятий показывают время записи (Тбилиси) и идут вперемешку с остальными, новые сверху', async () => {
    seed();
    fake.db.payments = [];
    fake.rpc.cash_day_service = () => [
      { id: 's1', amount: 40, method: 'Перевод', what: 'Экипировка', player_id: 'p1', full_name: 'Иванов Пётр', recorded_at: `${today()}T02:46:00Z` },
      { id: 's2', amount: 50, method: 'Наличные', what: 'Индивидуальное', player_id: 'p1', full_name: 'Иванов Пётр', recorded_at: `${today()}T06:05:00Z` },
    ];
    render(<CashDesk />);
    await screen.findByRole('heading', { name: /Внесено сегодня.*90 ₾/ });
    const a = screen.getByText(/10:05 · Индивидуальное/);
    const b = screen.getByText(/06:46 · Экипировка/);
    expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('оплата, внесённая в другой день, показывает дату записи рядом со временем', async () => {
    seed();
    fake.db.payments = [];
    fake.rpc.cash_day_service = () => [
      { id: 's3', amount: 40, method: 'Перевод', what: 'Экипировка', player_id: 'p1', full_name: 'Иванов Пётр', recorded_at: '2099-01-02T06:46:00Z' },
    ];
    render(<CashDesk />);
    await screen.findByRole('heading', { name: /Внесено сегодня.*40 ₾/ });
    expect(screen.getByText(/внесено 02\.01\.2099 10:46 · Экипировка/)).toBeInTheDocument();
  });

  it('индивидуальную можно оплатить задним числом: дата уходит в ind_set_paid', async () => {
    seed();
    fake.rpc.ind_set_paid = () => null;
    await openPlayer();
    await screen.findByText(/к оплате:/);
    const c = card(/Вратари 10.01.2020/);
    fireEvent.click(within(c).getByRole('button', { name: 'Принять оплату' }));
    fireEvent.change(within(c).getByLabelText('Дата'), { target: { value: '2020-01-05' } });
    fireEvent.click(within(c).getByRole('button', { name: 'Отметить оплаченным (50 ₾)' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Записать' }));
    await waitFor(() => expect(fake.rpcCalls('ind_set_paid')[0]).toMatchObject({ d: '2020-01-05' }));
  });

  it('показывает наличные/перевод и отменяет оплату записью с минусом', async () => {
    seed();
    fake.db.payments = [{ id: 'x1', player_id: 'p1', amount: 50, paid_on: today(), method: 'Наличные', players: { full_name: 'Иванов Пётр' } }];
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<CashDesk />);
    await screen.findByRole('heading', { name: /Внесено сегодня.*50 ₾/ });
    expect(screen.getByText('Наличные').nextSibling?.textContent).toBe('50 ₾');
    cancelViaMenu();
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Отменить оплату' }));
    await waitFor(() => expect(fake.writes('payments', 'insert')).toEqual([expect.objectContaining({ player_id: 'p1', amount: -50, paid_on: today(), method: 'Наличные' })]));
  });
  it('если отмена не записалась, показывается ошибка', async () => {
    seed();
    fake.db.payments = [{ id: 'x1', player_id: 'p1', amount: 50, paid_on: today(), method: 'Наличные', players: { full_name: 'Иванов Пётр' } }];
    render(<CashDesk />);
    await screen.findByRole('heading', { name: /Внесено сегодня.*50 ₾/ });
    fake.errors.payments = 'boom';
    cancelViaMenu();
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Отменить оплату' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Отмена не записана/);
  });
  it('после записи платежа список долгов остаётся на экране, пока обновляется', async () => {
    seed();
    await openPlayer();
    await screen.findByText(/Внесено 50 ₾ из 165 ₾/);
    const sub = card(/Внесено 50 ₾ из 165 ₾/);
    fireEvent.click(within(sub).getByRole('button', { name: 'Принять оплату' }));
    fireEvent.click(within(sub).getByRole('button', { name: 'Записать платёж' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Записать' }));
    await screen.findByText('Платёж записан.');
    // сразу после записи разделы не заменяются на «Загрузка», иначе страница сжимается и прыгает к началу
    expect(screen.getByRole('heading', { name: 'Сборы' })).toBeInTheDocument();
  });
  it('карточка долга: сумма в плашке подписана для читалки, класс для компактной раскладки', async () => {
    seed();
    await openPlayer();
    await screen.findByText(/Внесено 50 ₾ из 165 ₾/);
    const sub = card(/Внесено 50 ₾ из 165 ₾/);
    expect(sub).toHaveClass('ks-due');
    expect(within(sub).getByRole('img', { name: 'Осталось оплатить 115 ₾' })).toBeInTheDocument();
  });
  it('в карточке игрока дата и способ лежат в блоке pay-fields: на 320 px он ставится в один столбец', async () => {
    seed();
    render(<PlayerDues embedded player={{ id: 'p1', full_name: 'Иванов Пётр', group_id: 'g1', groups: { name: 'U9-A' }, status: 'active' }} />);
    await screen.findByText(/Внесено 50 ₾ из 165 ₾/);
    const sub = card(/Внесено 50 ₾ из 165 ₾/);
    fireEvent.click(within(sub).getByRole('button', { name: 'Принять оплату' }));
    expect(within(sub).getByLabelText('Дата').closest('.two')).toHaveClass('pay-fields');
    expect(within(sub).getByLabelText('Способ')).toBeInTheDocument();
  });
  it('игрок на паузе: месяцы после начала паузы без платежей долгом не считаются', async () => {
    seed();
    fake.db.payments = [];
    fake.db.subscriptions = [{ player_id: 'p1', month: monthIso(new Date()), group_id: 'g1', discount: false, written_off: false }];
    fake.db.player_status_log = [{ player_id: 'p1', status: 'paused', on_date: '2026-09-30', created_at: '2026-11-02T17:00:00Z' }];
    render(<PlayerDues embedded player={{ id: 'p1', full_name: 'Иванов Пётр', group_id: 'g1', groups: { name: 'U9-A' }, status: 'paused' }} />);
    await screen.findByText(/Форма/);
    expect(screen.queryByText(/Октябрь 2026/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Ноябрь 2026/)).not.toBeInTheDocument();
  });
  it('«Внесено сегодня»: новые платежи сверху по времени записи, без времени в конце', async () => {
    seed();
    const pl = { full_name: 'Иванов Пётр' };
    fake.db.payments = [
      { id: 'a', player_id: 'p1', amount: 11, paid_on: today(), method: 'Наличные', recorded_at: null, players: pl },
      { id: 'b', player_id: 'p1', amount: 22, paid_on: today(), method: 'Наличные', recorded_at: '2026-10-15T08:00:00Z', players: pl },
      { id: 'c', player_id: 'p1', amount: 33, paid_on: today(), method: 'Наличные', recorded_at: '2026-10-15T09:00:00Z', players: pl },
    ];
    render(<CashDesk />);
    await screen.findByRole('heading', { name: /Внесено сегодня/ });
    await waitFor(() => expect(screen.getAllByText(/^(11|22|33) ₾$/).map(e => e.textContent)).toEqual(['33 ₾', '22 ₾', '11 ₾']));
  });
  it('отмена платежа вперёд записывается в тот же месяц; отменённый платёж не отменить дважды', async () => {
    seed();
    fake.db.payments = [{ id: 'a1', player_id: 'p1', amount: 165, paid_on: today(), for_month: '2099-11-01', method: 'Перевод', players: { full_name: 'Иванов Пётр' } }];
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<CashDesk />);
    await screen.findByRole('heading', { name: /Внесено сегодня.*165 ₾/ });
    cancelViaMenu();
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Отменить оплату' }));
    await waitFor(() => expect(fake.writes('payments', 'insert')).toEqual([expect.objectContaining({ amount: -165, for_month: '2099-11-01', method: 'Перевод' })]));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Действия: Иванов Пётр' })).toBeNull());
  });
  it('два одинаковых платежа за день: отмена уходит со ссылкой на выбранный платёж и гасит только его', async () => {
    seed();
    const pl = { full_name: 'Иванов Пётр' };
    fake.db.payments = [
      { id: 'a1', player_id: 'p1', amount: 50, paid_on: today(), method: 'Наличные', recorded_at: '2026-10-15T08:00:00Z', players: pl },
      { id: 'a2', player_id: 'p1', amount: 50, paid_on: today(), method: 'Перевод', recorded_at: '2026-10-15T09:00:00Z', players: pl },
    ];
    render(<CashDesk />);
    await screen.findByRole('heading', { name: /Внесено сегодня.*100 ₾/ });
    // новые сверху: первая кнопка относится к a2 (перевод)
    cancelViaMenu(0);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Отменить оплату' }));
    await waitFor(() => expect(fake.writes('payments', 'insert')).toEqual([expect.objectContaining({ amount: -50, cancels: 'a2', method: 'Перевод' })]));
    // a2 отменён, a1 остаётся доступным для отмены
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Действия: Иванов Пётр' })).toHaveLength(1));
  });
  it('платёж, отменённый записью в другой день, повторно не отменяется', async () => {
    seed();
    const pl = { full_name: 'Иванов Пётр' };
    fake.db.payments = [
      { id: 'a1', player_id: 'p1', amount: 50, paid_on: today(), method: 'Наличные', players: pl },
      { id: 'c1', player_id: 'p1', amount: -50, paid_on: '2020-01-01', method: 'Наличные', cancels: 'a1', players: pl },
    ];
    render(<CashDesk />);
    await screen.findByRole('heading', { name: /Внесено сегодня.*50 ₾/ });
    expect(screen.queryByRole('button', { name: 'Действия: Иванов Пётр' })).toBeNull();
  });
  it('если платёж уже отменён (повторный или параллельный запрос), показывается понятное сообщение', async () => {
    seed();
    fake.db.payments = [{ id: 'a1', player_id: 'p1', amount: 50, paid_on: today(), method: 'Наличные', players: { full_name: 'Иванов Пётр' } }];
    render(<CashDesk />);
    await screen.findByRole('heading', { name: /Внесено сегодня.*50 ₾/ });
    fake.errors.payments = 'duplicate key value violates unique constraint "payments_cancels_key"';
    cancelViaMenu();
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Отменить оплату' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Этот платёж уже отменён.');
  });
  it('у ушедшего игрока текущий и будущий месяцы не считаются долгом', async () => {
    seed();
    fake.db.players = [{ id: 'p1', full_name: 'Иванов Пётр', group_id: 'g1', status: 'inactive', groups: { name: 'U9-A' } }];
    fake.db.payments = [];
    fake.db.equipment_orders = [];
    fake.db.individual_bookings = [];
    fake.db.extra_bookings = [];
    fake.db.camp_participants = [];
    await openPlayer();
    expect(await screen.findByText(/Долгов нет/)).toBeInTheDocument();
    expect(screen.queryByText(/\(вперёд\)/)).toBeNull();
  });
});

describe('Поиск игрока в кассе (0154)', () => {
  it('ищет через cash_find_players, а не прямым запросом в players', async () => {
    fake.reset();
    seed();
    fake.rpc.cash_find_players = () => [{ id: 'p1', full_name: 'Иванов Пётр', group_id: 'g1', external_id: 'KS-1', birth_date: null, status: 'active', group_name: 'Isani' }];
    render(<CashDesk />);
    fireEvent.change(screen.getByLabelText(/^Игрок/), { target: { value: 'Иванов' } });
    await screen.findByRole('button', { name: /Иванов Пётр/ });
    expect(fake.rpcCalls('cash_find_players')[0]).toEqual({ q: 'Иванов' });
  });

  it('если база отказала, список остаётся пустым', async () => {
    fake.reset();
    seed();
    fake.rpc.cash_find_players = () => ({ error: { message: 'forbidden' } });
    render(<CashDesk />);
    fireEvent.change(screen.getByLabelText(/^Игрок/), { target: { value: 'Иванов' } });
    await waitFor(() => expect(fake.rpcCalls('cash_find_players')).toHaveLength(1));
    expect(screen.queryByRole('button', { name: /Иванов Пётр/ })).not.toBeInTheDocument();
  });
});

// Условия: notes/acceptance-card-match-event-dues-2026-11-09.md
describe('«К оплате»: взносы матчей и событий', () => {
  function seedFees() {
    seed();
    fake.db.payments = [];
    fake.db.equipment_orders = [];
    fake.db.individual_bookings = [];
    fake.db.extra_bookings = [];
    fake.db.camp_participants = [];
    fake.db.subscriptions = [{ player_id: 'p1', month: M, group_id: null, discount: true, written_off: false }]; // абонемент закрыт, остаются только взносы
    fake.db.match_fees = [
      { match_id: 'm1', player_id: 'p1', amount: 25, paid: false, matches: { played_on: '2026-10-10', team: 'U9-A', opponent: 'Динамо', kind: 'game' } },
      { match_id: 'm2', player_id: 'p1', amount: 20, paid: false, matches: { played_on: '2026-10-03', team: 'U9-A', opponent: 'Локо', kind: 'friendly' } }, // частично
      { match_id: 'm3', player_id: 'p1', amount: 20, paid: true, matches: { played_on: '2026-09-20', team: 'U9-A', opponent: 'Торпедо', kind: 'friendly' } }, // оплачен при импорте, платежей нет
      { match_id: 'm4', player_id: 'p1', amount: 15, paid: true, matches: { played_on: '2026-09-10', team: 'U9-A', opponent: 'Рубин', kind: 'friendly' } }, // оплачен платежом
      { match_id: 'm5', player_id: 'p1', amount: 0, paid: false, matches: { played_on: '2026-09-01', team: 'U9-A', opponent: 'Нулевой', kind: 'friendly' } }, // сумма 0
      { match_id: 'm6', player_id: 'p2', amount: 25, paid: false, matches: { played_on: '2026-10-11', team: 'U9-A', opponent: 'Чужой', kind: 'game' } }, // другой игрок
    ];
    fake.db.match_payments = [
      { match_id: 'm2', player_id: 'p1', amount: 5 },
      { match_id: 'm4', player_id: 'p1', amount: 15 },
      { match_id: 'm6', player_id: 'p2', amount: 1 },
    ];
    fake.db.tournament_fees = [
      { tournament_id: 't1', player_id: 'p1', amount: 80, paid: false, tournaments: { name: 'Championship 2', kind: 'championship', team: 'U9' } },
      { tournament_id: 't2', player_id: 'p1', amount: 50, paid: false, tournaments: { name: null, kind: 'festival', team: 'U9' } },
      { tournament_id: 't3', player_id: 'p1', amount: 60, paid: false, tournaments: { name: 'Оплаченный', kind: 'cup', team: 'U9' } },
    ];
    fake.db.tournament_payments = [
      { tournament_id: 't1', player_id: 'p1', amount: 30 },
      { tournament_id: 't3', player_id: 'p1', amount: 70 }, // больше взноса, не долг
    ];
  }
  const payVia = async (c: HTMLElement) => {
    fireEvent.click(within(c).getByRole('button', { name: 'Принять оплату' }));
    fireEvent.click(within(c).getByRole('button', { name: 'Записать платёж' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Записать' }));
  };

  it('показывает неоплаченные и частичные взносы матчей и событий; оплаченные, нулевые и чужие скрыты', async () => {
    seedFees();
    await openPlayer();
    expect(await screen.findByRole('heading', { name: 'Взносы матчей' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Взносы событий' })).toBeInTheDocument();
    expect(screen.getByText(/10.10.2026/)).toBeInTheDocument();
    expect(screen.getByText(/К оплате 25 ₾/)).toBeInTheDocument();
    expect(screen.getByText(/Внесено 5 ₾ из 20 ₾/)).toBeInTheDocument();
    expect(screen.getByText(/Внесено 30 ₾ из 80 ₾/)).toBeInTheDocument();
    expect(screen.getByText(/Festival|Фестиваль/)).toBeInTheDocument();
    for (const gone of ['Торпедо', 'Рубин', 'Нулевой', 'Чужой', 'Оплаченный']) expect(screen.queryByText(new RegExp(gone))).not.toBeInTheDocument();
    expect(screen.getByText(/к оплате: 140 ₾/)).toBeInTheDocument(); // 25 + 15 + 50 + 50
  });

  it('оплата матча идёт через match_pay с одним игроком, суммой, датой и способом', async () => {
    seedFees();
    fake.rpc.match_pay = () => 1;
    await openPlayer();
    await payVia(card(/К оплате 25 ₾/));
    await waitFor(() => expect(fake.rpcCalls('match_pay')).toHaveLength(1));
    expect(fake.rpcCalls('match_pay')[0]).toMatchObject({ m: 'm1', ids: ['p1'], amt: 25, d: today(), mth: 'Наличные', cmt: null });
  });

  it('частичная оплата события идёт через event_pay', async () => {
    seedFees();
    fake.rpc.event_pay = () => 1;
    await openPlayer();
    const c = card(/Внесено 30 ₾ из 80 ₾/);
    fireEvent.click(within(c).getByRole('button', { name: 'Принять оплату' }));
    fireEvent.change(within(c).getByLabelText(/Сумма/), { target: { value: '20' } });
    fireEvent.click(within(c).getByRole('button', { name: 'Записать платёж' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Записать' }));
    await waitFor(() => expect(fake.rpcCalls('event_pay')).toHaveLength(1));
    expect(fake.rpcCalls('event_pay')[0]).toMatchObject({ t: 't1', ids: ['p1'], amt: 20, mth: 'Наличные', cmt: null });
  });

  it('ошибка match_pay показывается в строке, платёж не засчитан', async () => {
    seedFees();
    fake.rpc.match_pay = () => ({ data: null, error: { message: 'bad amount' } });
    await openPlayer();
    const c = card(/К оплате 25 ₾/);
    await payVia(c);
    expect(await within(c).findByText('Сумма указана неверно.')).toBeInTheDocument();
  });

  it('«Перейти к оплате»: есть кнопки Сборы, Матчи и События, они прокручивают к своим разделам', async () => {
    seedFees();
    fake.db.camp_participants = [{ id: 'cp1', player_id: 'p1', amount: 300, status: 'registered', camps: { name: 'Зимний лагерь' }, camp_payments: [{ amount: 100 }] }];
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this.getAttribute('data-sec') ?? ''); };
    await openPlayer();
    await screen.findByRole('heading', { name: 'Сборы' });
    for (const [label, sec] of [['Сборы', 'Сборы'], ['Матчи', 'Взносы матчей'], ['События', 'Взносы событий']]) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(scrolled.pop()).toBe(sec);
    }
  });

  it('«Перейти к оплате»: кнопка есть только у раздела, который есть у игрока (сбор без записи не показывается)', async () => {
    seedFees();
    fake.db.camp_participants = []; // не записан ни на один сбор
    await openPlayer();
    await screen.findByRole('heading', { name: 'Взносы матчей' });
    expect(screen.getByRole('button', { name: 'Матчи' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'События' })).toBeInTheDocument();
    fake.db.prices = []; // абонемента нет вовсе, кнопка «Абонемент» остаётся всегда
    fireEvent.click(screen.getByRole('button', { name: 'Сменить' }));
    fireEvent.change(screen.getByLabelText(/^Игрок/), { target: { value: 'Иванов' } });
    fireEvent.click(await screen.findByRole('button', { name: /Иванов Пётр/ }));
    await screen.findByRole('heading', { name: 'Взносы матчей' });
    expect(screen.queryByRole('heading', { name: 'Абонемент' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Абонемент' })).toBeInTheDocument();
    for (const gone of ['Сборы', 'Экипировка', 'Индивидуальные', 'Дополнительные']) expect(screen.queryByRole('button', { name: gone })).not.toBeInTheDocument();
  });

  it('сбой чтения взносов не ломает остальные разделы, но показывает, что данные неполные (#692)', async () => {
    seedFees();
    fake.db.equipment_orders = [{ id: 'o1', player_id: 'p1', ordered_on: '2026-09-10', total: 160, paid: 60, equipment_order_lines: [{ kit: 'Форма' }] }];
    fake.errors.match_fees = 'boom';
    await openPlayer();
    expect(await screen.findByRole('heading', { name: 'Экипировка' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Взносы матчей' })).not.toBeInTheDocument();
    expect(within(await screen.findByRole('alert')).getByText(/Не удалось загрузить: взносы матчей\./)).toBeInTheDocument();
  });
});

// Условия: docs/acceptance/cashdesk-match-event-dues-errors-692-2026-11-20.md
describe('«К оплате»: сбой чтения взносов матчей и событий (#692)', () => {
  function seedDues() {
    seed();
    fake.db.payments = [];
    fake.db.equipment_orders = [{ id: 'o1', player_id: 'p1', ordered_on: '2026-09-10', total: 160, paid: 60, equipment_order_lines: [{ kit: 'Форма' }] }];
    fake.db.individual_bookings = [];
    fake.db.extra_bookings = [];
    fake.db.camp_participants = [];
    fake.db.subscriptions = [{ player_id: 'p1', month: M, group_id: null, discount: true, written_off: false }];
    fake.db.match_fees = [{ match_id: 'm1', player_id: 'p1', amount: 25, paid: false, matches: { played_on: '2026-10-10', team: 'U9-A', opponent: 'Динамо', kind: 'game' } }];
    fake.db.match_payments = [];
    fake.db.tournament_fees = [{ tournament_id: 't1', player_id: 'p1', amount: 80, paid: false, tournaments: { name: 'Championship 2', kind: 'championship', team: 'U9' } }];
    fake.db.tournament_payments = [];
  }
  const alertText = async () => (await screen.findByRole('alert')).textContent ?? '';

  it('успех: предупреждения нет, оба раздела на месте', async () => {
    seedDues();
    await openPlayer();
    expect(await screen.findByRole('heading', { name: 'Взносы матчей' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Взносы событий' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/неполно/)).not.toBeInTheDocument();
  });

  it.each(['match_fees', 'match_payments'])('отказ %s: названы взносы матчей; события и экипировка доступны', async table => {
    seedDues();
    fake.errors[table] = 'boom';
    await openPlayer();
    const text = await alertText();
    expect(text).toMatch(/Не удалось загрузить: взносы матчей\./);
    expect(text).not.toMatch(/взносы событий/);
    expect(text).not.toMatch(/boom/);
    expect(screen.queryByRole('heading', { name: 'Взносы матчей' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Взносы событий' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Экипировка' })).toBeInTheDocument();
    expect(screen.getByText(/к оплате: .*\(неполно\)/)).toBeInTheDocument();
  });

  it.each(['tournament_fees', 'tournament_payments'])('отказ %s: названы взносы событий; матчи доступны', async table => {
    seedDues();
    fake.errors[table] = 'boom';
    await openPlayer();
    const text = await alertText();
    expect(text).toMatch(/Не удалось загрузить: взносы событий\./);
    expect(text).not.toMatch(/взносы матчей/);
    expect(text).not.toMatch(/boom/);
    expect(screen.queryByRole('heading', { name: 'Взносы событий' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Взносы матчей' })).toBeInTheDocument();
  });

  it('отказ матчей и событий: названы оба раздела, остальное доступно', async () => {
    seedDues();
    fake.errors.match_fees = 'boom';
    fake.errors.tournament_payments = 'boom';
    await openPlayer();
    expect(await alertText()).toMatch(/Не удалось загрузить: взносы матчей, взносы событий\./);
    expect(screen.getByRole('heading', { name: 'Экипировка' })).toBeInTheDocument();
  });

  it('недоступные данные не выдаются за «долгов нет»', async () => {
    seedDues();
    fake.db.equipment_orders = [];
    fake.errors.match_fees = 'boom';
    await openPlayer();
    await alertText();
    expect(screen.queryByText('Долгов нет')).not.toBeInTheDocument();
    expect(screen.queryByText(/всё оплачено/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Ниже можно принять оплату вперёд/)).not.toBeInTheDocument();
  });

  it('при предупреждении остальные разделы принимают оплату как раньше', async () => {
    seedDues();
    fake.rpc.eq_add_payment = () => null;
    fake.errors.match_fees = 'boom';
    await openPlayer();
    await alertText();
    const c = card(/Внесено 60 ₾ из 160 ₾/);
    fireEvent.click(within(c).getByRole('button', { name: 'Принять оплату' }));
    fireEvent.click(within(c).getByRole('button', { name: 'Записать платёж' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Записать' }));
    await waitFor(() => expect(fake.rpcCalls('eq_add_payment')).toHaveLength(1));
    expect(fake.rpcCalls('eq_add_payment')[0]).toMatchObject({ o: 'o1', amt: 100 });
  });

  it('«Повторить»: перечитывает карточку без записей, выбранный игрок и способ остаются, предупреждение снимается', async () => {
    seedDues();
    fake.errors.match_fees = 'boom';
    fake.errors.tournament_fees = 'boom';
    await openPlayer();
    await alertText();
    delete fake.errors.match_fees;
    delete fake.errors.tournament_fees;
    const writesBefore = fake.calls.filter(c => c.kind !== 'rpc').length;
    const rpcBefore = fake.calls.filter(c => c.kind === 'rpc' && c.name !== 'cash_find_players').length;
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('heading', { name: 'Взносы матчей' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Взносы событий' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Иванов Пётр')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Наличные' })).toHaveAttribute('aria-pressed', 'true');
    expect(fake.calls.filter(c => c.kind !== 'rpc')).toHaveLength(writesBefore); // записей не добавилось
    expect(fake.calls.filter(c => c.kind === 'rpc' && c.name !== 'cash_find_players')).toHaveLength(rpcBefore); // платёжных функций не вызывалось
    expect(fake.rpcCalls('match_pay')).toHaveLength(0);
    expect(fake.rpcCalls('event_pay')).toHaveLength(0);
  });

  it('повторный отказ оставляет предупреждение; потом успех снимает его', async () => {
    seedDues();
    fake.errors.match_payments = 'boom';
    await openPlayer();
    await alertText();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Повторить' })).not.toBeDisabled());
    expect(await alertText()).toMatch(/взносы матчей/);
    expect(screen.queryByRole('heading', { name: 'Взносы матчей' })).not.toBeInTheDocument();
    delete fake.errors.match_payments;
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('heading', { name: 'Взносы матчей' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('устаревший ответ не затирает данные: игрока сменили до ответа предыдущей загрузки', async () => {
    seedDues();
    const pl = (id: string, name: string) => ({ id, full_name: name, group_id: 'g1', groups: { name: 'U9-A' } });
    const gated = gateFirst('prices'); // чтение долгов первого игрока отвечает позже, чем второго
    const { rerender } = render(<PlayerDues player={pl('p1', 'Иванов Пётр')} />);
    rerender(<PlayerDues player={pl('p2', 'Иванов Олег')} />);
    expect(await screen.findByText(/к оплате:/)).toBeInTheDocument(); // загрузка p2 завершена
    gated.release();
    await new Promise(r => setTimeout(r, 30));
    expect(screen.queryByText(/Динамо/)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Взносы матчей' })).not.toBeInTheDocument();
    gated.restore();
  });
});

// Условия приёмки: docs/PAY_PER_VISIT_ACCEPTANCE.md, п. 14 (игрок «за визит»: абонемент не предлагается)
describe('«Приём оплат»: игрок «Платит за визит»', () => {
  it('месяцы с месяца начала не предлагаются; визиты остаются; игрок с абонементом как раньше', async () => {
    seed();
    fake.db.payments = [];
    fake.db.subscriptions = [{ player_id: 'p1', month: DEBT_START, group_id: null, discount: false, written_off: false }];
    fake.db.players = [{ id: 'p1', full_name: 'Иванов Пётр', group_id: 'g1', groups: { name: 'U9-A' }, pay_mode: 'per_visit', pay_mode_from: '2026-10-05' }];
    fake.db.own_visits = [{ session_id: 's7', player_id: 'p1', paid: false, amount: 20, sessions: { starts_at: '2026-10-14T12:00:00+04:00', groups: { name: 'U9-A' } } }];
    await openPlayer();
    expect(await screen.findByText(/Оплата за визит 14.10.2026/)).toBeInTheDocument();
    expect(screen.queryByText(/Октябрь 2026/)).toBeNull();
    expect(screen.queryByText(/\(вперёд\)/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Закрыть без оплаты|Оплатить со скидкой/ })).toBeNull();
    expect(screen.getByText(/Сентябрь 2026/)).toBeInTheDocument(); // месяц до начала: как раньше
  });
});

describe('«Приём оплат»: быстрые даты и отмена через «⋯»', () => {
  it('кнопки «Сегодня» и «Вчера» переключают день; выбранная нажата', async () => {
    seed();
    render(<CashDesk />);
    const t = await screen.findByRole('button', { name: 'Сегодня' });
    const y = screen.getByRole('button', { name: 'Вчера' });
    expect(t).toHaveAttribute('aria-pressed', 'true');
    expect(y).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(y);
    expect(screen.getByLabelText('Дата платежей')).toHaveValue('2026-10-14');
    expect(y).toHaveAttribute('aria-pressed', 'true');
    expect(t).toHaveAttribute('aria-pressed', 'false');
    expect(await screen.findByRole('heading', { name: /Внесено 14\.10\.2026|Внесено 14\.10/ })).toBeInTheDocument();
    fireEvent.click(t);
    expect(screen.getByLabelText('Дата платежей')).toHaveValue(today());
  });

  it('любая другая дата снимает нажатие с обеих кнопок', async () => {
    seed();
    render(<CashDesk />);
    await screen.findByRole('button', { name: 'Сегодня' });
    fireEvent.change(screen.getByLabelText('Дата платежей'), { target: { value: '2026-10-01' } });
    expect(screen.getByRole('button', { name: 'Сегодня' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Вчера' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('у оплаты нет отдельной кнопки «Отменить оплату»: действие в меню «⋯», без подтверждения запись не создаётся', async () => {
    seed();
    fake.db.payments = [{ id: 'x1', player_id: 'p1', amount: 50, paid_on: today(), method: 'Наличные', players: { full_name: 'Иванов Пётр' } }];
    render(<CashDesk />);
    await screen.findByRole('heading', { name: /Внесено сегодня.*50 ₾/ });
    expect(screen.queryByRole('button', { name: 'Отменить оплату: Иванов Пётр' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Отменить оплату' })).toBeNull();
    cancelViaMenu();
    const dlg = within(await screen.findByRole('dialog'));
    expect(dlg.getByText('Отменить оплату?')).toBeInTheDocument();
    expect(fake.paymentAdds()).toEqual([]);
    fireEvent.click(dlg.getByRole('button', { name: /^(Отмена|Не надо|Назад)/ }));
    expect(fake.paymentAdds()).toEqual([]);
  });

  it('у отменённой оплаты и у записи с минусом меню нет', async () => {
    seed();
    const pl = { full_name: 'Иванов Пётр' };
    fake.db.payments = [
      { id: 'a1', player_id: 'p1', amount: 50, paid_on: today(), method: 'Наличные', players: pl },
      { id: 'c1', player_id: 'p1', amount: -50, paid_on: today(), method: 'Наличные', cancels: 'a1', players: pl },
    ];
    render(<CashDesk />);
    await screen.findByRole('heading', { name: /Внесено сегодня/ });
    expect(screen.queryByRole('button', { name: 'Действия: Иванов Пётр' })).toBeNull();
  });
});

// Условия: docs/acceptance/cashdesk-day-register-errors-691-2026-11-20.md
describe('«Внесено за день»: сбой источников (#691)', () => {
  function seedDay() {
    seed();
    fake.db.payments = [{ id: 'a1', player_id: 'p1', amount: 100, paid_on: today(), method: 'Наличные', recorded_at: '2026-10-15T08:00:00Z', players: { full_name: 'Иванов Пётр' } }];
    fake.db.camp_payments = [{ id: 'c1', player_id: 'p1', amount: 250, paid_on: today(), method: 'Перевод', kind: 'payment', recorded_at: '2026-10-15T09:00:00Z', players: { full_name: 'Иванов Пётр' } }];
    fake.rpc.cash_day_service = () => [{ id: 's1', amount: 40, method: 'Наличные', what: 'Экипировка', player_id: 'p1', full_name: 'Иванов Пётр', recorded_at: '2026-10-15T10:00:00Z' }];
  }
  const failSvc = () => { fake.rpc.cash_day_service = () => ({ data: null, error: { message: 'boom' } }); };
  const regAlert = () => screen.findByRole('alert');
  const noTotals = () => {
    expect(screen.getByRole('heading', { name: /^Внесено сегодня$/ })).toBeInTheDocument(); // без суммы в заголовке
    for (const t of ['Всего', 'Наличные', 'Перевод']) expect(screen.queryByText(t, { selector: '.ks-tile b' })).not.toBeInTheDocument();
    expect(screen.queryByText('В этот день платежей нет.')).not.toBeInTheDocument();
  };

  it('успех: все строки, итог и плитки, блока ошибки нет', async () => {
    seedDay();
    render(<CashDesk />);
    expect(await screen.findByRole('heading', { name: /Внесено сегодня.*390/ })).toBeInTheDocument();
    expect(screen.getByText('Всего', { selector: '.ks-tile b' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('отказ payments: не бесконечная загрузка; сборы и занятия остаются; итога нет', async () => {
    seedDay();
    fake.errors.payments = 'boom';
    render(<CashDesk />);
    const a = await regAlert();
    expect(a.textContent).toMatch(/Касса за день загружена не полностью/);
    expect(a.textContent).toMatch(/Не удалось загрузить: оплаты абонементов\./);
    expect(a.textContent).not.toMatch(/boom/);
    expect(screen.queryByRole('status', { name: 'Загрузка' })).not.toBeInTheDocument();
    expect(screen.getByText(/Сбор, U9-A, Оплата, Перевод/)).toBeInTheDocument();
    expect(screen.getByText(/Экипировка/)).toBeInTheDocument();
    noTotals();
  });

  it('отказ camp_payments: названы оплаты сборов, строки абонемента остаются, итога нет', async () => {
    seedDay();
    fake.errors.camp_payments = 'boom';
    render(<CashDesk />);
    expect((await regAlert()).textContent).toMatch(/Не удалось загрузить: оплаты сборов\./);
    expect(screen.getByText(/Абонемент 10.26/)).toBeInTheDocument();
    expect(screen.queryByText(/Сбор, U9-A/)).not.toBeInTheDocument();
    noTotals();
  });

  it('отказ cash_day_service: названы оплаты экипировки и занятий, итога нет', async () => {
    seedDay();
    failSvc();
    render(<CashDesk />);
    expect((await regAlert()).textContent).toMatch(/Не удалось загрузить: оплаты экипировки и занятий\./);
    expect(screen.getByText(/Абонемент 10.26/)).toBeInTheDocument();
    noTotals();
  });

  it('отказ проверки отмен: тоже неполные данные', async () => {
    seedDay();
    const real = supabase.from;
    const spy = vi.spyOn(supabase, 'from').mockImplementation(((t: string) => {
      const q = real(t);
      if (t !== 'payments') return q;
      const sel = q.select.bind(q);
      q.select = (cols: string) => (cols === 'cancels' ? { in: () => ({ limit: () => Promise.resolve({ data: null, error: { message: 'boom' } }) }) } : sel(cols));
      return q;
    }) as any);
    render(<CashDesk />);
    expect((await regAlert()).textContent).toMatch(/Не удалось загрузить: отметки об отменах оплат\./);
    noTotals();
    spy.mockRestore();
  });

  it('все источники отказали: блок есть, строк и «платежей нет» нет, загрузки нет', async () => {
    seedDay();
    fake.errors.payments = 'boom';
    fake.errors.camp_payments = 'boom';
    failSvc();
    render(<CashDesk />);
    const a = await regAlert();
    expect(a.textContent).toMatch(/оплаты абонементов.*оплаты сборов.*оплаты экипировки и занятий/);
    expect(screen.queryByRole('status', { name: 'Загрузка' })).not.toBeInTheDocument();
    noTotals();
  });

  it('«Повторить»: один новый запрос, после успеха полный список, итог и плитки, блока нет', async () => {
    seedDay();
    fake.errors.camp_payments = 'boom';
    render(<CashDesk />);
    await regAlert();
    delete fake.errors.camp_payments;
    const before = fake.rpcCalls('cash_day_service').length;
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('heading', { name: /Внесено сегодня.*390/ })).toBeInTheDocument();
    expect(fake.rpcCalls('cash_day_service')).toHaveLength(before + 1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Всего', { selector: '.ks-tile b' })).toBeInTheDocument();
    expect(fake.calls.filter(c => c.kind !== 'rpc')).toHaveLength(0); // никаких записей
  });

  it('двойное быстрое нажатие «Повторить» запускает одну загрузку', async () => {
    seedDay();
    fake.errors.camp_payments = 'boom';
    render(<CashDesk />);
    await regAlert();
    delete fake.errors.camp_payments;
    const before = fake.rpcCalls('cash_day_service').length;
    const btn = within(screen.getByRole('alert')).getByRole('button', { name: 'Повторить' });
    act(() => { btn.click(); btn.click(); });
    expect(await screen.findByRole('heading', { name: /Внесено сегодня.*390/ })).toBeInTheDocument();
    expect(fake.rpcCalls('cash_day_service')).toHaveLength(before + 1);
  });

  it('повторный отказ оставляет предупреждение, итога нет', async () => {
    seedDay();
    fake.errors.camp_payments = 'boom';
    render(<CashDesk />);
    await regAlert();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect((await regAlert()).textContent).toMatch(/оплаты сборов/);
    noTotals();
  });

  it('устаревший ответ при смене даты не применяется (данные и ошибка прежней даты)', async () => {
    seedDay();
    fake.db.payments.push({ id: 'b1', player_id: 'p1', amount: 7, paid_on: '2026-10-05', method: 'Наличные', recorded_at: '2026-10-05T08:00:00Z', players: { full_name: 'Иванов Пётр' } });
    const pending: Record<string, (v: unknown) => void> = {};
    fake.rpc.cash_day_service = (a: { p_day: string }) => a.p_day === today() ? new Promise(r => { pending[a.p_day] = r; }) : [];
    render(<CashDesk />);
    await waitFor(() => expect(pending[today()]).toBeDefined());
    fireEvent.change(screen.getByLabelText('Дата платежей'), { target: { value: '2026-10-05' } });
    expect(await screen.findByRole('heading', { name: /Внесено 05.10.2026.*7/ })).toBeInTheDocument();
    pending[today()]({ data: null, error: { message: 'boom' } }); // поздний отказ за прежнюю дату
    await new Promise(r => setTimeout(r, 30));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Внесено 05.10.2026.*7/ })).toBeInTheDocument();
  });

  it('устаревший успех при смене даты не подмешивает строки прежнего дня', async () => {
    seedDay();
    fake.db.payments.push({ id: 'b1', player_id: 'p1', amount: 7, paid_on: '2026-10-05', method: 'Наличные', recorded_at: '2026-10-05T08:00:00Z', players: { full_name: 'Иванов Пётр' } });
    const pending: Record<string, (v: unknown) => void> = {};
    fake.rpc.cash_day_service = (a: { p_day: string }) => a.p_day === today() ? new Promise(r => { pending[a.p_day] = r; }) : [];
    render(<CashDesk />);
    await waitFor(() => expect(pending[today()]).toBeDefined());
    fireEvent.change(screen.getByLabelText('Дата платежей'), { target: { value: '2026-10-05' } });
    expect(await screen.findByRole('heading', { name: /Внесено 05.10.2026.*7/ })).toBeInTheDocument();
    pending[today()]([{ id: 's9', amount: 999, method: 'Наличные', what: 'Экипировка', player_id: 'p1', full_name: 'Старый ответ' }]);
    await new Promise(r => setTimeout(r, 30));
    expect(screen.queryByText('Старый ответ')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Внесено 05.10.2026.*7/ })).toBeInTheDocument();
  });
});
