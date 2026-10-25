import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LinkOnboarding from './LinkOnboarding';
import type { Req } from './LinkStatus';

const req = (status: Req['status']): Req => ({ id: status, status, players: { full_name: 'Алексей Петров' } });
const show = (reqs: Req[]) => {
  const onOpenStatus = vi.fn();
  render(<LinkOnboarding reqs={reqs} onApproved={() => {}} onOpenStatus={onOpenStatus} />);
  return onOpenStatus;
};

describe('родитель без привязанного ребёнка', () => {
  it('нет запросов: три шага и один главный переход к поиску', () => {
    show([]);
    expect(screen.getByRole('heading', { name: 'Подключите профиль ребёнка' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /Статус запросов/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Найти ребёнка' }));
    expect(screen.getByLabelText('Фамилия или имя ребёнка')).toBeInTheDocument();
  });

  it('запрос ждёт: поиск скрыт, повторный запрос не предлагается, есть статус', () => {
    const open = show([req('pending')]);
    expect(screen.getByRole('heading', { name: 'Запрос отправлен' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Фамилия или имя ребёнка')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Найти ребёнка' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Статус запросов/ }));
    expect(open).toHaveBeenCalled();
  });

  it('запрос ждёт: другого ребёнка добавить можно', () => {
    show([req('pending')]);
    fireEvent.click(screen.getByRole('button', { name: 'Добавить другого ребёнка' }));
    expect(screen.getByLabelText('Фамилия или имя ребёнка')).toBeInTheDocument();
  });

  it('запрос отклонён: объяснение, ссылка администратору и поиск снова', () => {
    show([req('rejected')]);
    expect(screen.getByText(/Прошлый запрос был отклонён/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /написать администратору/ })).toHaveAttribute('href', expect.stringContaining('t.me/'));
    expect(screen.getByRole('button', { name: 'Найти ребёнка' })).toBeInTheDocument();
  });

  it('подтверждён, но ребёнка нет: восстановление доступа без зацикливания на поиске', () => {
    show([req('approved')]);
    expect(screen.getByRole('heading', { name: 'Ребёнок пока не отображается' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Найти ребёнка' })).toBeNull();
    expect(screen.getByRole('link', { name: /напишите администратору/ })).toBeInTheDocument();
  });
});
