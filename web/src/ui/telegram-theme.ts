// Тема UI-kit внутри Telegram (docs/MINIAPP_UI_PLAN.md, решение 1: гибрид) и личный выбор темы родителем (lib/theme.ts).
// Рекомендуемый вариант «гибрид»: светлая/тёмная — как в Telegram, фон и поверхности — из темы Telegram,
// основной цвет (кнопки, выбранные вкладки) — синий клуба, чтобы приложение узнавалось.

import { getThemePref } from '../lib/theme';

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
 *  hybrid — фон из Telegram, основной цвет клуба. Вне Telegram «авто» — тема устройства. Личный выбор темы (lib/theme.ts) главнее. */
export function applyTelegramTheme(mode: ThemeMode = 'hybrid'): void {
  const tg = app();
  const root = document.documentElement;
  if (!tg) {
    // вне Telegram: «авто» — тема устройства (media-запрос в tokens.css), иначе выбранная
    const pref = getThemePref();
    if (pref === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', pref);
    return;
  }
  const run = () => {
    const pref = getThemePref();
    const scheme = tg.colorScheme === 'dark' ? 'dark' : 'light';
    // свой выбор, отличный от схемы Telegram: цвета фона Telegram не подмешиваем, иначе тёмный фон под светлой темой
    const forced = pref !== 'auto' && pref !== scheme;
    root.setAttribute('data-theme', pref === 'auto' ? scheme : pref);
    const p = tg.themeParams;
    const set = (v: string, val?: string) => (val ? root.style.setProperty(v, val) : root.style.removeProperty(v));
    const bg = mode === 'club' || forced ? undefined : p.secondary_bg_color || p.bg_color;
    const surface = mode === 'club' || forced ? undefined : p.bg_color;
    set('--ks-bg', bg);
    set('--ks-surface', surface);
    if (mode === 'telegram' && !forced) {
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
  if (!applied) {
    applied = true;
    tg.onEvent?.('themeChanged', () => applyTelegramTheme(mode));
  }
}
let applied = false;
