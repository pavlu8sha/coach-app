import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
import Payments from './Payments';

const IBAN = 'GE11TB7050036080100015';
const BENEFICIARY = 'F.C. Kickstart LLC';

function seed(withKids = true) {
  fake.reset();
  fake.db.player_guardians = withKids ? [{ user_id: 'u', consent_revoked_at: null, players: { id: 'p1', full_name: 'Аня' } }] : [];
  fake.db.payments = [];
  fake.rpc.parent_debts = () => [];
  fake.rpc.parent_dues = () => [];
}

describe('Оплата родителя: реквизиты и правила (#239)', () => {
  beforeEach(() => seed());

  it('показывает четыре реквизита без изменений и все разделы правил', async () => {
    render(<Payments />);

    for (const value of ['JSC TBC Bank', 'TBCBGE22', IBAN, BENEFICIARY]) {
      expect(await screen.findByText(value)).toBeInTheDocument();
    }
    for (const title of ['1. Абонементы', '2. Пропущенные тренировки не компенсируются', '3. Регулярные пропуски без уведомления', '4. Сохранение места при длительном отсутствии']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
    expect(screen.getByText(/с 22-го по 28-е число/)).toBeInTheDocument();
    expect(screen.getByText(/менее 60% тренировок/)).toBeInTheDocument();
    expect(screen.getByText(/оплатив 50% стоимости/)).toBeInTheDocument();
    expect(screen.getByText(/минимум за две недели/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '@coach_siordia' })).toHaveAttribute('href', 'https://t.me/coach_siordia');
    expect(screen.getByText(/Правила и реквизиты обновлены/)).toBeInTheDocument();
  });

  it('копирует IBAN и имя получателя одним нажатием и показывает «Скопировано»', async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t: string) => { written.push(t); } }, configurable: true });
    render(<Payments />);
    await screen.findByText(IBAN);

    fireEvent.click(screen.getByRole('button', { name: /IBAN/ }));
    await waitFor(() => expect(written).toEqual([IBAN]));
    expect(screen.getByRole('button', { name: 'Скопировано' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Name of Beneficiary/ }));
    await waitFor(() => expect(written).toEqual([IBAN, BENEFICIARY]));
  });

  it('реквизиты и правила видны и без привязанного ребёнка', async () => {
    seed(false);
    render(<Payments />);

    expect(await screen.findByText('JSC TBC Bank')).toBeInTheDocument();
    expect(await screen.findByText(/Оплаты появятся, когда администратор подтвердит связь/)).toBeInTheDocument();
  });

  it('родительский экран только читает реквизиты и правила, настроек не меняет', async () => {
    render(<Payments />);
    await screen.findByText(IBAN);

    expect(fake.calls.filter(c => c.kind !== 'rpc')).toHaveLength(0);
    expect(fake.writes('club_settings')).toHaveLength(0);
  });
});
