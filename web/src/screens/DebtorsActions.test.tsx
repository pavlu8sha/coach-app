import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fake } from '../test/fakeSupabase';
import Debtors from './Debtors';

const monthIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};
function seed() {
  fake.rpc.debtors = () => [{ group_name: 'U9', player_id: 'p1', full_name: 'Иванов Пётр', tariff: 165, paid: 0, debt: 165 }];
  fake.db.subscriptions = [
    { id: 's1', player_id: 'p7', month: monthIso(), discount: false, written_off: true, players: { full_name: 'Списанный Иван' } },
  ];
  fake.db.clubs = [{ id: 'c1' }];
  fake.db.club_settings = [];
}
afterEach(() => vi.restoreAllMocks());

describe('«Должники»: списание и создание абонементов (0032)', () => {
  it('«Списать долг» ставит флаг written_off за выбранный месяц', async () => {
    seed();
    render(<Debtors />);
    fireEvent.click(await screen.findByRole('button', { name: 'Списать долг' }));
    await waitFor(() => expect(fake.writes('subscriptions', 'upsert')).toEqual([{ player_id: 'p1', month: monthIso(), written_off: true }]));
  });

  it('списанные показываются отдельно и возвращаются кнопкой', async () => {
    seed();
    render(<Debtors />);
    expect(await screen.findByText('Списанный Иван')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть' }));
    await waitFor(() => expect(fake.writes('subscriptions', 'upsert')).toEqual([{ player_id: 'p7', month: monthIso(), written_off: false }]));
  });

  it('создание абонементов: без подтверждения ничего не происходит, с ним — вызов и число созданных', async () => {
    seed();
    fake.rpc.create_subscription_month = () => 12;
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<Debtors />);
    const btn = await screen.findByRole('button', { name: 'Создать абонементы на месяц' });
    fireEvent.click(btn);
    expect(fake.rpcCalls('create_subscription_month')).toHaveLength(0);
    fireEvent.click(btn);
    expect(await screen.findByText('Создано абонементов: 12. Уже существующие не менялись.')).toBeInTheDocument();
    expect(fake.rpcCalls('create_subscription_month')).toEqual([{ m: monthIso() }]);
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('если миграция 0032 не применена, экран говорит об этом', async () => {
    seed();
    fake.rpc.create_subscription_month = () => ({ error: { message: 'Could not find the function public.create_subscription_month' } });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<Debtors />);
    fireEvent.click(await screen.findByRole('button', { name: 'Создать абонементы на месяц' }));
    expect(await screen.findByText(/миграция 0032/)).toBeInTheDocument();
  });
});
