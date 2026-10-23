// Обёртка над Telegram.WebApp (скрипт подключён в index.html). Вне Telegram window.Telegram.WebApp.initData пустой.
interface TgWebApp {
  initData: string;
  initDataUnsafe?: { user?: { language_code?: string } };
  ready(): void;
  expand(): void;
  themeParams: Record<string, string | undefined>;
}
declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp };
  }
}

export const tgApp = (): TgWebApp | null => window.Telegram?.WebApp ?? null;

/** Подписанные данные запуска; null, если страница открыта не из Telegram. */
export const initData = (): string | null => {
  const d = tgApp()?.initData;
  return d ? d : null;
};

/** Сообщить Telegram, что страница готова, раскрыть на весь экран и перенять цвета темы. */
export function prepareTelegram(): void {
  const app = tgApp();
  if (!app) return;
  app.ready();
  app.expand();
  const map: Record<string, string> = {
    bg_color: '--bg',
    secondary_bg_color: '--bg-2',
    text_color: '--fg',
    hint_color: '--muted',
    button_color: '--accent',
    button_text_color: '--accent-fg',
  };
  for (const [k, v] of Object.entries(map)) {
    const val = app.themeParams[k];
    if (val) document.documentElement.style.setProperty(v, val);
  }
}

/** Язык интерфейса: русский, если в Telegram русский, иначе английский. */
export const preferredLang = (): 'ru' | 'en' => (tgApp()?.initDataUnsafe?.user?.language_code?.startsWith('ru') ? 'ru' : 'en');
