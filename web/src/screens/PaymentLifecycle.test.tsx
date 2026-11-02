import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fake } from '../test/fakeSupabase';
import { PlayerDues } from './CashDesk';
import { gel } from './MonthPayments';
import Payments from './Payments';

// Регрессионные сценарии жизненного цикла платежа (задача #245). Только фиктивные данные и заглушка Supabase в памяти.
// Что уже проверено в CashDesk / MonthPayments / AdminPayments / DebtorsActions / ParentDues, здесь не повторяется.
// Дата зафиксирована в середине месяца, как в CashDesk.test.tsx.
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date(2026, 9, 15, 12, 0, 0));

const PL = { id: 'p1', full_name: 'Иванов Пётр', group_id: 'g1', groups: { name: 'U9-A' }, status: 'active' };

function seed() {
  fake.db.players = [{ id: 'p1', full_name: 'Иванов Пётр', group_id: 'g1', groups: { name: 'U9-A' } }];
  fake.db.prices = [{ group_id: null, kind: 'subscription', amount: 165, valid_from: '2026-09-01', valid_to: null }];
  fake.db.payments = [];
  fake.db.subscriptions = [];
  fake.db.equipment_orders = [];
  fake.db.individual_bookings = [];
  fake.db.extra_bookings = [];
  fake.db.camp_participants = [];
}

/** Карточка долга за октябрь, открытая для приёма оплаты. */
async function openOctober() {
  render(<PlayerDues embedded player={PL} />);
  const title = await screen.findByText(/Октябрь 2026/);
  const card = title.closest('.ks-card') as HTMLElement;
  fireEvent.click(within(card).getByRole('button', { name: 'Принять оплату' }));
  return card;
}
const fill = (card: HTMLElement, amount: string, method = 'Наличные') => {
  fireEvent.change(within(card).getByLabelText(/Сумма/), { target: { value: amount } });
  fireEvent.change(within(card).getByLabelText('Способ'), { target: { value: method } });
};

describe('Платёж: ввод суммы и повтор', () => {
  it('сумма с запятой записывается числом, в окне подтверждения она видна до копейки', async () => {
    seed();
    const card = await openOctober();
    fill(card, '60,5', 'Перевод');
    fireEvent.click(within(card).getByRole('button', { name: 'Записать платёж' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('60.50 ₾')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Записать' }));
    await waitFor(() => expect(fake.writes('payments', 'insert')).toHaveLength(1));
    expect(fake.writes('payments', 'insert')[0]).toMatchObject({ player_id: 'p1', amount: 60.5, method: 'Перевод' });
  });

  it.each(['0', '-5', 'abc', ''])('сумма «%s» отклоняется: окна подтверждения нет, записи нет', async (bad) => {
    seed();
    const card = await openOctober();
    fill(card, bad);
    fireEvent.click(within(card).getByRole('button', { name: 'Записать платёж' }));
    expect(await within(card).findByText('Введите сумму больше нуля.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fake.writes('payments')).toHaveLength(0);
  });

  it('двойное нажатие «Записать» создаёт один платёж', async () => {
    seed();
    const card = await openOctober();
    fill(card, '100');
    fireEvent.click(within(card).getByRole('button', { name: 'Записать платёж' }));
    const confirm = within(await screen.findByRole('dialog')).getByRole('button', { name: 'Записать' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await screen.findByText('Платёж записан.');
    expect(fake.writes('payments', 'insert')).toHaveLength(1);
  });
});

describe('Платёж: ошибка записи', () => {
  it('база отказала: показана ошибка, «Платёж записан» не появляется, запись не создана', async () => {
    seed();
    const card = await openOctober();
    fill(card, '100');
    fireEvent.click(within(card).getByRole('button', { name: 'Записать платёж' }));
    const dialog = await screen.findByRole('dialog');
    fake.errors.payments = 'boom'; // база начинает отвечать ошибкой уже после загрузки списка
    fireEvent.click(within(dialog).getByRole('button', { name: 'Записать' }));
    await waitFor(() => expect(card.querySelector('.error')).not.toBeNull());
    expect(screen.queryByText('Платёж записан.')).not.toBeInTheDocument();
    expect(fake.writes('payments')).toHaveLength(0);
  });
});

describe('Суммы: округление и формат', () => {
  it.each([
    [0, '0 ₾'],
    [165, '165 ₾'],
    [-50, '-50 ₾'],
    [165.5, '165.50 ₾'],
    [0.1 + 0.2, '0.30 ₾'],
    [60.5, '60.50 ₾'],
  ])('gel(%s) = «%s»', (n, text) => {
    expect(gel(n)).toBe(text);
  });
});

describe('Родитель: история оплат', () => {
  const guardian = () => { fake.db.player_guardians = [{ user_id: 'u', consent_revoked_at: null, players: { id: 'p1', full_name: 'Аня' } }]; fake.rpc.parent_debts = () => []; fake.rpc.parent_dues = () => []; };
  const slot = (month: RegExp) => screen.getByText(month).closest('.ks-slot') as HTMLElement;

  it('оплата вперёд попадает в месяц назначения, а не в месяц, когда внесены деньги', async () => {
    guardian();
    fake.db.payments = [{ player_id: 'p1', amount: 165, paid_on: '2026-10-28', for_month: '2026-11-01' }];
    render(<Payments />);
    expect(await screen.findByText(/Абонемент · Ноябрь 2026/)).toBeInTheDocument();
    expect(within(slot(/Ноябрь 2026/)).getByText('165 ₾')).toBeInTheDocument();
    expect(screen.queryByText(/Абонемент · Октябрь 2026/)).not.toBeInTheDocument();
  });

  it('отменённый платёж гасит исходную сумму в том же месяце', async () => {
    guardian();
    fake.db.payments = [
      { player_id: 'p1', amount: 165, paid_on: '2026-10-05' },
      { player_id: 'p1', amount: -165, paid_on: '2026-10-06' },
    ];
    render(<Payments />);
    expect(await screen.findByText(/Абонемент · Октябрь 2026/)).toBeInTheDocument();
    expect(within(slot(/Октябрь 2026/)).getByText('0 ₾')).toBeInTheDocument();
  });

  it('платежи чужого ребёнка не показываются', async () => {
    guardian();
    fake.db.payments = [
      { player_id: 'p1', amount: 165, paid_on: '2026-10-05' },
      { player_id: 'p2', amount: 999, paid_on: '2026-10-05' },
    ];
    render(<Payments />);
    expect(await screen.findByText(/Абонемент · Октябрь 2026/)).toBeInTheDocument();
    expect(screen.queryByText('999 ₾')).not.toBeInTheDocument();
  });

  it('ошибка загрузки платежей не выглядит как «платежей пока нет»', async () => {
    guardian();
    fake.errors.payments = 'boom';
    render(<Payments />);
    expect(await screen.findByText('Не удалось загрузить оплаты')).toBeInTheDocument();
    expect(screen.queryByText('Платежей пока нет.')).not.toBeInTheDocument();
  });
});
