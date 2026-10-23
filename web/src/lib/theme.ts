// Выбор темы родителем: «как в системе / Telegram», светлая или тёмная. Хранится только на устройстве.
export type ThemePref = 'auto' | 'light' | 'dark';
const KEY = 'ks-theme';

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch {
    return 'auto'; // хранилище недоступно (приватный режим и т.п.)
  }
}

export function saveThemePref(p: ThemePref): void {
  try {
    if (p === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, p);
  } catch {
    /* без хранилища выбор действует до закрытия приложения */
  }
}
