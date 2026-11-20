import { supabase } from './supabase';
import { ERR_NETWORK } from './userError';

export type SaveRoleResult = { ok: true } | { ok: false; text: string };

export const ROLE_ERR_NETWORK = 'Не удалось сохранить роль. Проверьте соединение и попробуйте ещё раз.';
export const ROLE_ERR_PROFILE = 'Не удалось найти ваш профиль. Закройте приложение и откройте его заново.';
export const ROLE_ERR_GENERIC = 'Не удалось сохранить роль. Попробуйте ещё раз.';

type Failure = { message?: unknown; code?: unknown } | null | undefined;

/** Понятный текст вместо сообщения Supabase/сети: сырые тексты, имена функций и коды пользователю не показываются (#705). */
export function roleErrorMessage(err: unknown): string {
  const e = (err ?? {}) as Failure;
  const code = String(e?.code ?? '');
  const raw = String(e?.message ?? err ?? '');
  const text = raw.toLowerCase();
  if (code === '42501' || code === 'P0002' || text.includes('forbidden') || text.includes('profile_missing') || text.includes('jwt')) return ROLE_ERR_PROFILE;
  if (err instanceof TypeError || raw === ERR_NETWORK || text.includes('fetch') || text.includes('network') || text.includes('timeout') || text.includes('failed to')) return ROLE_ERR_NETWORK;
  return ROLE_ERR_GENERIC;
}

/**
 * Сохраняет роль и подтверждает её чтением строки текущего пользователя (#704): успех — только если база вернула выбранную роль.
 * Не бросает исключений: отказ RPC и отклонённый Promise превращаются в { ok: false, message } с понятным текстом.
 * Технические подробности уходят только в console.error.
 */
export async function saveMyRole(r: string): Promise<SaveRoleResult> {
  try {
    const res = await supabase.rpc('set_my_role', { r });
    if (res.error) {
      console.error('set_my_role', res.error);
      return { ok: false, text: roleErrorMessage(res.error) };
    }
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) {
      console.error('set_my_role: getUser', authErr);
      return { ok: false, text: roleErrorMessage(authErr) };
    }
    if (!auth.user) return { ok: false, text: ROLE_ERR_PROFILE };
    const back = await supabase.from('users').select('chosen_role').eq('id', auth.user.id).maybeSingle();
    if (back.error) {
      console.error('set_my_role: чтение роли', back.error);
      return { ok: false, text: roleErrorMessage(back.error) };
    }
    if (!back.data) return { ok: false, text: ROLE_ERR_PROFILE };
    if (back.data.chosen_role !== r) return { ok: false, text: ROLE_ERR_GENERIC };
    return { ok: true };
  } catch (e) {
    console.error('set_my_role', e);
    return { ok: false, text: roleErrorMessage(e) };
  }
}
