import { useEffect, useState } from 'react';
import { coachError, fmtDate, today } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { ListRow, Pill } from '../ui/components';

interface FeeRow { player_id: string; full_name: string; group_name: string | null; due: number; paid: number }
interface PayRow { id: string; player_id: string; full_name: string; amount: number; paid_on: string; method: string | null; comment: string | null; cancelled: boolean }

const METHODS = ['Наличные', 'Перевод', 'Карта'];
const money = (n: number) => `${Number(n)} ₾`;

// Взносы события (только администратор): сумма, оплата одному или нескольким со способом и датой, скидка, отмена оплаты.
export default function EventFees({ eventId, reloadKey, onChanged }: { eventId: string; reloadKey: number; onChanged: () => void }) {
  const [fees, setFees] = useState<FeeRow[] | null>(null);
  const [pays, setPays] = useState<PayRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [amt, setAmt] = useState('');
  const [method, setMethod] = useState(METHODS[0]);
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const [feeInput, setFeeInput] = useState('');
  const [discountFor, setDiscountFor] = useState<string | null>(null);
  const [discount, setDiscount] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [n, setN] = useState(0);

  useEffect(() => {
    void (async () => {
      const [f, p] = await Promise.all([supabase.rpc('event_fees', { t: eventId }), supabase.rpc('event_payments', { t: eventId })]);
      if (f.error) return setError(f.error.message);
      setFees(((f.data ?? []) as FeeRow[]).map(x => ({ ...x, due: Number(x.due), paid: Number(x.paid) })));
      setPays(p.error ? [] : ((p.data ?? []) as PayRow[]).map(x => ({ ...x, amount: Number(x.amount) })));
    })();
  }, [eventId, reloadKey, n]);

  const run = async (p: PromiseLike<{ error: { message: string } | null }>, ok: string, after?: () => void) => {
    setBusy(true);
    setMsg(null);
    const r = await p;
    setBusy(false);
    if (r.error) return setMsg({ ok: false, text: coachError(r.error.message) });
    setMsg({ ok: true, text: ok });
    after?.();
    setN(x => x + 1);
    onChanged();
  };

  if (error) return <p className="error">Взносы: {coachError(error)}</p>;
  if (!fees) return null;
  const debt = fees.reduce((s, f) => s + Math.max(0, f.due - f.paid), 0);
  const toggle = (id: string) => setSel(s => { const c = new Set(s); if (c.has(id)) c.delete(id); else c.add(id); return c; });
  const pay = () => {
    if (sel.size === 0) return setMsg({ ok: false, text: 'Отметьте игроков, которые платят.' });
    if (amt !== '' && !(Number(amt) > 0)) return setMsg({ ok: false, text: 'Сумма должна быть больше нуля.' });
    void run(supabase.rpc('event_pay', { t: eventId, ids: [...sel], amt: amt === '' ? null : Number(amt), d: date, mth: method, cmt: note }), 'Оплата записана.', () => { setSel(new Set()); setAmt(''); setNote(''); });
  };

  return (
    <section>
      <h3>Взносы</h3>
      <p className="muted" style={{ marginBottom: 8 }}>Не оплачено всего: {money(debt)}</p>
      <label className="ks-label" htmlFor="ef-fee">Взнос с игрока, ₾</label>
      <div className="ks-line">
        <input id="ef-fee" className="ks-input" inputMode="decimal" value={feeInput} onChange={e => setFeeInput(e.target.value.replace(/[^\d.]/g, '').slice(0, 7))} placeholder="Сумма" />
        <button type="button" className="ks-btn secondary" style={{ width: 'auto' }} disabled={busy || feeInput === ''} onClick={() => void run(supabase.rpc('event_set_fee', { t: eventId, amt: Number(feeInput) }), 'Взнос обновлён (у тех, кому не делали скидку и кто не платил).', () => setFeeInput(''))}>Сохранить</button>
      </div>
      {fees.map(f => {
        const left = f.due - f.paid;
        return (
          <div key={f.player_id}>
            <ListRow
              avatar={f.full_name}
              title={f.full_name}
              sub={[`К оплате ${money(f.due)} · оплачено ${money(f.paid)}`]}
              end={f.due === 0 ? <Pill tone="neutral">Без взноса</Pill> : left <= 0 ? <Pill tone="success">Оплачен</Pill> : <Pill tone="danger">Долг {money(left)}</Pill>}
            />
            <div className="ks-line" style={{ marginBottom: 8 }}>
              <label className="ks-check">
                <input type="checkbox" checked={sel.has(f.player_id)} onChange={() => toggle(f.player_id)} aria-label={`Платит: ${f.full_name}`} />
                <span>Платит</span>
              </label>
              <button type="button" className="ks-btn secondary" style={{ width: 'auto', minHeight: 36 }} aria-label={`Скидка: ${f.full_name}`} onClick={() => { setDiscountFor(discountFor === f.player_id ? null : f.player_id); setDiscount(String(f.due)); }}>Скидка</button>
            </div>
            {discountFor === f.player_id && (
              <div className="ks-line" style={{ marginBottom: 8 }}>
                <input className="ks-input" inputMode="decimal" aria-label="Сумма к оплате" value={discount} onChange={e => setDiscount(e.target.value.replace(/[^\d.]/g, '').slice(0, 7))} />
                <button type="button" className="ks-btn" style={{ width: 'auto' }} disabled={busy || discount === ''} onClick={() => void run(supabase.rpc('event_discount', { t: eventId, pid: f.player_id, due: Number(discount) }), 'Сумма к оплате изменена.', () => setDiscountFor(null))}>Применить</button>
              </div>
            )}
          </div>
        );
      })}
      <h3>Принять оплату</h3>
      <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>Отметьте «Платит» у нужных игроков. Если сумму не указать, запишется остаток каждого.</p>
      <label className="ks-label" htmlFor="ef-amt">Сумма с каждого, ₾ (необязательно)</label>
      <input id="ef-amt" className="ks-input" inputMode="decimal" value={amt} onChange={e => setAmt(e.target.value.replace(/[^\d.]/g, '').slice(0, 7))} placeholder="Остаток" />
      <label className="ks-label" htmlFor="ef-method">Способ</label>
      <select id="ef-method" className="ks-select" value={method} onChange={e => setMethod(e.target.value)}>
        {METHODS.map(m => <option key={m}>{m}</option>)}
      </select>
      <label className="ks-label" htmlFor="ef-date">Дата</label>
      <input id="ef-date" className="ks-input" type="date" value={date} onChange={e => setDate(e.target.value)} />
      <label className="ks-label" htmlFor="ef-note">Комментарий</label>
      <input id="ef-note" className="ks-input" value={note} onChange={e => setNote(e.target.value)} maxLength={120} />
      <button type="button" className="ks-btn" disabled={busy || sel.size === 0} onClick={pay}>Записать оплату{sel.size ? ` (${sel.size})` : ''}</button>
      {msg && <p className={msg.ok ? 'ks-ok' : 'error'}>{msg.text}</p>}
      {pays.length > 0 && (
        <>
          <h3>Платежи</h3>
          {pays.map(p => (
            <ListRow
              key={p.id}
              title={`${p.full_name} · ${money(p.amount)}`}
              sub={[`${fmtDate(p.paid_on)}${p.method ? ' · ' + p.method : ''}${p.comment ? ' · ' + p.comment : ''}`]}
              end={p.amount > 0 && !p.cancelled ? <button type="button" className="ks-btn secondary" style={{ width: 'auto', minHeight: 36 }} aria-label={`Отменить оплату: ${p.full_name}`} disabled={busy} onClick={() => { if (window.confirm('Отменить эту оплату?')) void run(supabase.rpc('event_cancel_payment', { payid: p.id }), 'Оплата отменена.'); }}>Отменить</button> : p.cancelled ? <Pill tone="neutral">Отменён</Pill> : undefined}
            />
          ))}
        </>
      )}
    </section>
  );
}
