import { useState } from 'react';
import { coachError } from '../lib/coach';
import { ADMIN_CHAT, BRANCHES } from '../lib/clubInfo';
import { supabase } from '../lib/supabase';
import Privacy from './Privacy';

const YEAR = new Date().getFullYear();
const err = (m: string) =>
  m.includes('consent') ? 'Нужно согласие. Отметьте его ниже.'
  : m.includes('bad year') ? 'Проверьте год рождения ребёнка.'
  : m.includes('bad phone') ? 'Проверьте телефон: цифры, можно с «+».'
  : m.includes('bad child') ? 'Укажите имя и фамилию ребёнка.'
  : m.includes('too many leads') ? 'Сегодня уже отправлено три заявки. Напишите администратору клуба.'
  : m.includes('not authenticated') ? 'Сессия закончилась. Закройте приложение и откройте снова.'
  : m.includes('Could not find the function') ? 'Заявки в приложении пока недоступны. Напишите администратору клуба.'
  : coachError(m);

// Заявка на пробную тренировку из приложения (миграция 0044): попадает администратору в «Ещё → Заявки».
export default function TrialForm() {
  const [open, setOpen] = useState(false);
  const [parent, setParent] = useState('');
  const [child, setChild] = useState('');
  const [year, setYear] = useState('');
  const [phone, setPhone] = useState('');
  const [branch, setBranch] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [policy, setPolicy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (policy) return <Privacy onBack={() => setPolicy(false)} />;
  if (sent) {
    return (
      <section className="ks-card">
        <h2>Заявка отправлена</h2>
        <p className="muted">Администратор клуба свяжется с вами и предложит время пробной тренировки.</p>
      </section>
    );
  }
  if (!open) {
    return (
      <section className="ks-card">
        <h2>Записаться на пробную тренировку</h2>
        <p className="muted">Оставьте данные ребёнка, и администратор подберёт группу и время.</p>
        <button type="button" className="ks-btn" onClick={() => setOpen(true)}>Записаться на пробную</button>
        <a className="ks-btn secondary" href={ADMIN_CHAT} target="_blank" rel="noreferrer">Написать администратору</a>
      </section>
    );
  }
  const y = Number(year);
  const valid = parent.trim().length > 1 && child.trim().length > 2 && y >= YEAR - 18 && y <= YEAR - 2 && /^\+?[0-9 ()-]{7,20}$/.test(phone.trim()) && agreed;
  const submit = async () => {
    setBusy(true);
    setError(null);
    const r = await supabase.rpc('lead_submit_app', { parent: parent.trim(), child: child.trim(), byear: y, phone: phone.trim(), wish: branch ? `Филиал: ${branch}` : null, consent: agreed });
    setBusy(false);
    if (r.error) return setError(err(r.error.message));
    setSent(true);
  };
  return (
    <section className="ks-card">
      <h2>Запись на пробную тренировку</h2>
      <form onSubmit={e => { e.preventDefault(); if (valid && !busy) void submit(); }}>
        <input className="ks-input" value={parent} onChange={e => setParent(e.target.value)} placeholder="Ваше имя" aria-label="Ваше имя" autoComplete="name" />
        <input className="ks-input" style={{ marginTop: 8 }} value={child} onChange={e => setChild(e.target.value)} placeholder="Имя и фамилия ребёнка" aria-label="Имя и фамилия ребёнка" autoComplete="off" />
        <input className="ks-input" style={{ marginTop: 8 }} value={year} onChange={e => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="Год рождения ребёнка" aria-label="Год рождения ребёнка" inputMode="numeric" />
        <input className="ks-input" style={{ marginTop: 8 }} value={phone} onChange={e => setPhone(e.target.value)} placeholder="Телефон" aria-label="Телефон" inputMode="tel" autoComplete="tel" />
        <select className="ks-select" style={{ marginTop: 8 }} value={branch} onChange={e => setBranch(e.target.value)} aria-label="Удобный филиал">
          <option value="">Удобный филиал (необязательно)</option>
          {BRANCHES.map(b => <option key={b.name}>{b.name}</option>)}
        </select>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 12 }}>
          <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} style={{ marginTop: 4 }} />
          <span className="muted note">Я согласен(на) на обработку моих данных и данных ребёнка для записи в клуб, как описано в <button type="button" className="link-btn" onClick={() => setPolicy(true)}>Политике конфиденциальности</button>.</span>
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="ks-btn" style={{ marginTop: 12 }} disabled={!valid || busy}>Отправить заявку</button>
      </form>
    </section>
  );
}
