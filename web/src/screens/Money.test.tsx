import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Money from './Money';

describe('«Оплаты»: вкладки в один ряд', () => {
  it('четыре вкладки стоят в одном ряду (класс row, без переноса в два ряда)', () => {
    render(<Money />);
    const tabs = screen.getByRole('tablist', { name: 'Раздел оплат' });
    expect(tabs.className).toContain('row');
    expect(tabs.className).not.toContain('quad');
    expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual(['Приём оплат', 'По месяцам', 'Должники', 'Отчёт']);
  });
});
