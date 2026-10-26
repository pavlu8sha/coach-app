import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import Debtors from './Debtors';
import Payments from './Payments';

const monthIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};
function seed() {
  fake.rpc.debtors = () => [
    { group_name: 'U9-A', player_id: 'p1', full_name: 'Иванов Пётр', tariff: 165, paid: 100, debt: 65 },
    { group_name: 'U9-A', player_id: 'p2', full_name: 'Сидоров Ян', tariff: 165, paid: 0, debt: 165 },
    { group_name: 'weekends', player_id: 'p3', full_name: 'Weekends Игрок', tariff: 130, paid: 0, debt: 130 },
  ];
  fake.db.subscriptions = [{ id: 's1', player_id: 'p9', month: monthIso(), discount: true, players: { full_name: 'Со Скидкой' } }];
  fake.db.clubs = [{ id: 'c1' }];
  fake.db.club_settings = [];
}

describe('«Должники» (администратор)', () => {
  it('показывает группы, суммы и итог', async () => {
    seed();
    render(<Debtors />);
    expect(await screen.findByText('Должны: 3, всего 360 ₾')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'weekends' })).toBeInTheDocument();
    expect(screen.getByText('Внесено 100 ₾ из 165 ₾')).toBeInTheDocument();
    expect(fake.rpcCalls('debtors')).toEqual([{ m: monthIso() }]);
  });

  it('показ долга родителям выключен по умолчанию и включается кнопкой', async () => {
    seed();
    render(<Debtors />);
    expect(await screen.findByText('Показ долга родителям: выключен')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Включить показ родителям'));
    await waitFor(() => expect(fake.writes('club_settings', 'upsert')).toEqual([{ club_id: 'c1', key: 'parent_debt_enabled', value: 'true' }]));
    expect(await screen.findByText('Показ долга родителям: включён')).toBeInTheDocument();
  });

  it('скидку можно отметить и снять', async () => {
    seed();
    render(<Debtors />);
    fireEvent.click((await screen.findAllByText('Отметить «Скидка»'))[0]);
    await waitFor(() => expect(fake.writes('subscriptions', 'upsert')).toContainEqual({ player_id: 'p1', month: monthIso(), discount: true }));
    fireEvent.click(await screen.findByText('Снять'));
    await waitFor(() => expect(fake.writes('subscriptions', 'upsert')).toContainEqual({ player_id: 'p9', month: monthIso(), discount: false }));
  });

  it('пустой список — «Должников нет»', async () => {
    seed();
    fake.rpc.debtors = () => [];
    render(<Debtors />);
    expect(await screen.findByText('Должников нет')).toBeInTheDocument();
  });

  it('если функция расчёта не установлена, объясняет, что нужна миграция', async () => {
    seed();
    fake.rpc.debtors = () => ({ error: { message: 'Could not find the function public.debtors' } });
    render(<Debtors />);
    expect(await screen.findByText(/ещё не установлена в базе \(миграция 0023\)/)).toBeInTheDocument();
  });
});

describe('«Оплата» родителя: долг', () => {
  const kids = () => {
    fake.db.player_guardians = [{ user_id: 'u', players: { id: 'p1', full_name: 'Иван Петров' } }];
    fake.db.payments = [{ player_id: 'p1', amount: 100, paid_on: '2026-10-01' }];
  };
  it('показывает «К оплате» суммой и по месяцам', async () => {
    kids();
    fake.rpc.parent_debts = () => [
      { player_id: 'p1', month: '2026-10-01', tariff: 165, paid: 100, debt: 65 },
      { player_id: 'p1', month: '2026-09-01', tariff: 165, paid: 60, debt: 105 },
    ];
    render(<Payments />);
    expect(await screen.findByText('К оплате: 170 ₾')).toBeInTheDocument();
    expect(screen.getByText('внесено 100 ₾ из 165 ₾')).toBeInTheDocument();
  });
  it('не показывает долг, если показ выключен (функция вернула пусто) или её нет', async () => {
    kids();
    fake.rpc.parent_debts = () => [];
    const { unmount } = render(<Payments />);
    await screen.findByText('Иван Петров');
    expect(screen.queryByText(/К оплате/)).toBeNull();
    unmount();
    fake.rpc.parent_debts = () => ({ error: { message: 'Could not find the function' } });
    render(<Payments />);
    await screen.findByText('Иван Петров');
    expect(screen.queryByText(/К оплате/)).toBeNull();
  });
  it('нулевой долг не показывается', async () => {
    kids();
    fake.rpc.parent_debts = () => [{ player_id: 'p1', month: '2026-10-01', tariff: 165, paid: 165, debt: 0 }];
    render(<Payments />);
    await screen.findByText('Иван Петров');
    expect(screen.queryByText(/К оплате/)).toBeNull();
  });
});
