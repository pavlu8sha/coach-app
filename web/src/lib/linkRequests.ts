import { supabase } from './supabase';

// Запросы родителя на привязку и согласия, ожидающие принятия: серверные функции чтения (миграция 0217).
// Пока миграция не применена, экраны работают как раньше: прямой выбор запросов (имя ребёнка до подтверждения не виден) и без экрана согласия.
export interface LinkReq { id: string; status: 'pending' | 'approved' | 'rejected'; players: { full_name: string } | null }
export interface PendingConsent { player_id: string; full_name: string; group_name: string | null; version_id: string; version: string }

// «Функции в базе нет» (миграция ещё не применена): тело ответа проверяем целиком, текст пользователю не показывается
const missing = (e: unknown): boolean => {
  let m = '';
  try { m = JSON.stringify(e) ?? ''; } catch { /* не разобрать: считаем обычной ошибкой */ }
  return m.includes('Could not find the function') || m.includes('schema cache') || m.includes('PGRST202');
};

/** Свои запросы с именем ребёнка. Ошибка ответа (не «функции нет») возвращается как error. */
export async function loadMyLinkRequests(me: string): Promise<{ reqs: LinkReq[] | null; error: unknown }> {
  try {
    const r = await supabase.rpc('my_link_requests');
    if (!r.error && Array.isArray(r.data)) {
      return { reqs: (r.data as { id: string; status: LinkReq['status']; full_name: string | null }[]).map(x => ({ id: x.id, status: x.status, players: x.full_name ? { full_name: x.full_name } : null })), error: null };
    }
    if (r.error && !missing(r.error)) return { reqs: null, error: r.error };
  } catch {
    /* сбой функции не мешает прежнему выбору ниже: он вернёт свою ошибку, если сети нет */
  }
  try {
    // только свои запросы: администратору RLS отдаёт чужие, они показываются во вкладке «Запросы»
    const r = await supabase.from('link_requests').select('id, status, players(full_name)').eq('user_id', me).order('created_at', { ascending: false });
    if (r.error) return { reqs: null, error: r.error };
    return { reqs: (r.data ?? []) as unknown as LinkReq[], error: null };
  } catch (e) {
    return { reqs: null, error: e ?? new Error('request failed') };
  }
}

/** Дети, которым не хватает только принятия согласия родителем. Любой сбой (в том числе «функции нет») даёт пустой список: прежний экран остаётся. */
export async function loadPendingConsents(): Promise<PendingConsent[]> {
  try {
    const r = await supabase.rpc('my_pending_consents');
    if (r.error || !Array.isArray(r.data)) return [];
    return (r.data as PendingConsent[]).filter(x => x && x.player_id && x.version_id);
  } catch {
    return [];
  }
}
