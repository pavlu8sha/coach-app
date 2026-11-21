import { supabase } from './supabase';
import { inTelegram, tgApp } from './telegram';

// Ник родителя в Telegram для кнопки «Написать в Telegram» у тренера и администратора (миграция 0218).
// Ник берётся из initDataUnsafe и не подписан (проверка подписи возможна только в Edge Function), поэтому годится лишь как контакт.
let done = false;

/** Тест: сбросить отметку «уже отправлено за это открытие». */
export const resetTgUsernameSync = () => { done = false; };

/** Один раз за открытие внутри Telegram передать базе свой ник (или null, если ника нет, чтобы очистить прежний). Ошибки молча игнорируются: до применения 0218 функции в базе нет. */
export async function syncTelegramUsername(): Promise<void> {
  if (done || !inTelegram()) return;
  done = true;
  try {
    await supabase.rpc('set_my_tg_username', { p: tgApp()?.initDataUnsafe?.user?.username ?? null });
  } catch {
    // ник не критичен: вход и экраны работают без него
  }
}
