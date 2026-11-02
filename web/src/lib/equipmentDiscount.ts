import { settingNumber, settingText, type SettingValues } from './clubSettings';

// Скидка на комплект экипировки (#339). Правила и проценты берутся из настроек клуба.
// Скидка действует, если в новом заказе есть нужные позиции, а у игрока в итоге (в прошлых заказах или в этом) есть полный набор.
// Скидка применяется к позициям нового заказа, кроме позиций «по полной цене»; при рассрочке скидки нет.

/** «A или B, C» → [[A, B], [C]]: каждая группа через запятую обязательна, внутри группы достаточно любой из позиций. */
export function parseKitRule(s: string): string[][] {
  return s.split(',').map(g => g.split(/\s+или\s+/i).map(x => x.trim().toLowerCase()).filter(Boolean)).filter(g => g.length > 0);
}

export const parseKitList = (s: string) => s.split(',').map(x => x.trim().toLowerCase()).filter(Boolean);

const satisfied = (rule: string[][], have: Set<string>) => rule.length > 0 && rule.every(g => g.some(k => have.has(k)));

export interface OrderLine { kit: string; amount: number }
export interface DiscountResult { applies: boolean; base: number; total: number; discount: number; pct: number }

export function bundleDiscount(args: { lines: OrderLine[]; pastKits: string[]; installment: boolean; settings: SettingValues }): DiscountResult {
  const { lines, pastKits, installment, settings } = args;
  const sum = lines.reduce((s, l) => s + l.amount, 0);
  const none: DiscountResult = { applies: false, base: sum, total: sum, discount: 0, pct: 0 };
  const pct = settingNumber(settings, 'equip.discPct');
  if (installment || pct <= 0 || lines.length === 0) return none;
  const inOrder = new Set(lines.map(l => l.kit.trim().toLowerCase()));
  const all = new Set([...inOrder, ...pastKits.map(k => k.trim().toLowerCase())]);
  if (!satisfied(parseKitRule(settingText(settings, 'equip.discNeedOwn')), inOrder)) return none;
  if (!satisfied(parseKitRule(settingText(settings, 'equip.discNeedAll')), all)) return none;
  const full = new Set(parseKitList(settingText(settings, 'equip.fullPrice')));
  const fullSum = lines.filter(l => full.has(l.kit.trim().toLowerCase())).reduce((s, l) => s + l.amount, 0);
  const part = sum - fullSum;
  const round = settingNumber(settings, 'equip.discRound');
  let discounted = part * (1 - pct / 100);
  if (round > 0) discounted = Math.round(discounted / round) * round;
  discounted = Math.max(0, Math.round(discounted * 100) / 100);
  const total = fullSum + discounted;
  return { applies: total < sum, base: sum, total, discount: sum - total, pct };
}
