// Тема UI-kit внутри Telegram. Не вызывается, пока не выбран вариант (docs/MINIAPP_UI_PLAN.md, решение 1).
// Рекомендуемый вариант «гибрид»: светлая/тёмная — как в Telegram, фон и поверхности — из темы Telegram,
// основной цвет (кнопки, выбранные вкладки) — синий клуба, чтобы приложение узнавалось.

interface TgThemeApp {
  colorScheme?: 'light' | 'dark';
  themeParams: Record<string, string | undefined>;
  setHeaderColor?: (c: string) => void;
  setBackgroundColor?: (c: string) => void;
  onEvent?: (e: 'themeChanged', cb: () => void) => void;
}

const app = (): TgThemeApp | null => (window as unknown as { Telegram?: { WebApp?: TgThemeApp } }).Telegram?.WebApp ?? null;

export type ThemeMode = 'club' | 'telegram' | 'hybrid';

/** Применить тему UI-kit. club — только цвета клуба (светлая/тёмная по Telegram); telegram — полностью цвета Telegram;
 *  hybrid — фон из Telegram, основной цвет клуба. Вне Telegram ничего не делает (работает тема устройства). */
export function applyTelegramTheme(mode: ThemeMode = 'hybrid'): void {
  const tg = app();
  if (!tg) return;
  const root = document.documentElement;
  const run = () => {
    root.setAttribute('data-theme', tg.colorScheme === 'dark' ? 'dark' : 'light');
    const p = tg.themeParams;
    const set = (v: string, val?: string) => (val ? root.style.setProperty(v, val) : root.style.removeProperty(v));
    const bg = mode === 'club' ? undefined : p.secondary_bg_color || p.bg_color;
    const surface = mode === 'club' ? undefined : p.bg_color;
    set('--ks-bg', bg);
    set('--ks-surface', surface);
    if (mode === 'telegram') {
      set('--ks-text', p.text_color);
      set('--ks-text-muted', p.hint_color);
      set('--ks-primary', p.button_color);
      set('--ks-on-primary', p.button_text_color);
    } else {
      ['--ks-text', '--ks-text-muted', '--ks-primary', '--ks-on-primary'].forEach(v => root.style.removeProperty(v));
    }
    // Шапка и фон самого Telegram — в цвет фона приложения, без полосы другого цвета сверху
    const real = getComputedStyle(root).getPropertyValue('--ks-bg').trim();
    if (real) {
      try {
        tg.setHeaderColor?.(real);
        tg.setBackgroundColor?.(real);
      } catch {
        /* старые клиенты Telegram не поддерживают произвольный цвет — оставляем их цвет */
      }
    }
  };
  run();
  tg.onEvent?.('themeChanged', run);
}
