import { useEffect, useState } from 'react';
import { coachError, fmtDate, today } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { EmptyState, ListRow, Pill, SearchInput, Segmented } from '../ui/components';
import { BackNav } from '../ui/nav';
import { Failure, Loading } from './Message';

interface Booking { player_id: string; paid: boolean; attended: boolean | null; paid_amount: number | null; method: string | null; players: { full_name: string } | null }
interface Session { id: string; starts_on: string; amount: number; place: string | null; extra_bookings: Booking[] }
interface DebtRow { player_id: string; players: { full_name: string } | null; extra_sessions: { starts_on: string; amount: number } }

const gel = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2)} ₾`;
const METHODS = ['Наличные', 'Перевод', 'Другое'];
const errText = (m: string) =>
  m.includes('already booked') ? 'Игрок уже записан.' : m.includes('booking is paid') ? 'Сначала отмените оплату.' : m.includes('session has payments') ? 'На тренировке есть оплаты: дату и сумму менять и удалять нельзя.' : m.includes('session exists') ? 'Тренировка на эту дату уже есть.' : m.includes('bad amount') ? 'Сумма указана неверно.' : coachError(m);

type Tab = 'next' | 'past' | 'debt';

// Дополнительные тренировки для администратора (миграция 0035): запись, оплата, долги.
export default function Extra() {
  const [tab, setTab] = useState<Tab>('next');
  const [list, setList] = useState<Session[] | null>(null);
  const [debts, setDebts] = useState<DebtRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void (async () => {
      if (tab === 'debt') {
        const r = await supabase.from('extra_bookings').select('player_id, players(full_name), extra_sessions!inner(starts_on, amount)').eq('paid', false).lte('extra_sessions.starts_on', today()).limit(1000);
        if (r.error) return setError(r.error.message.includes('extra_') ? 'Модуль ещё не установлен в базе (миграция 0035).' : coachError(r.error.message));
        return setDebts((r.data ?? []) as unknown as DebtRow[]);
      }
      const q = supabase.from('extra_sessions').select('id, starts_on, amount, place, extra_bookings(player_id, paid, attended, paid_amount, method, players(full_name))');
      const r = tab === 'next' ? await q.gt('starts_on', today()).order('starts_on').limit(60) : await q.lte('starts_on', today()).order('starts_on', { ascending: false }).limit(60);
      if (r.error) return setError(r.error.message.includes('extra_') ? 'Модуль ещё не установлен в базе (миграция 0035).' : coachError(r.error.message));
      setList((r.data ?? []) as unknown as Session[]);
    })();
  }, [tab, reload]);

  const done = () => { setCreating(false); setList(null); setDebts(null); setReload(n => n + 1); };
  if (error) return <Failure title="Не удалось загрузить тренировки" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} />;
  if (creating) return <Form onBack={() => setCreating(false)} onDone={done} />;
  const open = list?.find(s => s.id === openId);
  if (open) return <View session={open} onBack={() => { setOpenId(null); done(); }} />;

  const byPlayer = new Map<string, { name: string; sum: number; n: number }>();
  (debts ?? []).forEach(d => {
    const cur = byPlayer.get(d.player_id) ?? { name: d.players?.full_name ?? 'Игрок', sum: 0, n: 0 };
    byPlayer.set(d.player_id, { ...cur, sum: cur.sum + Number(d.extra_sessions.amount), n: cur.n + 1 });
  });

  return (
    <main className="page">
      <h1>Дополнительные</h1>
      <Segmented label="Раздел" value={tab} onChange={v => { setList(null); setDebts(null); setTab(v); }} items={[{ value: 'next', label: 'Предстоящие' }, { value: 'past', label: 'Прошедшие' }, { value: 'debt', label: 'Долги' }]} />
      <div style={{ height: 10 }} />
      {tab !== 'debt' && <button type="button" className="ks-btn" onClick={() => setCreating(true)}>Новая тренировка</button>}
      {tab === 'debt' ? (
        !debts ? <Loading /> : byPlayer.size === 0 ? (
          <EmptyState icon="users" title="Долгов нет" text="Все записанные на прошедшие тренировки оплатили." />
        ) : (
          [...byPlayer.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, 'ru')).filter(([, v]) => v.sum > 0).map(([id, v]) => (
            <ListRow key={id} avatar={v.name} title={v.name} sub={[`Неоплаченных тренировок: ${v.n}`]} end={<Pill tone="danger" dot>{gel(v.sum)}</Pill>} />
          ))
        )
      ) : !list ? (
        <Loading />
      ) : list.length === 0 ? (
        <EmptyState icon="users" title="Тренировок нет" text={tab === 'next' ? 'Создайте тренировку кнопкой выше.' : 'Прошедших тренировок пока нет.'} />
      ) : (
        list.map(s => (
          <ListRow key={s.id} avatar="Д" title={`${fmtDate(s.starts_on)} · ${gel(Number(s.amount))}`} sub={[s.place ?? 'место не указано', `Записано: ${s.extra_bookings.length}, оплатили: ${s.extra_bookings.filter(b => b.paid).length}`]} onClick={() => setOpenId(s.id)} />
        ))
      )}
    </main>
  );
}

function Form({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState('');
  const [place, setPlace] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setErr(null);
    const r = await supabase.rpc('extra_create_session', { d: date, amt: Number(amount.replace(',', '.')), plc: place });
    setBusy(false);
    if (r.error) return setErr(errText(r.error.message));
    onDone();
  };
  return (
    <main className="page">
      <BackNav onBack={onBack} />
      <h1>Новая тренировка</h1>
      <label className="field">Дата<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
      <label className="field">Сумма с игрока, ₾<input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></label>
      <label className="field">Место (необязательно)<input value={place} maxLength={80} onChange={e => setPlace(e.target.value)} /></label>
      {err && <p className="error">{err}</p>}
      <button type="button" className="ks-btn" disabled={busy || !date || amount.trim() === '' || Number.isNaN(Number(amount.replace(',', '.')))} onClick={() => void save()}>Создать</button>
    </main>
  );
}

function View({ session, onBack }: { session: Session; onBack: () => void }) {
  const [bookings, setBookings] = useState<Booking[]>(session.extra_bookings);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<{ id: string; full_name: string }[]>([]);
  const [date, setDate] = useState(session.starts_on);
  const [amount, setAmount] = useState(String(session.amount));
  const [place, setPlace] = useState(session.place ?? '');
  const [method, setMethod] = useState(METHODS[0]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [gone, setGone] = useState(false);

  const refresh = async () => {
    const r = await supabase.from('extra_bookings').select('player_id, paid, attended, paid_amount, method, players(full_name)').eq('session_id', session.id);
    if (!r.error) setBookings((r.data ?? []) as unknown as Booking[]);
  };
  useEffect(() => { if (gone) onBack(); }, [gone]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (q.trim().length < 2) return setFound([]);
    const t = setTimeout(() => {
      void supabase.from('players').select('id, full_name').eq('status', 'active').ilike('full_name', `%${q.trim()}%`).order('full_name').limit(8).then(r => {
        if (!r.error) setFound((r.data ?? []) as { id: string; full_name: string }[]);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const run = async (key: string, f: () => PromiseLike<{ error: { message: string } | null }>, ok?: string) => {
    setBusy(key);
    setMsg(null);
    const r = await f();
    setBusy(null);
    if (r.error) { setMsg({ ok: false, text: errText(r.error.message) }); return false; }
    if (ok) setMsg({ ok: true, text: ok });
    await refresh();
    return true;
  };

  if (gone) return null;
  const anyPaid = bookings.some(b => b.paid);
  const sorted = [...bookings].sort((a, b) => (a.players?.full_name ?? '').localeCompare(b.players?.full_name ?? '', 'ru'));
  return (
    <main className="page">
      <BackNav onBack={onBack} />
      <h1>{fmtDate(session.starts_on)} · {gel(Number(session.amount))}</h1>
      <p className="muted">{session.place ?? 'Место не указано'}</p>
      {msg && <p className={msg.ok ? 'muted' : 'error'}>{msg.text}</p>}

      <h3>Записанные</h3>
      <label className="field">Способ оплаты<select value={method} onChange={e => setMethod(e.target.value)}>{METHODS.map(m => <option key={m}>{m}</option>)}</select></label>
      {sorted.length === 0 ? <p className="muted">Пока никого.</p> : sorted.map(b => (
        <div className="ks-card" key={b.player_id}>
          <div className="ks-line">
            <b style={{ overflowWrap: 'anywhere' }}>{b.players?.full_name ?? 'Игрок'}</b>
            <Pill tone={b.paid ? 'success' : 'danger'} dot>{b.paid ? `${gel(Number(b.paid_amount ?? session.amount))}${b.method ? ` · ${b.method}` : ''}` : 'Не оплачено'}</Pill>
          </div>
          <div style={{ marginTop: 8 }}>
            <Segmented label={`Посещение: ${b.players?.full_name ?? ''}`} value={b.attended === true ? 'yes' : b.attended === false ? 'no' : 'none'} onChange={v => void run('t' + b.player_id, () => supabase.rpc('extra_set_attended', { s: session.id, p: b.player_id, was: v === 'yes' ? true : v === 'no' ? false : null }))} items={[{ value: 'yes', label: 'Был(а)' }, { value: 'no', label: 'Нет' }, { value: 'none', label: '—' }]} />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <button type="button" className="ks-btn secondary" style={{ width: 'auto' }} disabled={busy === b.player_id} onClick={() => void run(b.player_id, () => supabase.rpc('extra_set_paid', { s: session.id, p: b.player_id, is_paid: !b.paid, mth: method }))}>
              {b.paid ? 'Отменить оплату' : 'Отметить оплату'}
            </button>
            {!b.paid && (
              <button type="button" className="ks-btn secondary" style={{ width: 'auto' }} disabled={busy === b.player_id} onClick={() => void run(b.player_id, () => supabase.rpc('extra_remove_player', { s: session.id, p: b.player_id }))}>Убрать</button>
            )}
          </div>
        </div>
      ))}

      <h3>Записать игрока</h3>
      <SearchInput label="Найти игрока" placeholder="Фамилия или имя (от 2 букв)" value={q} onChange={setQ} />
      {found.map(p => (
        <ListRow key={p.id} avatar={p.full_name} title={p.full_name} end={<button type="button" className="ks-btn secondary" style={{ width: 'auto', minHeight: 40 }} disabled={busy === 'a' + p.id} onClick={() => void run('a' + p.id, () => supabase.rpc('extra_add_player', { s: session.id, p: p.id }), 'Записан.').then(ok => { if (ok) setQ(''); })}>Записать</button>} />
      ))}

      <h3>Тренировка</h3>
      <label className="field">Дата<input type="date" value={date} disabled={anyPaid} onChange={e => setDate(e.target.value)} /></label>
      <label className="field">Сумма, ₾<input inputMode="decimal" value={amount} disabled={anyPaid} onChange={e => setAmount(e.target.value)} /></label>
      <label className="field">Место<input value={place} maxLength={80} onChange={e => setPlace(e.target.value)} /></label>
      <button type="button" className="ks-btn" disabled={busy === 'edit' || !date || Number.isNaN(Number(amount.replace(',', '.')))} onClick={() => void run('edit', () => supabase.rpc('extra_edit_session', { s: session.id, d: date, amt: Number(amount.replace(',', '.')), plc: place }), 'Сохранено.')}>Сохранить</button>
      <div style={{ height: 8 }} />
      {confirmDel ? (
        <>
          <p className="muted">Удалить тренировку вместе с записями? Это нельзя отменить.</p>
          <button type="button" className="ks-btn" disabled={busy === 'del'} onClick={() => void run('del', () => supabase.rpc('extra_delete_session', { s: session.id })).then(ok => { if (ok) setGone(true); })}>Да, удалить</button>
          <div style={{ height: 8 }} />
          <button type="button" className="ks-btn secondary" onClick={() => setConfirmDel(false)}>Не удалять</button>
        </>
      ) : (
        <button type="button" className="ks-btn secondary" disabled={anyPaid} onClick={() => setConfirmDel(true)}>{anyPaid ? 'Удалить нельзя: есть оплаты' : 'Удалить тренировку'}</button>
      )}
    </main>
  );
}
