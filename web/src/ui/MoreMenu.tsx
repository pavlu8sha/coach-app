import { useEffect, useRef, useState } from 'react';

export interface MoreItem { label: string; onSelect: () => void }

/** Меню «⋯» в шапке экрана. Esc, клик вне и повторный клик закрывают его, фокус возвращается на кнопку. */
export function MoreMenu({ items, badge = 0, label }: { items: MoreItem[]; badge?: number; label?: string }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  const btn = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); } };
    const onDown = (e: MouseEvent | TouchEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [open]);
  return (
    <div className="ks-more" ref={wrap}>
      <button type="button" ref={btn} className="ks-btn sm secondary" aria-label={label ?? (badge > 0 ? `Ещё, ${badge}` : 'Ещё')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        ⋯{badge > 0 && <span className="ks-more-dot" aria-hidden="true">{badge}</span>}
      </button>
      {open && (
        <div className="ks-more-menu" role="menu">
          {items.map(it => (
            <button key={it.label} type="button" role="menuitem" onClick={() => { setOpen(false); btn.current?.focus(); it.onSelect(); }}>{it.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
