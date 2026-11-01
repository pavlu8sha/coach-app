import { useEffect, useState } from 'react';
import { coachError, fmtDate, matchTeam, today, type CoachGroup } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { EmptyState, ListRow, Segmented, searchFocusProps } from '../ui/components';
import { BackNav } from '../ui/nav';
import EventFees from './EventFees';
import { Failure, Loading } from './Message';

export interface EventRow { id: string; team: string; kind: string; name: string | null; starts_on: string | null; players: number; games: number }
interface RosterRow { player_id: string; full_name: string; group_name: string | null; in_fees?: boolean }
interface Player { id: string; full_name: string }

type Kind = 'championship' | 'festival' | 'cup';
export const KIND_TITLE: Record<string, string> = { championship: 'Чемпионат', festival: 'Фестиваль', cup: 'Кубок' };
export const eventTitle = (e: Pick<EventRow, 'kind' | 'name'>) => e.name ?? KIND_TITLE[e.kind] ?? 'Событие';
export const eventCounts = (e: Pick<EventRow, 'players' | 'games'>) => `Игроков: ${e.players} · игр: ${e.games}`;

// «Новое событие»: тип, команда, название, дата; сумму взноса задаёт только администратор; состав можно скопировать из другого события.
export function EventForm({ teams, events, admin, onBack, onCreated }: { teams: string[]; events: EventRow[]; admin: boolean; onBack: () => void; onCreated: (id: string) => void }) {
  const [kind, setKind] = useState<Kind>('championship');
  const [team, setTeam] = useState(teams[0] ?? '');
  const [name, setName] = useState('');
  const [date, setDate] = useState(today());
  const [fee, setFee] = useState('');
  const [copy, setCopy] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!team) return setErr('Выберите команду.');
    setBusy(true);
    setErr(null);
    const r = await supabase.rpc('event_create', { k: kind, tm: team, nm: name, d: date || null, fee: admin && fee !== '' ? Number(fee) : null, copy_from: copy || null });
    setBusy(false);
    if (r.error) return setErr(coachError(r.error.message));
    onCreated(r.data as string);
  };
  const sameTeam = events.filter(e => e.team === team);
  return (
    <main className="page">
      <BackNav onBack={onBack} />
      <h1>Новое событие</h1>
      <Segmented label="Тип события" value={kind} onChange={setKind} items={[{ value: 'championship', label: 'Чемпионат' }, { value: 'festival', label: 'Фестиваль' }, { value: 'cup', label: 'Кубок' }]} />
      <label className="ks-label" htmlFor="e-team">Команда</label>
      <select id="e-team" className="ks-select" value={team} onChange={e => { setTeam(e.target.value); setCopy(''); }}>
        {teams.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <label className="ks-label" htmlFor="e-name">Название</label>
      <input id="e-name" className="ks-input" value={name} onChange={e => setName(e.target.value)} placeholder="Например, Championship 2" maxLength={80} />
      <label className="ks-label" htmlFor="e-date">Дата начала</label>
      <input id="e-date" className="ks-input" type="date" value={date} onChange={e => setDate(e.target.value)} />
      {admin && (
        <>
          <label className="ks-label" htmlFor="e-fee">Взнос с игрока, ₾</label>
          <input id="e-fee" className="ks-input" inputMode="decimal" value={fee} onChange={e => setFee(e.target.value.replace(/[^\d.]/g, '').slice(0, 7))} placeholder="0" />
        </>
      )}
      {sameTeam.length > 0 && (
        <>
          <label className="ks-label" htmlFor="e-copy">Скопировать состав из события</label>
          <select id="e-copy" className="ks-select" value={copy} onChange={e => setCopy(e.target.value)}>
            <option value="">Не копировать</option>
            {sameTeam.map(e => <option key={e.id} value={e.id}>{eventTitle(e)} · {e.players}</option>)}
          </select>
        </>
      )}
      {err && <p className="error">{err}</p>}
      <button type="button" className="ks-btn" disabled={busy} onClick={() => void save()}>Создать событие</button>
    </main>
  );
}

