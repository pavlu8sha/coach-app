import { useEffect, useState } from 'react';
import { coachError, fmtDate, hm, today } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { EmptyState, ListRow, Pill, SearchInput, Segmented } from '../ui/components';
import { BackNav } from '../ui/nav';
import { Failure, Loading } from './Message';

interface Booking { player_id: string; paid: boolean; amount: number; players: { full_name: string } | null }
interface Session { id: string; starts_at: string; topic: string | null; goalkeepers: boolean; individual_bookings: Booking[] }
interface DebtRow { player_id: string; amount: number; players: { full_name: string } | null; individual_sessions: { starts_at: string; goalkeepers: boolean } }

const gel = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2)} ₾`;
const dayOf = (ts: string) => ts.slice(0, 10);
const timeOf = (ts: string) => hm(ts.slice(11, 16));
const title = (s: { starts_at: string; goalkeepers: boolean }) => `${fmtDate(dayOf(s.starts_at))} ${timeOf(s.starts_at)} · ${s.goalkeepers ? 'Вратари' : 'Индивидуальные'}`;
const nowLocal = () => `${today()}T${new Date().toTimeString().slice(0, 5)}`;

type Tab = 'next' | 'past' | 'debt';

// Индивидуальные и вратарские занятия для администратора (миграция 0034): записи, оплата, постоянные участники.
export default function Individual() {
  const [tab, setTab] = useState<Tab>('next');
  const [list, setList] = useState<Session[] | null>(null);
  const [debts, setDebts] = useState<DebtRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void (async () => {
      const now = nowLocal();
      if (tab === 'debt') {
        const r = await supabase.from('individual_bookings').select('player_id, amount, players(full_name), individual_sessions!inner(starts_at, goalkeepers)').eq('paid', false).lt('individual_sessions.starts_at', now).limit(1000);
        if (r.error) return setError(coachError(r.error.message));
        return setDebts((r.data ?? []) as unknown as DebtRow[]);
      }
      const q = supabase.from('individual_sessions').select('id, starts_at, topic, goalkeepers, individual_bookings(player_id, paid, amount, players(full_name))');
      const r = tab === 'next' ? await q.gte('starts_at', now).order('starts_at').limit(60) : await q.lt('starts_at', now).order('starts_at', { ascending: false }).limit(60);
      if (r.error) return setError(r.error.message.includes('goalkeepers') ? 'Модуль ещё не установлен в базе (миграция 0034).' : coachError(r.error.message));
      setList((r.data ?? []) as unknown as Session[]);
    })();
  }, [tab, reload]);

  const done = () => { setCreating(false); setList(null); setDebts(null); setReload(n => n + 1); };
  if (error) return <Failure title="Не удалось загрузить занятия" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} />;
  if (creating) return <SessionForm onBack={() => setCreating(false)} onDone={done} />;
  const open = list?.find(s => s.id === openId);
  if (open) return <SessionView session={open} onBack={() => { setOpenId(null); done(); }} />;

  const byPlayer = new Map<string, { name: string; sum: number; n: number }>();
  (debts ?? []).forEach(d => {
    const cur = byPlayer.get(d.player_id) ?? { name: d.players?.full_name ?? 'Игрок', sum: 0, n: 0 };
    byPlayer.set(d.player_id, { ...cur, sum: cur.sum + Number(d.amount), n: cur.n + 1 });
  });

  return (
    <main className="page">
      <h1>Индивидуальные</h1>
      <Segmented label="Раздел" value={tab} onChange={v => { setList(null); setDebts(null); setTab(v); }} items={[{ value: 'next', label: 'Предстоящие' }, { value: 'past', label: 'Прошедшие' }, { value: 'debt', label: 'Долги' }]} />
      <div style={{ height: 10 }} />
      {tab !== 'debt' && <button type="button" className="ks-btn" onClick={() => setCreating(true)}>Новое занятие</button>}
      {tab === 'debt' ? (
        !debts ? <Loading /> : byPlayer.size === 0 ? (
          <EmptyState icon="users" title="Долгов нет" text="Все записанные на прошедшие занятия оплатили." />
        ) : (
          [...byPlayer.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, 'ru')).map(([id, v]) => (
            <ListRow key={id} avatar={v.name} title={v.name} sub={[`Неоплаченных занятий: ${v.n}`]} end={<Pill tone="danger" dot>{gel(v.sum)}</Pill>} />
          ))
        )
      ) : !list ? (
        <Loading />
      ) : list.length === 0 ? (
        <EmptyState icon="users" title="Занятий нет" text={tab === 'next' ? 'Создайте занятие кнопкой выше.' : 'Прошедших занятий пока нет.'} />
      ) : (
        list.map(s => {
          const paid = s.individual_bookings.filter(b => b.paid).length;
          return <ListRow key={s.id} avatar={s.goalkeepers ? 'В' : 'И'} title={title(s)} sub={[s.topic ?? 'без темы', `Записано: ${s.individual_bookings.length}, оплатили: ${paid}`]} onClick={() => setOpenId(s.id)} />;
        })
      )}
    </main>
  );
}

function SessionForm({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const [date, setDate] = useState(today());
  const [time, setTime] = useState('12:00');
  const [gk, setGk] = useState(false);
  const [theme, setTheme] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setErr(null);
    const r = await supabase.rpc('ind_create_session', { d: date, t: time, gk, theme });
    setBusy(false);
    if (r.error) return setErr(r.error.message.includes('session exists') ? 'Такое занятие уже есть.' : coachError(r.error.message));
    onDone();
  };
  return (
    <main className="page">
      <BackNav onBack={onBack} />
      <h1>Новое занятие</h1>
      <Segmented label="Тип" value={gk ? 'gk' : 'ind'} onChange={v => setGk(v === 'gk')} items={[{ value: 'ind', label: 'Индивидуальные' }, { value: 'gk', label: 'Вратари' }]} />
      <label className="field">Дата<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
      <label className="field">Время<input type="time" value={time} onChange={e => setTime(e.target.value)} /></label>
      <label className="field">Тема (необязательно)<input value={theme} maxLength={80} onChange={e => setTheme(e.target.value)} /></label>
      <p className="muted">Постоянные участники этого типа запишутся автоматически.</p>
      {err && <p className="error">{err}</p>}
      <button type="button" className="ks-btn" disabled={busy || !date || !time} onClick={() => void save()}>Создать</button>
    </main>
  );
}

function SessionView({ session, onBack }: { session: Session; onBack: () => void }) {
  const [bookings, setBookings] = useState<Booking[]>(session.individual_bookings);
  const [regular, setRegular] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [found, setFound] = useState<{ id: string; full_name: string }[]>([]);
  const [date, setDate] = useState(dayOf(session.starts_at));
  const [time, setTime] = useState(timeOf(session.starts_at));
  const [theme, setTheme] = useState(session.topic ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [gone, setGone] = useState(false);

  const refresh = async () => {
    const r = await supabase.from('individual_bookings').select('player_id, paid, amount, players(full_name)').eq('session_id', session.id);
    if (!r.error) setBookings((r.data ?? []) as unknown as Booking[]);
    const g = await supabase.from('individual_regulars').select('player_id').eq('goalkeepers', session.goalkeepers);
    if (!g.error) setRegular(new Set(((g.data ?? []) as { player_id: string }[]).map(x => x.player_id)));
  };
  useEffect(() => { void refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
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
    if (r.error) {
      const m = r.error.message;
      setMsg({ ok: false, text: m.includes('already booked') ? 'Игрок уже записан.' : m.includes('session full') ? 'Все места заняты (лимит из настроек).' : m.includes('booking is paid') ? 'Сначала отмените оплату.' : m.includes('session has payments') ? 'На занятии есть оплаты: дату и время менять и удалять нельзя.' : m.includes('session exists') ? 'Занятие в это время уже есть.' : coachError(m) });
      return false;
    }
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
      <h1>{title(session)}</h1>
      <p className="muted">{session.topic ?? 'Тема не указана'}</p>
      {msg && <p className={msg.ok ? 'muted' : 'error'}>{msg.text}</p>}

      <h3>Записанные</h3>
      {sorted.length === 0 ? <p className="muted">Пока никого.</p> : sorted.map(b => (
        <div className="ks-card" key={b.player_id}>
          <div className="ks-line">
            <b style={{ overflowWrap: 'anywhere' }}>{b.players?.full_name ?? 'Игрок'}</b>
            <Pill tone={b.paid ? 'success' : 'danger'} dot>{b.paid ? 'Оплачено' : gel(Number(b.amount))}</Pill>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <button type="button" className="ks-btn secondary" style={{ width: 'auto' }} disabled={busy === b.player_id} onClick={() => void run(b.player_id, () => supabase.rpc('ind_set_paid', { s: session.id, p: b.player_id, is_paid: !b.paid }))}>
              {b.paid ? 'Отменить оплату' : 'Отметить оплату'}
            </button>
            {!b.paid && (
              <button type="button" className="ks-btn secondary" style={{ width: 'auto' }} disabled={busy === b.player_id} onClick={() => void run(b.player_id, () => supabase.rpc('ind_remove_player', { s: session.id, p: b.player_id }))}>
                Убрать
              </button>
            )}
            <button type="button" className="ks-btn secondary" style={{ width: 'auto' }} disabled={busy === 'r' + b.player_id} onClick={() => void run('r' + b.player_id, () => supabase.rpc('ind_set_regular', { p: b.player_id, gk: session.goalkeepers, on_: !regular.has(b.player_id) }), regular.has(b.player_id) ? 'Убран из постоянных.' : 'Добавлен в постоянные: будет записываться на новые занятия.')}>
              {regular.has(b.player_id) ? 'Не постоянный' : 'Сделать постоянным'}
            </button>
          </div>
        </div>
      ))}

      <h3>Записать игрока</h3>
      <SearchInput label="Найти игрока" placeholder="Фамилия или имя (от 2 букв)" value={q} onChange={setQ} />
      {found.map(p => (
        <ListRow key={p.id} avatar={p.full_name} title={p.full_name} end={<button type="button" className="ks-btn secondary" style={{ width: 'auto', minHeight: 40 }} disabled={busy === 'a' + p.id} onClick={() => void run('a' + p.id, () => supabase.rpc('ind_add_player', { s: session.id, p: p.id }), 'Записан.').then(ok => { if (ok) setQ(''); })}>Записать</button>} />
      ))}

      <h3>Занятие</h3>
      <label className="field">Дата<input type="date" value={date} disabled={anyPaid} onChange={e => setDate(e.target.value)} /></label>
      <label className="field">Время<input type="time" value={time} disabled={anyPaid} onChange={e => setTime(e.target.value)} /></label>
      <label className="field">Тема<input value={theme} maxLength={80} onChange={e => setTheme(e.target.value)} /></label>
      <button type="button" className="ks-btn" disabled={busy === 'edit' || !date || !time} onClick={() => void run('edit', () => supabase.rpc('ind_edit_session', { s: session.id, d: date, t: time, theme }), 'Сохранено.')}>Сохранить</button>
      <div style={{ height: 8 }} />
      {confirmDel ? (
        <>
          <p className="muted">Удалить занятие вместе с записями? Это нельзя отменить.</p>
          <button type="button" className="ks-btn" disabled={busy === 'del'} onClick={() => void run('del', () => supabase.rpc('ind_delete_session', { s: session.id })).then(ok => { if (ok) setGone(true); })}>Да, удалить</button>
          <div style={{ height: 8 }} />
          <button type="button" className="ks-btn secondary" onClick={() => setConfirmDel(false)}>Не удалять</button>
        </>
      ) : (
        <button type="button" className="ks-btn secondary" disabled={anyPaid} onClick={() => setConfirmDel(true)}>{anyPaid ? 'Удалить нельзя: есть оплаты' : 'Удалить занятие'}</button>
      )}
    </main>
  );
}
