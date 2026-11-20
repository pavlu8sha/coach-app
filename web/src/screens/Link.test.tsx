import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fake } from '../test/fakeSupabase';
import { CONSENT_VERSION } from '../lib/consent';
import { supabase } from '../lib/supabase';
import Link from './Link';

const search = (q: string) => {
  fireEvent.change(screen.getByLabelText('Фамилия или имя ребёнка'), { target: { value: q } });
  fireEvent.click(screen.getByRole('button', { name: 'Найти' }));
};
const found = [{ player_id: 'p1', full_name: 'Алексей Петров', group_name: 'U10-A' }];

describe('привязка ребёнка', () => {
  it('поиск недоступен, пока введено меньше 3 букв', () => {
    render(<Link />);
    fireEvent.change(screen.getByLabelText('Фамилия или имя ребёнка'), { target: { value: 'Пе' } });
    expect(screen.getByRole('button', { name: 'Найти' })).toBeDisabled();
    expect(screen.getByText(/Введите ещё 1 букву/)).toBeInTheDocument();
  });

  it('выбор → согласие → запрос уходит с версией согласия', async () => {
    fake.rpc.search_players_for_link = () => found;
    fake.rpc.request_link = () => 'r1';
    let opened = 0;
    render(<Link onOpenStatus={() => opened++} />);
    search('Петров');
    fireEvent.click(await screen.findByRole('button', { name: /Алексей Петров/ }));
    const send = screen.getByRole('button', { name: /Отправить запрос/ });
    expect(send).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(send).toBeEnabled();
    fireEvent.click(send);
    await waitFor(() => expect(opened).toBe(1));
    expect(fake.rpcCalls('request_link')).toEqual([{ p: 'p1', consent: CONSENT_VERSION }]);
  });

  it('слишком частый поиск: родитель видит понятное сообщение', async () => {
    fake.rpc.search_players_for_link = () => ({ error: { message: 'search limit reached' } });
    render(<Link />);
    search('Петров');
    expect(await screen.findByText(/Слишком много поисков/)).toBeInTheDocument();
  });

  it('лимит запросов за час: родитель видит понятное сообщение', async () => {
    fake.rpc.search_players_for_link = () => found;
    fake.rpc.request_link = () => ({ error: { message: 'link request limit reached' } });
    render(<Link />);
    search('Петров');
    fireEvent.click(await screen.findByRole('button', { name: /Алексей Петров/ }));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /Отправить запрос/ }));
    expect(await screen.findByText(/Слишком много запросов и отмен за час/)).toBeInTheDocument();
  });

  it('согласия нет до выбора ребёнка', async () => {
    fake.rpc.search_players_for_link = () => found;
    render(<Link />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    search('Петров');
    await screen.findByRole('button', { name: /Алексей Петров/ });
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('подсказка: имя вводится латиницей, порядок слов не важен, плейсхолдер — пример', () => {
    render(<Link />);
    expect(screen.getByText(/латиницей, как в заявке клуба/)).toBeInTheDocument();
    expect(screen.getByText(/Порядок слов не важен/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Ivanov Max')).toBeInTheDocument();
  });

  it('ничего не найдено: напоминает про латиницу и порядок слов', async () => {
    fake.rpc.search_players_for_link = () => [];
    render(<Link />);
    search('Иванов');
    expect(await screen.findByText(/имя и фамилию лучше вводить латиницей, порядок слов не важен/)).toBeInTheDocument();
  });

  it('ничего не найдено: понятное пустое состояние', async () => {
    fake.rpc.search_players_for_link = () => [];
    render(<Link />);
    search('Иванов');
    expect(await screen.findByText('Ничего не найдено')).toBeInTheDocument();
  });

  it('ошибки базы показываются без технического текста', async () => {
    fake.rpc.search_players_for_link = () => found;
    fake.rpc.request_link = () => ({ error: { message: 'too many pending requests' } });
    render(<Link />);
    search('Петров');
    fireEvent.click(await screen.findByRole('button', { name: /Алексей Петров/ }));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /Отправить запрос/ }));
    expect(await screen.findByText(/Слишком много неподтверждённых/)).toBeInTheDocument();
  });

  it('подтверждённый запрос сообщается родителю экрана один раз', async () => {
    fake.db.link_requests = [{ id: 'r1', user_id: 'u', status: 'approved', players: { full_name: 'Алексей Петров' } }];
    let approved = 0;
    const { rerender } = render(<Link onApproved={() => approved++} />);
    await waitFor(() => expect(approved).toBe(1));
    rerender(<Link onApproved={() => approved++} />);
    await new Promise(r => setTimeout(r, 30));
    expect(approved).toBe(1);
  });

  // Условия приёмки: docs/acceptance/link-trial-error-handling-2026-11-20.md
  describe('ошибки и сброс busy', () => {
    let spy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => { spy = vi.spyOn(console, 'error').mockImplementation(() => undefined); });
    afterEach(() => spy.mockRestore());
    const noRaw = () => expect(document.body.textContent).not.toMatch(/search_players_for_link|request_link|SQLSTATE|Failed to fetch|permission denied|42501/);
    const choose = async () => {
      search('Петров');
      fireEvent.click(await screen.findByRole('button', { name: /Алексей Петров/ }));
      fireEvent.click(screen.getByRole('checkbox'));
    };

    it('поиск: отклонённый Promise — «Нет связи», кнопка «Найти» снова доступна, повтор работает', async () => {
      fake.rpc.search_players_for_link = () => Promise.reject(new TypeError('Failed to fetch'));
      render(<Link />);
      search('Петров');
      expect(await screen.findByText(/Нет связи/)).toBeInTheDocument();
      noRaw();
      expect(screen.getByRole('button', { name: 'Найти' })).toBeEnabled();
      fake.rpc.search_players_for_link = () => found;
      fireEvent.click(screen.getByRole('button', { name: 'Найти' }));
      expect(await screen.findByRole('button', { name: /Алексей Петров/ })).toBeInTheDocument();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('поиск: неизвестная ошибка базы — общий текст без сырого сообщения', async () => {
      fake.rpc.search_players_for_link = () => ({ error: { message: 'permission denied for function search_players_for_link (SQLSTATE 42501)' } });
      render(<Link />);
      search('Петров');
      expect(await screen.findByText('Не удалось выполнить действие. Попробуйте ещё раз.')).toBeInTheDocument();
      noRaw();
    });

    it('запрос: отклонённый Promise — сообщение, busy сброшен, повтор отправляет запрос', async () => {
      fake.rpc.search_players_for_link = () => found;
      fake.rpc.request_link = () => Promise.reject(new TypeError('Failed to fetch'));
      render(<Link />);
      await choose();
      fireEvent.click(screen.getByRole('button', { name: /Отправить запрос/ }));
      expect(await screen.findByText(/Нет связи/)).toBeInTheDocument();
      noRaw();
      const again = screen.getByRole('button', { name: /Отправить запрос/ });
      expect(again).toBeEnabled();
      fake.rpc.request_link = () => null;
      fireEvent.click(again);
      await waitFor(() => expect(fake.rpcCalls('request_link')).toHaveLength(2));
      await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    });

    it('запрос: неизвестная ошибка базы — общий текст', async () => {
      fake.rpc.search_players_for_link = () => found;
      fake.rpc.request_link = () => ({ error: { message: 'duplicate key value violates unique constraint "link_requests_pkey"' } });
      render(<Link />);
      await choose();
      fireEvent.click(screen.getByRole('button', { name: /Отправить запрос/ }));
      expect(await screen.findByText('Не удалось выполнить действие. Попробуйте ещё раз.')).toBeInTheDocument();
      expect(document.body.textContent).not.toContain('duplicate key');
    });

    it('загрузка своих запросов: отказ не остаётся необработанным, родитель видит понятное сообщение', async () => {
      const g = vi.spyOn(supabase.auth, 'getUser').mockRejectedValueOnce(new TypeError('Failed to fetch'));
      render(<Link />);
      expect(await screen.findByText(/Нет связи/)).toBeInTheDocument();
      noRaw();
      g.mockRestore();
    });
  });
});
