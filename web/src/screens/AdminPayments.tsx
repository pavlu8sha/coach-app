import { useEffect, useState } from 'react';
import { today } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { EmptyState, ListRow, Pill, SearchInput } from '../ui/components';
import { Failure, Loading } from './Message';

interface Player { id: string; full_name: string; groups: { name: string } | null }
interface Pay { id: string; amount: number; paid_on: string; method: string | null }

const gel = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2)} ₾`;
const fmt = (iso: string) => iso.split('-').reverse().join('.');
const METHODS = ['Наличные', 'Перевод', 'Другое'];

// Для администратора: платежи игрока. Журнал платежей только добавляется (даже администратору нельзя менять и удалять записи):
// ошибку исправляют записью с минусом («Исправление»). Расчёт долга берёт платежи по месяцу даты платежа.
export default function AdminPayments() {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Player[]>([]);
  const [open, setOpen] = useState<Player | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) return setFound([]);
    const t = setTimeout(() => {
      void supabase.from('players').select('id, full_name, groups(name)').ilike('full_name', `%${q.trim()}%`).order('full_name').limit(15).then(r => {
        if (!r.error) setFound((r.data ?? []) as unknown as Player[]);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  if (open) return <PlayerPayments player={open} onBack={() => setOpen(null)} />;
  return (
    <main className="page">
      <h1>Платежи</h1>
      <SearchInput label="Найти игрока" placeholder="Фамилия или имя (от 2 букв)" value={q} onChange={setQ} />
      <div style={{ height: 12 }} />
      {q.trim().length >= 2 && found.length === 0 ? (
        <EmptyState icon="search" title="Никого не найдено" text="Проверьте написание." />
      ) : (
        found.map(p => <ListRow key={p.id} avatar={p.full_name} title={p.full_name} sub={[p.groups?.name ?? 'без группы']} onClick={() => setOpen(p)} />)
      )}
    </main>
  );
}

function PlayerPayments({ player, onBack }: { player: Player; onBack: () => void }) {
  const [pays, setPays] = useState<Pay[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [method, setMethod] = useState(METHODS[0]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [undo, setUndo] = useState<Pay | null>(null);

  useEffect(() => {
    void (async () => {
      const r = await supabase.from('payments').select('id, amount, paid_on, method').eq('player_id', player.id).order('paid_on', { ascending: false }).limit(60);
      if (r.error) return setError(r.error.message);
      setPays(((r.data ?? []) as Pay[]).map(p => ({ ...p, amount: Number(p.amount) })));
    })();
  }, [player.id, reload]);

  const num = Number(amount.replace(',', '.'));
  const problem = (): string | null => {
    if (!amount.trim() || !Number.isFinite(num) || num === 0) return 'Введите сумму (не ноль).';
    if (Math.abs(num) > 100000) return 'Сумма слишком большая.';
    if (date > today()) return 'Дата платежа не может быть в будущем.';
    return null;
  };
  const add = async (row: { amount: number; paid_on: string; method: string }) => {
    setBusy(true);
    setMsg(null);
    const me = (await supabase.auth.getUser()).data.user?.id ?? null;
    const r = await supabase.from('payments').insert({ player_id: player.id, amount: Math.round(row.amount * 100) / 100, paid_on: row.paid_on, method: row.method, recorded_by: me });
    setBusy(false);
    setConfirm(false);
    setUndo(null);
    if (r.error) return setMsg({ ok: false, text: r.error.message });
    setAmount('');
    setMsg({ ok: true, text: 'Платёж записан.' });
    setReload(n => n + 1);
  };

  if (error) return <Failure title="Не удалось загрузить платежи" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} />;
  if (!pays) return <Loading />;
  const total = pays.reduce((s, p) => s + p.amount, 0);

  return (
    <main className="page">
      <button type="button" className="ks-back" onClick={onBack}>
        <span className="ks-chev back" aria-hidden="true" />
        Платежи
      </button>
      <h1 style={{ overflowWrap: 'anywhere' }}>{player.full_name}</h1>
      <p className="muted" style={{ marginBottom: 12 }}>{player.groups?.name ?? 'без группы'} · в списке ниже: {gel(total)}</p>

      <h3>Внести платёж</h3>
      <div className="ks-card">
        <label className="ks-label" htmlFor="pay-amount">Сумма, ₾ (минус — исправление)</label>
        <input id="pay-amount" className="ks-input" inputMode="decimal" value={amount} onChange={e => { setAmount(e.target.value); setMsg(null); setConfirm(false); }} placeholder="Например: 165" />
        <label className="ks-label" htmlFor="pay-date">Дата платежа</label>
        <input id="pay-date" className="ks-input" type="date" value={date} onChange={e => { setDate(e.target.value); setConfirm(false); }} />
        <label className="ks-label" htmlFor="pay-method">Способ</label>
        <select id="pay-method" className="ks-select" value={method} onChange={e => setMethod(e.target.value)}>
          {METHODS.map(m => (
            <option key={m}>{m}</option>
          ))}
        </select>
        {msg && <p className={msg.ok ? 'ks-ok' : 'error'}>{msg.text}</p>}
        {confirm ? (
          <>
            <p style={{ marginBottom: 8 }}>Записать {gel(num)} за {fmt(date)} ({method})? Запись нельзя изменить или удалить, ошибку исправляют записью с минусом.</p>
            <button type="button" className="ks-btn" disabled={busy} onClick={() => void add({ amount: num, paid_on: date, method })}>Записать платёж</button>
            <div style={{ height: 8 }} />
            <button type="button" className="ks-btn secondary" disabled={busy} onClick={() => setConfirm(false)}>Отмена</button>
          </>
        ) : (
          <button type="button" className="ks-btn" onClick={() => { const p = problem(); if (p) return setMsg({ ok: false, text: p }); setConfirm(true); }}>Внести платёж</button>
        )}
      </div>

      <h3>Платежи игрока</h3>
      {pays.length === 0 ? (
        <p className="muted">Платежей пока нет.</p>
      ) : (
        pays.map(p => (
          <div className="ks-card" key={p.id}>
            <div className="ks-line">
              <span>{fmt(p.paid_on)}{p.method ? ` · ${p.method}` : ''}</span>
              <Pill tone={p.amount < 0 ? 'danger' : 'success'}>{gel(p.amount)}</Pill>
            </div>
            {undo?.id === p.id ? (
              <div style={{ marginTop: 8 }}>
                <p style={{ marginBottom: 8 }}>Записать исправление {gel(-p.amount)} (отменить этот платёж)?</p>
                <button type="button" className="ks-btn" disabled={busy} onClick={() => void add({ amount: -p.amount, paid_on: p.paid_on, method: 'Исправление' })}>Записать исправление</button>
                <div style={{ height: 8 }} />
                <button type="button" className="ks-btn secondary" disabled={busy} onClick={() => setUndo(null)}>Не нужно</button>
              </div>
            ) : (
              <button type="button" className="ks-back" onClick={() => setUndo(p)}>Исправить (записать с минусом)</button>
            )}
          </div>
        ))
      )}
    </main>
  );
}
