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

describe('взносы: вид сумм', () => {
  it('знак ₾ отделён от суммы неразрывным пробелом и не переносится отдельно', async () => {
    seed();
    render(<EventFees eventId="m1" mode="match" reloadKey={0} onChanged={() => {}} />);
    await screen.findByText('Иванов Пётр');
    expect(document.body.textContent).toContain('К оплате 20\u00A0₾ · оплачено 0\u00A0₾');
    expect(document.body.textContent).not.toMatch(/\d ₾/);
  });
});

describe('взносы: скидка у оплаченного', () => {
  it('администратор видит «Скидка» у полностью оплаченного взноса и меняет сумму; тренер кнопки не видит', async () => {
    seed();
    fake.rpc.event_discount = () => null;
    fake.rpc.event_fees = () => [{ player_id: 'p2', full_name: 'Сидоров Ян', group_name: 'U9', due: 200, paid: 200 }];
    fake.rpc.event_payments = () => [];
    fake.rpc.fee_discounts = () => [];
    const { unmount } = render(<EventFees eventId="e1" reloadKey={0} onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Скидка: Сидоров Ян' }));
    expect(screen.queryByLabelText('Платит: Сидоров Ян')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Сумма к оплате'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }));
    fireEvent.change(await screen.findByLabelText(/Причина/), { target: { value: 'отыграл половину чемпионата' } });
    fireEvent.click(screen.getByRole('button', { name: 'Применить скидку' }));
    await waitFor(() => expect(fake.rpcCalls('event_discount')).toHaveLength(1));
    expect(fake.rpcCalls('event_discount')[0]).toMatchObject({ t: 'e1', pid: 'p2', due: 100, why: 'отыграл половину чемпионата' });
    unmount();
    render(<EventFees eventId="e1" reloadKey={0} coach onChanged={() => {}} />);
    await screen.findByText('Сидоров Ян');
    expect(screen.queryByRole('button', { name: 'Скидка: Сидоров Ян' })).not.toBeInTheDocument();
  });
});

describe('взносы матча: массовая оплата', () => {
  it('«Выбрать всех должников» отмечает только тех, у кого есть долг; оплата уходит всем выбранным', async () => {
    seed();
    render(<EventFees eventId="m1" mode="match" reloadKey={0} onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать всех должников' }));
    expect(screen.getByLabelText('Платит: Иванов Пётр')).toBeChecked();
    expect(screen.getByLabelText('Платит: Петров Иван')).toBeChecked();
    const paidBox = screen.queryByLabelText('Платит: Сидоров Ян') as HTMLInputElement | null;
    expect(paidBox === null || !paidBox.checked).toBe(true); // уже оплатил: отметки нет (или поля нет совсем)
    fireEvent.change(screen.getByLabelText(/^Способ/), { target: { value: 'Наличные' } });
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
