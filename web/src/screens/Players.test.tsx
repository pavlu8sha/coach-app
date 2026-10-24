import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import { today } from '../lib/coach';
import Players from './Players';

const month = today().slice(0, 7) + '-01';
function seed() {
  fake.db.groups = [{ id: 'g1', name: 'U10-B', club_id: 'c1' }, { id: 'g2', name: 'U7-A', club_id: 'c1' }];
  fake.db.players = [
    { id: 'p1', full_name: 'Amodeo Nolan', group_id: 'g1', birth_date: '2016-09-05', status: 'active', external_id: 'KS-0002' },
    { id: 'p2', full_name: 'Andreev Boris', group_id: 'g2', birth_date: '2020-02-15', status: 'active', external_id: 'KS-0004' },
    { id: 'p3', full_name: 'Старый Игрок', group_id: 'g2', birth_date: null, status: 'inactive', external_id: 'KS-0009' },
  ];
  fake.db.prices = [{ group_id: null, amount: 165, valid_from: '2026-01-01', valid_to: null, kind: 'subscription' }];
  fake.db.payments = [{ player_id: 'p1', amount: 165, paid_on: month }];
  fake.db.subscriptions = [];
}

describe('«Игроки»', () => {
  it('показывает игроков со статусом оплаты за месяц; неактивных по умолчанию нет', async () => {
    seed();
    render(<Players />);
    expect(await screen.findByText('Amodeo Nolan')).toBeInTheDocument();
    expect(screen.getByText('Оплачено')).toBeInTheDocument();
    expect(screen.getByText('Не платил')).toBeInTheDocument();
    expect(screen.queryByText('Старый Игрок')).not.toBeInTheDocument();
  });

  it('ищет по ID и фильтрует по году рождения', async () => {
    seed();
    render(<Players />);
    await screen.findByText('Amodeo Nolan');
    fireEvent.change(screen.getByLabelText('Поиск игроков'), { target: { value: 'KS-0004' } });
    expect(screen.queryByText('Amodeo Nolan')).not.toBeInTheDocument();
    expect(screen.getByText('Andreev Boris')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Поиск игроков'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '2016' }));
    expect(screen.getByText('Amodeo Nolan')).toBeInTheDocument();
    expect(screen.queryByText('Andreev Boris')).not.toBeInTheDocument();
  });

  it('«Только не оплатившие» оставляет должников', async () => {
    seed();
    render(<Players />);
    await screen.findByText('Amodeo Nolan');
    fireEvent.click(screen.getByRole('switch', { name: 'Только не оплатившие' }));
    expect(screen.queryByText('Amodeo Nolan')).not.toBeInTheDocument();
    expect(screen.getByText('Andreev Boris')).toBeInTheDocument();
  });

  it('фильтр статуса показывает неактивных', async () => {
    seed();
    render(<Players />);
    await screen.findByText('Amodeo Nolan');
    fireEvent.change(screen.getByLabelText('Статус'), { target: { value: 'inactive' } });
    const row = screen.getByText('Старый Игрок').closest('button')!;
    expect(within(row).getByText('Не занимается')).toBeInTheDocument();
  });
});
