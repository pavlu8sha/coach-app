// Заставка загрузки: эмблема на белом фоне в тёмной теме (docs/SPLASH_DARK_LOGO_ACCEPTANCE.md).
// @ts-expect-error в проекте нет типов node; vitest читает файл напрямую
import { readFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Splash } from './Message';

const css: string = readFileSync('src/ui/kit.css', 'utf8');

describe('заставка: эмблемы по темам', () => {
  it('п.1, 4: обе эмблемы на месте, заставка подписана для чтения с экрана', () => {
    const { container } = render(<Splash />);
    expect(screen.getByRole('status', { name: 'Загрузка' })).toBeInTheDocument();
    expect(container.querySelector('img.ks-logo-light')?.getAttribute('src')).toBe('/icon-192.png');
    expect(container.querySelector('img.ks-logo-dark')?.getAttribute('src')).toBe('/logo-dark.png');
  });

  it('п.2–3: белая эмблема скрыта по умолчанию и показывается в тёмной теме обоими путями', () => {
    expect(css).toMatch(/\.ks-splash \.ks-logo-dark \{ display: none;/);
    expect(css).toMatch(/prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme='light'\]\) \.ks-splash \.ks-logo-light[^}]*\}\s*:root:not\(\[data-theme='light'\]\) \.ks-splash \.ks-logo-dark \{ display: block; \}/);
    expect(css).toMatch(/:root\[data-theme='dark'\] \.ks-splash \.ks-logo-dark \{ display: block; \}/);
  });
});
