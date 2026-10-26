import { useEffect, useState } from 'react';
import { coachError, fmtDate, today } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { ListRow, Pill } from '../ui/components';

interface FeeRow { player_id: string; full_name: string; group_name: string | null; due: number; paid: number }
interface PayRow { id: string; player_id: string; full_name: string; amount: number; paid_on: string; method: string | null; comment: string | null; cancelled: boolean }

const METHODS = ['Наличные', 'Перевод', 'Карта'];
const money = (n: number) => `${Number(n)} ₾`;

const API = {
  event: { key: 't', fees: 'event_fees', pays: 'event_payments', pay: 'event_pay', discount: 'event_discount', cancel: 'event_cancel_payment', setFee: 'event_set_fee', add: null },
  match: { key: 'm', fees: 'match_fees_list', pays: 'match_payments_list', pay: 'match_pay', discount: 'match_discount', cancel: 'match_cancel_payment', setFee: 'match_set_fee', add: 'match_fee_add' },
} as const;

// Взносы события или матча (только администратор): сумма, оплата одному или нескольким со способом и датой, скидка, отмена оплаты.
// Для матча участников взноса добавляют из состава (addable): сумма берётся из поля «Взнос с игрока».
export default function EventFees({ eventId, reloadKey, onChanged, mode = 'event', addable = [] }: { eventId: string; reloadKey: number; onChanged: () => void; mode?: 'event' | 'match'; addable?: { id: string; name: string }[] }) {
  const api = API[mode];
  const [fees, setFees] = useState<FeeRow[] | null>(null);
  const [pays, setPays] = useState<PayRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [amt, setAmt] = useState('');
  const [method, setMethod] = useState('');
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
      const [f, p] = await Promise.all([supabase.rpc(api.fees, { [api.key]: eventId }), supabase.rpc(api.pays, { [api.key]: eventId })]);
      if (f.error) return setError(f.error.message);
      setFees(((f.data ?? []) as FeeRow[]).map(x => ({ ...x, due: Number(x.due), paid: Number(x.paid) })));
      setPays(p.error ? [] : ((p.data ?? []) as PayRow[]).map(x => ({ ...x, amount: Number(x.amount) })));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, reloadKey, n, mode]);

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
  const missing = addable.filter(a => !fees.some(f => f.player_id === a.id));
  const addAll = () => {
    if (feeInput === '' || !(Number(feeInput) >= 0)) return setMsg({ ok: false, text: 'Укажите взнос с игрока.' });
    void run(supabase.rpc('match_fee_add', { m: eventId, ids: missing.map(a => a.id), amt: Number(feeInput) }), 'Игроки добавлены во взнос.');
  };
  const saveFee = () => {
    const amount = Number(feeInput);
    if (feeInput === '' || !(amount >= 0)) return setMsg({ ok: false, text: 'Укажите взнос с игрока.' });
    if (!api.add) return void run(supabase.rpc(api.setFee, { [api.key]: eventId, amt: amount }), 'Взнос обновлён (у тех, кому не делали скидку и кто не платил).');
    // у матча взнос хранится у каждого игрока: сначала назначаем его тем, кого ещё нет, затем обновляем остальных
    if (fees.length === 0 && missing.length === 0) return setMsg({ ok: false, text: 'Сначала отметьте в составе игроков «Играл» и сохраните матч: взнос назначается им.' });
    void (async () => {
      setBusy(true);
      setMsg(null);
      let r: { error: { message: string } | null } = { error: null };
      if (missing.length) r = await supabase.rpc('match_fee_add', { m: eventId, ids: missing.map(a => a.id), amt: amount });
      if (!r.error && fees.length) r = await supabase.rpc(api.setFee, { m: eventId, amt: amount });
      setBusy(false);
      if (r.error) return setMsg({ ok: false, text: coachError(r.error.message) });
      setMsg({ ok: true, text: 'Взнос сохранён.' });
      setN(x => x + 1);
    })();
  };
  const pay = () => {
    if (sel.size === 0) return setMsg({ ok: false, text: 'Отметьте игроков, которые платят.' });
    if (!method) return setMsg({ ok: false, text: 'Выберите способ оплаты.' });
    if (amt !== '' && !(Number(amt) > 0)) return setMsg({ ok: false, text: 'Сумма должна быть больше нуля.' });
    void run(supabase.rpc(api.pay, { [api.key]: eventId, ids: [...sel], amt: amt === '' ? null : Number(amt), d: date, mth: method, cmt: note }), 'Оплата записана.', () => { setSel(new Set()); setAmt(''); setNote(''); });
  };

  return (
    <section>
      <h3>Взносы</h3>
      <p className="muted" style={{ marginBottom: 8 }}>Не оплачено всего: {money(debt)}</p>
      <label className="ks-label" htmlFor="ef-fee">Взнос с игрока, ₾</label>
      <div className="ks-line">
        <input id="ef-fee" className="ks-input" inputMode="decimal" value={feeInput} onChange={e => setFeeInput(e.target.value.replace(/[^\d.]/g, '').slice(0, 7))} placeholder="Сумма" />
        <button type="button" className="ks-btn secondary" style={{ width: 'auto' }} disabled={busy || feeInput === ''} onClick={saveFee}>Сохранить</button>
      </div>
      {api.add && missing.length > 0 && (
        <button type="button" className="ks-btn secondary" style={{ marginBottom: 8 }} disabled={busy} onClick={addAll}>Добавить игроков состава во взнос ({missing.length})</button>
      )}
      {fees.length === 0 && api.add && <p className="muted">Взнос за этот матч пока никому не назначен. Укажите сумму и добавьте игроков состава.</p>}
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
            {left > 0 && <div className="ks-line" style={{ marginBottom: 8 }}>
              <label className="ks-check">
                <input type="checkbox" checked={sel.has(f.player_id)} onChange={() => toggle(f.player_id)} aria-label={`Платит: ${f.full_name}`} />
                <span>Платит</span>
              </label>
              <button type="button" className="ks-btn secondary" style={{ width: 'auto', minHeight: 36 }} aria-label={`Скидка: ${f.full_name}`} onClick={() => { setDiscountFor(discountFor === f.player_id ? null : f.player_id); setDiscount(String(f.due)); }}>Скидка</button>
            </div>}
            {discountFor === f.player_id && (
              <div className="ks-line" style={{ marginBottom: 8 }}>
                <input className="ks-input" inputMode="decimal" aria-label="Сумма к оплате" value={discount} onChange={e => setDiscount(e.target.value.replace(/[^\d.]/g, '').slice(0, 7))} />
                <button type="button" className="ks-btn" style={{ width: 'auto' }} disabled={busy || discount === ''} onClick={() => void run(supabase.rpc(api.discount, { [api.key]: eventId, pid: f.player_id, due: Number(discount) }), 'Сумма к оплате изменена.', () => setDiscountFor(null))}>Применить</button>
              </div>
            )}
          </div>
        );
      })}
      <h3>Принять оплату</h3>
      <div className="ks-actions" style={{ marginBottom: 8 }}>
        <button type="button" className="ks-btn secondary sm" disabled={fees.every(f => f.due - f.paid <= 0)} onClick={() => setSel(new Set(fees.filter(f => f.due - f.paid > 0).map(f => f.player_id)))}>Выбрать всех должников</button>
        <button type="button" className="ks-btn secondary sm" disabled={sel.size === 0} onClick={() => setSel(new Set())}>Снять выбор</button>
      </div>
      <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>Отметьте «Платит» у нужных игроков. Если сумму не указать, запишется остаток каждого.</p>
      <label className="ks-label" htmlFor="ef-amt">Сумма с каждого, ₾ (необязательно)</label>
      <input id="ef-amt" className="ks-input" inputMode="decimal" value={amt} onChange={e => setAmt(e.target.value.replace(/[^\d.]/g, '').slice(0, 7))} placeholder="Остаток" />
      <label className="ks-label" htmlFor="ef-method">Способ</label>
      <select id="ef-method" className="ks-select" value={method} onChange={e => setMethod(e.target.value)}>
        <option value="">Выберите способ</option>
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
              end={p.amount > 0 && !p.cancelled ? <button type="button" className="ks-btn secondary" style={{ width: 'auto', minHeight: 36 }} aria-label={`Отменить оплату: ${p.full_name}`} disabled={busy} onClick={() => { if (window.confirm('Отменить эту оплату?')) void run(supabase.rpc(api.cancel, { payid: p.id }), 'Оплата отменена.'); }}>Отменить</button> : p.cancelled ? <Pill tone="neutral">Отменён</Pill> : undefined}
            />
          ))}
        </>
      )}
    </section>
  );
}
