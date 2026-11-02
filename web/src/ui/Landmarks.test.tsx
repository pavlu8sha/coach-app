import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Failure, Loading } from '../screens/Message';

// Аудит #244: состояние загрузки не создаёт вложенный основной блок (main в main) и не вешает role=status на main.
describe('Loading', () => {
  it('рендерится не как main, а как блок со статусом', () => {
    const { container } = render(<main><Loading title="Игрок" /></main>);
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(screen.getByRole('status', { name: 'Загрузка' }).tagName).toBe('DIV');
    expect(screen.getByRole('heading', { level: 1, name: 'Игрок' })).toBeInTheDocument();
  });
});

describe('Failure', () => {
  it('внутри другого экрана не создаёт вложенный main', () => {
    const { container } = render(<main><Failure embedded title="Не удалось загрузить" text="Ошибка" onRetry={() => {}} /></main>);
    expect(container.querySelectorAll('main')).toHaveLength(1);
  });
  it('сам по себе остаётся основным блоком страницы', () => {
    const { container } = render(<Failure title="Не удалось загрузить" text="Ошибка" onRetry={() => {}} />);
    expect(container.querySelectorAll('main')).toHaveLength(1);
  });
});
