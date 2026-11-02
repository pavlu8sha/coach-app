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

describe('Правила обработки данных', () => {
  it('заголовок экрана — h1, разделы — h2', async () => {
    const Privacy = (await import('../screens/Privacy')).default;
    render(<Privacy onBack={() => {}} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Политика конфиденциальности' })).toBeInTheDocument();
    expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0);
  });
});

describe('Заявка на пробную', () => {
  it('отдельным экраном заголовок — h1, во встроенной карточке — h2', async () => {
    const TrialForm = (await import('../screens/TrialForm')).default;
    const a = render(<TrialForm startOpen />);
    expect(screen.getByRole('heading', { level: 1, name: 'Запись на пробную тренировку' })).toBeInTheDocument();
    a.unmount();
    render(<TrialForm />);
    expect(screen.getByRole('heading', { level: 2, name: 'Записаться на пробную тренировку' })).toBeInTheDocument();
  });
});