// Событие: состав участников (добавить группу или игрока, убрать) и добавление игры.
export function EventScreen({ event, groups, admin = false, onBack }: { event: EventRow; groups: CoachGroup[]; admin?: boolean; onBack: () => void }) {
  const [roster, setRoster] = useState<RosterRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Player[]>([]);
  const [gameDate, setGameDate] = useState(today());
  const [opp, setOpp] = useState('');
  const [busy, setBusy] = useState(false);
  // команда «U10» объединяет группы U10-A и U10-B
  const teamGroups = groups.filter(g => g.name === event.team || matchTeam(g.name) === event.team);

  useEffect(() => {
    void (async () => {
      const r = await supabase.rpc('event_roster', { t: event.id });
      if (r.error) return setError(r.error.message);
      setRoster((r.data ?? []) as RosterRow[]);
    })();
  }, [event.id, reload]);

  useEffect(() => {
    if (q.trim().length < 2) return setFound([]);
    const t = setTimeout(() => {
      void supabase.from('players').select('id, full_name').ilike('full_name', `%${q.trim()}%`).order('full_name').limit(8).then(r => {
        if (!r.error) setFound((r.data ?? []) as Player[]);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const run = async (p: PromiseLike<{ error: { message: string } | null }>, ok?: string) => {
    setBusy(true);
    setMsg(null);
    const r = await p;
    setBusy(false);
    if (r.error) return setMsg(coachError(r.error.message));
    if (ok) setMsg(ok);
    setReload(n => n + 1);
  };
  const add = (ids: string[]) => run(supabase.rpc('event_roster_add', { t: event.id, ids }));
  const addGroup = async () => {
    if (teamGroups.length === 0) return;
    const p = await supabase.from('players').select('id').in('group_id', teamGroups.map(g => g.id)).eq('status', 'active');
    if (p.error) return setMsg(coachError(p.error.message));
    await add(((p.data ?? []) as { id: string }[]).map(x => x.id));
  };
  const addGame = async () => {
    setBusy(true);
    setMsg(null);
    const r = await supabase.rpc('event_add_game', { t: event.id, d: gameDate, opp });
    setBusy(false);
    if (r.error) return setMsg(coachError(r.error.message));
    onBack();
  };

  if (error) return <Failure title="Не удалось загрузить состав" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} back={<BackNav onBack={onBack} />} />;
  if (!roster) return <Loading />;
  return (
    <main className="page">
      <BackNav onBack={onBack} />
      <h1>{eventTitle(event)}</h1>
      <p className="muted">{KIND_TITLE[event.kind]} · {event.team}{event.starts_on ? ` · ${fmtDate(event.starts_on)}` : ''}</p>
      <h3>Состав: {roster.length}</h3>
      {teamGroups.length > 0 && <button type="button" className="ks-btn secondary" disabled={busy} onClick={() => void addGroup()}>Добавить всю команду {event.team}</button>}
      {roster.length === 0 ? (
        <EmptyState icon="users" title="В составе пока никого" text="Добавьте игроков группы или найдите игрока по имени." />
      ) : (
        roster.map(p => (
          <ListRow key={p.player_id} avatar={p.full_name} title={p.full_name} sub={p.group_name ? [p.group_name] : undefined}
            end={p.in_fees === false
              ? <span className="ks-muted" style={{ fontSize: 13 }}>играл в матче</span>
              : <button type="button" className="ks-btn secondary" style={{ width: 'auto', minHeight: 40 }} aria-label={`Убрать: ${p.full_name}`} disabled={busy} onClick={() => void run(supabase.rpc('event_roster_remove', { t: event.id, pid: p.player_id }))}>Убрать</button>} />
        ))
      )}
      <h3>Добавить игрока</h3>
      <input className="ks-input" value={q} onChange={e => setQ(e.target.value)} placeholder="Фамилия или имя (от 2 букв)" aria-label="Найти игрока" {...searchFocusProps} />
      {found.filter(f => !roster.some(r => r.player_id === f.id)).map(f => (
        <ListRow key={f.id} avatar={f.full_name} title={f.full_name} end={<button type="button" className="ks-btn secondary" style={{ width: 'auto', minHeight: 40 }} disabled={busy} onClick={() => { setQ(''); setFound([]); void add([f.id]); }}>Добавить</button>} />
      ))}
      {admin && <EventFees eventId={event.id} reloadKey={reload} onChanged={() => setReload(n => n + 1)} />}
      <h3>Добавить игру</h3>
      <label className="ks-label" htmlFor="g-date">Дата</label>
      <input id="g-date" className="ks-input" type="date" value={gameDate} onChange={e => setGameDate(e.target.value)} />
      <label className="ks-label" htmlFor="g-opp">Соперник</label>
      <input id="g-opp" className="ks-input" value={opp} onChange={e => setOpp(e.target.value)} placeholder="Название команды" maxLength={80} />
      <button type="button" className="ks-btn" disabled={busy || !gameDate} onClick={() => void addGame()}>Добавить игру</button>
      {msg && <p className="error">{msg}</p>}
    </main>
  );
}
