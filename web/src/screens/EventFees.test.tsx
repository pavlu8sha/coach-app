import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import EventFees from './EventFees';

function seed() {
  fake.rpc.match_fees_list = () => [
    { player_id: 'p1', full_name: 'Иванов Пётр', group_name: 'U9', due: 20, paid: 0 },
    { player_id: 'p2', full_name: 'Сидоров Ян', group_name: 'U9', due: 20, paid: 20 },
    { player_id: 'p3', full_name: 'Петров Иван', group_name: 'U9', due: 20, paid: 5 },
  ];
  fake.rpc.match_payments_list = () => [];
  fake.rpc.match_pay = () => null;
}

describe('взносы матча: массовая оплата', () => {
  it('«Выбрать всех должников» отмечает только тех, у кого есть долг; оплата уходит всем выбранным', async () => {
    seed();
    render(<EventFees eventId="m1" mode="match" reloadKey={0} onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать всех должников' }));
    expect(screen.getByLabelText('Платит: Иванов Пётр')).toBeChecked();
    expect(screen.getByLabelText('Платит: Петров Иван')).toBeChecked();
    expect(screen.queryByLabelText('Платит: Сидоров Ян')).toBeNull(); // уже оплатил: чекбокса нет
    fireEvent.click(screen.getByRole('button', { name: 'Записать оплату (2)' }));
    await waitFor(() => expect(fake.rpcCalls('match_pay')).toHaveLength(1));
    expect(fake.rpcCalls('match_pay')[0]).toMatchObject({ m: 'm1', ids: ['p1', 'p3'], amt: null, mth: 'Наличные' });
  });

  it('«Снять выбор» очищает отметки; без должников кнопка выбора недоступна', async () => {
    seed();
    const { unmount } = render(<EventFees eventId="m1" mode="match" reloadKey={0} onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать всех должников' }));
    fireEvent.click(screen.getByRole('button', { name: 'Снять выбор' }));
    expect(screen.getByLabelText('Платит: Иванов Пётр')).not.toBeChecked();
    unmount();
    fake.rpc.match_fees_list = () => [{ player_id: 'p2', full_name: 'Сидоров Ян', group_name: 'U9', due: 20, paid: 20 }];
    render(<EventFees eventId="m1" mode="match" reloadKey={0} onChanged={() => {}} />);
    expect(await screen.findByRole('button', { name: 'Выбрать всех должников' })).toBeDisabled();
  });
});
