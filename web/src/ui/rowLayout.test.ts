import { describe, expect, it } from 'vitest';
// @ts-expect-error в проекте нет типов node; vitest читает файл напрямую (CSS через ?raw в тестах пустой)
import { readFileSync } from 'node:fs';
const css: string = readFileSync('src/ui/kit.css', 'utf8');

// jsdom не считает раскладку, поэтому проверяем сами правила: строка списка должна
// переносить блок справа под название, а не сжимать название до нулевой ширины.
const rule = (sel: string) => new RegExp(`^${sel.replace('.', '\\.')} \\{([^}]*)\\}`, 'm').exec(css)?.[1] ?? '';

describe('ListRow: вёрстка узкой строки', () => {
  it('строка переносит содержимое', () => {
    expect(rule('.ks-row')).toMatch(/flex-wrap:\s*wrap/);
  });
  it('название не сжимается до нуля', () => {
    expect(rule('.ks-row-main')).toMatch(/flex:\s*1 1 8rem/);
  });
  it('блок справа переносится и не выходит за край', () => {
    const end = rule('.ks-row-end');
    expect(end).toMatch(/flex-wrap:\s*wrap/);
    expect(end).toMatch(/max-width:\s*100%/);
    expect(end).not.toMatch(/flex:\s*none/);
  });
});
