import { supabase } from './supabase';

// Дети родителя: единый серверный источник (миграция 0215, my_children). Список строится тем же предикатом доступа
// (parent_access_ok), что и RLS, поэтому экраны не фильтруют связи по полю отзыва старой модели.
export interface MyChild { player_id: string; full_name: string; group_id: string | null; group_name: string | null }

/** Ответ базы как есть: ошибку и отклонённый запрос вызывающий экран обрабатывает сам (пустой список ≠ ошибка). */
export async function loadMyChildren(): Promise<{ kids: MyChild[] | null; error: { message?: string } | null }> {
  const r = await supabase.rpc('my_children');
  if (r.error) return { kids: null, error: r.error };
  return { kids: ((r.data ?? []) as MyChild[]).filter(k => k && k.player_id), error: null };
}
