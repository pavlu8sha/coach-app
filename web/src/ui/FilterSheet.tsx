import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useBodyScrollLock } from './ConfirmSheet';

/** Нижнее окно «Фильтры»: содержимое передаёт экран. Esc, фон и «Показать» закрывают, фильтры применяются сразу. */
export function FilterSheet({ title = 'Фильтры', children, showLabel, onReset, onClose }: { title?: string; children: ReactNode; showLabel: string; onReset: () => void; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const closeNow = useRef(onClose);
  closeNow.current = onClose; // Esc вызывает актуальный обработчик, не переподписываясь на каждый рендер
  useBodyScrollLock();
  useEffect(() => { closeRef.current?.focus(); }, []); // начальный фокус один раз: правки фильтров его не сбрасывают
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeNow.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return createPortal(
    <div className="ks-sheet-back" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="ks-sheet" onClick={e => e.stopPropagation()}>
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
