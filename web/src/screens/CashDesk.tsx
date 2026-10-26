import { useCallback, useEffect, useState } from 'react';
import { coachError, fmtDate, today } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { EmptyState, ListRow, Pill, SearchInput } from '../ui/components';
import { BackNav } from '../ui/nav';
import { Failure, Loading } from './Message';
import { gel, monthIso, monthName, nextMonth, SEASON_START, tariffFor } from './MonthPayments';

interface Pl { id: string; full_name: string; group_id: string | null; groups: { name: string } | null }
interface Due { key: string; kind: 'sub' | 'eq' | 'ind' | 'extra' | 'camp'; section: string; title: string; sub?: string; due: number; paid: number; month?: string; pay: (amount: number, method: string, date: string) => PromiseLike<{ error: { message: string } | null }> }

const METHODS = ['Наличные', 'Перевод', 'Другое'];
const r2 = (n: number) => Math.round(n * 100) / 100;
const SECTIONS = ['Абонемент', 'Экипировка', 'Индивидуальные и вратари', 'Дополнительные тренировки', 'Сборы'];
const errText = (m: string) => (m.includes('paid above total') ? 'Оплата больше суммы заказа.' : m.includes('bad amount') ? 'Сумма указана неверно.' : coachError(m));

/** Всё, что игрок должен: абонемент по месяцам, заказы экипировки, занятия и сборы. Платёж по строке идёт в нужный раздел. */
async function loadDues(p: Pl): Promise<Due[]> {
  const out: Due[] = [];
  const me = (await supabase.auth.getUser()).data.user?.id ?? null;
  const noSub = (p.groups?.name ?? '').trim().toLowerCase() === 'индивидуальные / вратарские';
  const [prices, pays, subs, orders, ind, extra, camps] = await Promise.all([
    supabase.from('prices').select('group_id, amount, valid_from, valid_to').eq('kind', 'subscription'),
    supabase.from('payments').select('amount, paid_on').eq('player_id', p.id).limit(1000),
    supabase.from('subscriptions').select('month, group_id, discount, written_off').eq('player_id', p.id),
    supabase.from('equipment_orders').select('id, ordered_on, total, paid, equipment_order_lines(kit)').eq('player_id', p.id),
    supabase.from('individual_bookings').select('session_id, amount, paid, individual_sessions(starts_at, goalkeepers)').eq('player_id', p.id).eq('paid', false),
    supabase.from('extra_bookings').select('session_id, paid, extra_sessions(starts_on, amount)').eq('player_id', p.id).eq('paid', false),
    supabase.from('camp_participants').select('id, amount, status, camps(name), camp_payments(amount)').eq('player_id', p.id).eq('status', 'registered'),
  ]);
  const bad = [prices, pays, subs, orders, ind, extra, camps].find(r => r.error);
  if (bad?.error) throw new Error(bad.error.message);

  if (!noSub) {
    const pr = ((prices.data ?? []) as { group_id: string | null; amount: number; valid_from: string; valid_to: string | null }[]).map(x => ({ ...x, amount: Number(x.amount) }));
    const paidBy = new Map<string, number>();
    ((pays.data ?? []) as { amount: number; paid_on: string }[]).forEach(x => paidBy.set(monthIso(new Date(x.paid_on + 'T12:00:00')), (paidBy.get(monthIso(new Date(x.paid_on + 'T12:00:00'))) ?? 0) + Number(x.amount)));
    const sb = new Map(((subs.data ?? []) as { month: string; group_id: string | null; discount: boolean; written_off: boolean }[]).map(s => [s.month, s]));
    const cur = monthIso(new Date());
    for (let m = SEASON_START; m <= cur; m = nextMonth(m)) {
      const s = sb.get(m);
      if (m !== cur && !s && !paidBy.has(m)) continue; // прошлый месяц без строки абонемента долгом не считается
      const gid = s?.group_id ?? p.group_id;
      const tariff = gid ? tariffFor(pr, gid, m) : null;
      if (tariff === null || s?.written_off) continue;
      const got = paidBy.get(m) ?? 0;
      if (s?.discount && got > 0) continue;
      if (got >= tariff) continue;
      out.push({
        key: 'sub' + m, kind: 'sub', section: SECTIONS[0], title: monthName(m), sub: s?.discount ? 'скидка по договорённости: оплатите любую сумму' : undefined, due: tariff, paid: got, month: m,
        pay: (amount, method, date) => supabase.from('payments').insert({ player_id: p.id, amount: r2(amount), paid_on: date, method, recorded_by: me }),
      });
    }
  }
  ((orders.data ?? []) as unknown as { id: string; ordered_on: string | null; total: number; paid: number; equipment_order_lines: { kit: string }[] }[]).forEach(o => {
    if (Number(o.paid) >= Number(o.total)) return;
    out.push({ key: 'eq' + o.id, kind: 'eq', section: SECTIONS[1], title: [...new Set(o.equipment_order_lines.map(l => l.kit))].join(' + ') || 'Заказ', sub: o.ordered_on ? fmtDate(o.ordered_on) : undefined, due: Number(o.total), paid: Number(o.paid), pay: amount => supabase.rpc('eq_add_payment', { o: o.id, amt: r2(amount) }) });
  });
  const nowLocal = `${today()}T${new Date().toTimeString().slice(0, 5)}`;
  ((ind.data ?? []) as unknown as { session_id: string; amount: number; individual_sessions: { starts_at: string; goalkeepers: boolean } | null }[]).forEach(b => {
    if (!b.individual_sessions || b.individual_sessions.starts_at > nowLocal) return;
    out.push({ key: 'ind' + b.session_id, kind: 'ind', section: SECTIONS[2], title: `${b.individual_sessions.goalkeepers ? 'Вратари' : 'Индивидуальное'} ${fmtDate(b.individual_sessions.starts_at.slice(0, 10))}`, due: Number(b.amount), paid: 0, pay: () => supabase.rpc('ind_set_paid', { s: b.session_id, p: p.id, is_paid: true }) });
  });
  ((extra.data ?? []) as unknown as { session_id: string; extra_sessions: { starts_on: string; amount: number } | null }[]).forEach(b => {
    if (!b.extra_sessions || b.extra_sessions.starts_on > today() || Number(b.extra_sessions.amount) <= 0) return;
    out.push({ key: 'ex' + b.session_id, kind: 'extra', section: SECTIONS[3], title: `Доп. тренировка ${fmtDate(b.extra_sessions.starts_on)}`, due: Number(b.extra_sessions.amount), paid: 0, pay: (amount, method) => supabase.rpc('extra_set_paid', { s: b.session_id, p: p.id, is_paid: true, mth: method, amt: r2(amount) }) });
  });
  ((camps.data ?? []) as unknown as { id: string; amount: number; camps: { name: string } | null; camp_payments: { amount: number }[] }[]).forEach(c => {
    const got = c.camp_payments.reduce((s, x) => s + Number(x.amount), 0);
    if (got >= Number(c.amount)) return;
    out.push({ key: 'camp' + c.id, kind: 'camp', section: SECTIONS[4], title: c.camps?.name ?? 'Сбор', due: Number(c.amount), paid: got, pay: (amount, method, date) => supabase.rpc('camp_pay', { pid: c.id, amt: r2(amount), k: 'payment', d: date, mth: method, cmt: null }) });
  });
  return out;
}

