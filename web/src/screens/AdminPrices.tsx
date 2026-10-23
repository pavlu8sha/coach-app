import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Pill } from '../ui/components';
import { Failure, Loading } from './Message';

interface Price { id: string; group_id: string | null; kind: string; amount: number; valid_from: string; valid_to: string | null }
interface Group { id: string; name: string }

const KINDS: Record<string, string> = { subscription: 'Абонемент', individual: 'Индивидуальное занятие' };
const gel = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2)} ₾`;
const monthLabel = (iso: string) => {
  const [y, m] = iso.split('-').map(Number);
  const s = new Date(y, m - 1, 1).toLocaleDateString('ru', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const thisMonth = () => new Date().toLocaleDateString('en-CA').slice(0, 7);

// Для администратора: цены абонемента и индивидуального занятия по месяцам. Новая цена действует с выбранного месяца, прошлые
// месяцы остаются по своей цене (как в старом приложении): добавлять можно с текущего месяца, удалять только будущие.
export default function AdminPrices() {
  const [prices, setPrices] = useState<Price[] | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [clubId, setClubId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [kind, setKind] = useState('subscription');
  const [group, setGroup] = useState('');
  const [amount, setAmount] = useState('');
  const [from, setFrom] = useState(thisMonth());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    void (async () => {
      const [p, g, c] = await Promise.all([
        supabase.from('prices').select('id, group_id, kind, amount, valid_from, valid_to').order('valid_from', { ascending: false }),
        supabase.from('groups').select('id, name').order('name'),
        supabase.from('clubs').select('id').limit(1),
      ]);
      const err = p.error ?? g.error ?? c.error;
      if (err) return setError(err.message);
      setPrices(((p.data ?? []) as Price[]).map(x => ({ ...x, amount: Number(x.amount) })));
      setGroups((g.data ?? []) as Group[]);
      setClubId(((c.data ?? []) as { id: string }[])[0]?.id ?? null);
    })();
  }, [reload]);

  const gname = (id: string | null) => (id ? groups.find(g => g.id === id)?.name ?? 'группа' : 'все группы');
  const add = async () => {
    const num = Number(amount.replace(',', '.'));
    if (!amount.trim() || !Number.isFinite(num) || num < 0 || num > 100000) return setMsg({ ok: false, text: 'Цена — число от 0 до 100000.' });
    if (from < thisMonth()) return setMsg({ ok: false, text: 'Цену можно задать с текущего или будущего месяца: прошлые месяцы остаются по своей цене.' });
    const gid = kind === 'subscription' && group ? group : null;
    const validFrom = `${from}-01`;
    if ((prices ?? []).some(p => p.kind === kind && p.group_id === gid && p.valid_from === validFrom)) return setMsg({ ok: false, text: 'Такая цена на этот месяц уже есть: удалите её (если она будущая) и добавьте заново.' });
    if (!clubId) return setMsg({ ok: false, text: 'Не найден клуб.' });
    setBusy(true);
    setMsg(null);
    const r = await supabase.from('prices').insert({ club_id: clubId, group_id: gid, kind, amount: Math.round(num * 100) / 100, valid_from: validFrom });
    setBusy(false);
    if (r.error) return setMsg({ ok: false, text: r.error.message });
    setAmount('');
    setMsg({ ok: true, text: 'Цена добавлена.' });
    setReload(n => n + 1);
  };
  const remove = async (p: Price) => {
    if (!window.confirm(`Удалить цену ${gel(p.amount)} с ${monthLabel(p.valid_from)}?`)) return;
    const r = await supabase.from('prices').delete().eq('id', p.id);
    if (r.error) return setMsg({ ok: false, text: r.error.message });
    setReload(n => n + 1);
  };

  if (error) return <Failure title="Не удалось загрузить цены" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} />;
  if (!prices) return <Loading />;

  return (
    <main className="page">
      <h1>Цены</h1>
      <p className="muted" style={{ marginBottom: 12 }}>Цена действует с выбранного месяца; прошлые месяцы остаются по своей цене. Своя цена группы важнее общей. По ним считается долг в «Должниках» и у родителей.</p>
      <h3>Новая цена</h3>
      <div className="ks-card">
        <label className="ks-label" htmlFor="pr-kind">Что</label>
        <select id="pr-kind" className="ks-select" value={kind} onChange={e => setKind(e.target.value)}>
          {Object.entries(KINDS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        {kind === 'subscription' && (
          <>
            <label className="ks-label" htmlFor="pr-group">Группа</label>
            <select id="pr-group" className="ks-select" value={group} onChange={e => setGroup(e.target.value)}>
              <option value="">Все группы</option>
              {groups.map(g => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </>
        )}
        <label className="ks-label" htmlFor="pr-amount">Цена, ₾</label>
        <input id="pr-amount" className="ks-input" inputMode="decimal" value={amount} onChange={e => { setAmount(e.target.value); setMsg(null); }} placeholder="Например: 170" />
        <label className="ks-label" htmlFor="pr-from">С месяца</label>
        <input id="pr-from" className="ks-input" type="month" value={from} onChange={e => setFrom(e.target.value)} />
        {msg && <p className={msg.ok ? 'ks-ok' : 'error'}>{msg.text}</p>}
        <div style={{ height: 10 }} />
        <button type="button" className="ks-btn" disabled={busy} onClick={() => void add()}>Добавить цену</button>
      </div>

      <h3>Действующие и будущие цены</h3>
      {prices.map(p => {
        const future = p.valid_from.slice(0, 7) > thisMonth();
        return (
          <div className="ks-card" key={p.id}>
            <div className="ks-line">
              <b>{KINDS[p.kind] ?? p.kind}{p.kind === 'subscription' ? ` · ${gname(p.group_id)}` : ''}</b>
              <Pill tone="primary">{gel(p.amount)}</Pill>
            </div>
            <div className="ks-muted" style={{ fontSize: 13 }}>с {monthLabel(p.valid_from)}{p.valid_to ? ` по ${monthLabel(p.valid_to)}` : ''}{future ? ' · ещё не действует' : ''}</div>
            {future && <button type="button" className="ks-back" onClick={() => void remove(p)}>Удалить будущую цену</button>}
          </div>
        );
      })}
    </main>
  );
}
