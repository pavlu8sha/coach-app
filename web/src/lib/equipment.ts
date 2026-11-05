import { useEffect, useState } from 'react';
import { supabase } from './supabase';

// Статусы заказа экипировки (#240, миграция 0098): порядок задаёт допустимые шаги.
export const ORDER_STATUSES = [
  { value: 'accepted', label: 'Принят в заказ' },
  { value: 'sewing', label: 'Начался пошив' },
  { value: 'ready', label: 'Готов к выдаче' },
  { value: 'issued', label: 'Выдан' },
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number]['value'];

export const orderStatusLabel = (s: string | null | undefined) => ORDER_STATUSES.find(x => x.value === s)?.label ?? ORDER_STATUSES[0].label;
export const nextStatus = (s: string) => ORDER_STATUSES[ORDER_STATUSES.findIndex(x => x.value === s) + 1]?.value;
// «Выдан» ставится, только когда по каждой вещи заказа есть отметка выдачи (0133).
export const allKitsIssued = (lines: { kit: string }[], issues: { kit: string }[]) =>
  lines.length > 0 && lines.every(l => issues.some(i => i.kit === l.kit));
export const prevStatus = (s: string) => ORDER_STATUSES[ORDER_STATUSES.findIndex(x => x.value === s) - 1]?.value;

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
