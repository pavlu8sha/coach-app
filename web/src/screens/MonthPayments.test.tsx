import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import MonthPayments, { inMonth, tariffFor } from './MonthPayments';

const monthIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};
const seed = () => {
  fake.db.groups = [{ id: 'g1', name: 'U9' }];
  fake.db.prices = [
    { group_id: null, kind: 'subscription', amount: 165, valid_from: '2026-09-01', valid_to: null },
    { group_id: 'g2', kind: 'subscription', amount: 130, valid_from: '2026-09-01', valid_to: null },
  ];
  fake.db.players = [
    { id: 'p1', full_name: 'Иванов Пётр', group_id: 'g1', status: 'active' },
    { id: 'p2', full_name: 'Сидоров Ян', group_id: 'g1', status: 'active' },
    { id: 'p3', full_name: 'Со Скидкой', group_id: 'g1', status: 'active' },
  ];
  fake.db.payments = [
    { player_id: 'p1', amount: 100, paid_on: monthIso() },
    { player_id: 'p3', amount: 50, paid_on: monthIso() },
  ];
  fake.db.subscriptions = [{ player_id: 'p3', month: monthIso(), discount: true, written_off: false }];
};

describe('tariffFor', () => {
  const prices = [
    { group_id: null, amount: 165, valid_from: '2026-09-01', valid_to: null },
    { group_id: 'g2', amount: 130, valid_from: '2026-09-01', valid_to: null },
    { group_id: null, amount: 170, valid_from: '2026-12-01', valid_to: null },
  ];
  it('своя цена группы важнее общей, будущая цена действует с своего месяца', () => {
    expect(tariffFor(prices, 'g1', '2026-10-01')).toBe(165);
    expect(tariffFor(prices, 'g2', '2026-10-01')).toBe(130);
    expect(tariffFor(prices, 'g1', '2026-12-01')).toBe(170);
    expect(tariffFor(prices, 'g1', '2026-08-01')).toBeNull();
  });
});

describe('inMonth: кто в списке месяца', () => {
  const all = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  it('прошедший месяц: только с абонементом или платежом, пришедший позже не должник', () => {
    expect(inMonth(all, '2026-09-01', '2026-11-01', new Set(['a']), new Set(['b'])).map(p => p.id)).toEqual(['a', 'b']);
  });
  it('текущий и будущий месяц: все активные', () => {
    expect(inMonth(all, '2026-11-01', '2026-11-01', new Set(['a']), new Set()).map(p => p.id)).toEqual(['a', 'b', 'c']);
    expect(inMonth(all, '2026-12-01', '2026-11-01', new Set(), new Set()).map(p => p.id)).toEqual(['a', 'b', 'c']);
  });
  it('прошедший месяц без данных вовсе: показываем всех', () => {
    expect(inMonth(all, '2026-09-01', '2026-11-01', new Set(), new Set())).toHaveLength(3);
  });
});

describe('«Оплаты за месяц»', () => {
  it('показывает кто сколько внёс, скидку и итог группы', async () => {
    seed();
    render(<MonthPayments />);
    expect(await screen.findByText('100 ₾ из 165 ₾')).toBeInTheDocument();
    expect(screen.getByText('0 ₾ из 165 ₾')).toBeInTheDocument();
    expect(screen.getByText('Скидка')).toBeInTheDocument();
    expect(screen.getAllByText('1 из 3')).toHaveLength(2); // плитка «Оплатили» и заголовок группы
    expect(screen.getByText(/внесено 150 ₾ из 495 ₾/)).toBeInTheDocument(); // итог группы
  });

  it('деньги ушедшего игрока остаются в итоге месяца, а должником он не становится', async () => {
    seed();
    fake.db.players = [...fake.db.players, { id: 'p9', full_name: 'Ушедший Лёва', group_id: 'g1', status: 'inactive' }, { id: 'p8', full_name: 'Ушедший Без Денег', group_id: 'g1', status: 'inactive' }];
    fake.db.payments = [...fake.db.payments, { player_id: 'p9', amount: 165, paid_on: monthIso() }];
    render(<MonthPayments />);
    expect(await screen.findByText('Ушедший Лёва')).toBeInTheDocument();
    expect(screen.queryByText('Ушедший Без Денег')).toBeNull();
    expect(screen.getByText(/внесено 315 ₾ из 660 ₾/)).toBeInTheDocument(); // 100 + 50 + 165 при четырёх в группе
  });

  it('«Только должники» прячет оплативших, поиск ищет по фамилии', async () => {
    seed();
    render(<MonthPayments />);
    await screen.findByText('100 ₾ из 165 ₾');
    fireEvent.click(screen.getByRole('switch', { name: 'Только должники' }));
    expect(screen.queryByText('Скидка')).toBeNull();
    fireEvent.change(screen.getByLabelText('Поиск по ФИ'), { target: { value: 'сидор' } });
    expect(screen.getByText('Сидоров Ян')).toBeInTheDocument();
    expect(screen.queryByText('Иванов Пётр')).toBeNull();
  });

  it('«Считать оплаченным (скидка)» есть у частично оплативших и ставит скидку', async () => {
    seed();
    render(<MonthPayments />);
    await screen.findByText('100 ₾ из 165 ₾');
    expect(screen.getAllByRole('button', { name: 'Считать оплаченным (скидка)' })).toHaveLength(1); // Иванов: внесено 100 из 165
    fireEvent.click(screen.getByRole('button', { name: 'Считать оплаченным (скидка)' }));
    await waitFor(() => expect(fake.writes('subscriptions', 'upsert')).toEqual([{ player_id: 'p1', month: monthIso(), discount: true }]));
  });

  it('быстрый платёж: сумма по умолчанию — остаток, запись в журнал', async () => {
    seed();
    render(<MonthPayments />);
    await screen.findByText('100 ₾ из 165 ₾');
    fireEvent.click(screen.getAllByRole('button', { name: 'Внести платёж' })[0]); // Иванов: внесено 100
    expect(screen.getByLabelText(/Сумма/)).toHaveValue('65');
    fireEvent.change(screen.getByLabelText(/^Способ/), { target: { value: 'Наличные' } });
    fireEvent.click(screen.getByRole('button', { name: 'Записать платёж' }));
    await waitFor(() => expect(fake.writes('payments', 'insert')).toHaveLength(1));
    expect(fake.writes('payments', 'insert')[0]).toMatchObject({ player_id: 'p1', amount: 65, method: 'Наличные' });
  });

  it('нулевая сумма и будущая дата отклоняются без записи', async () => {
    seed();
    render(<MonthPayments />);
    await screen.findByText('100 ₾ из 165 ₾');
    fireEvent.click(screen.getAllByRole('button', { name: 'Внести платёж' })[0]);
    fireEvent.change(screen.getByLabelText(/Сумма/), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText(/^Способ/), { target: { value: 'Наличные' } });
    fireEvent.click(screen.getByRole('button', { name: 'Записать платёж' }));
    expect(await screen.findByText('Введите сумму (не ноль).')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Сумма/), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Дата'), { target: { value: '2999-01-05' } });
    fireEvent.change(screen.getByLabelText(/^Способ/), { target: { value: 'Наличные' } });
    fireEvent.click(screen.getByRole('button', { name: 'Записать платёж' }));
    expect(await screen.findByText(/Дата платежа не может быть в будущем/)).toBeInTheDocument();
    expect(fake.writes('payments', 'insert')).toHaveLength(0);
  });
});
