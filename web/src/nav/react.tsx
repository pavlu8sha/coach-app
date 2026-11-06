import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { backStack } from './backStack';
import { specKey, type PersistSpec } from './storage';
import { NavStore, type NavEntry } from './store';

interface Ctx {
  store: NavStore;
  specs: Map<string, PersistSpec>;
}
const NavCtx = createContext<Ctx | null>(null);
const EntryCtx = createContext<{ root: string; index: number } | null>(null);

/** Корень навигации приложения: один на сеанс, создаётся над оболочкой. `initial` — раздел, который открыт сразу. */
export function NavProvider({ initial, children }: { initial: string; children: ReactNode }) {
  const [ctx] = useState<Ctx>(() => {
    const store = new NavStore();
    store.selectRoot(initial);
    return { store, specs: new Map() };
  });
  return <NavCtx.Provider value={ctx}>{children}</NavCtx.Provider>;
}

function useCtx(): Ctx {
  const c = useContext(NavCtx);
  if (!c) throw new Error('Навигация: нет NavProvider');
  return c;
}
export const useNavStore = (): NavStore => useCtx().store;

function useVersion(store: NavStore) {
  return useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
}

/** Активный раздел и переключение. Повторный выбор активного раздела ничего не меняет. */
export function useActiveRoot<T extends string>(fallback: T): [T, (r: T) => void] {
  const store = useNavStore();
  useVersion(store);
  const select = useCallback((r: T) => store.selectRoot(r), [store]);
  return [(store.getActive() as T | null) ?? fallback, select];
}

/** Область состояния (пользователь + режим). При смене стеки очищаются. */
export function useNavScope(scope: string | null) {
  const store = useNavStore();
  useEffect(() => {
    if (scope !== null) store.setScope(scope);
  }, [store, scope]);
}

/** Выход из аккаунта: сбросить состояние навигации. */
export function useResetNav(): () => void {
  const store = useNavStore();
  return useCallback(() => store.reset(), [store]);
}

/**
 * Экран-корень раздела. Показывается только для активного раздела. Делает три вещи:
 * вешает «Назад» на каждый вложенный экран стека, восстанавливает прокрутку верхнего экрана и задаёт контекст для useNavState.
 * manualScroll: экран сам вызывает useRestoreScroll(ready) после загрузки данных.
 */
export function NavRoot({ root, manualScroll, children }: { root: string; manualScroll?: boolean; children: ReactNode }) {
  const store = useNavStore();
  useVersion(store);
  const entries = store.entries(root);
  return (
    <EntryCtx.Provider value={{ root, index: entries.length - 1 }}>
      {entries.slice(1).map(e => (
        <EntryBack key={e.id} root={root} />
      ))}
      {!manualScroll && <AutoScroll />}
      {children}
    </EntryCtx.Provider>
  );
}

function AutoScroll() {
  useRestoreScroll(true);
  return null;
}

// Один вложенный экран = один обработчик «Назад» (и одна запись истории браузера).
function EntryBack({ root }: { root: string }) {
  const store = useNavStore();
  useEffect(() => backStack().register(() => void store.back(root)), [store, root]);
  return null;
}

/** Явно указать, к какому экрану стека относится содержимое (когда родитель остаётся смонтированным при открытии вложенного). */
export function NavEntry({ index, children }: { index: number; children: ReactNode }) {
  const cur = useContext(EntryCtx);
  if (!cur) throw new Error('Навигация: NavEntry вне NavRoot');
  return <EntryCtx.Provider value={{ root: cur.root, index }}>{children}</EntryCtx.Provider>;
}

function useEntryCtx() {
  const e = useContext(EntryCtx);
  if (!e) throw new Error('Навигация: экран вне NavRoot');
  return e;
}

/** Стек текущего раздела и действия над ним. */
export function useNav() {
  const store = useNavStore();
  const { root } = useEntryCtx();
  useVersion(store);
  const entries: NavEntry[] = store.entries(root);
  const push = useCallback((screen: string, params?: Record<string, string>) => store.push(root, { screen, params }), [store, root]);
  const back = useCallback(() => store.back(root), [store, root]);
  return { root, entries, top: entries[entries.length - 1], depth: entries.length, push, back };
}

/**
 * Как useState, но значение живёт в записи стека и возвращается при «Назад» и при повторном входе в раздел.
 * На диск попадает только поле с объявленным persist (белый список); без него значение хранится лишь в памяти.
 * Для строки поиска persist не задаём: в ней могут быть имена детей.
 */
export function useNavState<T>(key: string, initial: T, opts?: { persist?: PersistSpec }): [T, (v: T | ((prev: T) => T)) => void] {
  const { store, specs } = useCtx();
  const { root, index } = useEntryCtx();
  useVersion(store);
  const stored = store.getUi<T>(root, index, key);
  const value = stored === undefined ? initial : stored;
  const screen = store.entries(root)[index]?.screen;
  if (opts?.persist && screen) specs.set(specKey(root, screen, key), opts.persist);
  const set = useCallback(
    (v: T | ((prev: T) => T)) => {
      const prev = (store.getUi<T>(root, index, key) ?? initial) as T;
      store.setUi(root, index, key, typeof v === 'function' ? (v as (p: T) => T)(prev) : v);
    },
    // initial — только запасное значение первого чтения
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, root, index, key],
  );
  return [value, set];
}

/** Реестр объявленных полей для сериализации. */
export const useNavSpecs = (): ReadonlyMap<string, PersistSpec> => useCtx().specs;

/**
 * Вернуть прокрутку экрана, на которой пользователь ушёл. Ждёт ready (данные загружены), чтобы экран не открывался сверху.
 * Если пользователь начал прокручивать сам, восстановление прекращается. Новый экран (позиция 0) открывается сверху.
 */
export function useRestoreScroll(ready = true) {
  const store = useNavStore();
  const { root, index } = useEntryCtx();
  const id = store.entries(root)[index]?.id;
  useLayoutEffect(() => {
    if (!ready) return;
    const target = store.getScroll(root, index);
    let raf = 0;
    let tries = 0;
    let stopped = false;
    const events = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const;
    const stop = () => {
      stopped = true;
      cancelAnimationFrame(raf);
      events.forEach(ev => window.removeEventListener(ev, stop));
    };
    const attempt = () => {
      if (stopped) return;
      if (Math.abs(window.scrollY - target) > 1) window.scrollTo(0, target);
      // страница может быть ещё короче нужной высоты (данные догружаются): повторяем до ~1,5 с
      if (Math.abs(window.scrollY - target) <= 1 || ++tries >= 90) return stop();
      raf = requestAnimationFrame(attempt);
    };
    events.forEach(ev => window.addEventListener(ev, stop, { passive: true, once: true }));
    attempt();
    return stop;
  }, [ready, root, id, index, store]);
}
