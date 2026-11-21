import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fake } from '../test/fakeSupabase';
import Debtors from './Debtors';
import Coaches from './Coaches';
import MonthPayments from './MonthPayments';

// Условия приёмки: docs/acceptance/user-errors-everywhere-2026-11-20.md №1: на экранах, которые раньше показывали r.error.message, сырого текста нет.
const RAW = 'permission denied for table players (SQLSTATE 42501) at supabase.co/rest/v1';
const NET = 'TypeError: Failed to fetch';
const NO_RAW = /SQLSTATE|supabase\.co|rest\/v1|Failed to fetch|42P01|relation "/;

describe('экраны не показывают сырые ошибки', () => {
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { spy = vi.spyOn(console, 'error').mockImplementation(() => undefined); });
  afterEach(() => spy.mockRestore());

  it('«Должники»: ошибка базы → «Нет прав…», сбой сети → «Нет связи…»', async () => {
    fake.rpc.debtors = () => ({ error: { message: RAW } });
    const { unmount } = render(<Debtors />);
    expect(await screen.findByText(/Нет прав на это действие/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(NO_RAW);
    unmount();
    fake.rpc.debtors = () => ({ error: { message: NET } });
    render(<Debtors />);
    expect(await screen.findByText(/Нет связи/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(NO_RAW);
  });

  it('«Должники»: неизвестная ошибка → общий текст и «Повторить» работает', async () => {
    fake.rpc.debtors = () => ({ error: { message: 'relation "subscriptions" does not exist (SQLSTATE 42P01)' } });
    render(<Debtors />);
    expect(await screen.findByText('Не удалось выполнить действие. Попробуйте ещё раз.')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(NO_RAW);
    fake.rpc.debtors = () => [];
    fake.db.subscriptions = []; fake.db.clubs = [{ id: 'c1' }]; fake.db.club_settings = [];
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(screen.queryByText('Не удалось выполнить действие. Попробуйте ещё раз.')).toBeNull());
  });

  it('«Тренеры» и «Оплаты за месяц»: ошибка загрузки без сырого текста', async () => {
    fake.errors.coach_groups = RAW; fake.errors.users = RAW; fake.errors.groups = RAW;
    const a = render(<Coaches />);
    await waitFor(() => expect(document.body.textContent).toMatch(/Нет прав на это действие|Не удалось/));
    expect(document.body.textContent).not.toMatch(NO_RAW);
    a.unmount();
    fake.errors = { subscriptions: NET, players: NET, groups: NET, payments: NET };
    render(<MonthPayments />);
    await waitFor(() => expect(document.body.textContent).toMatch(/Нет связи/));
    expect(document.body.textContent).not.toMatch(NO_RAW);
  });
});
