// Хранилище навигации: независимый стек экранов на каждый раздел (корень). Без React и без браузерных API,
// поэтому полностью проверяется юнит-тестами. Правила состояния описаны в notes/tech-assessment-518-nav-state-2026-11-06.md.

export interface NavEntry {
  id: number;
  /** Имя экрана: для корня — id раздела, для вложенного — имя, выбранное вызывающим кодом. */
  screen: string;
  /** Идентификаторы и короткие метки (UUID / slug). Имена, суммы и тексты сюда не кладём. */
  params: Record<string, string>;
  /** Состояние интерфейса экрана (вкладка, фильтр, раскрытые блоки). На диск попадает только объявленное через persist. */
  ui: Record<string, unknown>;
  scrollY: number;
  /** Ключи ui, поднятые с диска и ещё не выбранные пользователем: useNavState проверяет их по правилу persist. */
  fromDisk?: string[];
}

export interface NavStoreOptions {
  /** Текущая вертикальная прокрутка страницы; в тестах подменяется. */
  readScroll?: () => number;
}

export class NavStore {
  private stacks = new Map<string, NavEntry[]>();
  private active: string | null = null;
  private scope = '';
  private nextId = 1;
  private version = 0;
  private listeners = new Set<() => void>();
  private readScroll: () => number;
  private restored = false;

  constructor(opts: NavStoreOptions = {}) {
    this.readScroll = opts.readScroll ?? (() => (typeof window === 'undefined' ? 0 : window.scrollY));
  }

  // ----- подписка (для useSyncExternalStore) -----
  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  getVersion = (): number => this.version;
  private bump(): void {
    this.version += 1;
    this.listeners.forEach(l => l());
  }

  // ----- чтение -----
  getActive(): string | null {
    return this.active;
  }
  getScope(): string {
    return this.scope;
  }
  /** Стек раздела; запись корня создаётся при первом обращении. Ссылка остаётся прежней, пока стек не менялся. */
  entries(root: string): NavEntry[] {
    let s = this.stacks.get(root);
    if (!s) {
      s = [this.make(root, {})];
      this.stacks.set(root, s);
    }
    return s;
  }
  top(root: string): NavEntry {
    const s = this.entries(root);
    return s[s.length - 1];
  }
  depth(root: string): number {
    return this.entries(root).length;
  }
  /** Копия состояния для сериализации (см. storage.ts). */
  exportState(): { active: string | null; stacks: Record<string, NavEntry[]> } {
    this.captureScroll();
    return { active: this.active, stacks: Object.fromEntries(this.stacks) };
  }

  // ----- изменение -----
  /**
   * Область состояния: пользователь и режим (реальная роль / «Родитель» / предпросмотр).
   * При смене области все стеки очищаются, чтобы состояние разных пользователей и режимов не смешивалось.
   * Выбранный раздел остаётся: его определяет вызывающий код.
   */
  setScope(scope: string): void {
    if (scope === this.scope) return;
    this.scope = scope;
    this.stacks = new Map();
    this.bump();
  }
  /** Полный сброс (выход из аккаунта). */
  reset(): void {
    this.restored = false;
    this.scope = '';
    this.stacks = new Map();
    this.active = null;
    this.bump();
  }
  /** Восстановление уже выполнялось с момента запуска (или входа): повторно, при смене режима, состояние не поднимаем. */
  hasRestored(): boolean {
    return this.restored;
  }
  /**
   * Поднять сохранённое состояние. Раздел, которого у роли нет, пропускается; вложенные экраны берутся
   * по списку restorable и обрываются на первом неподходящем; значения «только сегодня» из прошлых дней отбрасываются.
   */
  hydrate(
    snap: { active: string | null; day: string; stacks: Record<string, { screen: string; params: Record<string, string>; ui: Record<string, unknown>; daily?: string[]; scrollY: number }[]> } | null,
    o: { allowRoot: (root: string) => boolean; restorable: (screen: string, params: Record<string, string>) => boolean; today: string },
  ): void {
    this.restored = true;
    if (snap) {
      for (const [root, list] of Object.entries(snap.stacks)) {
        if (!o.allowRoot(root) || list.length === 0 || list[0].screen !== root) continue;
        const entries: NavEntry[] = [];
        for (let i = 0; i < list.length; i++) {
          const e = list[i];
          if (i > 0 && !o.restorable(e.screen, e.params)) break;
          const ui = { ...e.ui };
          if (snap.day !== o.today) for (const k of e.daily ?? []) delete ui[k];
          entries.push({ id: this.nextId++, screen: e.screen, params: { ...e.params }, ui, scrollY: e.scrollY, fromDisk: Object.keys(ui) });
        }
        this.stacks.set(root, entries);
      }
      if (snap.active && o.allowRoot(snap.active)) this.active = snap.active;
    }
    this.bump();
  }
  /** Переключить раздел. Повторный выбор активного раздела ничего не меняет: ни стек, ни позицию. */
  selectRoot(root: string): void {
    if (root === this.active) return;
    this.captureScroll();
    this.active = root;
    this.entries(root);
    this.bump();
  }
  /** Открыть вложенный экран раздела. Позиция прокрутки текущего экрана запоминается. */
  push(root: string, e: { screen: string; params?: Record<string, string> }): void {
    if (root === this.active) this.captureScroll();
    this.stacks.set(root, [...this.entries(root), this.make(e.screen, e.params ?? {})]);
    this.bump();
  }
  /** Вернуться на предыдущий экран раздела. false — стек уже на корне. */
  back(root: string): boolean {
    const s = this.entries(root);
    if (s.length <= 1) return false;
    this.stacks.set(root, s.slice(0, -1));
    this.bump();
    return true;
  }
  /** Закрыть все вложенные экраны раздела разом (например, после сохранения формы, открытой из карточки). */
  backToRoot(root: string): boolean {
    const s = this.entries(root);
    if (s.length <= 1) return false;
    this.stacks.set(root, s.slice(0, 1));
    this.bump();
    return true;
  }
  getUi<T>(root: string, index: number, key: string): T | undefined {
    return this.entries(root)[index]?.ui[key] as T | undefined;
  }
  setUi(root: string, index: number, key: string, value: unknown): void {
    const s = this.entries(root);
    const e = s[index];
    if (!e || Object.is(e.ui[key], value)) return;
    const next = s.slice();
    next[index] = { ...e, ui: { ...e.ui, [key]: value }, ...(e.fromDisk ? { fromDisk: e.fromDisk.filter(k => k !== key) } : {}) };
    this.stacks.set(root, next);
    this.bump();
  }
  /** Значение ещё с диска (не менялось пользователем) и потому требует проверки. */
  isFromDisk(root: string, index: number, key: string): boolean {
    return this.entries(root)[index]?.fromDisk?.includes(key) ?? false;
  }
  getScroll(root: string, index: number): number {
    return this.entries(root)[index]?.scrollY ?? 0;
  }
  /** Запомнить прокрутку верхнего экрана активного раздела. Вызывается до смены экрана, пока страница ещё не перестроена. */
  captureScroll(): void {
    if (!this.active) return;
    const s = this.entries(this.active);
    const i = s.length - 1;
    const y = Math.max(0, Math.round(this.readScroll()));
    if (s[i].scrollY === y) return;
    const next = s.slice();
    next[i] = { ...s[i], scrollY: y };
    this.stacks.set(this.active, next); // без bump: перерисовка не нужна
  }

  private make(screen: string, params: Record<string, string>): NavEntry {
    return { id: this.nextId++, screen, params, ui: {}, scrollY: 0 };
  }
}
