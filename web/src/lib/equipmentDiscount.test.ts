import { describe, expect, it } from 'vitest';
import { bundleDiscount, priorAmount } from './equipmentDiscount';

const line = (kit: string, amount: number) => ({ kit, amount });
const full = [line('Игровая форма', 200), line('Тренировочная форма', 160), line('Спортивный костюм', 150), line('Дождевик', 110)];
const oldNeedAll = [['игровая форма', 'вратарская форма', 'тренировочная форма', 'спортивный костюм', 'дождевик']];
const oldNeedOwn = [['игровая форма', 'вратарская форма'], ['тренировочная форма'], ['спортивный костюм'], ['дождевик']];
const fullPrice = ['носки', 'гетры'];
type Past = { kit: string; sum: number };

function oldDiscount(args: { lines: { kit: string; amount: number }[]; past: Past[]; installment: boolean; pct: number; round: number }) {
  const sum = args.lines.reduce((s, l) => s + l.amount, 0);
  const parts = new Set(args.lines.map(l => l.kit.trim().toLowerCase()));
  const excl = args.lines.filter(l => fullPrice.includes(l.kit.trim().toLowerCase())).reduce((s, l) => s + l.amount, 0);
  if (args.installment || args.pct <= 0 || args.lines.length === 0) return { total: sum, applies: false };
  if (!oldNeedAll.every(g => g.some(k => parts.has(k)))) return { total: sum, applies: false };
  const pastKits = args.past.flatMap(p => p.kit.split(/\s*\+\s*/).map(k => k.trim().toLowerCase()));
  const own = new Set([...parts, ...pastKits]);
  if (!oldNeedOwn.every(g => g.some(k => own.has(k)))) return { total: sum, applies: false };
  const base = oldNeedOwn.flat();
  const prior = args.past
    .filter(p => p.kit.split(/\s*\+\s*/).some(k => base.includes(k.trim().toLowerCase())))
    .reduce((s, p) => s + (Number(p.sum) || 0), 0);
  const target = Math.round((prior + sum - excl) * (100 - args.pct) / 100 / args.round) * args.round;
  const total = Math.round((Math.max(target - prior, 0) + excl) * 100) / 100;
  return { total, applies: total < sum };
}

