import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useBodyScrollLock } from './ConfirmSheet';

/** Нижнее окно «Фильтры»: содержимое передаёт экран. Esc, фон и «Показать» закрывают, фильтры применяются сразу. */
export function FilterSheet({ title = 'Фильтры', children, showLabel, onReset, onClose }: { title?: string; children: ReactNode; showLabel: string; onReset: () => void; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const closeNow = useRef(onClose);
  closeNow.current = onClose; // Esc вызывает актуальный обработчик, не переподписываясь на каждый рендер
  useBodyScrollLock();
  const sheetRef = useRef<HTMLDivElement | null>(null);
  // начальный фокус один раз (правки фильтров его не сбрасывают); при закрытии фокус возвращается на кнопку, открывшую окно
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, []);
  // Tab и Shift+Tab ходят по кругу внутри окна и не уходят на фон
  const trapTab = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const items = Array.from(sheetRef.current?.querySelectorAll<HTMLElement>('button, select, input, [href], [tabindex]:not([tabindex="-1"])') ?? []).filter(el => !el.hasAttribute('disabled'));
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1], at = document.activeElement;
    if (e.shiftKey && (at === first || !sheetRef.current?.contains(at))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (at === last || !sheetRef.current?.contains(at))) { e.preventDefault(); first.focus(); }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeNow.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return createPortal(
    <div className="ks-sheet-back" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="ks-sheet" ref={sheetRef} onKeyDown={trapTab} onClick={e => e.stopPropagation()}>
        <div className="ks-sheet-head">
          <h3>{title}</h3>
          <button type="button" className="ks-link" onClick={onReset}>Сбросить</button>
        </div>
        {children}
        <button type="button" ref={closeRef} className="ks-btn" onClick={onClose}>{showLabel}</button>
      </div>
    </div>,
    document.body,
  );
}
