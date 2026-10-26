import { useEffect, useMemo, useState } from 'react';
import { today } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { EmptyState, Pill } from '../ui/components';
import { Failure, Loading } from './Message';

interface Group { id: string; name: string }
export interface Player { id: string; full_name: string }
interface Price { group_id: string | null; amount: number; valid_from: string; valid_to: string | null }
export interface Sub { player_id: string; discount: boolean; written_off: boolean }

export const gel = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2)} ₾`;
const METHODS = ['Наличные', 'Перевод', 'Другое'];
export const SEASON_START = '2026-09-01'; // как debt_start() в базе
export const monthIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
export const monthName = (iso: string) => {
  const [y, m] = iso.split('-').map(Number);
  const s = new Date(y, m - 1, 1).toLocaleDateString('ru', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
export const nextMonth = (iso: string) => {
  const [y, m] = iso.split('-').map(Number);
  return monthIso(new Date(y, m, 1));
};
/** Цена абонемента на месяц: своя цена группы важнее общей, берётся последняя из действующих (как tariff_for в базе). */
export function tariffFor(prices: Price[], group: string, month: string): number | null {
  const ok = prices.filter(p => p.valid_from <= month && (!p.valid_to || p.valid_to >= month) && (p.group_id === group || p.group_id === null));
  ok.sort((a, b) => Number(b.group_id !== null) - Number(a.group_id !== null) || b.valid_from.localeCompare(a.valid_from));
  return ok[0] ? Number(ok[0].amount) : null;
}

// «Оплаты» по месяцам и группам: кто сколько внёс из абонемента, быстрый платёж. Журнал платежей только добавляется.
export default function MonthPayments() {
  const months = useMemo(() => {
    const out: string[] = [];
    const now = new Date();
    for (let d = new Date(now.getFullYear(), now.getMonth(), 1); monthIso(d) >= SEASON_START; d.setMonth(d.getMonth() - 1)) out.push(monthIso(d));
    return out;
  }, []);
  const [month, setMonth] = useState(months[0] ?? SEASON_START);
  const [groups, setGroups] = useState<Group[]>([]);
  const [prices, setPrices] = useState<Price[]>([]);
  const [gid, setGid] = useState('');
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [paid, setPaid] = useState<Map<string, number>>(new Map());
  const [subs, setSubs] = useState<Map<string, Sub>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const g = await supabase.from('groups').select('id, name').order('name');
      const p = await supabase.from('prices').select('group_id, amount, valid_from, valid_to').eq('kind', 'subscription');
      if (g.error || p.error) return setError((g.error ?? p.error)!.message);
      // игроки индивидуальных и вратарских платят за занятия, а не абонементом
      const gs = ((g.data ?? []) as Group[]).filter(x => x.name.trim().toLowerCase() !== 'индивидуальные / вратарские');
      setGroups(gs);
      setPrices(((p.data ?? []) as Price[]).map(x => ({ ...x, amount: Number(x.amount) })));
      setGid(cur => cur || gs[0]?.id || '');
    })();
  }, []);

  useEffect(() => {
    if (!gid) return;
    void (async () => {
      const pl = await supabase.from('players').select('id, full_name').eq('group_id', gid).eq('status', 'active').order('full_name').limit(200);
      if (pl.error) return setError(pl.error.message);
      const list = (pl.data ?? []) as Player[];
      const ids = list.map(x => x.id);
      const pay = ids.length ? await supabase.from('payments').select('player_id, amount').in('player_id', ids).gte('paid_on', month).lt('paid_on', nextMonth(month)).limit(2000) : { data: [], error: null };
      const sb = ids.length ? await supabase.from('subscriptions').select('player_id, discount, written_off').in('player_id', ids).eq('month', month) : { data: [], error: null };
      if (pay.error) return setError(pay.error.message);
      if (sb.error) return setError(sb.error.message);
      const m = new Map<string, number>();
      ((pay.data ?? []) as { player_id: string; amount: number }[]).forEach(x => m.set(x.player_id, (m.get(x.player_id) ?? 0) + Number(x.amount)));
      setPaid(m);
      setSubs(new Map(((sb.data ?? []) as Sub[]).map(x => [x.player_id, x])));
      setPlayers(list);
    })();
  }, [gid, month, reload]);

  if (error) return <Failure title="Не удалось загрузить оплаты" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} />;
  const tariff = gid ? tariffFor(prices, gid, month) : null;
  const done = (p: Player) => {
    const s = subs.get(p.id);
    const got = paid.get(p.id) ?? 0;
    return !!s?.written_off || (!!s?.discount && got > 0) || (tariff !== null && got >= tariff);
  };
  const total = (players ?? []).reduce((s, p) => s + (paid.get(p.id) ?? 0), 0);
  const nPaid = (players ?? []).filter(done).length;

  return (
    <main className="page">
      <h1>Оплаты за месяц</h1>
      <select className="ks-select" aria-label="Месяц" value={month} onChange={e => { setPlayers(null); setOpenId(null); setMonth(e.target.value); }}>
        {months.map(m => <option key={m} value={m}>{monthName(m)}</option>)}
      </select>
      <div style={{ height: 8 }} />
      <select className="ks-select" aria-label="Группа" value={gid} onChange={e => { setPlayers(null); setOpenId(null); setGid(e.target.value); }}>
        {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
      {!players ? <Loading /> : players.length === 0 ? <EmptyState icon="users" title="В группе нет активных игроков" /> : (
        <>
          <p className="muted" style={{ margin: '10px 0' }}>
            {tariff === null ? 'Цена абонемента для группы не задана («Ещё → Цены»). ' : `Абонемент ${gel(tariff)}. `}Оплатили {nPaid} из {players.length} · внесено {gel(total)}
          </p>
          {players.map(p => (
            <Row key={`${p.id}|${paid.get(p.id) ?? 0}|${month}`} player={p} month={month} tariff={tariff} got={paid.get(p.id) ?? 0} sub={subs.get(p.id)} paidUp={done(p)} open={openId === p.id} onOpen={() => setOpenId(openId === p.id ? null : p.id)} onSaved={() => { setOpenId(null); setReload(n => n + 1); }} />
          ))}
        </>
      )}
    </main>
  );
}

export function Row({ player, title, month, tariff, got, sub, paidUp, open, onOpen, onSaved }: { player: Player; title?: string; month: string; tariff: number | null; got: number; sub?: Sub; paidUp: boolean; open: boolean; onOpen: () => void; onSaved: () => void }) {
  const isCurrent = month === monthIso(new Date());
  const [amount, setAmount] = useState(String(Math.max((tariff ?? 0) - got, 0) || ''));
  const [date, setDate] = useState(isCurrent ? today() : month);
  const [method, setMethod] = useState(METHODS[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const num = Number(amount.replace(',', '.'));
  const save = async () => {
    if (!amount.trim() || !Number.isFinite(num) || num === 0 || Math.abs(num) > 100000) return setErr('Введите сумму (не ноль).');
    if (date > today()) return setErr('Дата платежа не может быть в будущем.');
    if (date < month || date >= nextMonth(month)) return setErr('Дата должна быть в выбранном месяце: оплата считается по месяцу даты.');
    setBusy(true);
    setErr(null);
    const me = (await supabase.auth.getUser()).data.user?.id ?? null;
    const r = await supabase.from('payments').insert({ player_id: player.id, amount: Math.round(num * 100) / 100, paid_on: date, method, recorded_by: me });
    setBusy(false);
    if (r.error) return setErr(r.error.message);
    onSaved();
  };
  return (
    <div className="ks-card">
      <div className="ks-line">
        <b style={{ overflowWrap: 'anywhere' }}>{title ?? player.full_name}</b>
        <Pill tone={paidUp ? 'success' : 'danger'} dot>{sub?.written_off ? 'Списано' : sub?.discount && got > 0 ? 'Скидка' : `${gel(got)}${tariff !== null ? ` из ${gel(tariff)}` : ''}`}</Pill>
      </div>
      <button type="button" className="ks-btn secondary" style={{ marginTop: 8 }} onClick={onOpen}>{open ? 'Свернуть' : 'Внести платёж'}</button>
      {open && (
        <div style={{ marginTop: 8 }}>
          <label className="field">Сумма, ₾ (минус — исправление)<input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></label>
          <div className="two">
            <label className="field">Дата<input type="date" value={date} min={month} max={today()} onChange={e => setDate(e.target.value)} /></label>
            <label className="field">Способ<select value={method} onChange={e => setMethod(e.target.value)}>{METHODS.map(m => <option key={m}>{m}</option>)}</select></label>
          </div>
          {err && <p className="error">{err}</p>}
          <button type="button" className="ks-btn" disabled={busy} onClick={() => void save()}>Записать платёж</button>
          <p className="ks-muted" style={{ fontSize: 13, marginTop: 6 }}>Запись нельзя изменить или удалить: ошибку исправляют записью с минусом.</p>
        </div>
      )}
    </div>
  );
}
