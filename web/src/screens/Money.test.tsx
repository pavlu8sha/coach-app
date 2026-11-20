import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Money from './Money';

describe('«Оплаты»: вкладки разделов', () => {
  it('четыре вкладки идут сеткой 2×2 на узком экране (класс quad, не тесный ряд)', () => {
    render(<Money />);
    const tabs = screen.getByRole('tablist', { name: 'Раздел оплат' });
    expect(tabs.className).toContain('quad');
    expect(tabs.className).not.toContain('row');
    expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual(['Приём оплат', 'По месяцам', 'Должники', 'Отчёт']);
  });
});
