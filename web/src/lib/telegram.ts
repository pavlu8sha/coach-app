import { applyTelegramTheme } from '../ui/telegram-theme';
// Обёртка над Telegram.WebApp (скрипт подключён в index.html). Вне Telegram window.Telegram.WebApp.initData пустой.
interface TgWebApp {
  initData: string;
  initDataUnsafe?: { user?: { language_code?: string; first_name?: string; last_name?: string } };
  ready(): void;
  expand(): void;
  themeParams: Record<string, string | undefined>;
  close?(): void;
  BackButton?: TgButton;
  MainButton?: TgMainButton;
}
interface TgButton {
  show(): void;
  hide(): void;
  onClick(cb: () => void): void;
  offClick(cb: () => void): void;
}
interface TgMainButton extends TgButton {
  setText(t: string): void;
  enable(): void;
  disable(): void;
  showProgress(leaveActive?: boolean): void;
  hideProgress(): void;
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
  if (!app) return applyTelegramTheme('hybrid'); // вне Telegram — только выбранная тема
  app.ready();
  app.expand();
  // Решение владельца 2026-10-23: гибрид — светлая/тёмная и фон из Telegram, основной цвет — синий клуба
  applyTelegramTheme('hybrid');
}

/** Язык интерфейса: русский, если в Telegram русский, иначе английский. */
export const preferredLang = (): 'ru' | 'en' => (tgApp()?.initDataUnsafe?.user?.language_code?.startsWith('ru') ? 'ru' : 'en');

/** Открыто ли приложение внутри Telegram: только тогда доступны нативные кнопки. */
export const inTelegram = (): boolean => Boolean(initData());

/** Имя пользователя из Telegram (видно только ему самому); null вне Telegram. */
export const telegramName = (): string | null => {
  const u = tgApp()?.initDataUnsafe?.user;
  const n = [u?.first_name, u?.last_name].filter(Boolean).join(' ');
  return n || null;
};

/** Закрыть Mini App (вне Telegram — перезагрузить страницу). */
export const closeApp = (): void => {
  const app = tgApp();
  if (inTelegram() && app?.close) app.close();
  else location.reload();
};
