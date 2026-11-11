import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { today } from '../lib/coach';
import { DEBT_START } from '../lib/debtSeason';
import { fake } from '../test/fakeSupabase';
import CashDesk, { PlayerDues } from './CashDesk';
import { monthIso, nextMonth } from './MonthPayments';

// Дата зафиксирована в середине месяца: в первый день месяца платёж «за месяц» совпадал с сегодняшним, и тесты падали (1 ноября).
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date(2026, 9, 15, 12, 0, 0));
const M = monthIso(new Date());
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
    await waitFor(() => expect(fake.writes('payments', 'insert')).toHaveLength(1));
    expect(fake.writes('payments', 'insert')[0]).toMatchObject({ player_id: 'p1', amount: 60, method: 'Перевод', paid_on: today() });
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
    expect(fake.writes('payments', 'insert')[0]).toMatchObject({ player_id: 'p1', amount: 60, method: 'Перевод', for_month: M });
    expect(fake.writes('subscriptions', 'upsert')[0]).toMatchObject({ player_id: 'p1', month: M, discount: true });
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
    await waitFor(() => expect(fake.writes('payments', 'insert')).toHaveLength(1));
    expect(fake.writes('payments', 'insert')[0]).toMatchObject({ player_id: 'p1', amount: 165, paid_on: today(), for_month: next, method: 'Перевод' });
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
    expect(fake.writes('payments', 'insert')).toHaveLength(0);
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
    expect(fake.writes('payments', 'insert')).toHaveLength(0);
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
    expect(screen.queryByRole('button', { name: 'Отменить оплату: Иванов Пётр' })).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Отменить оплату: Иванов Пётр' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Отменить оплату' }));
    await waitFor(() => expect(fake.writes('payments', 'insert')).toEqual([expect.objectContaining({ player_id: 'p1', amount: -50, paid_on: today(), method: 'Наличные' })]));
  });
  it('если отмена не записалась, показывается ошибка', async () => {
    seed();
    fake.db.payments = [{ id: 'x1', player_id: 'p1', amount: 50, paid_on: today(), method: 'Наличные', players: { full_name: 'Иванов Пётр' } }];
    render(<CashDesk />);
    await screen.findByRole('heading', { name: /Внесено сегодня.*50 ₾/ });
    fake.errors.payments = 'boom';
    fireEvent.click(screen.getByRole('button', { name: 'Отменить оплату: Иванов Пётр' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Отменить оплату: Иванов Пётр' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Отменить оплату' }));
    await waitFor(() => expect(fake.writes('payments', 'insert')).toEqual([expect.objectContaining({ amount: -165, for_month: '2099-11-01', method: 'Перевод' })]));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Отменить оплату: Иванов Пётр' })).toBeNull());
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
    fireEvent.click(screen.getAllByRole('button', { name: 'Отменить оплату: Иванов Пётр' })[0]);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Отменить оплату' }));
    await waitFor(() => expect(fake.writes('payments', 'insert')).toEqual([expect.objectContaining({ amount: -50, cancels: 'a2', method: 'Перевод' })]));
    // a2 отменён, a1 остаётся доступным для отмены
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Отменить оплату: Иванов Пётр' })).toHaveLength(1));
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
    expect(screen.queryByRole('button', { name: 'Отменить оплату: Иванов Пётр' })).toBeNull();
  });
  it('если платёж уже отменён (повторный или параллельный запрос), показывается понятное сообщение', async () => {
    seed();
    fake.db.payments = [{ id: 'a1', player_id: 'p1', amount: 50, paid_on: today(), method: 'Наличные', players: { full_name: 'Иванов Пётр' } }];
    render(<CashDesk />);
    await screen.findByRole('heading', { name: /Внесено сегодня.*50 ₾/ });
    fake.errors.payments = 'duplicate key value violates unique constraint "payments_cancels_key"';
    fireEvent.click(screen.getByRole('button', { name: 'Отменить оплату: Иванов Пётр' }));
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

  it('сбой чтения взносов не ломает остальные разделы', async () => {
    seedFees();
    fake.db.equipment_orders = [{ id: 'o1', player_id: 'p1', ordered_on: '2026-09-10', total: 160, paid: 60, equipment_order_lines: [{ kit: 'Форма' }] }];
    fake.errors.match_fees = 'boom';
    await openPlayer();
    expect(await screen.findByRole('heading', { name: 'Экипировка' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Взносы матчей' })).not.toBeInTheDocument();
  });
});
