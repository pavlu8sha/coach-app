import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import Group from './Group';

const groups = [{ id: 'g1', name: 'U9' }];
function seed() {
  fake.db.players = [{ id: 'p1', full_name: 'Иванов Пётр', group_id: 'g1', status: 'active' }];
  fake.db.point_events = [
    { id: 'e1', player_id: 'p1', points: 1, explanation: 'Пришёл на тренировку', occurred_on: '2026-10-19', source_type: 'session' },
    { id: 'e2', player_id: 'p1', points: 3, explanation: 'Отлично играл', occurred_on: '2026-10-20', source_type: 'coach' },
  ];
  fake.rpc.group_parents = () => [{ player_id: 'p1', parent_name: 'Мама Пети', telegram_id: 4242 }];
  fake.rpc.award_bonus = () => 'e3';
}
const open = async () => {
  render(<Group groups={groups} />);
  fireEvent.click(await screen.findByText('Иванов Пётр'));
  await screen.findByText('Ручные баллы');
};

describe('карточка игрока', () => {
  it('показывает сумму баллов и контакт родителя со ссылкой на Telegram', async () => {
    seed();
    await open();
    expect(screen.getByText(/Всего: 4 балла/)).toBeInTheDocument();
    expect(await screen.findByText('Мама Пети')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Написать в Telegram' })).toHaveAttribute('href', 'tg://user?id=4242');
  });

  it('если функции контактов нет или нет прав, контакты не показываются', async () => {
    seed();
    fake.rpc.group_parents = () => ({ error: { message: 'forbidden' } });
    await open();
    expect(await screen.findByText('Контакты недоступны.')).toBeInTheDocument();
  });

  it('ручные баллы: без комментария нельзя, с комментарием уходит выбранное число', async () => {
    seed();
    await open();
    expect(screen.getByRole('button', { name: 'Начислить' })).toBeDisabled();
    fireEvent.click(screen.getByRole('tab', { name: '+3' }));
    fireEvent.change(screen.getByLabelText(/За что/), { target: { value: ' Отлично в защите ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Начислить' }));
    await waitFor(() => expect(fake.rpcCalls('award_bonus')).toEqual([{ p: 'p1', pts: 3, note: ' Отлично в защите ' }]));
    expect(await screen.findByText('Баллы начислены.')).toBeInTheDocument();
  });

  it('ошибку функции показывает по-русски', async () => {
    seed();
    fake.rpc.award_bonus = () => ({ error: { message: 'note required' } });
    await open();
    fireEvent.change(screen.getByLabelText(/За что/), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Начислить' }));
    expect(await screen.findByText('Напишите, за что баллы.')).toBeInTheDocument();
  });

  it('отменить можно только ручное начисление, и только после подтверждения', async () => {
    seed();
    await open();
    const cancels = screen.getAllByRole('button', { name: 'Отменить' });
    expect(cancels).toHaveLength(1); // у автоначисления кнопки нет
    fireEvent.click(cancels[0]);
    expect(fake.rpcCalls('revoke_bonus')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Отменить начисление' }));
    await waitFor(() => expect(fake.rpcCalls('revoke_bonus')).toEqual([{ e: 'e2' }]));
  });
});
