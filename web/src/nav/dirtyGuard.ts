// Предупреждение о несохранённых изменениях. Форма сообщает «есть правки» через useDirtyGuard; любой уход
// (кнопка «Назад», системная «Назад», нативная кнопка Telegram, смена вкладки) сначала спрашивает подтверждение.
// Закрытие вкладки и обновление: beforeunload в браузере и enableClosingConfirmation в Telegram (где платформа это позволяет).
// Сами правки нигде не сохраняются: черновики на диск не пишем.
import { useEffect, useRef } from 'react';
import { inTelegram, tgApp } from '../lib/telegram';

type Asker = () => Promise<boolean>;

class DirtyGuard {
  private dirty = new Set<symbol>();
  private asker: Asker | null = null;
  private pending: Promise<boolean> | null = null;
  private unloadOn = false;

  setAsker(a: Asker | null) {
    this.asker = a;
  }
  set(token: symbol, on: boolean) {
    if (on) this.dirty.add(token);
    else this.dirty.delete(token);
    this.syncPlatform();
  }
  isDirty = (): boolean => this.dirty.size > 0;

  /** true — можно уходить (правок нет или пользователь подтвердил). Параллельные вопросы сливаются в один. */
  confirmLeave = (): Promise<boolean> => {
    if (!this.isDirty()) return Promise.resolve(true);
    if (this.pending) return this.pending;
    const ask = this.asker ? this.asker() : Promise.resolve(true);
    this.pending = ask.then(
      ok => { this.pending = null; return ok; },
      () => { this.pending = null; return false; },
    );
    return this.pending;
  };

  /** Выполнить уход, если правок нет или пользователь подтвердил. */
  leave = (go: () => void): void => {
    if (!this.isDirty()) return go();
    void this.confirmLeave().then(ok => { if (ok) go(); });
  };

  private onUnload = (e: BeforeUnloadEvent) => {
    if (!this.isDirty()) return;
    e.preventDefault();
    e.returnValue = ''; // браузер покажет свой стандартный диалог
  };
  private syncPlatform() {
    const on = this.isDirty();
    if (on !== this.unloadOn) {
      this.unloadOn = on;
      if (on) window.addEventListener('beforeunload', this.onUnload);
      else window.removeEventListener('beforeunload', this.onUnload);
      // Telegram не даёт перехватить закрытие или перезагрузку, только включить стандартное подтверждение (где клиент его поддерживает)
      const app = tgApp();
      if (inTelegram() && app) {
        if (on) app.enableClosingConfirmation?.();
        else app.disableClosingConfirmation?.();
      }
    }
  }
  /** Для тестов. */
  reset() {
    this.dirty.clear();
    this.pending = null;
    this.asker = null;
    this.syncPlatform();
  }
}

export const dirtyGuard = new DirtyGuard();

/** Форма сообщает, что в ней есть несохранённые правки. При размонтировании (сохранение, уход) отметка снимается. */
export function useDirtyGuard(dirty: boolean): void {
  const token = useRef<symbol>(Symbol('dirty'));
  useEffect(() => {
    const t = token.current;
    dirtyGuard.set(t, dirty);
    return () => dirtyGuard.set(t, false);
  }, [dirty]);
}
