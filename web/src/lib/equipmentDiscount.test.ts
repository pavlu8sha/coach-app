import { describe, expect, it } from 'vitest';
import { bundleDiscount } from './equipmentDiscount';

const line = (kit: string, amount: number) => ({ kit, amount });
const full = [line('Игровая форма', 200), line('Тренировочная форма', 160), line('Спортивный костюм', 150), line('Дождевик', 110)];

describe('Скидка на комплект (#339)', () => {
  it('полный набор в одном заказе: 15% и округление до 5 ₾', () => {
    const r = bundleDiscount({ lines: full, pastKits: [], installment: false, settings: {} });
    expect(r).toMatchObject({ applies: true, base: 620, total: 525, discount: 95, pct: 15 });
  });

  it('форма была заказана раньше: новый заказ из остального набора получает скидку на новые позиции', () => {
    const r = bundleDiscount({ lines: [line('Тренировочная форма', 160), line('Спортивный костюм', 150), line('Дождевик', 110)], pastKits: ['Игровая форма'], installment: false, settings: {} });
    expect(r.applies).toBe(true);
    expect(r.total).toBe(Math.round(420 * 0.85 / 5) * 5);
  });

  it('вратарская форма заменяет игровую; регистр названий не важен', () => {
    const r = bundleDiscount({ lines: [line('ДОЖДЕВИК', 100)], pastKits: ['вратарская форма', 'Тренировочная форма', 'Спортивный костюм'], installment: false, settings: {} });
    expect(r.applies).toBe(true);
  });

  it('набор неполный: скидки нет', () => {
    const r = bundleDiscount({ lines: [line('Дождевик', 110)], pastKits: ['Игровая форма'], installment: false, settings: {} });
    expect(r).toMatchObject({ applies: false, total: 110, discount: 0 });
  });

  it('в новом заказе нет ни одной позиции из условия: скидки нет', () => {
    const r = bundleDiscount({ lines: [line('Носки', 20)], pastKits: ['Игровая форма', 'Тренировочная форма', 'Спортивный костюм', 'Дождевик'], installment: false, settings: {} });
    expect(r.applies).toBe(false);
  });

  it('рассрочка: скидки нет', () => {
    expect(bundleDiscount({ lines: full, pastKits: [], installment: true, settings: {} }).applies).toBe(false);
  });

  it('носки и гетры идут по полной цене', () => {
    const r = bundleDiscount({ lines: [...full, line('Носки', 20), line('Гетры', 30)], pastKits: [], installment: false, settings: {} });
    expect(r.total).toBe(525 + 50);
  });

  it('настройки меняют процент и округление; 0% отключает скидку', () => {
    expect(bundleDiscount({ lines: full, pastKits: [], installment: false, settings: { 'equip.discPct': '10', 'equip.discRound': '0' } }).total).toBe(558);
    expect(bundleDiscount({ lines: full, pastKits: [], installment: false, settings: { 'equip.discPct': '0' } }).applies).toBe(false);
  });
});
