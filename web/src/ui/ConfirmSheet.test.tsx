import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useConfirm } from './ConfirmSheet';

function Probe({ onResult }: { onResult: (ok: boolean) => void }) {
  const { ask, dialog } = useConfirm();
  return (
    <>
      <button type="button" onClick={() => void ask({ title: 'Записать платёж?', lines: [['Сумма', '50 ₾'], ['Игрок', null]], confirmLabel: 'Записать' }).then(onResult)}>открыть</button>
      {dialog}
    </>
  );
}

describe('окно подтверждения', () => {
  it('подтверждение возвращает true и показывает только заполненные строки', async () => {
    let result: boolean | null = null;
    render(<Probe onResult={ok => { result = ok; }} />);
    fireEvent.click(screen.getByRole('button', { name: 'открыть' }));
    const dialog = await screen.findByRole('dialog', { name: 'Записать платёж?' });
    expect(dialog).toHaveTextContent('50 ₾');
    expect(dialog).not.toHaveTextContent('Игрок');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Записать' })); });
    expect(result).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('«Отмена», Esc и фон возвращают false без записи', async () => {
    const results: boolean[] = [];
    render(<Probe onResult={ok => { results.push(ok); }} />);
    fireEvent.click(screen.getByRole('button', { name: 'открыть' }));
    await screen.findByRole('dialog');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Отмена' })); });
    fireEvent.click(screen.getByRole('button', { name: 'открыть' }));
    await screen.findByRole('dialog');
    await act(async () => { fireEvent.keyDown(window, { key: 'Escape' }); });
    fireEvent.click(screen.getByRole('button', { name: 'открыть' }));
    await screen.findByRole('dialog');
    await act(async () => { fireEvent.click(screen.getByRole('dialog')); });
    expect(results).toEqual([false, false, false]);
  });

  it('пока окно открыто, страница под ним не прокручивается', async () => {
    render(<Probe onResult={() => {}} />);
    expect(document.body.style.overflow).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'открыть' }));
    await screen.findByRole('dialog');
    expect(document.body.style.overflow).toBe('hidden');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Отмена' })); });
    expect(document.body.style.overflow).toBe('');
  });
});
