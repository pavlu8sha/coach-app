import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fake } from '../test/fakeSupabase';
import Payments from './Payments';

// дата фиксирована: «Платил/Платит за визит» зависит от сегодняшней даты
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date(2026, 11, 15, 12, 0, 0));

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

// Условия приёмки: docs/PARENT_VISITS_PAYMENTS_ACCEPTANCE.md
describe('Оплата родителя: ребёнок на оплате за визит', () => {
  const visit = (on: string, paid: number, group = 'U9-A') => ({ player_id: 'p1', kind: 'own_visit', title: `Оплата за визит: ${group}`, on_date: on, due: 20, paid, debt: 20 - paid });
  beforeEach(() => { seed(); });

  it('показывает статус «Платит за визит с…» и визиты по месяцам; неоплаченные остаются в «К оплате», оплаченные не дублируются', async () => {
    fake.db.players = [{ id: 'p1', pay_mode: 'per_visit', pay_mode_from: '2026-11-01', pay_mode_until: null }];
    fake.rpc.parent_dues = () => [visit('2026-11-04', 20), visit('2026-11-06', 20), visit('2026-11-11', 0), visit('2026-11-13', 0), visit('2026-10-30', 20)];
    render(<Payments />);
    expect(await screen.findByText('Платит за визит с 01.11.2026')).toBeInTheDocument();
    expect(screen.getByText('Визиты · Ноябрь 2026 г.')).toBeInTheDocument();
    expect(screen.getByText('4 визита, начислено 80 ₾')).toBeInTheDocument();
    expect(screen.getByText('40 из 80 ₾')).toBeInTheDocument();
    expect(screen.getByText('Визиты · Октябрь 2026 г.')).toBeInTheDocument();
    expect(screen.getByText('1 визит, начислено 20 ₾')).toBeInTheDocument();
    expect(screen.getByText('20 ₾', { selector: '.ks-slot *' })).toBeInTheDocument();
    expect(screen.getByText('К оплате: 40 ₾')).toBeInTheDocument();
    expect(screen.queryByText('Оплаты по другим видам')).not.toBeInTheDocument();
  });

  it('склонение: 2, 5 и 21 визит', async () => {
    fake.db.players = [{ id: 'p1', pay_mode: 'per_visit', pay_mode_from: '2026-09-01', pay_mode_until: null }];
    const many = (n: number, month: string) => Array.from({ length: n }, (_, i) => visit(`${month}-${String(i + 1).padStart(2, '0')}`, 20));
    fake.rpc.parent_dues = () => [...many(2, '2026-09'), ...many(5, '2026-10'), ...many(21, '2026-11')];
    render(<Payments />);
    expect(await screen.findByText('2 визита, начислено 40 ₾')).toBeInTheDocument();
    expect(screen.getByText('5 визитов, начислено 100 ₾')).toBeInTheDocument();
    expect(screen.getByText('21 визит, начислено 420 ₾')).toBeInTheDocument();
  });

  it('вернулся на абонемент: «Платил за визит с … до …, дальше абонемент»; назначенный возврат — «Платит за визит до …»', async () => {
    fake.db.players = [{ id: 'p1', pay_mode: 'subscription', pay_mode_from: '2026-11-01', pay_mode_until: '2026-12-01' }];
    fake.rpc.parent_dues = () => [visit('2026-11-04', 20)];
    const { unmount } = render(<Payments />);
    expect(await screen.findByText('Платил за визит с 01.11.2026 до 01.12.2026, дальше абонемент')).toBeInTheDocument();
    unmount();
    fake.db.players = [{ id: 'p1', pay_mode: 'subscription', pay_mode_from: '2026-11-01', pay_mode_until: '2999-01-01' }];
    render(<Payments />);
    expect(await screen.findByText('Платит за визит до 01.01.2999, дальше абонемент')).toBeInTheDocument();
  });

  it('ребёнок на абонементе: блока визитов и статуса нет, экран прежний', async () => {
    fake.db.players = [{ id: 'p1', pay_mode: 'subscription', pay_mode_from: null, pay_mode_until: null }];
    render(<Payments />);
    await screen.findByText('Аня');
    expect(screen.queryByText(/Платит за визит|Платил за визит/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Визиты · /)).not.toBeInTheDocument();
  });

  it('сбой чтения типа оплаты: предупреждение с «Повторить», а не «нет оплаты за визит»', async () => {
    fake.errors.players = 'connection lost';
    render(<Payments />);
    expect(await screen.findByText('Не удалось загрузить задолженность')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторить загрузку' })).toBeInTheDocument();
  });
});
