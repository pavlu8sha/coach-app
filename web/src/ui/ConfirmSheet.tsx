import { useCallback, useEffect, useRef, useState } from 'react';

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

/** Окно подтверждения: показывает, что именно будет сделано, и ждёт явного нажатия. Esc и фон закрывают без действия. */
export function ConfirmSheet({ title, lines = [], note, confirmLabel, danger, onConfirm, onCancel }: ConfirmRequest & { onConfirm: () => void; onCancel: () => void }) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const shown = lines.filter((l): l is [string, string] => Boolean(l[1]));
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onCancel}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
    >
      <div className="ks-card" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, margin: 0, borderRadius: 20, padding: 20 }}>
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
    </div>
  );
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
