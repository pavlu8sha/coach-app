import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

export interface ConfirmRequest {
  title: string;
  /** Что именно будет записано: сумма, игрок, за что, месяц, способ, дата. Пустые строки не показываются. */
  lines?: [label: string, value: string | null | undefined][];
  /** Текст предупреждения, например «Запись нельзя изменить или удалить». */
  note?: string;
  confirmLabel: string;
  /** Для необратимых действий: кнопка подтверждения красная, «Отмена» в фокусе. */
  danger?: boolean;
}

/**
 * Общий вид модальных окон. Подложка почти непрозрачная, а карточка получает свой непрозрачный фон:
 * `.ks-group .ks-card` делает карточки прозрачными, и без явного фона блоки под окном просвечивали бы.
 * Окно центрируется через `margin: auto`, поэтому высокое окно не обрезается сверху и прокручивается
 * внутри подложки; `overscrollBehavior: contain` не даёт прокрутке уходить в страницу под окном.
 */
export const sheetOverlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', zIndex: 1000, padding: 16,
  overflowY: 'auto', overscrollBehavior: 'contain',
};
export const sheetCardStyle: CSSProperties = {
  width: '100%', maxWidth: 420, margin: 'auto', borderRadius: 20, padding: 20,
  background: 'var(--ks-surface, #ffffff)', opacity: 1, position: 'relative',
};

/** Окно подтверждения: показывает, что именно будет сделано, и ждёт явного нажатия. Esc и фон закрывают без действия. */
export function ConfirmSheet({ title, lines = [], note, confirmLabel, danger, onConfirm, onCancel }: ConfirmRequest & { onConfirm: () => void; onCancel: () => void }) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  useBodyScrollLock();

  const shown = lines.filter((l): l is [string, string] => Boolean(l[1]));
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onCancel}
      style={sheetOverlayStyle}
    >
      <div className="ks-card" onClick={e => e.stopPropagation()} style={sheetCardStyle}>
        <h3 style={{ marginTop: 0, textAlign: 'center' }}>{title}</h3>
        {shown.length > 0 && (
          <dl style={{ margin: '12px 0', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 16px', alignItems: 'baseline' }}>
            {shown.map(([label, value]) => (
              <div key={label} style={{ display: 'contents' }}>
                <dt className="ks-muted" style={{ fontSize: 13 }}>{label}</dt>
                <dd style={{ margin: 0, overflowWrap: 'anywhere', textAlign: 'right' }}><b>{value}</b></dd>
              </div>
            ))}
          </dl>
        )}
        {note && <p className="muted" style={{ fontSize: 13, textAlign: 'center' }}>{note}</p>}
        <div className="ks-actions" style={{ flexWrap: 'wrap' }}>
          <button ref={cancelRef} type="button" className="ks-btn secondary" style={{ flex: '1 1 120px' }} onClick={onCancel}>Отмена</button>
          <button type="button" className="ks-btn" style={{ flex: '1 1 120px', ...(danger ? { background: 'var(--danger, #c0392b)' } : {}) }} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Блокирует прокрутку страницы под окном. `overflow: hidden` на body в iOS-вебвью (Telegram) не работает,
 * поэтому тело страницы фиксируется на текущей позиции, а после закрытия позиция восстанавливается.
 */
export function useBodyScrollLock() {
  useEffect(() => {
    const body = document.body;
    const scrollY = window.scrollY;
    const prev = { position: body.style.position, top: body.style.top, left: body.style.left, right: body.style.right, width: body.style.width, overflow: body.style.overflow };
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    body.style.overflow = 'hidden';
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.left = prev.left;
      body.style.right = prev.right;
      body.style.width = prev.width;
      body.style.overflow = prev.overflow;
      window.scrollTo(0, scrollY);
    };
  }, []);
}

/** Промис-обёртка: `if (!(await ask({...}))) return;` — возвращает true только после нажатия кнопки подтверждения. */
export function useConfirm() {
  const [req, setReq] = useState<ConfirmRequest | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const ask = useCallback((r: ConfirmRequest) => new Promise<boolean>(resolve => {
    resolver.current?.(false);
    resolver.current = resolve;
    setReq(r);
  }), []);

  const close = useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setReq(null);
  }, []);

  const dialog = req ? <ConfirmSheet {...req} onConfirm={() => close(true)} onCancel={() => close(false)} /> : null;
  return { ask, dialog };
}
