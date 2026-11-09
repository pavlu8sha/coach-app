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
      <div className="ks-expandable-head">
        <label htmlFor={id}>{label}</label>
        <button type="button" className="ks-btn secondary sm" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>
          {expanded ? 'Свернуть' : 'Развернуть'}
        </button>
      </div>
      <textarea id={id} rows={rows} maxLength={maxLength} value={value} onChange={e => onChange(e.target.value)} />
      {expanded && hint && <p className="ks-hint">{hint}</p>}
    </div>
  );
}
