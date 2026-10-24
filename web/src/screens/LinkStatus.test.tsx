import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '../test/fakeSupabase';
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
    fireEvent.click(await screen.findByRole('button', { name: 'Не отменять' }));
    expect(fake.rpcCalls('cancel_link')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Отменить запрос' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Отменить запрос' }));
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
    fireEvent.click(await screen.findByRole('button', { name: 'Отменить запрос' }));
    expect(await screen.findByText('Это действие пока недоступно.')).toBeInTheDocument();
  });

  it('при ошибке загрузки есть кнопка «Повторить»', async () => {
    fake.errors.link_requests = 'нет связи';
    render(<LinkStatus onBack={() => {}} />);
    expect(await screen.findByText('нет связи')).toBeInTheDocument();
    delete fake.errors.link_requests;
    fake.db.link_requests = [];
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Запросов пока нет')).toBeInTheDocument();
  });
});