const pastKits = (past: Past[]) => past.flatMap(p => p.kit.split(/\s*\+\s*/).map(k => k.trim()));
const pastOrders = (past: Past[]) => past.map(p => ({ total: p.sum, lines: p.kit.split(/\s*\+\s*/).map(kit => ({ kit: kit.trim() })) }));

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

  it('скидка от всего набора с прошлыми заказами: 300 + 320 = 620, со скидкой 525, новый заказ 225', () => {
    const r = bundleDiscount({ lines: [line('Спортивный костюм', 150), line('Дождевик', 170)], pastKits: ['Игровая форма', 'Тренировочная форма'], pastAmount: 300, installment: false, settings: {} });
    expect(r).toMatchObject({ applies: true, base: 320, total: 225, discount: 95, pastAmount: 300, allBase: 620, allTotal: 525 });
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
    expect(bundleDiscount({ lines: full, pastKits: [], installment: false, settings: { 'equip.discPct': '10', 'equip.discRound': '10' } }).total).toBe(560);
    expect(bundleDiscount({ lines: full, pastKits: [], installment: false, settings: { 'equip.discPct': '0' } }).applies).toBe(false);
  });

  it('округление 0 исторически недопустимо: ошибка видна, скидка не считается молча', () => {
    const r = bundleDiscount({ lines: full, pastKits: [], installment: false, settings: { 'equip.discPct': '10', 'equip.discRound': '0' } });
    expect(r).toMatchObject({ applies: false, total: 620, discount: 0 });
  });

  it('неверный процент или округление не дают молчаливой скидки', () => {
    expect(bundleDiscount({ lines: full, pastKits: [], installment: false, settings: { 'equip.discPct': '500' } }).applies).toBe(false);
    expect(bundleDiscount({ lines: full, pastKits: [], installment: false, settings: { 'equip.discRound': 'abc' } }).applies).toBe(false);
  });

  it('исторические ключи читаются по старым правилам: NeedAll — в заказе, NeedOwn — у игрока', () => {
    const base = { lines: [line('Спортивный костюм', 150)], pastKits: ['Игровая форма'], installment: false };
    expect(bundleDiscount({ ...base, settings: { 'equip.discNeedAll': 'Спортивный костюм', 'equip.discNeedOwn': 'Игровая форма' } }).applies).toBe(true);
    expect(bundleDiscount({ ...base, settings: { 'equip.discNeedAll': 'Игровая форма', 'equip.discNeedOwn': 'Спортивный костюм' } }).applies).toBe(false);
  });

  it('старый пример: в заказе нет игровой формы, поэтому общий набор не выполнен', () => {
    const settings = {
      'equip.discNeedAll': 'Игровая форма или Вратарская форма, Тренировочная форма, Спортивный костюм, Дождевик',
      'equip.discNeedOwn': 'Тренировочная форма, Игровая форма или Вратарская форма, Спортивный костюм, Дождевик',
    };
    const past = [{ kit: 'Игровая форма + Тренировочная форма', sum: 360 }];
    expect(bundleDiscount({ lines: [line('Спортивный костюм', 150), line('Дождевик', 110)], pastKits: pastKits(past), pastAmount: priorAmount(pastOrders(past), settings), installment: false, settings }).applies).toBe(false);
  });

  it('priorAmount берёт только прошлые заказы с позицией из discNeedOwn и whole order total', () => {
    expect(priorAmount([
      { total: 300, lines: [{ kit: 'Игровая форма' }, { kit: 'Носки' }] },
      { total: 100, lines: [{ kit: 'Куртка' }] },
      { total: 250, lines: [{ kit: 'Дождевик' }] },
    ], {})).toBe(550);
  });

  it('прошлый заказ с позицией по полной цене входит в prior целиком', () => {
    const settings = { 'equip.discPct': '10', 'equip.discRound': '1' };
    const past = [{ kit: 'Игровая форма + Тренировочная форма + Носки', sum: 380 }];
    const r = bundleDiscount({ lines: [line('Спортивный костюм', 150), line('Дождевик', 110)], pastKits: pastKits(past), pastAmount: priorAmount(pastOrders(past), settings), installment: false, settings });
    expect(priorAmount(pastOrders(past), settings)).toBe(380);
    expect(r).toMatchObject({ applies: true, total: 196, discount: 64, pastAmount: 380, allBase: 640, allTotal: 576 });
  });

  it('прошлый заказ без позиции из discNeedOwn не уменьшает prior', () => {
    const settings = {};
    const past = [{ kit: 'Куртка', sum: 100 }];
    const r = bundleDiscount({ lines: full, pastKits: pastKits(past), pastAmount: priorAmount(pastOrders(past), settings), installment: false, settings });
    expect(priorAmount(pastOrders(past), settings)).toBe(0);
    expect(r).toMatchObject({ applies: true, total: 525, discount: 95, pastAmount: 0 });
  });

  it('совпадает со старой формулой на полном наборе сценариев', () => {
    const cases = [
      { lines: full, past: [], installment: false, pct: 15, round: 5 },
      { lines: [line('Тренировочная форма', 160), line('Спортивный костюм', 150), line('Дождевик', 110)], past: [{ kit: 'Игровая форма', sum: 0 }], installment: false, pct: 15, round: 5 },
      { lines: [line('Спортивный костюм', 150), line('Дождевик', 170)], past: [{ kit: 'Игровая форма + Тренировочная форма', sum: 300 }], installment: false, pct: 15, round: 5 },
      { lines: [...full, line('Носки', 20), line('Гетры', 30)], past: [], installment: false, pct: 15, round: 5 },
      { lines: [line('Игровая форма', 100), line('Тренировочная форма', 83), line('Спортивный костюм', 80), line('Дождевик', 70)], past: [], installment: false, pct: 15, round: 5 },
      { lines: full, past: [], installment: true, pct: 15, round: 5 },
      { lines: [line('Дождевик', 110)], past: [{ kit: 'Игровая форма', sum: 0 }], installment: false, pct: 15, round: 5 },
      { lines: [line('Носки', 20)], past: [{ kit: 'Игровая форма + Тренировочная форма + Спортивный костюм + Дождевик', sum: 0 }], installment: false, pct: 15, round: 5 },
      { lines: [line('Спортивный костюм', 150), line('Дождевик', 110)], past: [{ kit: 'Игровая форма + Носки', sum: 215 }], installment: false, pct: 10, round: 1 },
      { lines: full, past: [{ kit: 'Куртка', sum: 100 }], installment: false, pct: 10, round: 5 },
    ];
    for (const c of cases) {
      const expected = oldDiscount(c);
      const settings = { 'equip.discPct': String(c.pct), 'equip.discRound': String(c.round) };
      const actual = bundleDiscount({ lines: c.lines, pastKits: pastKits(c.past), pastAmount: priorAmount(pastOrders(c.past), settings), installment: c.installment, settings });
      expect({ total: actual.total, applies: actual.applies }, JSON.stringify(c)).toEqual(expected);
    }
  });
});
