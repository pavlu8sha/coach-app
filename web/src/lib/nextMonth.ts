import { settingNumber, type SettingValues } from './clubSettings';

// Следующий месяц с N-го числа (настройка payments.nextMonthDay, по умолчанию 22) — обычный долг, а не оплата «вперёд» (миграция 0230).
// Правило то же, что debt_month_limit в базе: в коротком месяце порог не позже его последнего дня; недопустимая настройка — следующий месяц не считается долгом.
export function nextMonthDue(now: Date, n: number): boolean {
  if (!Number.isFinite(n)) return false;
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return now.getDate() >= Math.min(n, last);
}

export const nextMonthDueFor = (values: SettingValues, now = new Date()): boolean => nextMonthDue(now, settingNumber(values, 'payments.nextMonthDay'));
