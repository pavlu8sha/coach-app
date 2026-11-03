import { useState } from 'react';
import { INSTALLMENT_CHAT } from '../lib/clubInfo';
import { COPY_LABELS, updatedLabel, usePaymentInfo } from '../lib/paymentInfo';

const MENTION = '@coach_siordia';

function RuleText({ text }: { text: string }) {
  const i = text.indexOf(MENTION);
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <a href={INSTALLMENT_CHAT} target="_blank" rel="noreferrer">{MENTION}</a>
      {text.slice(i + MENTION.length)}
    </>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'error'>('idle');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState('done');
      setTimeout(() => setState('idle'), 1800);
    } catch {
      setState('error');
    }
  };
  const text = state === 'done' ? 'Скопировано' : state === 'error' ? 'Не удалось' : 'Скопировать';
  return (
    <button type="button" className="ks-btn secondary sm" aria-label={state === 'idle' ? `Скопировать: ${label}` : text} onClick={() => void copy()}>
      {text}
    </button>
  );
}

// Реквизиты и утверждённые правила оплаты для родителя. Значения из таблицы payment_info (правит администратор); запасной вариант в lib/clubInfo.
export default function PaymentInfo() {
  const info = usePaymentInfo();
  return (
    <>
      <section className="ks-card" aria-labelledby="payment-details">
        <h2 id="payment-details">Реквизиты для оплаты</h2>
        <p className="muted" style={{ marginTop: 0 }}>Перевод по реквизитам ниже. IBAN и имя получателя можно скопировать одним нажатием.</p>
        {info.details.map(d => (
          <div key={d.label} style={{ marginTop: 12 }}>
            <div className="muted" style={{ fontSize: 13 }}>{d.label}</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 2 }}>
              <b style={{ overflowWrap: 'anywhere', minWidth: 0, ...(COPY_LABELS.has(d.label) && /^[A-Z]{2}\d{2}[A-Z0-9]{10,}$/.test(d.value) ? { whiteSpace: 'nowrap', fontSize: 'clamp(12px, 3.9vw, 16px)', letterSpacing: '0.02em' } : {}) }}>{d.value}</b>
              {COPY_LABELS.has(d.label) && <CopyButton value={d.value} label={d.label} />}
            </div>
          </div>
        ))}
      </section>
      <section className="ks-card" aria-labelledby="payment-rules">
        <h2 id="payment-rules">Правила оплаты</h2>
        {info.rules.map(r => (
          <div key={r.title}>
            <h3>{r.title}</h3>
            <ul className="ks-checks plain">
              {r.items.map(t => <li key={t}><RuleText text={t} /></li>)}
            </ul>
          </div>
        ))}
        <p className="ks-hint">Правила и реквизиты обновлены: {updatedLabel(info.updatedAt)}</p>
      </section>
    </>
  );
}
