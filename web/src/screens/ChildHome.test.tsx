import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import ChildHome, { ChildCode } from './ChildHome';

describe('ввод кода ребёнком', () => {
  const type = (code: string) => {
    fireEvent.change(screen.getByLabelText('Код от родителя'), { target: { value: code } });
    fireEvent.click(screen.getByRole('button', { name: 'Привязать' }));
  };
  it('кнопка недоступна, пока введено меньше 8 символов', () => {
    render(<ChildCode onLinked={() => {}} />);
    fireEvent.change(screen.getByLabelText('Код от родителя'), { target: { value: 'abc12' } });
    expect(screen.getByRole('button', { name: 'Привязать' })).toBeDisabled();
  });
  it('верный код: переходит дальше, код уходит заглавными', async () => {
    fake.rpc.redeem_child_code = () => 'player-1';
    let linked = 0;
    render(<ChildCode onLinked={() => linked++} />);
    type('abcd2345');
    await waitFor(() => expect(linked).toBe(1));
    expect(fake.rpcCalls('redeem_child_code')).toEqual([{ c: 'ABCD2345' }]);
  });
  it('пустой ответ — «Код не подошёл»; переход не происходит', async () => {
    fake.rpc.redeem_child_code = () => null;
    let linked = 0;
    render(<ChildCode onLinked={() => linked++} />);
    type('ABCD2345');
    expect(await screen.findByText(/Код не подошёл или устарел/)).toBeInTheDocument();
    expect(linked).toBe(0);
  });
  it('лимит попыток и занятый игрок объясняются', async () => {
    fake.rpc.redeem_child_code = () => ({ error: { message: 'too many attempts' } });
    const { unmount } = render(<ChildCode onLinked={() => {}} />);
    type('ABCD2345');
    expect(await screen.findByText(/Подождите 10 минут/)).toBeInTheDocument();
    unmount();
    fake.rpc.redeem_child_code = () => ({ error: { message: 'already linked' } });
    render(<ChildCode onLinked={() => {}} />);
    type('ABCD2345');
    expect(await screen.findByText('К этому игроку уже привязан другой аккаунт.')).toBeInTheDocument();
  });
  it('ребёнок видит свои баллы', async () => {
    fake.db.point_events = [{ player_id: 'p1', points: 3, explanation: 'Свой', occurred_on: '2026-10-20' }, { player_id: 'p2', points: 9, explanation: 'Чужой', occurred_on: '2026-10-20' }];
    fake.db.match_players = [];
    render(<ChildHome player={{ id: 'p1', name: 'Иван', group: 'U9' }} />);
    expect(await screen.findByText('Свой')).toBeInTheDocument();
    expect(screen.queryByText('Чужой')).toBeNull();
  });
});
