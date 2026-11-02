import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SwitchRow } from './components';

describe('SwitchRow', () => {
  it('переключается нажатием на подпись и на строку, а не только на сам переключатель', () => {
    const onChange = vi.fn();
    render(<SwitchRow id="t" label="Только не оплатившие" checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByText('Только не оплатившие'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(true);
  });

  it('нажатие на сам переключатель срабатывает один раз, без двойного переключения', () => {
    const onChange = vi.fn();
    render(<SwitchRow id="t" label="Только не оплатившие" checked={true} onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Только не оплатившие' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });
});
