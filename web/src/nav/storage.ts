// Хранение состояния навигации в localStorage по белому списку.
// Пишем только объявленные поля (белый список) и короткие идентификаторы; поиск, тексты форм и суммы на диск не попадают.
// При запуске состояние читается и проверяется заново (nav/restore.ts): права, существование данных, «только сегодня».
import type { NavEntry } from './store';

export const STORAGE_PREFIX = 'ks.nav.';
export const STORAGE_VERSION = 1;

export type PersistSpec =
  | { kind: 'enum'; values: readonly string[] }
  | { kind: 'bool' }
  | { kind: 'uuid' }
  | { kind: 'int'; min?: number; max?: number }
  /** Дата ГГГГ-ММ-ДД, которая восстанавливается только в тот же день, когда была сохранена. */
  | { kind: 'day' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9_.-]{1,40}$/i;

export function validateValue(spec: PersistSpec, v: unknown): boolean {
  switch (spec.kind) {
    case 'enum': return typeof v === 'string' && spec.values.includes(v);
    case 'bool': return typeof v === 'boolean';
    case 'uuid': return typeof v === 'string' && UUID.test(v);
    case 'day': return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
    case 'int': return typeof v === 'number' && Number.isInteger(v) && v >= (spec.min ?? -1e9) && v <= (spec.max ?? 1e9);
  }
}

/** Ключ реестра объявленных полей: раздел, экран и имя поля. */
export const specKey = (root: string, screen: string, key: string) => `${root}|${screen}|${key}`;

export interface Snapshot {
  v: number;
  active: string | null;
  /** Локальная дата записи: значения kind 'day' из другого дня не восстанавливаются. */
  day: string;
  stacks: Record<string, { screen: string; params: Record<string, string>; ui: Record<string, string | number | boolean>; daily?: string[]; scrollY: number }[]>;
}

export const localDay = (d = new Date()): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Снимок для записи: только объявленные и прошедшие проверку поля; params — только UUID или короткие slug. */
export function buildSnapshot(state: { active: string | null; stacks: Record<string, NavEntry[]> }, specs: ReadonlyMap<string, PersistSpec>, day = localDay()): Snapshot {
  const stacks: Snapshot['stacks'] = {};
  for (const [root, entries] of Object.entries(state.stacks)) {
    if (!SLUG.test(root)) continue;
    stacks[root] = entries
      .filter(e => SLUG.test(e.screen))
      .map(e => {
        const params: Record<string, string> = {};
        for (const [k, val] of Object.entries(e.params)) if (SLUG.test(k) && (UUID.test(val) || SLUG.test(val))) params[k] = val;
        const ui: Record<string, string | number | boolean> = {};
        const daily: string[] = [];
        for (const [k, val] of Object.entries(e.ui)) {
          const spec = specs.get(specKey(root, e.screen, k));
          if (spec && validateValue(spec, val)) {
            ui[k] = val as string | number | boolean;
            if (spec.kind === 'day') daily.push(k);
          }
        }
        return { screen: e.screen, params, ui, ...(daily.length ? { daily } : {}), scrollY: Math.max(0, Math.round(e.scrollY)) };
      });
  }
  return { v: STORAGE_VERSION, active: state.active, day, stacks };
}

export const storageKey = (userId: string, mode: string) => `${STORAGE_PREFIX}v${STORAGE_VERSION}:${userId}:${mode}`;

export function saveSnapshot(userId: string, mode: string, snap: Snapshot): void {
  try {
    localStorage.setItem(storageKey(userId, mode), JSON.stringify(snap));
  } catch {
    /* хранилище недоступно — приложение работает без восстановления */
  }
}

/** Прочитать снимок. Чужая версия или повреждённые данные удаляются. */
export function loadSnapshot(userId: string, mode: string): Snapshot | null {
  const key = storageKey(userId, mode);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const s = JSON.parse(raw) as Snapshot;
    if (!s || s.v !== STORAGE_VERSION || typeof s.day !== 'string' || typeof s.stacks !== 'object') throw new Error('version');
    return s;
  } catch {
    try { localStorage.removeItem(key); } catch { /* ничего */ }
    return null;
  }
}

/** Удалить всё состояние навигации; keepUserId — оставить только этого пользователя (при смене пользователя). */
export function clearNavStorage(keepUserId?: string): void {
  try {
    const drop: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(STORAGE_PREFIX)) continue;
      const rest = k.slice(STORAGE_PREFIX.length).split(':'); // v1:<userId>:<mode>
      if (keepUserId === undefined || rest[0] !== `v${STORAGE_VERSION}` || rest[1] !== keepUserId) drop.push(k);
    }
    drop.forEach(k => localStorage.removeItem(k));
  } catch {
    /* хранилище недоступно */
  }
}
