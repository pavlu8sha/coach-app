import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBodyScrollLock } from './ConfirmSheet';

function ScrollLock() {
  useBodyScrollLock();
  return null;
}

function Icon({ expanded }: { expanded: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {expanded ? <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" /> : <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />}
    </svg>
  );
}

/**
 * Многострочное поле со значком «развернуть» в углу, как в Telegram (#517). Развёрнутый вид выводится
 * отдельным слоем поверх всей страницы (через портал): внутри карточки с анимацией или трансформацией
 * `position: fixed` закрывал бы только карточку. При переключении режимов сохраняются текст,
 * положение курсора и прокрутка. Свернуть можно значком или клавишей Esc.
 */
export function ExpandableTextarea({ label, value, onChange, rows = 6, maxLength, hint, readOnly, placeholder, hideLabel, id: idProp }: {
  label: string;
  value: string;
  /** Для полей только для чтения можно не передавать. */
  onChange?: (v: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  /** Подпись уже есть рядом: в обычном виде не показывать вторую (в развёрнутом слое подпись остаётся). */
  hideLabel?: boolean;
  /** Внешняя подпись может ссылаться на поле через htmlFor. */
  id?: string;
  rows?: number;
  maxLength?: number;
  hint?: string;
}) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const [expanded, setExpanded] = useState(false);
  const area = useRef<HTMLTextAreaElement | null>(null);
  const saved = useRef<{ start: number; end: number; top: number; height: number } | null>(null);
  const placeholderHeight = useRef(0);

  const toggle = () => {
    const el = area.current;
    if (el) {
      saved.current = { start: el.selectionStart, end: el.selectionEnd, top: el.scrollTop, height: el.offsetHeight };
      placeholderHeight.current = el.offsetHeight;
    }
    setExpanded(v => !v);
  };

  // Новый textarea после переключения получает прежние курсор и прокрутку.
  useLayoutEffect(() => {
    const el = area.current;
    const s = saved.current;
    if (!el || !s) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(s.start, s.end);
    el.scrollTo?.({ top: s.top }); // прокрутка самого поля, не страницы
    saved.current = null;
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  const field = (
    <>
      <textarea ref={area} id={id} rows={rows} maxLength={maxLength} value={value} readOnly={readOnly} placeholder={placeholder} aria-label={hideLabel && !expanded ? label : undefined} onChange={e => onChange?.(e.target.value)} />
      <button type="button" className="ks-expand-btn" aria-expanded={expanded} aria-label={expanded ? 'Свернуть' : 'Развернуть на весь экран'} onClick={toggle}>
        <Icon expanded={expanded} />
      </button>
    </>
  );

  if (expanded) {
    return (
      <>
        {/* На месте поля остаётся пустой блок прежней высоты, чтобы страница под слоем не прыгала. */}
        <div className="field ks-expandable">
          <span>{label}</span>
          <div style={{ height: placeholderHeight.current }} />
        </div>
        {createPortal(
          <div className="ks-expand-layer" role="dialog" aria-modal="true" aria-label={label}>
            <ScrollLock />
            <label htmlFor={id}>{label}</label>
            <div className="ks-expandable-box">{field}</div>
            {hint && <p className="ks-hint">{hint}</p>}
          </div>,
          document.body,
        )}
      </>
    );
  }

  return (
    <div className="field ks-expandable">
      {!hideLabel && <label htmlFor={id}>{label}</label>}
      <div className="ks-expandable-box">{field}</div>
    </div>
  );
}
