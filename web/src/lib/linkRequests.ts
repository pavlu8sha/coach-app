import { supabase } from './supabase';

// Запросы родителя на привязку и согласия, ожидающие принятия: серверные функции чтения (миграция 0217).
// Пока миграция не применена, экраны работают как раньше: прямой выбор запросов (имя ребёнка до подтверждения не виден) и без экрана согласия.
export interface LinkReq { id: string; status: 'pending' | 'approved' | 'rejected'; players: { full_name: string } | null }
export interface PendingConsent { player_id: string; full_name: string; group_name: string | null; version_id: string; version: string }

// «Функции в базе нет» (миграция 0217 ещё не применена): только PGRST202 либо точное сообщение об отсутствии именно этой функции.
// Общее «schema cache» и любые другие ошибки отсутствием функции не считаются. Текст пользователю не показывается.
const missing = (e: unknown, fn: string): boolean => {
  if (e && typeof e === 'object' && (e as { code?: unknown }).code === 'PGRST202') return true;
  let m = '';
  try { m = JSON.stringify(e) ?? ''; } catch { /* не разобрать: считаем обычной ошибкой */ }
  return m.includes(`Could not find the function public.${fn}`);
};

/** Свои запросы с именем ребёнка. Ошибка ответа (не «функции нет») возвращается как error. */
export async function loadMyLinkRequests(me: string): Promise<{ reqs: LinkReq[] | null; error: unknown }> {
  try {
    const r = await supabase.rpc('my_link_requests');
    if (!r.error && Array.isArray(r.data)) {
      return { reqs: (r.data as { id: string; status: LinkReq['status']; full_name: string | null }[]).map(x => ({ id: x.id, status: x.status, players: x.full_name ? { full_name: x.full_name } : null })), error: null };
    }
    // прямой выбор только при подтверждённом отсутствии функции: сбой RPC (сеть, права, SQL) им не маскируется
    if (r.error && !missing(r.error, 'my_link_requests')) return { reqs: null, error: r.error };
    if (!r.error) return { reqs: null, error: new Error('bad response') }; // успех, но не массив (null/undefined): для функции-таблицы штатно только [], fallback не запускается
  } catch (e) {
    return { reqs: null, error: e ?? new Error('request failed') };
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

/** Дети, которым не хватает только принятия согласия родителем.
 *  Пустой список: подтверждённо нечего принимать, либо функции в базе ещё нет (до применения 0217, прежний экран остаётся).
 *  Любая другая ошибка (сеть, права, SQL, некорректный ответ) возвращается как error: экран показывает ошибку с повтором, а не вводящий в заблуждение онбординг. */
export async function loadPendingConsents(): Promise<{ items: PendingConsent[]; error: unknown }> {
  try {
    const r = await supabase.rpc('my_pending_consents');
    if (r.error) return missing(r.error, 'my_pending_consents') ? { items: [], error: null } : { items: [], error: r.error };
    if (!Array.isArray(r.data)) return { items: [], error: new Error('bad response') };
    return { items: (r.data as PendingConsent[]).filter(x => x && x.player_id && x.version_id), error: null };
  } catch (e) {
    return { items: [], error: e ?? new Error('request failed') };
  }
}
