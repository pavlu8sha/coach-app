// Просмотр фото на весь экран: страница под ним не прокручивается (правка 24.11.2026, docs/EQUIPMENT_CATALOG_ACCEPTANCE.md).
// @ts-expect-error в проекте нет типов node; vitest читает файл напрямую (CSS через ?raw в тестах пустой)
import { readFileSync } from 'node:fs';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ZoomPhoto } from './Lightbox';

describe('Lightbox: фон не скроллится', () => {
  it('пока фото открыто, body без прокрутки; после закрытия прокрутка возвращается', () => {
    render(<ZoomPhoto name="kit-lineup" alt="Фото" />);
    expect(document.body.style.overflow).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Открыть фото: Фото' }));
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(document.body.style.overflow).toBe('');
  });

  it('оверлей в CSS не пропускает вертикальный жест к странице', () => {
    const css: string = readFileSync('src/ui/kit.css', 'utf8');
    const line = css.split('\n').find(l => /^\.ks-lightbox \{/.test(l)) ?? '';
    expect(line).toMatch(/touch-action: none/);
    expect(line).toMatch(/overscroll-behavior: contain/);
  });
});
