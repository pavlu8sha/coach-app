// Правки вёрстки по скриншотам 24.11 (docs/UI_SCREENSHOTS_2026-11-26_ACCEPTANCE.md). Стили vitest не считает: правила CSS проверяются по тексту файла.
// @ts-expect-error в проекте нет типов node; vitest читает файлы напрямую
import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useConfirm } from './ConfirmSheet';
import { ListRow } from './components';

const kit: string = readFileSync('src/ui/kit.css', 'utf8');
const css = (selector: string) => kit.split('\n').find(l => l.startsWith(selector)) ?? '';

describe('п.1: поле даты в «Отметках»: пробная правка #812 откатана', () => {
  it('родного оформления (ks-date-native, appearance: auto) нет ни в CSS, ни в экране', () => {
    const sessions: string = readFileSync('src/screens/Sessions.tsx', 'utf8');
    expect(kit).not.toMatch(/ks-date-native/);
    expect(sessions).not.toMatch(/ks-date-native/);
    expect(sessions).toMatch(/className="ks-input" type="date" aria-label="Дата"/);
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
  it('длинное слово без пробела и дефисное слово шире окна переносятся внутри колонки значения', async () => {
    function Long() {
      const { ask, dialog } = useConfirm();
      return (<><button type="button" onClick={() => void ask({ title: 'Удалить?', lines: [['Комментарий', 'я'.repeat(120)], ['Ссылка', 'очень-' + 'длинный-'.repeat(12) + 'хвост']], confirmLabel: 'Да' })}>длинно</button>{dialog}</>);
    }
    render(<Long />);
    fireEvent.click(screen.getByRole('button', { name: 'длинно' }));
    const dialog = await screen.findByRole('dialog');
    const dd = Array.from(dialog.querySelectorAll('dd')) as HTMLElement[];
    expect(dd).toHaveLength(2);
    for (const el of dd) { expect(el.style.minWidth).toBe('0'); expect(el.style.overflowWrap).toBe('anywhere'); }
    expect((dialog.querySelector('dl') as HTMLElement).style.gridTemplateColumns).toBe('auto minmax(0, 1fr)');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Отмена' })); });
  });

  it('слово с дефисом лежит в неразрывной обёртке, текст сохраняется целиком', async () => {
    render(<Probe />);
    fireEvent.click(screen.getByRole('button', { name: 'открыть' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Оплата за визит 23.11.2026 · U7-A');
    const word = screen.getByText('U7-A');
    expect(word.tagName).toBe('SPAN');
    expect((word as HTMLElement).style.display).toBe('inline-block');
    expect((word as HTMLElement).style.maxWidth).toBe('100%');
    expect((word as HTMLElement).style.overflowWrap).toBe('anywhere');
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
    expect(css('.ks-group.ks-group-spaced[open] > summary')).toMatch(/padding-bottom: 8px/);
    expect(kit).not.toMatch(/^\.ks-group\[open\] > summary \{/m);
    expect(kit).toMatch(/@media \(max-width: 380px\) \{ \.ks-row\.ks-row-end-inline \{ flex-wrap: wrap; \}/);
  });
});
