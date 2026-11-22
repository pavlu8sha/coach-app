import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
// @ts-expect-error в проекте нет типов node; vitest читает файл напрямую (CSS через ?raw в тестах пустой)
import { readFileSync } from 'node:fs';
import { Segmented } from './components';

const css: string = readFileSync('src/ui/kit.css', 'utf8');

// jsdom не считает раскладку, поэтому проверяем разметку и сами правила; реальный рендер проверен в Chromium и владельцем на iPhone.
describe('Правки вёрстки по скриншотам (часть 3)', () => {
  it('переключатель из двух пунктов получает класс pair: две равные колонки, подпись переносится', () => {
    render(<Segmented label="Кому" value="a" onChange={() => {}} items={[{ value: 'a', label: 'Записанным на сбор' }, { value: 'b', label: 'Всем родителям клуба' }]} />);
    expect(screen.getByRole('tablist', { name: 'Кому' }).className).toContain('pair');
    expect(css).toMatch(/\.ks-seg\.pair \{[^}]*repeat\(2, minmax\(0, 1fr\)\)[^}]*overflow-x: visible/);
    expect(css).toMatch(/\.ks-seg\.pair button \{[^}]*white-space: normal/);
  });
  it('переключатель из трёх пунктов остаётся прежним', () => {
    render(<Segmented label="Три" value="a" onChange={() => {}} items={[{ value: 'a', label: 'А' }, { value: 'b', label: 'Б' }, { value: 'c', label: 'В' }]} />);
    expect(screen.getByRole('tablist', { name: 'Три' }).className).toBe('ks-seg');
  });
  it('строка с меню «⋯» поднимается над соседями, включая обёртку прямого ребёнка .page', () => {
    expect(css).toMatch(/\.ks-row:has\(\.ks-more-menu\)[^{]*\.page > :has\(\.ks-more-menu\) \{[^}]*position: relative[^}]*z-index: 50/);
  });
});

describe('Переключатель с wrap (рассылки сбора)', () => {
  it('три длинные подписи: класс many, подпись переносится внутри кнопки', () => {
    render(<Segmented wrap label="Вид" value="a" onChange={() => {}} items={[{ value: 'a', label: 'Записанным на сбор' }, { value: 'b', label: 'Всем родителям клуба' }, { value: 'c', label: 'Напоминание об оплате' }]} />);
    expect(screen.getByRole('tablist', { name: 'Вид' }).className).toContain('many');
    expect(css).toMatch(/\.ks-seg\.many button \{[^}]*white-space: normal/);
  });
});
