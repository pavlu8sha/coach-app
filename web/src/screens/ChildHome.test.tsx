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
    const row = (id: string, player_id: string, points: number) => ({ id, player_id, points, event_date: '2026-11-03', source_type: 'group_session', reason_code: 'attended', components: { class: 'regular', base: points }, status: 'active' });
    fake.db.points_ledger = [row('l1', 'p1', 3), row('l2', 'p2', 9)];
    fake.db.point_events = [{ player_id: 'p1', points: 40, explanation: 'Старое', occurred_on: '2026-10-01' }];
    fake.db.match_players = [];
    render(<ChildHome player={{ id: 'p1', name: 'Иван', group: 'U9' }} />);
    expect(await screen.findByText('Всего накоплено: 3 балла')).toBeInTheDocument();
    expect(screen.queryByText('Старое')).toBeNull();
    expect(screen.queryByText(/9 баллов/)).toBeNull();
  });
});

describe('ребёнок: свой профиль (#266, П1.2)', () => {
  it('кнопка «Мой профиль» открывает собственный профиль и возвращает назад', async () => {
    fake.db.match_players = [];
    fake.db.players = [{ id: 'p1', full_name: 'Иван', birth_date: null, groups: { name: 'U9' } }];
    fake.rpc.player_training_history = () => [];
    render(<ChildHome player={{ id: 'p1', name: 'Иван', group: 'U9' }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Мой профиль' }));
    expect(await screen.findByRole('tablist', { name: 'Разделы профиля' })).toBeInTheDocument();
    expect(fake.rpcCalls('player_training_history')[0].p).toBe('p1');
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(await screen.findByRole('heading', { name: 'Мои баллы' })).toBeInTheDocument();
  });
});
