import { useCallback, useEffect, useRef, useState } from 'react';

// Закрытие долга без поступления денег (#260): вид и причина обязательны, пишутся в абонемент вместе с автором и датой (миграция 0100).
export type ClosureKind = 'discount' | 'forgiven' | 'paid_elsewhere';
export const CLOSURE_LABELS: Record<ClosureKind, string> = { discount: 'Скидка', forgiven: 'Долг прощён', paid_elsewhere: 'Оплачено вне приложения' };
export const CLOSURE_HINTS: Record<ClosureKind, string> = {
  discount: 'Платит меньше или не платит по договорённости.',
  forgiven: 'Долг списан, месяц не показывается в должниках.',
  paid_elsewhere: 'Деньги получены не через приложение, платёж не записан.',
};

/** Флаги абонемента для вида закрытия: «прощён» ставит written_off, остальное discount. Деньги не пишутся ни в одном случае. */
export function closureFlags(kind: ClosureKind): { discount: boolean; written_off: boolean } {
  return kind === 'forgiven' ? { discount: false, written_off: true } : { discount: true, written_off: false };
}

export interface ClosureRequest { title: string; lines?: [string, string | null | undefined][]; defaultKind?: ClosureKind }
export interface ClosureAnswer { kind: ClosureKind; reason: string }

export function ClosureSheet({ title, lines = [], defaultKind = 'discount', onDone, onCancel }: ClosureRequest & { onDone: (a: ClosureAnswer) => void; onCancel: () => void }) {
  const [kind, setKind] = useState<ClosureKind>(defaultKind);
  const [reason, setReason] = useState('');
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  const ok = reason.trim().length >= 3;
  return (
    <div role="dialog" aria-modal="true" aria-label={title} onClick={onCancel}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div className="ks-card" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, margin: 0, borderRadius: 20, padding: 20 }}>
        <h3 style={{ marginTop: 0, textAlign: 'center' }}>{title}</h3>
        {lines.filter(l => l[1]).map(([k, v]) => <p key={k} className="ks-muted" style={{ margin: '4px 0' }}>{k}: <b>{v}</b></p>)}
        <label className="field">Вид закрытия
          <select value={kind} onChange={e => setKind(e.target.value as ClosureKind)}>
            {(Object.keys(CLOSURE_LABELS) as ClosureKind[]).map(k => <option key={k} value={k}>{CLOSURE_LABELS[k]}</option>)}
          </select>
        </label>
        <p className="ks-muted" style={{ fontSize: 13, margin: '0 0 8px' }}>{CLOSURE_HINTS[kind]}</p>
        <label className="field">Причина (обязательно)
          <input value={reason} maxLength={200} onChange={e => setReason(e.target.value)} placeholder="Например: договорённость с родителем" />
        </label>
        <p className="muted" style={{ fontSize: 13 }}>Деньги не записываются, касса и выручка не меняются. Причина и автор сохранятся.</p>
        <div className="ks-actions" style={{ flexWrap: 'wrap' }}>
          <button ref={cancelRef} type="button" className="ks-btn secondary" style={{ flex: '1 1 120px' }} onClick={onCancel}>Отмена</button>
          <button type="button" className="ks-btn" style={{ flex: '1 1 120px' }} disabled={!ok} onClick={() => onDone({ kind, reason: reason.trim() })}>Закрыть без оплаты</button>
        </div>
      </div>
    </div>
  );
}

/** `const a = await askClosure({...}); if (!a) return;` */
export function useClosure() {
  const [req, setReq] = useState<ClosureRequest | null>(null);
  const resolver = useRef<((a: ClosureAnswer | null) => void) | null>(null);
  const askClosure = useCallback((r: ClosureRequest) => new Promise<ClosureAnswer | null>(resolve => {
    resolver.current?.(null);
    resolver.current = resolve;
    setReq(r);
  }), []);
  const close = useCallback((a: ClosureAnswer | null) => { resolver.current?.(a); resolver.current = null; setReq(null); }, []);
  const closureDialog = req ? <ClosureSheet {...req} onDone={a => close(a)} onCancel={() => close(null)} /> : null;
  return { askClosure, closureDialog };
}
