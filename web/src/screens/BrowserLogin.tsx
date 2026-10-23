import { useEffect, useRef } from 'react';

const BOT = (import.meta.env.VITE_TG_BOT_USERNAME as string | undefined)?.replace(/^@/, '');

/** Вход из браузера включён, если задано имя бота (VITE_TG_BOT_USERNAME) и в BotFather указан домен сайта (/setdomain). */
export const browserLoginEnabled = Boolean(BOT);

// Кнопка «Войти через Telegram» (виджет Telegram Login). Подпись проверяет сервер (Edge Function tg-login).
export default function BrowserLogin({ onUser }: { onUser: (user: Record<string, unknown>) => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!BOT || !box.current) return;
    const w = window as unknown as Record<string, unknown>;
    w.__tgLogin = onUser;
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://telegram.org/js/telegram-widget.js?22';
    s.setAttribute('data-telegram-login', BOT);
    s.setAttribute('data-size', 'large');
    s.setAttribute('data-radius', '12');
    s.setAttribute('data-userpic', 'false');
    s.setAttribute('data-onauth', '__tgLogin(user)');
    box.current.appendChild(s);
    return () => {
      delete w.__tgLogin;
      s.remove();
    };
  }, [onUser]);
  return (
    <main className="page center">
      <h1>Вход</h1>
      <p className="muted">Войдите через свой аккаунт Telegram: это тот же вход, что и в приложении в Telegram, дети и данные те же.</p>
      <div ref={box} style={{ marginTop: 12, minHeight: 48 }} />
    </main>
  );
}
