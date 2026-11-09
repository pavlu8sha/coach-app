import { useEffect, useId, useState } from 'react';
import { useBodyScrollLock } from './ConfirmSheet';

function ScrollLock() {
  useBodyScrollLock();
  return null;
}

/**
 * Многострочное поле с кнопкой «Развернуть» (#517): на небольшом экране длинный текст неудобно писать
 * и читать в тесном поле. Поле остаётся тем же элементом, меняется только его оформление, поэтому
 * введённый текст, курсор и позиция прокрутки при переключении режимов не сбрасываются.
 * Свернуть можно кнопкой «Свернуть» или клавишей Esc.
 */
export function ExpandableTextarea({ label, value, onChange, rows = 6, maxLength, hint }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  maxLength?: number;
  hint?: string;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  return (
    <div className={`field ks-expandable${expanded ? ' is-expanded' : ''}`} role={expanded ? 'dialog' : undefined} aria-modal={expanded ? true : undefined} aria-label={expanded ? label : undefined}>
      {expanded && <ScrollLock />}
      <label htmlFor={id}>{label}</label>
      <div className="ks-expandable-box">
        <textarea id={id} rows={rows} maxLength={maxLength} value={value} onChange={e => onChange(e.target.value)} />
        <button type="button" className="ks-expand-btn" aria-expanded={expanded} aria-label={expanded ? 'Свернуть' : 'Развернуть на весь экран'} onClick={() => setExpanded(v => !v)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {expanded
              ? <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
              : <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />}
          </svg>
        </button>
      </div>
      {expanded && hint && <p className="ks-hint">{hint}</p>}
    </div>
  );
}
