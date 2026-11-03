import { describe, expect, it } from 'vitest';
import { articleExcerpt, safeHttpUrl } from './articles';

describe('безопасные ссылки материалов', () => {
  it('принимает только абсолютные http(s)-ссылки', () => {
    expect(safeHttpUrl('https://t.me/fc_kickstart_tbs/1083')).toBe('https://t.me/fc_kickstart_tbs/1083');
    expect(safeHttpUrl(' http://example.com/path ')).toBe('http://example.com/path');
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(safeHttpUrl('mailto:club@example.com')).toBeNull();
    expect(safeHttpUrl('/relative/path')).toBeNull();
    expect(safeHttpUrl('https://example.com/a b')).toBeNull();
    expect(safeHttpUrl('')).toBeNull();
  });
});

describe('краткий текст материала', () => {
  it('схлопывает переводы строк и ограничивает длину', () => {
    expect(articleExcerpt('Первая строка.\n\nВторая строка.')).toBe('Первая строка. Вторая строка.');
    expect(articleExcerpt('abcdef', 4)).toBe('abcd…');
  });
});
