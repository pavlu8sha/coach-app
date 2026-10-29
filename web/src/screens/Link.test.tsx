import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
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
    expect(fake.rpcCalls('request_link')).toEqual([{ p: 'p1', consent: expect.stringMatching(/^draft-/) }]);
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
});
