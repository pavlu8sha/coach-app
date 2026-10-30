import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import Payments from './Payments';

describe('Ошибка загрузки задолженности родителя', () => {
  beforeEach(() => {
    fake.reset();
    fake.db.player_guardians = [{ user_id: 'u', consent_revoked_at: null, players: { id: 'p1', full_name: 'Аня' } }];
    fake.db.payments = [];
  });

  it('не выдаёт ошибку RPC за отсутствие долга и позволяет повторить загрузку', async () => {
    fake.rpc.parent_debts = () => ({ data: null, error: { message: 'RPC unavailable' } });
    fake.rpc.parent_dues = () => [];

    render(<Payments />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить задолженность');
    expect(screen.getByRole('alert')).toHaveTextContent('сведения о долгах могут быть неполными');
    expect(screen.queryByText(/К оплате:/)).not.toBeInTheDocument();

    fake.rpc.parent_debts = () => [
      { player_id: 'p1', month: '2026-10-01', tariff: 200, paid: 100, debt: 100 },
    ];
    fireEvent.click(screen.getByRole('button', { name: 'Повторить загрузку' }));

    expect(await screen.findByText('К оплате: 100 ₾')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});
