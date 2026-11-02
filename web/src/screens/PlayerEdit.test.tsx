import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fake } from '../test/fakeSupabase';
import PlayerEdit from './PlayerEdit';

const groups = [{ id: 'g1', name: 'U13-C' }, { id: 'g2', name: 'U13-B' }];
const initial = { id: 'p1', full_name: 'Иванов Пётр', birth_date: null, group_id: 'g1', status: 'active' as const };
const open = (onDone = vi.fn()) => {
  render(<PlayerEdit initial={initial} groups={groups} clubId="c1" onDone={onDone} onCancel={() => {}} />);
  return onDone;
};

describe('Данные ребёнка: перевод в другую группу (#261)', () => {
  it('смена группы меняет группу и в абонементе текущего месяца', async () => {
    const onDone = open();
    fireEvent.change(screen.getByLabelText('Группа'), { target: { value: 'g2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(fake.writes('players', 'update')).toEqual([expect.objectContaining({ group_id: 'g2' })]);
    expect(fake.writes('subscriptions', 'update')).toEqual([{ group_id: 'g2' }]);
  });
  it('без смены группы абонемент не трогаем', async () => {
    const onDone = open();
    fireEvent.change(screen.getByLabelText('Фамилия Имя'), { target: { value: 'Иванов Пётр Иванович' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(fake.writes('subscriptions', 'update')).toEqual([]);
  });
  it('если абонемент обновить не удалось, показывается ошибка и форма остаётся', async () => {
    const onDone = open();
    fake.errors.subscriptions = 'boom';
    fireEvent.change(screen.getByLabelText('Группа'), { target: { value: 'g2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText(/обновить не удалось: boom/)).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });
});
