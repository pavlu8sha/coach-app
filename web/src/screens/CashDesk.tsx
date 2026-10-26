import { useCallback, useEffect, useState } from 'react';
import { coachError, fmtDate, today } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { EmptyState, ListRow, Pill, SearchInput } from '../ui/components';
import { BackNav } from '../ui/nav';
import { Failure, Loading } from './Message';
import { gel, monthIso, monthName, nextMonth, SEASON_START, tariffFor } from './MonthPayments';

interface Pl { id: string; full_name: string; group_id: string | null; groups: { name: string } | null; external_id?: string | null; birth_date?: string | null }
interface Due { key: string; kind: 'sub' | 'eq' | 'ind' | 'extra' | 'camp'; section: string; title: string; sub?: string; due: number; paid: number; month?: string; advance?: boolean; pay: (amount: number, method: string, date: string) => PromiseLike<{ error: { message: string } | null }> }

const METHODS = ['Наличные', 'Перевод', 'Другое'];
const PAY_METHODS = ['Наличные', 'Перевод'];
const JUMPS = [
  { label: 'Абонемент', section: 'Абонемент' }, { label: 'Экипировка', section: 'Экипировка' },
  { label: 'Индивидуальные', section: 'Индивидуальные и вратари' }, { label: 'Дополнительные', section: 'Дополнительные тренировки' },
];
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
    for (let m = SEASON_START; m <= nextMonth(cur); m = nextMonth(m)) {
      const s = sb.get(m);
      if (m < cur && !s && !paidBy.has(m)) continue; // прошлый месяц без строки абонемента долгом не считается
      const gid = s?.group_id ?? p.group_id;
      const tariff = gid ? tariffFor(pr, gid, m) : null;
      if (tariff === null || s?.written_off) continue;
      const got = paidBy.get(m) ?? 0;
      if (s?.discount && got > 0) continue;
      if (got >= tariff) continue;
      out.push({
        key: 'sub' + m, kind: 'sub', section: SECTIONS[0], title: m > cur ? `${monthName(m)} (вперёд)` : monthName(m), sub: s?.discount ? 'скидка по договорённости: оплатите любую сумму' : m > cur ? 'оплата вперёд, запись датируется 1-м числом' : undefined, due: tariff, paid: got, month: m, advance: m > cur,
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
  const [day, setDay] = useState(today());
  const [payMethod, setPayMethod] = useState('');
  const [todayRows, setTodayRows] = useState<{ id: string; amount: number; method: string | null; what: string; player_id?: string; players: { full_name: string } | null }[] | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (q.trim().length < 2) return setFound([]);
    const t = setTimeout(() => {
      void supabase.from('players').select('id, full_name, group_id, external_id, birth_date, groups(name)').ilike('full_name', `%${q.trim()}%`).order('full_name').limit(10).then(r => {
        if (!r.error) setFound((r.data ?? []) as unknown as Pl[]);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  // Платежи за выбранный день: абонемент (payments) и сборы (camp_payments); у экипировки и занятий даты платежа не хранятся
  useEffect(() => {
    setTodayRows(null);
    void (async () => {
      const a = await supabase.from('payments').select('id, amount, method, player_id, players(full_name)').eq('paid_on', day).limit(500);
      const c = await supabase.from('camp_payments').select('id, amount, method, kind, players(full_name)').eq('paid_on', day).limit(500);
      if (a.error) return;
      const rows = ((a.data ?? []) as unknown as { id: string; amount: number; method: string | null; player_id: string; players: { full_name: string } | null }[]).map(x => ({ ...x, what: 'Абонемент' }));
      const camp = c.error ? [] : ((c.data ?? []) as unknown as { id: string; amount: number; method: string | null; kind: string; players: { full_name: string } | null }[]).map(x => ({ ...x, what: 'Сбор' }));
      setTodayRows([...rows, ...camp]);
    })();
  }, [reload, player, day]);

  // Отмена оплаты абонемента — записью с минусом (журнал платежей только добавляется)
  const cancelPay = async (x: { id: string; amount: number; player_id?: string }) => {
    if (!x.player_id || !window.confirm('Отменить эту оплату? Будет записана запись с минусом.')) return;
    setCancelling(x.id);
    const me = (await supabase.auth.getUser()).data.user?.id ?? null;
    await supabase.from('payments').insert({ player_id: x.player_id, amount: -Number(x.amount), paid_on: day, method: 'Исправление', recorded_by: me });
    setCancelling(null);
    setReload(n => n + 1);
  };
  const total = (todayRows ?? []).reduce((s, x) => s + Number(x.amount), 0);
  return (
    <main className="page">
      <h1>Приём оплат</h1>
      {player ? (
        <>
          <div className="ks-card">
            <div className="ks-line">
              <span style={{ minWidth: 0 }}><b style={{ overflowWrap: 'anywhere' }}>{player.full_name}</b><br /><span className="muted">{[player.external_id, player.groups?.name ?? 'без группы', player.birth_date ? `${player.birth_date.slice(0, 4)} г.` : null].filter(Boolean).join(' · ')}</span></span>
              <button type="button" className="ks-btn secondary sm" onClick={() => { setPlayer(null); setReload(n => n + 1); }}>Сменить</button>
            </div>
          </div>
          <p className="ks-label">Способ оплаты</p>
          <div className="two" role="group" aria-label="Способ оплаты">
            {PAY_METHODS.map(m => (
              <button type="button" key={m} className={payMethod === m ? 'ks-btn' : 'ks-btn secondary'} aria-pressed={payMethod === m} onClick={() => setPayMethod(m)}>{m}</button>
            ))}
          </div>
          <p className="ks-label">Перейти к оплате</p>
          <div className="two">
            {JUMPS.map(j => (
              <button type="button" key={j.label} className="ks-btn secondary" onClick={() => document.querySelector(`[data-sec="${j.section}"]`)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })}>{j.label}</button>
            ))}
          </div>
          <PlayerDues embedded player={player} sharedMethod={payMethod} />
        </>
      ) : (
        <>
          <SearchInput label="Игрок (введите ФИ и выберите из списка)" placeholder="Фамилия или имя (от 2 букв)" value={q} onChange={setQ} />
          {q.trim().length >= 2 && found.length === 0 ? (
            <EmptyState icon="search" title="Никого не найдено" text="Проверьте написание." />
          ) : (
            found.map(p => <ListRow key={p.id} avatar={p.full_name} title={p.full_name} sub={[p.groups?.name ?? 'без группы']} onClick={() => setPlayer(p)} />)
          )}
        </>
      )}
      <h3 className="ks-list-head"><span>{day === today() ? 'Внесено сегодня' : `Внесено ${fmtDate(day)}`}</span><span>{todayRows ? gel(total) : ''}</span></h3>
      <label className="field" style={{ marginBottom: 8 }}>Дата<input type="date" aria-label="Дата платежей" value={day} max={today()} onChange={e => e.target.value && setDay(e.target.value)} /></label>
      {todayRows && todayRows.length > 0 && (
        <div className="ks-tiles" style={{ marginBottom: 12, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
          <div className="ks-tile"><b>Наличные</b>{gel(todayRows.filter(x => x.method === 'Наличные').reduce((s, x) => s + Number(x.amount), 0))}</div>
          <div className="ks-tile"><b>Перевод</b>{gel(todayRows.filter(x => x.method === 'Перевод').reduce((s, x) => s + Number(x.amount), 0))}</div>
          <div className="ks-tile"><b>Всего</b>{gel(total)}</div>
        </div>
      )}
      {!todayRows ? <Loading /> : todayRows.length === 0 ? <p className="muted">В этот день платежей по абонементам и сборам нет.</p> : todayRows.map(x => (
        <div key={x.what + x.id}>
          <ListRow title={x.players?.full_name ?? 'Игрок'} sub={[[x.what, x.method].filter(Boolean).join(' · ')]} end={<Pill tone={Number(x.amount) < 0 ? 'danger' : 'success'}>{gel(Number(x.amount))}</Pill>} />
          {x.what === 'Абонемент' && Number(x.amount) > 0 && (
            <button type="button" className="ks-btn secondary" style={{ marginTop: -2, marginBottom: 8 }} aria-label={`Отменить оплату: ${x.players?.full_name ?? 'игрок'}`} disabled={cancelling === x.id} onClick={() => void cancelPay(x)}>Отменить оплату</button>
          )}
        </div>
      ))}
      <p className="ks-muted" style={{ fontSize: 13 }}>В списке платежи по абонементам и сборам. Оплаты экипировки и занятий дат не хранят, их видно в своих разделах.</p>
    </main>
  );
}

export function PlayerDues({ player, onBack, embedded = false, sharedMethod }: { player: Pl; onBack?: () => void; embedded?: boolean; sharedMethod?: string }) {
  const [dues, setDues] = useState<Due[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => { void loadDues(player).then(setDues).catch(e => setError(e instanceof Error ? e.message : String(e))); }, [player]);
  useEffect(() => { load(); }, [load, reload]);

  if (error) return <Failure title="Не удалось загрузить долги игрока" text={coachError(error)} onRetry={() => { setError(null); setDues(null); setReload(n => n + 1); }} />;
  const sum = (dues ?? []).filter(d => !d.advance).reduce((s, d) => s + (d.due - d.paid), 0);
  const Wrap = embedded ? 'div' : 'main';
  return (
    <Wrap className={embedded ? undefined : 'page'}>
      {!embedded && onBack && <BackNav onBack={onBack} />}
      {!embedded && <h1 style={{ overflowWrap: 'anywhere' }}>{player.full_name}</h1>}
      <p className="muted">{embedded ? '' : `${player.groups?.name ?? 'без группы'}`}{dues ? `${embedded ? '' : ' · '}к оплате: ${gel(sum)}` : ''}</p>
      {msg && <p className="ks-ok">{msg}</p>}
      {dues && dues.length > 0 && !dues.some(d => !d.advance) && <p className="muted">Долгов нет. Ниже можно принять оплату вперёд.</p>}
      {!dues ? <Loading /> : dues.length === 0 ? (
        <EmptyState icon="users" title="Долгов нет" text="По абонементу, экипировке, занятиям и сборам всё оплачено." />
      ) : (
        SECTIONS.filter(s => dues.some(d => d.section === s)).map(s => (
          <section key={s} data-sec={s}>
            <h3>{s}</h3>
            {dues.filter(d => d.section === s).map(d => (
              <DueCard key={d.key} due={d} sharedMethod={sharedMethod} open={openKey === d.key} onOpen={() => setOpenKey(openKey === d.key ? null : d.key)} onPaid={() => { setOpenKey(null); setMsg('Платёж записан.'); setDues(null); setReload(n => n + 1); }} />
            ))}
          </section>
        ))
      )}
    </Wrap>
  );
}

function DueCard({ due, open, onOpen, onPaid, sharedMethod }: { due: Due; open: boolean; onOpen: () => void; onPaid: () => void; sharedMethod?: string }) {
  const left = r2(due.due - due.paid);
  const isCurrent = due.month === monthIso(new Date());
  const [amount, setAmount] = useState(String(left));
  const [ownMethod, setMethod] = useState('');
  const method = sharedMethod !== undefined ? sharedMethod : ownMethod;
  const [date, setDate] = useState(due.month && !isCurrent ? due.month : today());
  const advance = Boolean(due.advance);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fixedAmount = due.kind === 'ind'; // индивидуальное занятие отмечается оплаченным целиком
  const num = Number(amount.replace(',', '.'));
  const save = async () => {
    if (!method) return setErr(sharedMethod !== undefined ? 'Выберите способ оплаты вверху экрана: «Наличные» или «Перевод».' : 'Выберите способ оплаты.');
    if (!fixedAmount && (!Number.isFinite(num) || num <= 0 || num > 100000)) return setErr('Введите сумму больше нуля.');
    if (due.month && ((date > today() && !advance) || date < due.month || date >= nextMonth(due.month))) return setErr('Дата должна быть в этом месяце и не в будущем: оплата считается по месяцу даты.');
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
            {due.kind === 'sub' || due.kind === 'camp' ? <label className="field">Дата<input type="date" value={date} min={due.month} max={advance ? undefined : today()} disabled={advance} onChange={e => setDate(e.target.value)} /></label> : <span />}
            {sharedMethod !== undefined ? <span /> : <label className="field">Способ<select value={method} onChange={e => setMethod(e.target.value)}><option value="">Выберите способ</option>{METHODS.map(m => <option key={m}>{m}</option>)}</select></label>}
          </div>
          {err && <p className="error">{err}</p>}
          <button type="button" className="ks-btn" disabled={busy} onClick={() => void save()}>{fixedAmount ? `Отметить оплаченным (${gel(left)})` : 'Записать платёж'}</button>
        </div>
      )}
    </div>
  );
}
