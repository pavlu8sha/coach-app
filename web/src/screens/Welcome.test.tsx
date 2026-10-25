import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Welcome from './Welcome';

describe('страница без входа', () => {
  it('предложение, главная кнопка и пример с пометкой; без голов и рейтингов', () => {
    render(<Welcome />);
    expect(screen.getByRole('link', { name: 'Подключиться к школе' })).toHaveAttribute('href', expect.stringContaining('t.me/'));
    expect(screen.getByText('Пример')).toBeInTheDocument();
    expect(screen.getByText('Вымышленные данные')).toBeInTheDocument();
    expect(screen.queryByText(/гол|рейтинг/i)).toBeNull();
    expect(screen.queryByText(/Уже есть аккаунт/)).toBeNull();
  });

  it('«Войти» показывается только когда вход из браузера включён', () => {
    const onLogin = vi.fn();
    render(<Welcome onLogin={onLogin} />);
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    expect(onLogin).toHaveBeenCalled();
  });
});
