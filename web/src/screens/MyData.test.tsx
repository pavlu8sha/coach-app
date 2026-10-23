import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fake } from '../test/fakeSupabase';
import MyData from './MyData';
import MyKids from './MyKids';

describe('«Мои данные»', () => {
  it('выгружает данные в файл и показывает копию для копирования', async () => {
    fake.rpc.export_my_data = () => ({ account: { display_name: 'Анна' }, children: [] });
    URL.createObjectURL = vi.fn(() => 'blob:test');
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<MyData onBack={() => {}} />);
    fireEvent.click(await screen.findByText('Скачать мои данные'));
    expect(((await screen.findByLabelText('Выгруженные данные')) as HTMLTextAreaElement).value).toContain('"display_name": "Анна"');
    expect(click).toHaveBeenCalled();
    expect(screen.getByText('Скопировать данные')).toBeInTheDocument();
  });

  it('запрос на удаление: подтверждение, затем статус «Запрос отправлен»', async () => {
    fake.db.data_requests = [];
    fake.rpc.request_data_deletion = () => {
      fake.db.data_requests = [{ id: 'd1', kind: 'delete', status: 'open', created_at: '2026-10-23T10:00:00Z', note: null }];
      return 'd1';
    };
    render(<MyData onBack={() => {}} />);
    fireEvent.click(await screen.findByText('Удалить мои данные'));
    expect(fake.rpcCalls('request_data_deletion')).toHaveLength(0); // до подтверждения ничего не уходит
    fireEvent.click(screen.getByText('Отправить запрос'));
    expect(await screen.findByText('Запрос отправлен 23.10.2026')).toBeInTheDocument();
  });

  it('повторный открытый запрос отклоняется понятным сообщением', async () => {
    fake.db.data_requests = [];
    fake.rpc.request_data_deletion = () => ({ error: { message: 'request already open' } });
    render(<MyData onBack={() => {}} />);
    fireEvent.click(await screen.findByText('Удалить мои данные'));
    fireEvent.click(screen.getByText('Отправить запрос'));
    expect(await screen.findByText('Запрос уже отправлен и ждёт обработки.')).toBeInTheDocument();
  });

  it('если запрос уже открыт, кнопки удаления нет', async () => {
    fake.db.data_requests = [{ id: 'd1', kind: 'delete', status: 'open', created_at: '2026-10-23T10:00:00Z', note: null }];
    render(<MyData onBack={() => {}} />);
    expect(await screen.findByText('Запрос отправлен 23.10.2026')).toBeInTheDocument();
    expect(screen.queryByText('Удалить мои данные')).toBeNull();
  });

  it('если функции нет в базе, говорит «пока недоступно»', async () => {
    fake.rpc.export_my_data = () => ({ error: { message: 'Could not find the function public.export_my_data' } });
    render(<MyData onBack={() => {}} />);
    fireEvent.click(await screen.findByText('Скачать мои данные'));
    expect(await screen.findByText('Это действие пока недоступно.')).toBeInTheDocument();
  });
});

describe('«Мои дети»: отзыв согласия', () => {
  it('отзыв только после подтверждения с объяснением последствий', async () => {
    fake.db.player_guardians = [{ user_id: 'u', consent_revoked_at: null, players: { id: 'p1', full_name: 'Иван Петров', groups: { name: 'U9' } } }];
    render(<MyKids onBack={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Отозвать согласие' }));
    expect(screen.getByText(/Ребёнок и все его данные пропадут/)).toBeInTheDocument();
    expect(fake.rpcCalls('revoke_consent')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Отозвать согласие' }));
    await waitFor(() => expect(fake.rpcCalls('revoke_consent')).toEqual([{ p: 'p1' }]));
  });
});
