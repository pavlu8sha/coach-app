import { supabase } from '../lib/supabase';
import type { ConfirmRequest } from '../ui/ConfirmSheet';

interface Clash { label: string; starts_at: string; ends_at: string | null }
const hm = (iso: string) => iso.slice(11, 16);

// Запись администратором: если у ребёнка в это время уже что-то есть (booking_conflicts, миграция 0150), просим подтвердить.
// Только предупреждение: без функции или при ошибке запись идёт как раньше.
export async function clashConfirmed(ask: (r: ConfirmRequest) => Promise<boolean>, k: string, s: string, p: string, name: string): Promise<boolean> {
  const r = await supabase.rpc('booking_conflicts', { k, s, p });
  const list = r.error ? [] : ((r.data ?? []) as Clash[]);
  if (list.length === 0) return true;
  return ask({
    title: 'Есть пересечение',
    lines: [['Игрок', name], ...list.map((c): [string, string] => [c.label, `${hm(c.starts_at)}${c.ends_at ? `–${hm(c.ends_at)}` : ''}`])],
    note: 'В это время у ребёнка уже есть другое занятие. Записать всё равно?',
    confirmLabel: 'Записать',
  });
}
