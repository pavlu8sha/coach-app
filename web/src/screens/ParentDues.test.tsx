import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import Payments from './Payments';

describe('Оплата у родителя: все виды', () => {
  it('долг по экипировке и занятиям входит в «К оплате», оплаченное видно в «Других оплатах»', async () => {
    fake.db.player_guardians = [{ user_id: 'u', consent_revoked_at: null, players: { id: 'p1', full_name: 'Аня' } }];
    fake.db.payments = [];
    fake.rpc.parent_debts = () => [{ player_id: 'p1', month: '2026-10-01', tariff: 165, paid: 65, debt: 100 }];
    fake.rpc.parent_dues = () => [
      { player_id: 'p1', kind: 'eq', title: 'Форма', on_date: '2026-09-10', due: 160, paid: 60, debt: 100 },
      { player_id: 'p1', kind: 'extra', title: 'Дополнительная тренировка', on_date: '2026-10-17', due: 20, paid: 20, debt: 0 },
    ];
    render(<Payments />);
    expect(await screen.findByText('К оплате: 200 ₾')).toBeInTheDocument();
    expect(screen.getAllByText(/Форма · 10.09.2026/).length).toBeGreaterThan(0);
    expect(screen.getByText('Оплаты по другим видам')).toBeInTheDocument();
    expect(screen.getByText(/Дополнительная тренировка · 17.10.2026/)).toBeInTheDocument();
  });

  it('разовое посещение другой группы показано отдельным видом, долг входит в «К оплате»', async () => {
    fake.db.player_guardians = [{ user_id: 'u', consent_revoked_at: null, players: { id: 'p1', full_name: 'Тимофей' } }];
    fake.db.payments = [];
    fake.rpc.parent_debts = () => [];
    fake.rpc.parent_dues = () => [
      { player_id: 'p1', kind: 'visit', title: 'Разовое посещение: U9-B', on_date: '2026-11-11', due: 15, paid: 0, debt: 15 },
    ];
    render(<Payments />);
    expect(await screen.findByText('К оплате: 15 ₾')).toBeInTheDocument();
    expect(screen.getByText(/Разовое посещение: U9-B · 11.11.2026/)).toBeInTheDocument();
    expect(screen.getByText(/Разовые посещения · внесено 0 ₾ из 15 ₾/)).toBeInTheDocument();
  });
});
