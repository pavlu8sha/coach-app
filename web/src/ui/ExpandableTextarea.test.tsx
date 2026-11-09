import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ExpandableTextarea } from './ExpandableTextarea';

function Host() {
  const [v, setV] = useState('Первая строка\nВторая строка');
  return <div className="ks-card"><ExpandableTextarea label="Текст" value={v} onChange={setV} /></div>;
}
const box = () => screen.getByRole('textbox', { name: 'Текст' }) as HTMLTextAreaElement;

describe('ExpandableTextarea', () => {
  it('разворачивается отдельным слоем вне карточки и сворачивается, текст сохраняется', () => {
    const { container } = render(<Host />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Развернуть на весь экран' }));
    const dialog = screen.getByRole('dialog', { name: 'Текст' });
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.parentElement).toBe(document.body);
    expect(box().value).toBe('Первая строка\nВторая строка');
    fireEvent.click(screen.getByRole('button', { name: 'Свернуть' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(box().value).toBe('Первая строка\nВторая строка');
  });

  it('правка в развёрнутом виде сохраняется после сворачивания', () => {
    render(<Host />);
    fireEvent.click(screen.getByRole('button', { name: 'Развернуть на весь экран' }));
    fireEvent.change(box(), { target: { value: 'Новый текст' } });
    fireEvent.click(screen.getByRole('button', { name: 'Свернуть' }));
    expect(box().value).toBe('Новый текст');
  });

  it('положение курсора сохраняется при переключении', () => {
    render(<Host />);
    box().setSelectionRange(3, 7);
    fireEvent.click(screen.getByRole('button', { name: 'Развернуть на весь экран' }));
    expect([box().selectionStart, box().selectionEnd]).toEqual([3, 7]);
  });

  it('Esc сворачивает поле', () => {
    render(<Host />);
    fireEvent.click(screen.getByRole('button', { name: 'Развернуть на весь экран' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
