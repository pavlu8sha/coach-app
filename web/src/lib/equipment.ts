import { useEffect, useState } from 'react';
import { supabase } from './supabase';

// Статусы заказа экипировки (#240, миграция 0098; «Новый» и «Отменён» — #471, 0185): порядок задаёт допустимые шаги.
// «Отменён» не шаг: его ставит и снимает только администратор отдельными действиями (eq_cancel_order / eq_restore_order).
export const ORDER_STATUSES = [
  { value: 'new', label: 'Новый' },
  { value: 'accepted', label: 'Принят в заказ' },
  { value: 'sewing', label: 'Начался пошив' },
  { value: 'ready', label: 'Готов к выдаче' },
  { value: 'issued', label: 'Выдан' },
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number]['value'] | 'cancelled';
export const CANCELLED = 'cancelled';
export const isCancelled = (o: { status?: string | null }) => o.status === CANCELLED;

// Неизвестный статус (например, появившийся в базе раньше, чем обновилось приложение) показывается как «Принят в заказ».
export const orderStatusLabel = (s: string | null | undefined) =>
  s === CANCELLED ? 'Отменён' : ORDER_STATUSES.find(x => x.value === s)?.label ?? 'Принят в заказ';
const stepOf = (s: string) => ORDER_STATUSES.findIndex(x => x.value === s);
export const nextStatus = (s: string) => (stepOf(s) < 0 ? undefined : ORDER_STATUSES[stepOf(s) + 1]?.value);
// «Выдан» ставится, только когда по каждой вещи заказа есть отметка выдачи (0133).
export const allKitsIssued = (lines: { kit: string }[], issues: { kit: string }[]) =>
  lines.length > 0 && lines.every(l => issues.some(i => i.kit === l.kit));
// Назад на шаг (только администратор); в «Новый» не возвращается (0185).
export const prevStatus = (s: string) => (stepOf(s) < 2 ? undefined : ORDER_STATUSES[stepOf(s) - 1]?.value);

/** К оплате по заказу: у отменённого 0, иначе остаток (как eq_order_due в базе). */
export const orderDue = (o: { status?: string | null; total: number | string; paid: number | string }) =>
  isCancelled(o) ? 0 : Math.max(Number(o.total) - Number(o.paid), 0);
/** Переплата: у отменённого всё оплаченное (возврат решает администратор), иначе оплачено сверх итога (как eq_order_overpaid). */
export const orderOverpaid = (o: { status?: string | null; total: number | string; paid: number | string }) =>
  isCancelled(o) ? Number(o.paid) : Math.max(Number(o.paid) - Number(o.total), 0);

export interface StatusEvent { status: string; changed_at: string; changed_by_name: string | null }

/** Дата последней смены статуса (YYYY-MM-DD) или null, если истории нет. */
export const lastStatusDate = (h: StatusEvent[] | null | undefined) => {
  const t = [...(h ?? [])].sort((a, b) => b.changed_at.localeCompare(a.changed_at))[0]?.changed_at;
  return t ? t.slice(0, 10) : null;
};

// Утверждённая владельцем формулировка — две строки. Показывается, пока администратор не задал свой текст
// (club_settings, ключ equipment.required_text; родителю текст отдаёт функция equipment_requirement).
export const EQUIPMENT_REQUIRED_TEXT =
  'Тренировочный комплект FC Kickstart обязателен для всех воспитанников: клуб переходит на единую тренировочную экипировку.\n' +
  'Если у ребёнка уже есть старая форма клуба, её можно использовать.';
export const EQUIPMENT_REQUIRED_KEY = 'equipment.required_text';

export interface IssueLine { kit: string; quantity: number }
export interface IssueRow { kit: string }

// Сколько единиц заказано и выдано. Выдача хранится по комплекту (одна строка на kit),
// поэтому по строке с quantity > 1 выданной считается не больше одной единицы.
export function issueUnits(lines: IssueLine[], issues: IssueRow[]) {
  const need = new Map<string, number>();
  for (const l of lines) need.set(l.kit, (need.get(l.kit) ?? 0) + l.quantity);
  const have = new Map<string, number>();
  for (const i of issues) have.set(i.kit, (have.get(i.kit) ?? 0) + 1);
  let total = 0;
  let issued = 0;
  for (const [kit, quantity] of need) {
    total += quantity;
    issued += Math.min(have.get(kit) ?? 0, quantity);
  }
  return { total, issued, full: total > 0 && issued >= total };
}

export const issueStateLabel = (lines: IssueLine[], issues: IssueRow[]) => {
  const { total, issued, full } = issueUnits(lines, issues);
  return total === 0 || issued === 0 ? 'Нет' : full ? 'Да' : 'Частично';
};

/** Выдана ли вещь заказа: выдача хранится по комплекту (kit). */
export const kitIssued = (issues: IssueRow[], kit: string) => issues.some(i => i.kit === kit);

/**
 * Подходит ли заказ под «Выдано» (want = true) или «Не выдано» (false).
 * Если выбрана вещь (kit), смотрим только на неё; иначе на заказ целиком («выдано» = выдано всё).
 */
export function orderMatchesIssue(lines: IssueLine[], issues: IssueRow[], want: boolean, kit = ''): boolean {
  const done = kit ? kitIssued(issues, kit) : issueUnits(lines, issues).full;
  return done === want;
}

/** Текст требования к тренировочной форме для родителя. До ответа базы и при ошибке показывается утверждённый текст. */
export function useEquipmentRequirement() {
  const [text, setText] = useState(EQUIPMENT_REQUIRED_TEXT);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await supabase.rpc('equipment_requirement');
      if (alive && !r.error && typeof r.data === 'string' && r.data.trim()) setText(r.data);
    })();
    return () => { alive = false; };
  }, []);
  return text;
}
