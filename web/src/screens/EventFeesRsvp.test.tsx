import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import EventFees from './EventFees';

// Условия приёмки: docs/MATCH_FEE_SINGLE_PLACE_ACCEPTANCE.md
function seed(fee: number | null | undefined, rows = [{ player_id: 'p1', full_name: 'Иванов Пётр', group_name: 'U9', due: 20, paid: 0 }]) {
  fake.db.matches = fee === undefined ? [] : [{ id: 'm1', fee }];
  fake.rpc.match_fees_list = () => rows;
  fake.rpc.match_payments_list = () => [];
  fake.rpc.fee_discounts = () => [];
  fake.rpc.match_pay = () => null;
  fake.rpc.match_fee_add = () => 1;
  fake.rpc.match_set_fee = () => null;
}
const open = async (rsvp = true, addable: { id: string; name: string }[] = []) => {
  render(<EventFees eventId="m1" mode="match" rsvp={rsvp} reloadKey={0} onChanged={() => {}} addable={addable} />);
  await screen.findByText('Иванов Пётр');
};

describe('взносы матча с подтверждением: сумма в одном месте', () => {
  it('поля суммы и «Сохранить» нет, сумма показана с неразрывным пробелом и подсказкой', async () => {
    seed(30);
    await open();
    expect(screen.queryByLabelText('Взнос с игрока, ₾')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull();
    expect(document.body.textContent).toContain('Взнос с игрока: 30 ₾');
    expect(screen.getByText(/Сумма меняется в разделе «Состав и ответы»/)).toBeInTheDocument();
  });

  it.each([[null], [0]])('сумма матча %s: «Взнос не задан», поля нет', async fee => {
    seed(fee);
    await open();
    expect(screen.getByText(/Взнос не задан\./)).toBeInTheDocument();
    expect(screen.getByText(/Укажите взнос в разделе «Состав и ответы» → «Изменить данные матча»/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Взнос с игрока, ₾')).toBeNull();
  });

  it('оплата по-прежнему записывается', async () => {
    seed(30);
    await open();
    fireEvent.click(screen.getByLabelText('Платит: Иванов Пётр'));
    fireEvent.change(screen.getByLabelText('Способ'), { target: { value: 'Наличные' } });
    fireEvent.click(screen.getByRole('button', { name: /Записать оплату/ }));
    await waitFor(() => expect(fake.rpcCalls('match_pay')).toHaveLength(1));
  });

  it('«Добавить игроков состава во взнос» берёт сумму матча', async () => {
    seed(30);
    await open(true, [{ id: 'p9', name: 'Новый Игрок' }]);
    fireEvent.click(screen.getByRole('button', { name: /Добавить игроков состава во взнос/ }));
    await waitFor(() => expect(fake.rpcCalls('match_fee_add')).toEqual([{ m: 'm1', ids: ['p9'], amt: 30 }]));
    expect(fake.rpcCalls('match_set_fee')).toHaveLength(0);
  });

  it('без суммы матча добавление игроков ничего не вызывает и показывает подсказку', async () => {
    seed(null);
    await open(true, [{ id: 'p9', name: 'Новый Игрок' }]);
    fireEvent.click(screen.getByRole('button', { name: /Добавить игроков состава во взнос/ }));
    await waitFor(() => expect(screen.getAllByText(/Укажите взнос в разделе «Состав и ответы»/)).toHaveLength(2)); // подсказка в блоке и сообщение у кнопки
    expect(fake.rpcCalls('match_fee_add')).toHaveLength(0);
  });

  it('ошибка чтения суммы матча: блок как раньше, поле и «Сохранить» на месте', async () => {
    seed(undefined);
    fake.rpc.match_fees_list = () => [{ player_id: 'p1', full_name: 'Иванов Пётр', group_name: 'U9', due: 20, paid: 0 }];
    // матча в базе нет: чтение суммы не вернуло данных
    await open();
    expect(screen.getByLabelText('Взнос с игрока, ₾')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeInTheDocument();
  });

  it('матч без подтверждения: поле и «Сохранить» как раньше', async () => {
    seed(30);
    await open(false);
    expect(screen.getByLabelText('Взнос с игрока, ₾')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeInTheDocument();
    expect(screen.queryByText(/Взнос не задан/)).toBeNull();
  });

  it('пока сумма матча читается, ручной ввод недоступен и match_set_fee не вызывается', async () => {
    seed(30);
    const held = fake.hold('matches');
    render(<EventFees eventId="m1" mode="match" rsvp reloadKey={0} onChanged={() => {}} />);
    await waitFor(() => expect(fake.holds.matches).toHaveLength(0)); // запрос суммы взят на удержание и ещё не завершён
    expect(screen.queryByLabelText('Взнос с игрока, ₾')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull();
    held.release();
    await screen.findByText('Иванов Пётр');
    expect(screen.queryByLabelText('Взнос с игрока, ₾')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull();
    expect(document.body.textContent).toContain('Взнос с игрока: 30\u00A0₾');
    expect(fake.rpcCalls('match_set_fee')).toHaveLength(0);
  });
});