// «Приём оплат»: найти игрока, увидеть всё, что к оплате, и принять платёж одним шагом (миграции 0023, 0034–0037).
export default function CashDesk() {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Pl[]>([]);
  const [player, setPlayer] = useState<Pl | null>(null);
  const [todayRows, setTodayRows] = useState<{ id: string; amount: number; method: string | null; players: { full_name: string } | null }[] | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (q.trim().length < 2) return setFound([]);
    const t = setTimeout(() => {
      void supabase.from('players').select('id, full_name, group_id, groups(name)').ilike('full_name', `%${q.trim()}%`).order('full_name').limit(10).then(r => {
        if (!r.error) setFound((r.data ?? []) as unknown as Pl[]);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    void supabase.from('payments').select('id, amount, method, players(full_name)').eq('paid_on', today()).limit(200).then(r => {
      if (!r.error) setTodayRows((r.data ?? []) as unknown as { id: string; amount: number; method: string | null; players: { full_name: string } | null }[]);
    });
  }, [reload, player]);

  if (player) return <PlayerDues player={player} onBack={() => { setPlayer(null); setReload(n => n + 1); }} />;
  const total = (todayRows ?? []).reduce((s, x) => s + Number(x.amount), 0);
  return (
    <main className="page">
      <h1>Приём оплат</h1>
      <SearchInput label="Найти игрока" placeholder="Фамилия или имя (от 2 букв)" value={q} onChange={setQ} />
      {q.trim().length >= 2 && found.length === 0 ? (
        <EmptyState icon="search" title="Никого не найдено" text="Проверьте написание." />
      ) : (
        found.map(p => <ListRow key={p.id} avatar={p.full_name} title={p.full_name} sub={[p.groups?.name ?? 'без группы']} onClick={() => setPlayer(p)} />)
      )}
      <h3 className="ks-list-head"><span>Внесено сегодня</span><span>{todayRows ? gel(total) : ''}</span></h3>
      {!todayRows ? <Loading /> : todayRows.length === 0 ? <p className="muted">Сегодня абонементных платежей ещё не было.</p> : todayRows.map(x => (
        <ListRow key={x.id} title={x.players?.full_name ?? 'Игрок'} sub={[x.method ?? '']} end={<Pill tone={Number(x.amount) < 0 ? 'danger' : 'success'}>{gel(Number(x.amount))}</Pill>} />
      ))}
      <p className="ks-muted" style={{ fontSize: 13 }}>В списке абонементные платежи. Оплаты экипировки, занятий и сборов видны в своих разделах.</p>
    </main>
  );
}

function PlayerDues({ player, onBack }: { player: Pl; onBack: () => void }) {
  const [dues, setDues] = useState<Due[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => { void loadDues(player).then(setDues).catch(e => setError(e instanceof Error ? e.message : String(e))); }, [player]);
  useEffect(() => { load(); }, [load, reload]);

  if (error) return <Failure title="Не удалось загрузить долги игрока" text={coachError(error)} onRetry={() => { setError(null); setDues(null); setReload(n => n + 1); }} />;
  const sum = (dues ?? []).reduce((s, d) => s + (d.due - d.paid), 0);
  return (
    <main className="page">
      <BackNav onBack={onBack} />
      <h1 style={{ overflowWrap: 'anywhere' }}>{player.full_name}</h1>
      <p className="muted">{player.groups?.name ?? 'без группы'}{dues ? ` · к оплате: ${gel(sum)}` : ''}</p>
      {msg && <p className="ks-ok">{msg}</p>}
      {!dues ? <Loading /> : dues.length === 0 ? (
        <EmptyState icon="users" title="Долгов нет" text="По абонементу, экипировке, занятиям и сборам всё оплачено." />
      ) : (
        SECTIONS.filter(s => dues.some(d => d.section === s)).map(s => (
          <section key={s}>
            <h3>{s}</h3>
            {dues.filter(d => d.section === s).map(d => (
              <DueCard key={d.key} due={d} open={openKey === d.key} onOpen={() => setOpenKey(openKey === d.key ? null : d.key)} onPaid={() => { setOpenKey(null); setMsg('Платёж записан.'); setDues(null); setReload(n => n + 1); }} />
            ))}
          </section>
        ))
      )}
    </main>
  );
}

function DueCard({ due, open, onOpen, onPaid }: { due: Due; open: boolean; onOpen: () => void; onPaid: () => void }) {
  const left = r2(due.due - due.paid);
  const isCurrent = due.month === monthIso(new Date());
  const [amount, setAmount] = useState(String(left));
  const [method, setMethod] = useState(METHODS[0]);
  const [date, setDate] = useState(due.month && !isCurrent ? due.month : today());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fixedAmount = due.kind === 'ind'; // индивидуальное занятие отмечается оплаченным целиком
  const num = Number(amount.replace(',', '.'));
  const save = async () => {
    if (!fixedAmount && (!Number.isFinite(num) || num <= 0 || num > 100000)) return setErr('Введите сумму больше нуля.');
    if (due.month && (date > today() || date < due.month || date >= nextMonth(due.month))) return setErr('Дата должна быть в этом месяце и не в будущем: оплата считается по месяцу даты.');
    setBusy(true);
    setErr(null);
    const r = await due.pay(fixedAmount ? left : num, method, date);
    setBusy(false);
    if (r.error) return setErr(errText(r.error.message));
    onPaid();
  };
  return (
    <div className="ks-card">
      <div className="ks-line"><b style={{ overflowWrap: 'anywhere' }}>{due.title}</b><Pill tone="danger" dot>{gel(left)}</Pill></div>
      <div className="ks-muted" style={{ fontSize: 13 }}>{due.paid > 0 ? `Внесено ${gel(due.paid)} из ${gel(due.due)}` : `К оплате ${gel(due.due)}`}{due.sub ? ` · ${due.sub}` : ''}</div>
      <button type="button" className="ks-btn secondary" style={{ marginTop: 8 }} onClick={onOpen}>{open ? 'Свернуть' : 'Принять оплату'}</button>
      {open && (
        <div style={{ marginTop: 8 }}>
          {!fixedAmount && <label className="field">Сумма, ₾ (меньше остатка — частичный платёж, останется долг)<input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></label>}
          <div className="two">
            {due.kind === 'sub' || due.kind === 'camp' ? <label className="field">Дата<input type="date" value={date} min={due.month} max={today()} onChange={e => setDate(e.target.value)} /></label> : <span />}
            <label className="field">Способ<select value={method} onChange={e => setMethod(e.target.value)}>{METHODS.map(m => <option key={m}>{m}</option>)}</select></label>
          </div>
          {err && <p className="error">{err}</p>}
          <button type="button" className="ks-btn" disabled={busy} onClick={() => void save()}>{fixedAmount ? `Отметить оплаченным (${gel(left)})` : 'Записать платёж'}</button>
        </div>
      )}
    </div>
  );
}
