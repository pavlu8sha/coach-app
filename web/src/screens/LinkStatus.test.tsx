import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fake } from '../test/fakeSupabase';
import { supabase } from '../lib/supabase';
import LinkStatus from './LinkStatus';

function seed() {
  fake.db.link_requests = [
    { id: 'r1', user_id: 'u', status: 'pending', players: { full_name: 'Алексей Петров' } },
    { id: 'r2', user_id: 'u', status: 'rejected', players: { full_name: 'Мария Петрова' } },
    { id: 'r3', user_id: 'u', status: 'approved', players: { full_name: 'Иван Петров' } },
  ];
}

describe('«Статус привязки»', () => {
  it('показывает статусы и действия только там, где они возможны', async () => {
    seed();
    render(<LinkStatus onBack={() => {}} />);
    expect(await screen.findByText('Ждёт подтверждения')).toBeInTheDocument();
    expect(screen.getByText('Подтверждено')).toBeInTheDocument();
    expect(screen.getByText('Отклонено')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Отменить запрос' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Попробовать снова' })).toHaveLength(1);
  });

  it('отмена запроса требует подтверждения', async () => {
    seed();
    render(<LinkStatus onBack={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Отменить запрос' }));
    expect(fake.rpcCalls('cancel_link')).toHaveLength(0);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Отмена' }));
    expect(fake.rpcCalls('cancel_link')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Отменить запрос' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Отменить запрос' }));
    await waitFor(() => expect(fake.rpcCalls('cancel_link')).toEqual([{ r: 'r1' }]));
  });

  it('повтор отклонённого: понятное сообщение, если ещё рано', async () => {
    seed();
    fake.rpc.retry_link = () => ({ error: { message: 'retry too soon' } });
    render(<LinkStatus onBack={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Попробовать снова' }));
    expect(await screen.findByText(/не раньше чем через сутки/)).toBeInTheDocument();
    expect(fake.rpcCalls('retry_link')).toEqual([{ r: 'r2' }]);
  });

  it('если функция ещё не установлена в базе, не показывает техническую ошибку', async () => {
    seed();
    fake.rpc.cancel_link = () => ({ error: { message: 'Could not find the function public.cancel_link' } });
    render(<LinkStatus onBack={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Отменить запрос' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Отменить запрос' }));
    expect(await screen.findByText('Это действие пока недоступно.')).toBeInTheDocument();
  });

  it('при ошибке загрузки есть кнопка «Повторить»', async () => {
    fake.errors.link_requests = 'connection reset by peer (SQLSTATE 08006)';
    render(<LinkStatus onBack={() => {}} />);
    expect(await screen.findByText('Не удалось выполнить действие. Попробуйте ещё раз.')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/SQLSTATE|connection reset/);
    delete fake.errors.link_requests;
    fake.db.link_requests = [];
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Запросов пока нет')).toBeInTheDocument();
  });

  // Условия приёмки: docs/acceptance/link-trial-error-handling-2026-11-20.md
  describe('ошибки и сброс busy', () => {
    let spy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => { spy = vi.spyOn(console, 'error').mockImplementation(() => undefined); });
    afterEach(() => spy.mockRestore());

    it('повтор: отклонённый Promise — «Нет связи», кнопка снова доступна, повторное нажатие работает', async () => {
      seed();
      fake.rpc.retry_link = () => Promise.reject(new TypeError('Failed to fetch'));
      render(<LinkStatus onBack={() => {}} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Попробовать снова' }));
      expect(await screen.findByText(/Нет связи/)).toBeInTheDocument();
      expect(document.body.textContent).not.toMatch(/retry_link|Failed to fetch/);
      const again = await screen.findByRole('button', { name: 'Попробовать снова' });
      expect(again).toBeEnabled();
      fake.rpc.retry_link = () => null;
      fireEvent.click(again);
      await waitFor(() => expect(fake.rpcCalls('retry_link')).toHaveLength(2));
    });

    it('отмена: неизвестная ошибка базы — общий текст без сырого сообщения', async () => {
      seed();
      fake.rpc.cancel_link = () => ({ error: { message: 'deadlock detected (SQLSTATE 40P01) in cancel_link' } });
      render(<LinkStatus onBack={() => {}} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Отменить запрос' }));
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Отменить запрос' }));
      expect(await screen.findByText('Не удалось выполнить действие. Попробуйте ещё раз.')).toBeInTheDocument();
      expect(document.body.textContent).not.toMatch(/deadlock|SQLSTATE|cancel_link/);
    });

    it('загрузка: отклонённый Promise — сообщение и «Повторить», без необработанного отказа', async () => {
      seed();
      const g = vi.spyOn(supabase.auth, 'getUser').mockRejectedValueOnce(new TypeError('Failed to fetch'));
      render(<LinkStatus onBack={() => {}} />);
      expect(await screen.findByText(/Нет связи/)).toBeInTheDocument();
      expect(document.body.textContent).not.toContain('Failed to fetch');
      g.mockRestore();
      fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
      expect(await screen.findByText('Алексей Петров')).toBeInTheDocument();
    });
  });
});
