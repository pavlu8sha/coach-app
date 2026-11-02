import { settingNumber, settingText, type SettingValues } from './clubSettings';

// Скидка на комплект экипировки (#339). Правила и проценты берутся из настроек клуба.
// Скидка действует, если в новом заказе есть нужные позиции, а у игрока в итоге (в прошлых заказах или в этом) есть полный набор.
// Скидка считается от общей суммы набора: прошлые заказы игрока (без позиций «по полной цене») плюс новый заказ.
// От результата отнимается то, что игрок уже заказал раньше, разница и есть сумма нового заказа. При рассрочке скидки нет.

/** «A или B, C» → [[A, B], [C]]: каждая группа через запятую обязательна, внутри группы достаточно любой из позиций. */
export function parseKitRule(s: string): string[][] {
  return s.split(',').map(g => g.split(/\s+или\s+/i).map(x => x.trim().toLowerCase()).filter(Boolean)).filter(g => g.length > 0);
}

export const parseKitList = (s: string) => s.split(',').map(x => x.trim().toLowerCase()).filter(Boolean);

const satisfied = (rule: string[][], have: Set<string>) => rule.length > 0 && rule.every(g => g.some(k => have.has(k)));

export interface OrderLine { kit: string; amount: number }
/** pastAmount — сумма прошлых заказов игрока без позиций «по полной цене»; allBase и allTotal — набор целиком до и после скидки. */
export interface DiscountResult { applies: boolean; base: number; total: number; discount: number; pct: number; pastAmount: number; allBase: number; allTotal: number }

export function bundleDiscount(args: { lines: OrderLine[]; pastKits: string[]; pastAmount?: number; installment: boolean; settings: SettingValues }): DiscountResult {
  const { lines, pastKits, installment, settings } = args;
  const pastAmount = Math.max(0, args.pastAmount ?? 0);
  const sum = lines.reduce((s, l) => s + l.amount, 0);
  const none: DiscountResult = { applies: false, base: sum, total: sum, discount: 0, pct: 0, pastAmount, allBase: sum + pastAmount, allTotal: sum + pastAmount };
  const pct = settingNumber(settings, 'equip.discPct');
  if (installment || pct <= 0 || lines.length === 0) return none;
  const inOrder = new Set(lines.map(l => l.kit.trim().toLowerCase()));
  const all = new Set([...inOrder, ...pastKits.map(k => k.trim().toLowerCase())]);
  if (!satisfied(parseKitRule(settingText(settings, 'equip.discNeedOwn')), inOrder)) return none;
  if (!satisfied(parseKitRule(settingText(settings, 'equip.discNeedAll')), all)) return none;
  const full = new Set(parseKitList(settingText(settings, 'equip.fullPrice')));
  const fullSum = lines.filter(l => full.has(l.kit.trim().toLowerCase())).reduce((s, l) => s + l.amount, 0);
  const allBase = (sum - fullSum) + pastAmount;
  const round = settingNumber(settings, 'equip.discRound');
  let allTotal = allBase * (1 - pct / 100);
  if (round > 0) allTotal = Math.round(allTotal / round) * round;
  allTotal = Math.max(0, Math.round(allTotal * 100) / 100);
  const total = fullSum + Math.max(0, Math.round((allTotal - pastAmount) * 100) / 100);
  return { applies: total < sum, base: sum, total, discount: sum - total, pct, pastAmount, allBase, allTotal };
}
