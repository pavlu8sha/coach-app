import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fake } from '../test/fakeSupabase';
import TrialForm from './TrialForm';

// Условия приёмки: docs/acceptance/link-trial-error-handling-2026-11-20.md
const YEAR = new Date().getFullYear();
const fill = () => {
  const t = (p: string, v: string) => fireEvent.change(screen.getByPlaceholderText(p), { target: { value: v } });
  t('Ваше имя', 'Анна');
  t('Имя и фамилия ребёнка', 'Ivan Petrov');
  t('Год рождения ребёнка', String(YEAR - 8));
  t('Телефон', '+995555123456');
  fireEvent.click(screen.getByRole('checkbox'));
};
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Отправить заявку' }));

describe('TrialForm: ошибки отправки', () => {
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { spy = vi.spyOn(console, 'error').mockImplementation(() => undefined); });
  afterEach(() => spy.mockRestore());
  const noRaw = () => expect(document.body.textContent).not.toMatch(/lead_submit_app|SQLSTATE|Failed to fetch|permission denied|42501/);

  it('успех: заявка уходит с теми же полями', async () => {
    fake.rpc.lead_submit_app = () => null;
    render(<TrialForm startOpen />);
    fill();
    submit();
    expect(await screen.findByText('Заявка отправлена')).toBeInTheDocument();
    expect(fake.rpcCalls('lead_submit_app')).toEqual([{ parent: 'Анна', child: 'Ivan Petrov', byear: YEAR - 8, phone: '+995555123456', wish: null, consent: true }]);
  });

  it('известная ошибка показывается прежним понятным текстом', async () => {
    fake.rpc.lead_submit_app = () => ({ error: { message: 'bad phone' } });
    render(<TrialForm startOpen />);
    fill();
    submit();
    expect(await screen.findByText('Проверьте телефон: цифры, можно с «+».')).toBeInTheDocument();
  });

  it('отклонённый Promise: «Нет связи», кнопка доступна, повтор отправляет заявку', async () => {
    fake.rpc.lead_submit_app = () => Promise.reject(new TypeError('Failed to fetch'));
    render(<TrialForm startOpen />);
    fill();
    submit();
    expect(await screen.findByText(/Нет связи/)).toBeInTheDocument();
    noRaw();
    expect(screen.getByRole('button', { name: 'Отправить заявку' })).toBeEnabled();
    expect(screen.getByPlaceholderText('Ваше имя')).toHaveValue('Анна'); // введённое не потеряно
    fake.rpc.lead_submit_app = () => null;
    submit();
    expect(await screen.findByText('Заявка отправлена')).toBeInTheDocument();
    expect(fake.rpcCalls('lead_submit_app')).toHaveLength(2);
  });

  it('неизвестная ошибка базы: общий текст без сырого сообщения, повтор возможен', async () => {
    fake.rpc.lead_submit_app = () => ({ error: { message: 'permission denied for function lead_submit_app (SQLSTATE 42501)' } });
    render(<TrialForm startOpen />);
    fill();
    submit();
    expect(await screen.findByText('Не удалось выполнить действие. Попробуйте ещё раз.')).toBeInTheDocument();
    noRaw();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Отправить заявку' })).toBeEnabled());
  });
});
