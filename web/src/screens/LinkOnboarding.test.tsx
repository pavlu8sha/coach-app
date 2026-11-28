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

  it('нет запросов: «Просто посмотреть клуб» только если передан обработчик', () => {
    const onGuest = vi.fn();
    const { unmount } = render(<LinkOnboarding reqs={[]} onApproved={() => {}} onOpenStatus={() => {}} onGuest={onGuest} />);
    fireEvent.click(screen.getByRole('button', { name: 'Просто посмотреть клуб' }));
    expect(onGuest).toHaveBeenCalled();
    unmount();
    show([]);
    expect(screen.queryByRole('button', { name: 'Просто посмотреть клуб' })).toBeNull();
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

  // Условия приёмки: docs/acceptance/link-sync-761-2026-11-28.md (условия 10-11)
  describe('approved без ребёнка: повторная проверка (#761)', () => {
    it('нет совета перезапускать приложение; кнопка «Проверить снова» вызывает обновление', () => {
      const onRetry = vi.fn();
      render(<LinkOnboarding reqs={[req('approved')]} onApproved={() => {}} onOpenStatus={() => {}} onRetry={onRetry} />);
      expect(document.body.textContent).not.toMatch(/Закройте приложение/);
      expect(screen.queryByText(/Проверили:/)).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Проверить снова' }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('пока идёт проверка: «Проверяю…», кнопка недоступна; после проверки без результата сообщается об этом', () => {
      const onRetry = vi.fn();
      const view = (checking: boolean, checks: number) => <LinkOnboarding reqs={[req('approved')]} onApproved={() => {}} onOpenStatus={() => {}} onRetry={onRetry} checking={checking} checks={checks} />;
      const { rerender } = render(view(false, 1));
      expect(screen.queryByText(/Проверили:/)).toBeNull(); // загрузка до нажатия сообщения не вызывает
      fireEvent.click(screen.getByRole('button', { name: 'Проверить снова' }));
      rerender(view(true, 1));
      expect(screen.getByRole('button', { name: 'Проверяю…' })).toBeDisabled();
      expect(screen.queryByText(/Проверили:/)).toBeNull();
      rerender(view(false, 2));
      expect(screen.getByRole('status')).toHaveTextContent('Проверили: ребёнок пока не отображается.');
      expect(screen.getByRole('button', { name: 'Проверить снова' })).toBeEnabled();
    });

    it('проверка завершилась до отрисовки «Проверяю…» (быстрый ответ): сообщение всё равно показывается', () => {
      const view = (checks: number) => <LinkOnboarding reqs={[req('approved')]} onApproved={() => {}} onOpenStatus={() => {}} onRetry={() => {}} checks={checks} />;
      const { rerender } = render(view(3));
      fireEvent.click(screen.getByRole('button', { name: 'Проверить снова' }));
      rerender(view(4));
      expect(screen.getByRole('status')).toHaveTextContent('Проверили: ребёнок пока не отображается.');
    });

    it('без обработчика кнопки нет, остальные состояния не меняются', () => {
      show([req('approved')]);
      expect(screen.queryByRole('button', { name: /Проверить снова/ })).toBeNull();
      expect(screen.getByRole('heading', { name: 'Ребёнок пока не отображается' })).toBeInTheDocument();
    });
  });

  describe('поиск как запись стека (#732)', () => {
    const back = () => screen.queryByRole('button', { name: 'Назад' });
    const cases: [string, Req[], string][] = [
      ['обзор шагов', [], 'Найти ребёнка'],
      ['запрос отправлен', [req('pending')], 'Добавить другого ребёнка'],
      ['ребёнок не отображается', [req('approved')], 'Найти другого ребёнка'],
    ];
    it.each(cases)('%s: «Назад» возвращает к шагу, поиск открывается снова', (_n, reqs, action) => {
      show(reqs);
      expect(back()).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: action }));
      expect(screen.getByLabelText('Фамилия или имя ребёнка')).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Фамилия или имя ребёнка'), { target: { value: 'Иван' } });
      fireEvent.click(back()!);
      expect(screen.queryByLabelText('Фамилия или имя ребёнка')).toBeNull();
      expect(screen.getByRole('button', { name: action })).toBeInTheDocument();
      expect(back()).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: action }));
      expect(screen.getByLabelText('Фамилия или имя ребёнка')).toHaveValue('');
    });
  });
});
