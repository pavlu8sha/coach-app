import { tgApp } from './telegram';

// Параметр запуска Mini App: ссылка t.me/kicksapp?startapp=camp_<имя> (Issue #470, условие 62).
// Имя проверяется так же, как при сохранении в настройках сбора: 3-60 латинских букв и цифр, дефисы только между ними.
const CAMP = /^camp_([a-z0-9]+(?:-[a-z0-9]+)*)$/i;

export function campSlugFromStart(v: string | null | undefined): string | null {
  const m = typeof v === 'string' ? CAMP.exec(v) : null;
  const s = m ? m[1].toLowerCase() : null;
  return s && s.length >= 3 && s.length <= 60 ? s : null;
}

// Параметр лежит в Telegram.WebApp.initDataUnsafe.start_param, а в браузере Telegram Web ещё и в адресе (tgWebAppStartParam)
function readRaw(): string | null {
  const fromApp = tgApp()?.initDataUnsafe?.start_param;
  if (fromApp) return fromApp;
  try {
    const q = new URLSearchParams(window.location.search).get('tgWebAppStartParam');
    if (q) return q;
    return new URLSearchParams(window.location.hash.replace(/^#/, '')).get('tgWebAppStartParam');
  } catch {
    return null;
  }
}

// Один раз за запуск: после применения (или отказа) значение сбрасывается и экран повторно не открывается
let state: { slug: string | null } | null = null;
const load = () => (state ??= { slug: campSlugFromStart(readRaw()) });

export const peekCampSlug = (): string | null => load().slug;
export function takeCampSlug(): string | null {
  const s = load();
  const v = s.slug;
  s.slug = null;
  return v;
}
/** Только для тестов. */
export const resetStartParam = () => { state = null; };
