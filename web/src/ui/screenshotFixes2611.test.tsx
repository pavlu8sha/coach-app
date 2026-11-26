// Правки вёрстки по скриншотам 24.11 (docs/UI_SCREENSHOTS_2026-11-26_ACCEPTANCE.md). Стили vitest не считает: правила CSS проверяются по тексту файла.
// @ts-expect-error в проекте нет типов node; vitest читает файлы напрямую
import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useConfirm } from './ConfirmSheet';
import { ListRow } from './components';

const kit: string = readFileSync('src/ui/kit.css', 'utf8');
const css = (selector: string) => kit.split('\n').find(l => l.startsWith(selector)) ?? '';

describe('п.1: поле даты в «Отметках» не шире колонки', () => {
  const rule = css("input[type='date'].ks-date-native");
  it('ширина ограничена колонкой', () => {
    expect(rule).toMatch(/width: 100%/);
    expect(rule).toMatch(/min-width: 0/);
    expect(rule).toMatch(/max-width: 100%/);
  });
});

describe('п.2: «Доп. посещения»: имя гостя на всю строку', () => {
  it('правила: перенос строки и имя на 100% ширины', () => {
    expect(css('.ks-mark.ks-mark-guest {')).toMatch(/flex-wrap: wrap/);
    expect(css('.ks-mark.ks-mark-guest b')).toMatch(/flex: 1 1 100%/);
  });
});

describe('п.6: окно подтверждения не рвёт «U7-A» по дефису', () => {
  function Probe() {
    const { ask, dialog } = useConfirm();
    return (
      <>
        <button type="button" onClick={() => void ask({ title: 'Записать платёж?', lines: [['За что', 'Оплата за визит 23.11.2026 · U7-A'], ['Сумма', '20 ₾']], confirmLabel: 'Записать' })}>открыть</button>
        {dialog}
      </>
    );
  }
  it('слово с дефисом лежит в неразрывной обёртке, текст сохраняется целиком', async () => {
    render(<Probe />);
    fireEvent.click(screen.getByRole('button', { name: 'открыть' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Оплата за визит 23.11.2026 · U7-A');
    const word = screen.getByText('U7-A');
    expect(word.tagName).toBe('SPAN');
    expect((word as HTMLElement).style.whiteSpace).toBe('nowrap');
    expect(screen.getByText('20 ₾').tagName).toBe('B');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Отмена' })); });
  });
});

describe('п.7: плашка суммы в строке с именем', () => {
  it('ListRow endInline добавляет класс; без него класс не ставится', () => {
    const { container, rerender } = render(<ListRow title="Kotov Rodion" end={<span>0 ₾ из 1350 ₾</span>} endInline />);
    expect(container.querySelector('.ks-row')).toHaveClass('ks-row-end-inline');
    rerender(<ListRow title="Kotov Rodion" end={<span>x</span>} />);
    expect(container.querySelector('.ks-row')).not.toHaveClass('ks-row-end-inline');
  });
  it('правила: строка не переносится, плашка не сжимается; заголовок раскрытой группы с отступом', () => {
    expect(css('.ks-row.ks-row-end-inline {')).toMatch(/flex-wrap: nowrap/);
    expect(css('.ks-row.ks-row-end-inline .ks-row-end')).toMatch(/flex: none/);
    expect(css('.ks-group[open] > summary')).toMatch(/padding-bottom: 8px/);
  });
});
