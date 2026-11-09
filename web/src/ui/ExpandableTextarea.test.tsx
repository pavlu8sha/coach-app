import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ExpandableTextarea } from './ExpandableTextarea';

function Host() {
  const [v, setV] = useState('Первая строка\nВторая строка');
  return <ExpandableTextarea label="Текст" value={v} onChange={setV} />;
}

describe('ExpandableTextarea', () => {
  it('разворачивается и сворачивается, оставляя тот же элемент и текст', () => {
    render(<Host />);
    const ta = screen.getByRole('textbox', { name: 'Текст' }) as HTMLTextAreaElement;
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Развернуть на весь экран' }));
    expect(screen.getByRole('dialog', { name: 'Текст' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Текст' })).toBe(ta);
    expect(ta.value).toBe('Первая строка\nВторая строка');
    fireEvent.click(screen.getByRole('button', { name: 'Свернуть' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Текст' })).toBe(ta);
  });

  it('правка в развёрнутом виде сохраняется после сворачивания', () => {
    render(<Host />);
    fireEvent.click(screen.getByRole('button', { name: 'Развернуть на весь экран' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Текст' }), { target: { value: 'Новый текст' } });
    fireEvent.click(screen.getByRole('button', { name: 'Свернуть' }));
    expect((screen.getByRole('textbox', { name: 'Текст' }) as HTMLTextAreaElement).value).toBe('Новый текст');
  });

  it('Esc сворачивает поле', () => {
    render(<Host />);
    fireEvent.click(screen.getByRole('button', { name: 'Развернуть на весь экран' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
