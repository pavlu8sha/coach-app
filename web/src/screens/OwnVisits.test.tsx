import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import { today } from '../lib/coach';
import OwnVisits, { ATTENDANCE_SAVED } from './OwnVisits';

// Условия приёмки: docs/PAY_PER_VISIT_ACCEPTANCE.md, п. 12 (экран «Отметки»: оплата за визит)
const visit = (over: Record<string, unknown> = {}) => ({ session_id: 'sid-1', player_id: 'p1', amount: 20, paid: false, paid_amount: null, method: null, players: { full_name: 'Иванов Пётр' }, ...over });
beforeEach(() => {
  fake.db.sessions = [{ id: 'sid-1', group_id: 'g1', source_key: `ATT|${today()}` }];
  fake.db.own_visits = [];
  fake.rpc.own_visit_set_paid = () => null;
});

describe('«Оплата за визит»', () => {
  it('без визитов блок не показывается', async () => {
    const { container } = render(<OwnVisits gid="g1" date={today()} />);
    await waitFor(() => expect(container.querySelector('section')).toBeNull());
  });

  it('визит показан с суммой и долгом; оплата с подтверждением идёт через own_visit_set_paid', async () => {
    fake.db.own_visits = [visit()];
    render(<OwnVisits gid="g1" date={today()} />);
    expect(await screen.findByText('Иванов Пётр')).toBeInTheDocument();
    expect(screen.getByText('20 ₾')).toBeInTheDocument();
    expect(screen.getByText('Не оплачено')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Перевод' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Принять оплату' }));
    await waitFor(() => expect(fake.rpcCalls('own_visit_set_paid')).toEqual([{ s: 'sid-1', p: 'p1', is_paid: true, mth: 'Перевод' }]));
  });

  it('оплаченный визит: статус со способом, отмену оплаты видит только администратор', async () => {
    fake.db.own_visits = [visit({ paid: true, paid_amount: 20, method: 'Наличные' })];
    const { unmount } = render(<OwnVisits gid="g1" date={today()} />);
    expect(await screen.findByText('Оплачено (Наличные)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Отменить оплату' })).not.toBeInTheDocument();
    unmount();
    render(<OwnVisits gid="g1" date={today()} admin />);
    fireEvent.click(await screen.findByRole('button', { name: 'Отменить оплату' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Отменить оплату' }));
    await waitFor(() => expect(fake.rpcCalls('own_visit_set_paid')).toEqual([{ s: 'sid-1', p: 'p1', is_paid: false }]));
  });

  it('после сохранения отметок список обновляется', async () => {
    render(<OwnVisits gid="g1" date={today()} />);
    await waitFor(() => expect(screen.queryByText('Иванов Пётр')).not.toBeInTheDocument());
    fake.db.own_visits = [visit()];
    window.dispatchEvent(new Event(ATTENDANCE_SAVED));
    expect(await screen.findByText('Иванов Пётр')).toBeInTheDocument();
  });
});
