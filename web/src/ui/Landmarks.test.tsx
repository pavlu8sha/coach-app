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

// 23.11.2026: Loading внутри экрана на десктопе сжимался до 78 px. Стили vitest не считает, проверяем, что правило не потеряно.
describe('Loading внутри .page', () => {
  it('kit.css сбрасывает поля и ширину у вложенной .page', async () => {
    // @ts-expect-error в проекте нет типов node; vitest читает файл напрямую (CSS через ?raw в тестах пустой)
    const { readFileSync } = await import('node:fs');
    const css: string = readFileSync('src/ui/kit.css', 'utf8');
    expect(css).toMatch(/\.page > \.page \{[^}]*max-width: none[^}]*margin: 0[^}]*padding: 0/);
  });
});
