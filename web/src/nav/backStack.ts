// Единая «Назад»: стек обработчиков + записи истории браузера + нативная кнопка Telegram.
// Каждый зарегистрированный обработчик = одна запись в history. Системная «Назад» (popstate) вызывает верхний обработчик,
// кнопка в интерфейсе/Telegram тоже; когда обработчик снят без системного шага, лишняя запись истории убирается.
import { inTelegram, tgApp } from '../lib/telegram';

export interface HistoryAdapter {
  push(): void;
  go(delta: number): void;
  onPop(cb: () => void): () => void;
}

export const browserHistory: HistoryAdapter = {
  push: () => window.history.pushState({ ks: 1 }, ''),
  go: d => window.history.go(d),
  onPop: cb => {
    window.addEventListener('popstate', cb);
    return () => window.removeEventListener('popstate', cb);
  },
};

interface Item {
  handler: () => void;
  consumed: boolean; // запись истории уже снята системным шагом
}

export class BackStack {
  private items: Item[] = [];
  private ignore = 0; // сколько ближайших popstate вызваны нами самими
  private pendingBack = 0;
  private listeners = new Set<() => void>();

  constructor(private h: HistoryAdapter) {
    h.onPop(this.onPop);
    // Браузер сам возвращает прокрутку при шаге по истории и делает это уже после нашего восстановления:
    // каталог «Ещё» после возврата из раздела оказывался вверху. Позицию возвращает только слой nav.
    try {
      if (typeof window !== 'undefined' && 'scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
    } catch { /* не критично */ }
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  size = (): number => this.items.length;
  private notify() {
    this.listeners.forEach(l => l());
  }

  /** Добавить обработчик «Назад» (становится верхним). Возвращает функцию снятия. */
  register(handler: () => void): () => void {
    const item: Item = { handler, consumed: false };
    this.items.push(item);
    this.h.push();
    this.notify();
    return () => {
      const i = this.items.indexOf(item);
      if (i < 0) return;
      this.items.splice(i, 1);
      if (!item.consumed) this.queueBack();
      this.notify();
    };
  }

  /** Вызвать верхний обработчик (кнопка в интерфейсе или нативная кнопка Telegram). */
  invoke(): boolean {
    const it = this.items[this.items.length - 1];
    if (!it) return false;
    it.handler();
    return true;
  }

  // Несколько обработчиков могут сняться в одном обновлении (смена раздела): откатываем историю одним переходом.
  private queueBack() {
    this.pendingBack += 1;
    if (this.pendingBack > 1) return;
    queueMicrotask(() => {
      const n = this.pendingBack;
      this.pendingBack = 0;
      if (n > 0) {
        this.ignore += 1;
        this.h.go(-n);
      }
    });
  }

  private onPop = () => {
    if (this.ignore > 0) {
      this.ignore -= 1;
      return;
    }
    const it = this.items[this.items.length - 1];
    if (!it) return; // истории приложения нет: браузер уходит как обычно
    it.consumed = true;
    it.handler();
    // Обработчик не снял себя (экран остался): возвращаем запись истории, чтобы следующий шаг снова сработал.
    setTimeout(() => {
      if (this.items.includes(it)) {
        it.consumed = false;
        this.h.push();
      }
    }, 0);
  };
}

let shared: BackStack | null = null;
/** Общий стек страницы: история браузера одна, поэтому и стек один. */
export function backStack(): BackStack {
  if (!shared) {
    shared = new BackStack(browserHistory);
    shared.subscribe(syncTelegramButton);
  }
  return shared;
}

let tgHandler: (() => void) | null = null;
function syncTelegramButton() {
  const b = tgApp()?.BackButton;
  if (!inTelegram() || !b) return;
  const stack = shared;
  if (!stack) return;
  if (!tgHandler) {
    tgHandler = () => void stack.invoke();
    b.onClick(tgHandler);
  }
  if (stack.size() > 0) b.show();
  else b.hide();
}
