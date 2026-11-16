import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import PlayerPayMode from './PlayerPayMode';

// Условия приёмки: docs/PAY_PER_VISIT_ACCEPTANCE.md, п. 1 и 13 (тип игрока в карточке)
beforeEach(() => {
  fake.db.players = [{ id: 'p1', pay_mode: 'subscription', pay_mode_from: null }];
  fake.rpc.player_set_pay_mode = () => null;
  fake.rpc.player_visit_month = () => ({ visits: 6, accrued: 120, paid: 100, subscription_price: 165 });
});

describe('«Тип оплаты» в карточке игрока', () => {
  it('по умолчанию «Абонемент»; смена на «Платит за визит» идёт через player_set_pay_mode с датой', async () => {
    render(<PlayerPayMode playerId="p1" />);
    expect(await screen.findByText('Абонемент')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Сменить на «Платит за визит»' }));
    expect(screen.getByText(/Старые оплаты в абонемент остаются как есть/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Платит за визит с'), { target: { value: '2026-11-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Платит за визит' }));
    await waitFor(() => expect(fake.rpcCalls('player_set_pay_mode')).toEqual([{ p: 'p1', mode: 'per_visit', from_d: '2026-11-01' }]));
  });

  it('у игрока «за визит» показан факт за месяц без слов о выгоде; можно вернуть абонемент', async () => {
    fake.db.players = [{ id: 'p1', pay_mode: 'per_visit', pay_mode_from: '2026-11-01' }];
    render(<PlayerPayMode playerId="p1" />);
    expect(await screen.findByText(/визитов 6, начислено 120 ₾, оплачено 100 ₾\. Абонемент в этом месяце: 165 ₾\./)).toBeInTheDocument();
    expect(screen.queryByText(/выгод|переплат|экономи/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Изменить тип оплаты' }));
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть абонемент' }));
    await waitFor(() => expect(fake.rpcCalls('player_set_pay_mode')).toEqual([{ p: 'p1', mode: 'subscription', from_d: null }]));
  });

  it('без миграции (нет колонок) панель не показывается', async () => {
    fake.db.players = [];
    const { container } = render(<PlayerPayMode playerId="p1" />);
    await waitFor(() => expect(container.querySelector('section')).toBeNull());
  });
});
