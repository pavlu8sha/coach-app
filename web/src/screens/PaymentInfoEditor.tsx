import { useState } from 'react';
import { FALLBACK_PAYMENT_INFO, updatedLabel, usePaymentInfo, type PaymentInfoData } from '../lib/paymentInfo';
import { supabase } from '../lib/supabase';
import { Loading } from './Message';

const errText = (m: string) =>
  m.includes('forbidden') ? 'Нет прав: реквизиты и правила правит только администратор.'
  : m.includes('bad details') ? 'Проверьте реквизиты: все четыре значения должны быть заполнены.'
  : m.includes('bad rules') ? 'Проверьте правила: у каждого раздела нужны заголовок и хотя бы один пункт.'
  : m.includes('Could not find the function') || m.includes('payment_info') ? 'Раздел ещё не установлен в базе (миграция 0099).'
  : 'Не удалось сохранить.';

const toLines = (items: string[]) => items.join('\n');
const fromLines = (s: string) => s.split('\n').map(x => x.trim()).filter(Boolean);

function Form({ initial }: { initial: PaymentInfoData }) {
  const [values, setValues] = useState(initial.details.map(d => d.value));
  const [titles, setTitles] = useState(initial.rules.map(r => r.title));
  const [texts, setTexts] = useState(initial.rules.map(r => toLines(r.items)));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const reset = () => {
    setValues(FALLBACK_PAYMENT_INFO.details.map(d => d.value));
    setTitles(FALLBACK_PAYMENT_INFO.rules.map(r => r.title));
    setTexts(FALLBACK_PAYMENT_INFO.rules.map(r => toLines(r.items)));
    setMsg({ ok: true, text: 'Подставлены утверждённые значения. Нажмите «Сохранить», чтобы применить.' });
  };
  const rules = titles.map((title, i) => ({ title: title.trim(), items: fromLines(texts[i]) }));
  const invalid = values.some(v => !v.trim()) || rules.some(r => !r.title || r.items.length === 0);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    const r = await supabase.rpc('payment_info_save', { d: initial.details.map((d, i) => ({ label: d.label, value: values[i].trim() })), r: rules });
    setBusy(false);
    setMsg(r.error ? { ok: false, text: errText(r.error.message) } : { ok: true, text: 'Сохранено. Родители увидят новые значения сразу.' });
  };

  return (
    <>
      <p className="muted" style={{ marginBottom: 12 }}>
        Реквизиты и правила видят родители на экране «Оплата». Названия реквизитов менять нельзя, добавлять другие банковские поля без согласования с владельцем тоже. Пишите только утверждённые условия.
      </p>
      <h3>Реквизиты</h3>
      {initial.details.map((d, i) => (
        <label className="field" key={d.label}>{d.label}<input value={values[i]} maxLength={200} onChange={e => setValues(v => v.map((x, j) => (j === i ? e.target.value : x)))} /></label>
      ))}
      <h3>Правила</h3>
      {titles.map((t, i) => (
        <div className="ks-card" key={i}>
          <label className="field">Заголовок раздела {i + 1}<input value={t} maxLength={200} onChange={e => setTitles(v => v.map((x, j) => (j === i ? e.target.value : x)))} /></label>
          <label className="field">Пункты раздела {i + 1} (каждый с новой строки)<textarea rows={6} value={texts[i]} onChange={e => setTexts(v => v.map((x, j) => (j === i ? e.target.value : x)))} /></label>
        </div>
      ))}
      {msg && <p className={msg.ok ? 'ks-ok' : 'error'}>{msg.text}</p>}
      <button type="button" className="ks-btn" disabled={busy || invalid} onClick={() => void save()}>Сохранить</button>
      <div style={{ height: 8 }} />
      <button type="button" className="ks-btn secondary" disabled={busy} onClick={reset}>Вернуть утверждённые значения</button>
    </>
  );
}

// Для администратора (миграция 0099): реквизиты и правила оплаты, которые видит родитель, без релиза приложения.
export default function PaymentInfoEditor() {
  const info = usePaymentInfo();
  return (
    <main className="page">
      <h1>Реквизиты и правила оплаты</h1>
      {!info.loaded ? <Loading /> : (
        <>
          <p className="muted">Последнее обновление: {updatedLabel(info.updatedAt)}.</p>
          <Form initial={info} />
        </>
      )}
    </main>
  );
}
