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

// Условия приёмки: docs/acceptance/link-sync-761-2026-11-28.md (условия 12-16)
describe('«Статус привязки»: текст соответствует доступу (#761)', () => {
  const OK = 'Ребёнок привязан и виден на вкладке «Ребёнок».';
  const NOT_SEEN = /Запрос подтверждён, но ребёнок пока не отображается/;
  const seedApproved = () => { fake.db.link_requests = [{ id: 'r3', user_id: 'u', status: 'approved', player_id: 'p3', players: { full_name: 'Иван Петров' } }]; };
  const kidP3 = { player_id: 'p3', full_name: 'Иван Петров', group_id: null, group_name: null };

  it('12: ребёнок есть в my_children (по player_id): «виден на вкладке»', async () => {
    seedApproved();
    fake.rpc.my_children = () => [kidP3];
    render(<LinkStatus onBack={() => {}} />);
    expect(await screen.findByText(OK)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Проверить снова' })).toBeNull();
  });

  it('12: у запроса нет player_id: сверка по имени', async () => {
    fake.db.link_requests = [{ id: 'r3', user_id: 'u', status: 'approved', players: { full_name: 'Иван Петров' } }];
    fake.rpc.my_children = () => [kidP3];
    render(<LinkStatus onBack={() => {}} />);
    expect(await screen.findByText(OK)).toBeInTheDocument();
  });

  it('14: подтверждён, но ребёнка нет: не утверждает «виден», есть «Проверить снова», и он перечитывает данные', async () => {
    seedApproved();
    let visible = false;
    fake.rpc.my_children = () => (visible ? [kidP3] : []);
    render(<LinkStatus onBack={() => {}} />);
    expect(await screen.findByText(NOT_SEEN)).toBeInTheDocument();
    expect(screen.queryByText(OK)).toBeNull();
    visible = true;
    fireEvent.click(screen.getByRole('button', { name: 'Проверить снова' }));
    expect(await screen.findByText(OK)).toBeInTheDocument();
    expect(screen.queryByText(NOT_SEEN)).toBeNull();
  });

  it('другой ребёнок в my_children не подтверждает доступ к этому', async () => {
    seedApproved();
    fake.rpc.my_children = () => [{ player_id: 'p9', full_name: 'Мария Иванова', group_id: null, group_name: null }];
    render(<LinkStatus onBack={() => {}} />);
    expect(await screen.findByText(NOT_SEEN)).toBeInTheDocument();
  });

  it('13: ребёнок ждёт принятия согласия: так и сказано', async () => {
    seedApproved();
    fake.rpc.my_children = () => [];
    fake.rpc.my_pending_consents = () => [{ player_id: 'p3', full_name: 'Иван Петров', group_name: null, version_id: 'v1', version: '1' }];
    render(<LinkStatus onBack={() => {}} />);
    expect(await screen.findByText(/Осталось принять согласие/)).toBeInTheDocument();
    expect(screen.queryByText(OK)).toBeNull();
  });

  it('15: сбой проверки доступа: статусы показаны, у подтверждённого нейтральный текст и «Проверить снова»', async () => {
    seedApproved();
    fake.rpc.my_children = () => ({ error: { message: 'boom' } });
    render(<LinkStatus onBack={() => {}} />);
    expect(await screen.findByText('Подтверждено')).toBeInTheDocument();
    expect(await screen.findByText(/Не удалось проверить, виден ли ребёнок/)).toBeInTheDocument();
    expect(screen.queryByText(OK)).toBeNull();
    expect(document.body.textContent).not.toMatch(/boom/);
    fake.rpc.my_children = () => [kidP3];
    fireEvent.click(screen.getByRole('button', { name: 'Проверить снова' }));
    expect(await screen.findByText(OK)).toBeInTheDocument();
  });

  it('15: сбой проверки согласий тоже не прячет статусы', async () => {
    seedApproved();
    fake.rpc.my_children = () => [];
    fake.rpc.my_pending_consents = () => ({ error: { message: 'boom' } });
    render(<LinkStatus onBack={() => {}} />);
    expect(await screen.findByText('Подтверждено')).toBeInTheDocument();
    expect(await screen.findByText(/Не удалось проверить, виден ли ребёнок/)).toBeInTheDocument();
  });

  it('16: тексты ожидающего и отклонённого запросов не меняются, лишних кнопок нет', async () => {
    seed();
    fake.rpc.my_children = () => [];
    render(<LinkStatus onBack={() => {}} />);
    expect(await screen.findByText(/Администратор клуба проверит запрос/)).toBeInTheDocument();
    expect(screen.getByText('Можно попробовать снова или спросить администратора клуба.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Проверить снова' })).toHaveLength(1); // только у подтверждённого
  });
});

