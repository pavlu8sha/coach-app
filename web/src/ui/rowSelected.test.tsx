import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ListRow } from './components';

// Регрессия #789: отметка выбранной строки ListRow получила класс .ks-check, которым уже оформлены строки с чекбоксом
// (экран «Тренеры»: названия групп повернулись на 45°, чекбоксы сжались). Класс отметки должен быть своим.
describe('ListRow: отметка выбранной строки', () => {
  it('отметка не использует класс чекбокс-строк .ks-check, но показана', () => {
    const { container } = render(<ListRow title="Группа" selected onClick={() => undefined} />);
    expect(container.querySelector('.ks-check')).toBeNull();
    expect(container.querySelector('.ks-row-tick')).not.toBeNull();
    expect(container.querySelector('.ks-chev')).toBeNull();
  });
  it('невыбранная строка со стрелкой', () => {
    const { container } = render(<ListRow title="Группа" onClick={() => undefined} />);
    expect(container.querySelector('.ks-chev')).not.toBeNull();
    expect(container.querySelector('.ks-row-tick')).toBeNull();
  });
});
