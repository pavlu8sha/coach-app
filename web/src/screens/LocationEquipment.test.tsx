import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import LocationEquipment from './LocationEquipment';

const order = (id: string, name: string, group: string, issued: string[] = []) => ({
  id, ordered_on: '2026-10-10', location: 'Isani',
  players: { full_name: name, groups: { name: group } },
  equipment_order_lines: [{ kit: 'Игровая форма', size: '128', quantity: 1 }, { kit: 'Куртка', size: 'L', quantity: 1 }],
  equipment_issues: issued.map(kit => ({ kit, issued_on: '2026-10-20', issued_by: 'Админ' })),
});

describe('Выдача формы локальным админом', () => {
  beforeEach(() => {
    fake.reset();
    fake.db.equipment_orders = [order('o1', 'Иванов Пётр', 'Isani'), order('o2', 'Сидоров Ян', 'Ortachala U9', ['Игровая форма', 'Куртка'])];
  });

  it('по умолчанию показывает только невыданные заказы, «Все заказы» — все', async () => {
    render(<LocationEquipment />);
    expect(await screen.findByText('Иванов Пётр')).toBeInTheDocument();
    expect(screen.queryByText('Сидоров Ян')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Все заказы' }));
    expect(screen.getByText('Сидоров Ян')).toBeInTheDocument();
  });

  it('#471 Ф9: отменённые заказы локальному админу не показываются даже во «Всех заказах»', async () => {
    (fake.db.equipment_orders as Record<string, unknown>[]).push({ ...order('o9', 'Отменов Лев', 'Isani'), status: 'cancelled' });
    render(<LocationEquipment />);
    expect(await screen.findByText('Иванов Пётр')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Все заказы' }));
    expect(screen.queryByText('Отменов Лев')).not.toBeInTheDocument();
  });

  it('отмечает выдачу комплекта после подтверждения; кнопки «снять» нет', async () => {
    fake.rpc.eq_set_issued = () => null;
    render(<LocationEquipment />);
    fireEvent.click(await screen.findByText('Иванов Пётр'));
    fireEvent.click((await screen.findAllByRole('button', { name: 'Отметить выдачу' }))[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Выдано' }));
    await waitFor(() => expect(fake.rpcCalls('eq_set_issued')[0]).toMatchObject({ o: 'o1', k: 'Игровая форма', on_: true }));
    expect(screen.queryByRole('button', { name: /Снять выдачу/ })).not.toBeInTheDocument();
  });

  it('при отказе базы показывает понятную ошибку', async () => {
    fake.rpc.eq_set_issued = () => ({ data: null, error: { message: 'forbidden' } });
    render(<LocationEquipment />);
    fireEvent.click(await screen.findByText('Иванов Пётр'));
    fireEvent.click((await screen.findAllByRole('button', { name: 'Отметить выдачу' }))[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Выдано' }));
    expect(await screen.findByText('Нет прав отметить выдачу этого заказа.')).toBeInTheDocument();
  });
});
