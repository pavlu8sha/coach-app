import { describe, expect, it } from 'vitest';

// Правило: любое многострочное поле в приложении можно развернуть на весь экран.
// Поэтому <textarea> допустим только внутри ExpandableTextarea; везде иначе используется он.
const sources = import.meta.glob(['../**/*.tsx', '!../**/*.test.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('многострочные поля', () => {
  it('<textarea> встречается только в ExpandableTextarea', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(20);
    const bad = Object.entries(sources)
      .filter(([f, src]) => !f.endsWith('/ExpandableTextarea.tsx') && /<textarea[\s>]/.test(src))
      .map(([f]) => f);
    expect(bad, 'Используйте <ExpandableTextarea> из src/ui вместо голого <textarea>').toEqual([]);
  });
});
