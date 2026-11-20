import { supabase } from './supabase';

// Дети родителя: единый серверный источник (миграция 0215, my_children). Список строится тем же предикатом доступа
// (parent_access_ok), что и RLS, поэтому экраны не фильтруют связи по полю отзыва старой модели.
export interface MyChild { player_id: string; full_name: string; group_id: string | null; group_name: string | null }

/** Ошибка ответа и отклонённый запрос (сбой сети) одинаково возвращаются как error: экран показывает ошибку с повтором, а не вечную загрузку.
 *  Пустой список (kids = []) — успешный ответ «детей нет», а не ошибка. */
export async function loadMyChildren(): Promise<{ kids: MyChild[] | null; error: unknown }> {
  try {
    const r = await supabase.rpc('my_children');
    if (r.error) return { kids: null, error: r.error };
    return { kids: ((r.data ?? []) as MyChild[]).filter(k => k && k.player_id), error: null };
  } catch (e) {
    return { kids: null, error: e ?? new Error('request failed') }; // текст не читаем: пользователю его показывает только errMsg()
  }
}
