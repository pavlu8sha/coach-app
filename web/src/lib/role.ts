import { supabase } from './supabase';
import { ERR_NETWORK } from './userError';

export type RoleErrorKind = 'network' | 'profile' | 'session' | 'generic';
export type SaveRoleResult = { ok: true } | { ok: false; text: string; kind: RoleErrorKind };

export const ROLE_ERR_NETWORK = 'Не удалось сохранить роль. Проверьте соединение и попробуйте ещё раз.';
export const ROLE_ERR_PROFILE = 'Не удалось найти ваш профиль. Закройте приложение и откройте его заново.';
export const ROLE_ERR_SESSION = 'Не удалось подтвердить вход. Закройте приложение и откройте его заново.';
export const ROLE_ERR_GENERIC = 'Не удалось сохранить роль. Попробуйте ещё раз.';

type Failure = { message?: unknown; code?: unknown } | null | undefined;
type Classified = { kind: RoleErrorKind; text: string };

/** Причина ошибки важна для восстановления (#816): пропавший профиль, истёкшая сессия и отказ прав — разные ситуации. */
function classify(err: unknown): Classified {
  const e = (err ?? {}) as Failure;
  const code = String(e?.code ?? '');
  const raw = String(e?.message ?? err ?? '');
  const text = raw.toLowerCase();
  if (err instanceof TypeError || raw === ERR_NETWORK || text.includes('fetch') || text.includes('network') || text.includes('timeout') || text.includes('failed to')) return { kind: 'network', text: ROLE_ERR_NETWORK };
  if (code === 'P0002' || text.includes('profile_missing')) return { kind: 'profile', text: ROLE_ERR_PROFILE };
  if (code === '42501') {
    // «forbidden»/JWT — сессия или права входа; прочий 42501 (например, отзыв EXECUTE) — общий отказ прав
    return text.includes('forbidden') || text.includes('jwt') ? { kind: 'session', text: ROLE_ERR_SESSION } : { kind: 'generic', text: ROLE_ERR_GENERIC };
  }
  if (text.includes('jwt') || text.includes('refresh token') || text.includes('auth session') || text.includes('session missing')) return { kind: 'session', text: ROLE_ERR_SESSION };
  return { kind: 'generic', text: ROLE_ERR_GENERIC };
}

function failure(err: unknown): SaveRoleResult & { ok: false } {
  return { ok: false, ...classify(err) };
}

/** Понятный текст вместо сообщения Supabase/сети: сырые тексты, имена функций и коды пользователю не показываются (#705). */
export function roleErrorMessage(err: unknown): string {
  return classify(err).text;
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
      return failure(res.error);
    }
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) {
      console.error('set_my_role: getUser', authErr);
      const c = classify(authErr);
      return c.kind === 'network' ? { ok: false, text: c.text, kind: 'network' } : { ok: false, text: ROLE_ERR_SESSION, kind: 'session' };
    }
    if (!auth.user) return { ok: false, text: ROLE_ERR_SESSION, kind: 'session' };
    const back = await supabase.from('users').select('chosen_role').eq('id', auth.user.id).maybeSingle();
    if (back.error) {
      console.error('set_my_role: чтение роли', back.error);
      return failure(back.error);
    }
    if (!back.data) return { ok: false, text: ROLE_ERR_PROFILE, kind: 'profile' };
    if (back.data.chosen_role !== r) return { ok: false, text: ROLE_ERR_GENERIC, kind: 'generic' };
    return { ok: true };
  } catch (e) {
    console.error('set_my_role', e);
    return failure(e);
  }
}
