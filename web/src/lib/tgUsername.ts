import { SUPABASE_URL } from './supabase';
import { inTelegram, tgApp } from './telegram';

// Ник родителя в Telegram для кнопки «Написать в Telegram» у тренера и администратора (миграция 0218).
// Клиент ник не пишет: он отправляет подписанные initData в Edge Function tg-auth, а та проверяет подпись и пишет ник
// в строку именно этого Telegram-аккаунта (при обычном входе — сразу в tg-auth, здесь — при повторном открытии с живой сессией).
let done = false;

/** Тест: сбросить отметку «уже отправлено за это открытие». */
export const resetTgUsernameSync = () => { done = false; };

/** Один раз за открытие внутри Telegram с живой сессией попросить сервер обновить ник по проверенным initData. Ошибки молча игнорируются. */
export async function syncTelegramUsername(): Promise<void> {
  if (done || !inTelegram()) return;
  const initData = tgApp()?.initData;
  if (!initData) return;
  done = true;
  try {
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
    await fetch(`${SUPABASE_URL}/functions/v1/tg-auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key },
      body: JSON.stringify({ initData, username_only: true }),
    });
  } catch {
    // ник не критичен: вход и экраны работают без него
  }
}
