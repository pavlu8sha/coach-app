import { useEffect, useMemo, useState } from 'react';
import { today } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { EmptyState, Pill, SearchInput, SwitchRow } from '../ui/components';
import { Failure, Loading } from './Message';

interface Group { id: string; name: string }
export interface Player { id: string; full_name: string }
interface Price { group_id: string | null; amount: number; valid_from: string; valid_to: string | null }
export interface Sub { player_id: string; discount: boolean; written_off: boolean }

export const gel = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2)} ₾`;
const METHODS = ['Наличные', 'Перевод'];
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

interface Pl extends Player { group_id: string }

// «Оплаты»: весь клуб за месяц — итоги плиткой, группы раскрываются списком игроков (как в старом приложении). Журнал платежей только добавляется.
export default function MonthPayments() {
  const months = useMemo(() => {
    const out: string[] = [];
    const now = new Date();
    // следующий месяц тоже доступен: родители платят вперёд
    for (let d = new Date(now.getFullYear(), now.getMonth() + 1, 1); monthIso(d) >= SEASON_START; d.setMonth(d.getMonth() - 1)) out.push(monthIso(d));
    return out;
  }, []);
  const [month, setMonth] = useState(monthIso(new Date()));
  const [groups, setGroups] = useState<Group[]>([]);
  const [prices, setPrices] = useState<Price[]>([]);
  const [players, setPlayers] = useState<Pl[] | null>(null);
  const [paid, setPaid] = useState<Map<string, number>>(new Map());
  const [subs, setSubs] = useState<Map<string, Sub>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [onlyDebt, setOnlyDebt] = useState(false);

  useEffect(() => {
    void (async () => {
      const g = await supabase.from('groups').select('id, name').order('name');
      const p = await supabase.from('prices').select('group_id, amount, valid_from, valid_to').eq('kind', 'subscription');
      if (g.error || p.error) return setError((g.error ?? p.error)!.message);
      // игроки индивидуальных и вратарских платят за занятия, а не абонементом
      const gs = ((g.data ?? []) as Group[]).filter(x => x.name.trim().toLowerCase() !== 'индивидуальные / вратарские');
      setGroups(gs);
      setPrices(((p.data ?? []) as Price[]).map(x => ({ ...x, amount: Number(x.amount) })));
    })();
  }, []);

  useEffect(() => {
    if (!groups.length) return;
    setPlayers(null);
    void (async () => {
      const pl = await supabase.from('players').select('id, full_name, group_id').eq('status', 'active').order('full_name').limit(1000);
      const pay = await supabase.from('payments').select('player_id, amount').gte('paid_on', month).lt('paid_on', nextMonth(month)).limit(5000);
      const sb = await supabase.from('subscriptions').select('player_id, discount, written_off').eq('month', month).limit(5000);
      if (pl.error) return setError(pl.error.message);
      if (pay.error) return setError(pay.error.message);
      if (sb.error) return setError(sb.error.message);
      const ok = new Set(groups.map(x => x.id));
      const m = new Map<string, number>();
      ((pay.data ?? []) as { player_id: string; amount: number }[]).forEach(x => m.set(x.player_id, (m.get(x.player_id) ?? 0) + Number(x.amount)));
      setPaid(m);
      setSubs(new Map(((sb.data ?? []) as Sub[]).map(x => [x.player_id, x])));
      setPlayers(((pl.data ?? []) as Pl[]).filter(x => ok.has(x.group_id)));
    })();
  }, [groups, month, reload]);

  if (error) return <Failure title="Не удалось загрузить оплаты" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} />;
  const tariffOf = (p: Pl) => tariffFor(prices, p.group_id, month);
  const gotOf = (p: Pl) => paid.get(p.id) ?? 0;
  const done = (p: Pl) => {
    const s = subs.get(p.id);
    const t = tariffOf(p);
    return !!s?.written_off || (!!s?.discount && gotOf(p) > 0) || (t !== null && gotOf(p) >= t);
  };
  const all = players ?? [];
  const total = all.reduce((s, p) => s + gotOf(p), 0);
  const expected = all.reduce((s, p) => s + (tariffOf(p) ?? 0), 0);
  const nPaid = all.filter(done).length;
  const needle = q.trim().toLowerCase();

  return (
    <main className="page">
      <h1>Оплаты за месяц</h1>
      <div className="ks-pair">
        <select className="ks-select" aria-label="Месяц" value={month} onChange={e => { setPlayers(null); setOpenId(null); setMonth(e.target.value); }}>
          {months.map(m => <option key={m} value={m}>{monthName(m)}</option>)}
        </select>
        <SwitchRow id="md" label="Только должники" checked={onlyDebt} onChange={setOnlyDebt} />
      </div>
      <SearchInput value={q} onChange={setQ} placeholder="Поиск по ФИ" label="Поиск по ФИ" />
      {!players ? <Loading /> : (
        <>
          <div className="ks-tiles" style={{ margin: '12px 0' }}>
            <div className="ks-tile"><b>Внесено</b>{gel(total)}</div>
            <div className="ks-tile"><b>Ожидается по тарифам</b>{gel(expected)}</div>
            <div className="ks-tile"><b>Оплатили</b>{nPaid} из {all.length}</div>
            <div className="ks-tile"><b>Должников</b>{all.length - nPaid}</div>
          </div>
          {groups.map(g => {
            const gp = all.filter(x => x.group_id === g.id);
            const shown = gp.filter(x => (!onlyDebt || !done(x)) && (!needle || x.full_name.toLowerCase().includes(needle)));
            if (!shown.length) return null;
            const gDone = gp.filter(done).length;
            const gTotal = gp.reduce((s, x) => s + gotOf(x), 0);
            const gExp = gp.reduce((s, x) => s + (tariffOf(x) ?? 0), 0);
            return (
              <details className="ks-group" key={g.id} open={onlyDebt || !!needle}>
                <summary>
                  <div className="ks-line"><b>{g.name}</b><span className="muted">{gDone} из {gp.length}</span></div>
                  <div className="ks-bar" aria-hidden="true"><i style={{ width: `${gp.length ? Math.round((gDone * 100) / gp.length) : 0}%` }} /></div>
                  <p className="muted" style={{ fontSize: 13 }}>внесено {gel(gTotal)} из {gel(gExp)}</p>
                </summary>
                {shown.map(p => (
                  <Row key={`${p.id}|${gotOf(p)}|${month}`} player={p} month={month} tariff={tariffOf(p)} got={gotOf(p)} sub={subs.get(p.id)} paidUp={done(p)} open={openId === p.id} onOpen={() => setOpenId(openId === p.id ? null : p.id)} onSaved={() => { setOpenId(null); setReload(n => n + 1); }} />
                ))}
              </details>
            );
          })}
          {all.length > 0 && !all.some(x => (!onlyDebt || !done(x)) && (!needle || x.full_name.toLowerCase().includes(needle))) && (
            <EmptyState icon="users" title="Ничего не найдено" text="Измените запрос или сбросьте фильтр." />
          )}
        </>
      )}
    </main>
  );
}

export function Row({ player, title, month, tariff, got, sub, paidUp, open, onOpen, onSaved }: { player: Player; title?: string; month: string; tariff: number | null; got: number; sub?: Sub; paidUp: boolean; open: boolean; onOpen: () => void; onSaved: () => void }) {
  const isCurrent = month === monthIso(new Date());
  const isFuture = month > monthIso(new Date());
  const [amount, setAmount] = useState(String(Math.max((tariff ?? 0) - got, 0) || ''));
  const [date, setDate] = useState(isCurrent ? today() : month);
  const [method, setMethod] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const num = Number(amount.replace(',', '.'));
  const discount = async () => {
    setBusy(true);
    setErr(null);
    const r = await supabase.from('subscriptions').upsert({ player_id: player.id, month, discount: true }, { onConflict: 'player_id,month' });
    setBusy(false);
    if (r.error) return setErr(r.error.message);
    onSaved();
  };
  const save = async () => {
    if (!method) return setErr('Выберите способ оплаты.');
    if (!amount.trim() || !Number.isFinite(num) || num === 0 || Math.abs(num) > 100000) return setErr('Введите сумму (не ноль).');
    if (date > today() && !isFuture) return setErr('Дата платежа не может быть в будущем.');
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
      {!paidUp && got > 0 && (
        <button type="button" className="ks-btn secondary" style={{ marginTop: 8 }} disabled={busy} onClick={() => void discount()}>Считать оплаченным (скидка)</button>
      )}
      {open && (
        <div style={{ marginTop: 8 }}>
          <label className="field">Сумма, ₾ (минус — исправление)<input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></label>
          <div className="two">
            <label className="field">Дата<input type="date" value={date} min={month} max={isFuture ? undefined : today()} disabled={isFuture} onChange={e => setDate(e.target.value)} /></label>
            <label className="field">Способ<select value={method} onChange={e => setMethod(e.target.value)}><option value="">Выберите способ</option>{METHODS.map(m => <option key={m}>{m}</option>)}</select></label>
          </div>
          {isFuture && <p className="ks-muted" style={{ fontSize: 13 }}>Оплата вперёд: запись датируется 1-м числом месяца, в списках «Внесено» она будет на эту дату.</p>}
          {err && <p className="error">{err}</p>}
          <button type="button" className="ks-btn" disabled={busy} onClick={() => void save()}>Записать платёж</button>
          <p className="ks-muted" style={{ fontSize: 13, marginTop: 6 }}>Запись нельзя изменить или удалить: ошибку исправляют записью с минусом.</p>
        </div>
      )}
    </div>
  );
}
