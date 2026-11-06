import { useEffect, useState } from 'react';
import { compareGroups, matchTeam, playsMatches, type CoachGroup } from '../lib/coach';
import { FILTER_LABEL, LIFECYCLE_LABEL, activityLine, fmtWhen, matchesFilter, fromTbilisiLocal, responseText, rsvpError, toTbilisiLocal, type Lifecycle, type RsvpResponse, type SummaryFilter } from '../lib/matchRsvp';
import { supabase } from '../lib/supabase';
import { Pill, ListRow } from '../ui/components';
import { BackNav } from '../ui/nav';
import { useConfirm } from '../ui/ConfirmSheet';
import { eventTitle, type EventRow } from './Events';
import { Failure, Loading } from './Message';

interface RsvpMatch { id: string; team: string; opponent: string | null; starts_at: string | null; lifecycle_status: Lifecycle; kind: string | null; venue: string | null; address: string | null; notes: string | null; tournament_id: string | null }
interface Summary { invited: number; yes: number; no: number; unanswered: number; reminders: number; last_reminder_at: string | null }
interface RosterRow { player_id: string; full_name: string; group_name: string | null; status: string; response: RsvpResponse | null; responded_by_name: string | null; responded_by_coach: boolean; responded_at: string | null; answer_until: string | null }

const COLS = 'id, team, opponent, starts_at, lifecycle_status, kind, venue, address, notes, tournament_id';
const TONE: Record<Lifecycle, 'success' | 'warning' | 'danger' | 'neutral'> = { published: 'success', draft: 'warning', cancelled: 'danger', legacy: 'neutral' };
const title = (m: RsvpMatch) => (m.opponent ? `${m.team} · ${m.opponent}` : `${m.team} · соперник не указан`);

/**
 * «Матчи с подтверждением» для тренера и администратора: список, создание черновика, состав приглашённых, публикация,
 * напоминания, отмена и перенос. Все правила (кто может, сроки, лимит напоминаний) проверяет база; здесь только вызовы.
 * Старые матчи (без подтверждения) сюда не попадают и работают как раньше.
 */
export default function CoachRsvp({ groups, onBack }: { groups: CoachGroup[]; onBack: () => void }) {
  const [list, setList] = useState<RsvpMatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [view, setView] = useState<{ id: string | null } | null>(null);
  useEffect(() => {
    void (async () => {
      const r = await supabase.from('matches').select(COLS).neq('lifecycle_status', 'legacy').order('starts_at', { ascending: false });
      if (r.error) return setError(r.error.message);
      setList((r.data ?? []) as RsvpMatch[]);
    })();
  }, [reload]);
  const back = () => { setView(null); setReload(n => n + 1); };
  if (view) return view.id ? <RsvpDetail id={view.id} groups={groups} onBack={back} /> : <RsvpCreate groups={groups} onBack={back} onCreated={id => setView({ id })} />;
  if (error) return <Failure title="Не удалось загрузить матчи" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} back={<BackNav onBack={onBack} />} />;
  if (!list) return <Loading />;
  return (
    <main className="page">
      <BackNav onBack={onBack} />
      <h1>Матчи с подтверждением</h1>
      <button type="button" className="ks-btn" onClick={() => setView({ id: null })}>Новый матч</button>
      <div style={{ height: 12 }} />
      {list.length === 0 && <p className="muted">Пока нет матчей с подтверждением участия.</p>}
      {list.map(m => (
        <ListRow key={m.id} title={title(m)} sub={[m.starts_at ? fmtWhen(m.starts_at) : '']} end={<Pill tone={TONE[m.lifecycle_status]}>{LIFECYCLE_LABEL[m.lifecycle_status]}</Pill>} onClick={() => setView({ id: m.id })} />
      ))}
    </main>
  );
}

function RsvpCreate({ groups, onBack, onCreated }: { groups: CoachGroup[]; onBack: () => void; onCreated: (id: string) => void }) {
  const teams = [...new Set(groups.map(g => g.name).filter(playsMatches).map(matchTeam))].sort(compareGroups);
  const [team, setTeam] = useState(teams[0] ?? '');
  const [kind, setKind] = useState<'friendly' | 'game'>('friendly');
  const [opp, setOpp] = useState('');
  const [when, setWhen] = useState('');
  const [venue, setVenue] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [tour, setTour] = useState('');
  const [grp, setGrp] = useState(''); // основная группа для товарищеского: '' — все группы команды
  const [events, setEvents] = useState<EventRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      const r = await supabase.rpc('event_list');
      if (!r.error) setEvents((r.data ?? []) as EventRow[]);
    })();
  }, []);
  const tours = events.filter(e => e.team === team);
  const teamGroups = groups.filter(g => playsMatches(g.name) && matchTeam(g.name) === team);
  const save = async () => {
    if (!team || !when) return setError('Выберите команду и укажите дату и время.');
    setBusy(true);
    setError(null);
    const c = await supabase.from('clubs').select('id').limit(1);
    const club = ((c.data ?? []) as { id: string }[])[0]?.id;
    if (!club) { setBusy(false); return setError('Клуб не найден'); }
    const r = await supabase.rpc('match_rsvp_create_draft', {
      p_club: club, p_kind: kind, p_team: team, p_opponent: opp, p_starts_at: fromTbilisiLocal(when),
      p_venue: venue, p_address: address, p_notes: notes, p_tournament: kind === 'game' && tour ? tour : null,
    });
    if (r.error) { setBusy(false); return setError(rsvpError(r.error.message)); }
    // Состав добавляется сразу (ТЗ §1): у чемпионата — список события, иначе основная группа или все группы команды.
    // Если не вышло, черновик всё равно создан, состав можно заполнить кнопкой на экране матча.
    const id = String(r.data);
    const seeds: Record<string, unknown>[] = kind === 'game' && tour ? [{ m: id }]
      : (grp ? teamGroups.filter(g => g.id === grp) : teamGroups).map(g => ({ m: id, p_group: g.id }));
    for (const a of seeds) await supabase.rpc('match_rsvp_seed', a);
    setBusy(false);
    onCreated(id);
  };
  return (
    <main className="page">
      <BackNav onBack={onBack} />
      <h1>Новый матч</h1>
      <label className="ks-label" htmlFor="rs-team">Команда</label>
      <select id="rs-team" className="ks-select" value={team} onChange={e => { setTeam(e.target.value); setTour(''); setGrp(''); }}>
        {teams.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <label className="ks-label" htmlFor="rs-kind">Тип</label>
      <select id="rs-kind" className="ks-select" value={kind} onChange={e => setKind(e.target.value as 'friendly' | 'game')}>
        <option value="friendly">Товарищеский матч</option>
        <option value="game">Матч чемпионата</option>
      </select>
      {kind === 'friendly' && teamGroups.length > 1 && (
        <>
          <label className="ks-label" htmlFor="rs-grp">Основная группа</label>
          <select id="rs-grp" className="ks-select" value={grp} onChange={e => setGrp(e.target.value)}>
            <option value="">Все группы команды</option>
            {teamGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </>
      )}
      {kind === 'game' && (
        <>
          <label className="ks-label" htmlFor="rs-tour">Чемпионат или фестиваль</label>
          <select id="rs-tour" className="ks-select" value={tour} onChange={e => setTour(e.target.value)}>
            <option value="">Не выбран</option>
            {tours.map(e => <option key={e.id} value={e.id}>{eventTitle(e)}</option>)}
          </select>
        </>
      )}
      <label className="ks-label" htmlFor="rs-opp">Соперник</label>
      <input id="rs-opp" className="ks-input" value={opp} onChange={e => setOpp(e.target.value)} />
      <label className="ks-label" htmlFor="rs-when">Дата и время (Тбилиси)</label>
      <input id="rs-when" className="ks-input" type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} />
      <label className="ks-label" htmlFor="rs-venue">Место</label>
      <input id="rs-venue" className="ks-input" value={venue} onChange={e => setVenue(e.target.value)} />
      <label className="ks-label" htmlFor="rs-addr">Адрес</label>
      <input id="rs-addr" className="ks-input" value={address} onChange={e => setAddress(e.target.value)} />
      <label className="ks-label" htmlFor="rs-notes">Заметка для родителей</label>
      <input id="rs-notes" className="ks-input" value={notes} onChange={e => setNotes(e.target.value)} />
      {error && <p role="alert" className="ks-error">{error}</p>}
      <button type="button" className="ks-btn" disabled={busy} onClick={() => void save()}>Создать черновик</button>
    </main>
  );
}

function RsvpDetail({ id, groups, onBack }: { id: string; groups: CoachGroup[]; onBack: () => void }) {
  const { ask: confirm, dialog } = useConfirm();
  const [m, setM] = useState<RsvpMatch | null>(null);
  const [sum, setSum] = useState<Summary | null>(null);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [newWhen, setNewWhen] = useState('');
  const [reason, setReason] = useState('');
  const [edit, setEdit] = useState<{ opponent: string; venue: string; address: string; notes: string; when: string } | null>(null);
  const [filter, setFilter] = useState<SummaryFilter>('all');
  const [history, setHistory] = useState<{ id: number; action: string; created_at: string }[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<{ id: string; full_name: string }[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) return setFound([]);
    const t = setTimeout(() => {
      void supabase.from('players').select('id, full_name').ilike('full_name', `%${q.trim()}%`).order('full_name').limit(8).then(r => {
        if (!r.error) setFound((r.data ?? []) as { id: string; full_name: string }[]);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    void (async () => {
      const r = await supabase.from('matches').select(COLS).eq('id', id).maybeSingle();
      if (r.error) return setError(r.error.message);
      setM((r.data ?? null) as RsvpMatch | null);
      const s = await supabase.rpc('match_rsvp_summary', { m: id });
      setSum(s.error ? null : (((s.data ?? []) as Summary[])[0] ?? null));
      const ro = await supabase.rpc('match_rsvp_roster', { m: id });
      setRoster(ro.error ? [] : ((ro.data ?? []) as RosterRow[]));
      // Последний неиспользованный снимок отметок (после переноса): даёт кнопку «Вернуть отметки»
      const sn = await supabase.from('match_mark_snapshots').select('id').eq('match_id', id).is('restored_at', null).order('taken_at', { ascending: false }).limit(1);
      setSnapshot(sn.error ? null : ((((sn.data ?? []) as { id: string }[])[0])?.id ?? null));
    })();
  }, [id, reload]);

  useEffect(() => {
    if (!showHistory) return;
    void supabase.from('match_activity').select('id, action, created_at').eq('match_id', id).order('id', { ascending: false }).limit(50).then(r => {
      setHistory(r.error ? [] : ((r.data ?? []) as { id: number; action: string; created_at: string }[]));
    });
  }, [showHistory, id, reload]);

  // Один вызов базы: показываем ошибку по-русски или обновляем экран
  const run = async (name: string, args: Record<string, unknown>, ok: (data: unknown) => string) => {
    setBusy(true);
    setMsg(null);
    const r = await supabase.rpc(name, args);
    setBusy(false);
    if (r.error) return setMsg({ ok: false, text: rsvpError(r.error.message) });
    setMsg({ ok: true, text: ok(r.data) });
    setReload(n => n + 1);
  };

  if (error) return <Failure title="Не удалось загрузить матч" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} back={<BackNav onBack={onBack} />} />;
  if (!m) return <Loading />;
  const st = m.lifecycle_status;
  const invited = roster.filter(p => p.status === 'invited'); // исключённые остаются в базе, в списке их нет
  const shown = invited.filter(p => matchesFilter(p.response, filter));
  const started = m.starts_at ? new Date(m.starts_at).getTime() <= Date.now() : false;
  const live = st === 'published' && !started;

  const remind = async () => {
    const unanswered = sum?.unanswered ?? 0;
    if (!(await confirm({ title: 'Напомнить родителям?', note: `Напоминание получат родители, не ответившие за ${unanswered} игр. Родителю можно напоминать не чаще раза в 24 часа.`, confirmLabel: 'Напомнить' }))) return;
    await run('match_rsvp_remind_unanswered', { m: id }, d => {
      const row = (Array.isArray(d) ? d[0] : d) as { queued?: number; skipped?: number } | null;
      return `Поставлено в очередь: ${row?.queued ?? 0}, пропущено (уже напоминали): ${row?.skipped ?? 0}`;
    });
  };
  const cancel = async () => {
    if (!(await confirm({ title: 'Отменить матч?', note: 'Матч останется в списке со статусом «Отменён», удалить его потом нельзя.', confirmLabel: 'Отменить матч', danger: true }))) return;
    await run('match_rsvp_cancel', { m: id, p_reason: reason }, () => 'Матч отменён');
  };
  const restore = async () => {
    if (!snapshot) return;
    if (!(await confirm({ title: 'Вернуть отметки?', note: 'Вернём отметки игроков и счёт, которые были до переноса. Работает, только пока на матче нет новых отметок.', confirmLabel: 'Вернуть' }))) return;
    await run('match_rsvp_restore_marks', { p_snapshot: snapshot }, () => 'Отметки и счёт возвращены');
  };
  const del = async () => {
    if (!(await confirm({ title: 'Удалить черновик?', note: 'Черновик ещё не виден родителям.', confirmLabel: 'Удалить', danger: true }))) return;
    setBusy(true);
    const r = await supabase.rpc('match_rsvp_delete_draft', { m: id });
    setBusy(false);
    if (r.error) return setMsg({ ok: false, text: rsvpError(r.error.message) });
    onBack();
  };
  const reschedule = async () => {
    if (!newWhen) return setMsg({ ok: false, text: 'Укажите новую дату и время.' });
    if (!(await confirm({ title: 'Перенести матч?', note: 'Ответы родителей сбросятся, родители ответят заново. Если по матчу уже были отметки или счёт, они сохранятся в снимке.', confirmLabel: 'Перенести' }))) return;
    await run('match_rsvp_reschedule', { m: id, p_starts_at: fromTbilisiLocal(newWhen), p_venue: m.venue, p_address: m.address }, () => 'Матч перенесён');
  };
  const openEdit = () => setEdit({ opponent: m.opponent ?? '', venue: m.venue ?? '', address: m.address ?? '', notes: m.notes ?? '', when: m.starts_at ? toTbilisiLocal(m.starts_at) : '' });
  // Отправляем только изменённые поля: база пишет в журнал, что именно поменялось
  const saveEdit = async () => {
    if (!edit) return;
    const p: Record<string, string> = {};
    if (edit.opponent.trim() !== (m.opponent ?? '')) p.opponent = edit.opponent;
    if (edit.venue.trim() !== (m.venue ?? '')) p.venue = edit.venue;
    if (edit.address.trim() !== (m.address ?? '')) p.address = edit.address;
    if (edit.notes.trim() !== (m.notes ?? '')) p.notes = edit.notes;
    if (edit.when && edit.when !== (m.starts_at ? toTbilisiLocal(m.starts_at) : '')) p.starts_at = fromTbilisiLocal(edit.when);
    if (!Object.keys(p).length) return setEdit(null);
    setBusy(true);
    setMsg(null);
    const r = await supabase.rpc('match_rsvp_update', { m: id, p });
    setBusy(false);
    if (r.error) return setMsg({ ok: false, text: rsvpError(r.error.message) });
    setEdit(null);
    setMsg({ ok: true, text: st === 'published' ? 'Сохранено. Родителям отправлено сообщение об изменении' : 'Сохранено' });
    setReload(n => n + 1);
  };
  // Состав: у события — список события, иначе игроки групп команды матча
  const fillRoster = async () => {
    setBusy(true);
    setMsg(null);
    let added = 0;
    let err: string | null = null;
    const targets = m.tournament_id ? [null] : groups.filter(g => matchTeam(g.name) === m.team).map(g => g.id);
    if (!targets.length) { setBusy(false); return setMsg({ ok: false, text: 'Группы этой команды не найдены. Добавьте игроков поиском ниже.' }); }
    for (const g of targets) {
      const r = await supabase.rpc('match_rsvp_seed', g ? { m: id, p_group: g } : { m: id });
      if (r.error) { err = rsvpError(r.error.message); break; }
      added += Number(r.data ?? 0);
    }
    setBusy(false);
    if (err) return setMsg({ ok: false, text: err });
    setMsg({ ok: true, text: `Добавлено игроков: ${added}` });
    setReload(n => n + 1);
  };
  const addPlayer = async (pl: { id: string; full_name: string }) => {
    setQ('');
    setFound([]);
    await run('match_rsvp_invite', { m: id, p_players: [pl.id] }, () => (st === 'published' ? `${pl.full_name} приглашён, родителям отправлено сообщение` : `${pl.full_name} добавлен в состав`));
  };
  const removePlayer = async (p: RosterRow) => {
    if (!(await confirm({ title: 'Убрать из состава?', lines: [['Игрок', p.full_name]], note: st === 'published' ? 'Ответ родителя сохранится в журнале.' : undefined, confirmLabel: 'Убрать', danger: true }))) return;
    await run('match_rsvp_remove', { m: id, p_players: [p.player_id] }, () => `${p.full_name} убран из состава`);
  };
  const setFor = (p: RosterRow, v: RsvpResponse) => run('match_rsvp_coach_set', { m: id, p_player: p.player_id, p_response: v }, () => `${p.full_name}: ${responseText(v)}`);

  return (
    <main className="page">
      <BackNav onBack={onBack} />
      {dialog}
      <h1>{title(m)}</h1>
      <p><Pill tone={TONE[st]}>{LIFECYCLE_LABEL[st]}</Pill> {m.starts_at ? fmtWhen(m.starts_at) : ''}</p>
      {[m.venue, m.address, m.notes].filter(Boolean).map(t => <p key={t} className="muted">{t}</p>)}
      {sum && (
        <div className="ks-card" aria-label="Сводка ответов">
          <p>Приглашено: {sum.invited} · Будут: {sum.yes} · Не будут: {sum.no} · Не ответили: {sum.unanswered}</p>
          <p className="muted">Напоминаний отправлено: {sum.reminders}{sum.last_reminder_at ? ` · последнее ${fmtWhen(sum.last_reminder_at)}` : ''}</p>
        </div>
      )}
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'muted' : 'ks-error'}>{msg.text}</p>}

      {st === 'draft' && (
        <>
          <button type="button" className="ks-btn secondary" disabled={busy} onClick={() => void fillRoster()}>{m.tournament_id ? 'Заполнить состав из события' : 'Заполнить состав команды'}</button>
          <div style={{ height: 8 }} />
          <button type="button" className="ks-btn" disabled={busy || invited.length === 0} onClick={() => void run('match_rsvp_publish', { m: id }, () => 'Матч опубликован, родители видят приглашение')}>Опубликовать</button>
          <div style={{ height: 8 }} />
          <button type="button" className="ks-btn secondary" disabled={busy} onClick={() => void del()}>Удалить черновик</button>
        </>
      )}
      {live && (
        <button type="button" className="ks-btn" disabled={busy || (sum?.unanswered ?? 0) === 0} onClick={() => void remind()}>Напомнить не ответившим</button>
      )}
      {st === 'published' && (
        <>
          <label className="ks-label" htmlFor="rs-new">Новая дата и время (Тбилиси)</label>
          <input id="rs-new" className="ks-input" type="datetime-local" value={newWhen} onChange={e => setNewWhen(e.target.value)} placeholder={m.starts_at ? toTbilisiLocal(m.starts_at) : ''} />
          <button type="button" className="ks-btn secondary" disabled={busy} onClick={() => void reschedule()}>Перенести матч</button>
          <label className="ks-label" htmlFor="rs-reason">Причина отмены</label>
          <input id="rs-reason" className="ks-input" value={reason} onChange={e => setReason(e.target.value)} />
          <button type="button" className="ks-btn secondary" disabled={busy} onClick={() => void cancel()}>Отменить матч</button>
        </>
      )}

      {(st === 'draft' || live) && (
        edit ? (
          <div className="ks-card" aria-label="Изменить матч">
            <label className="ks-label" htmlFor="ed-opp">Соперник</label>
            <input id="ed-opp" className="ks-input" value={edit.opponent} onChange={e => setEdit({ ...edit, opponent: e.target.value })} />
            <label className="ks-label" htmlFor="ed-when">Дата и время (Тбилиси){st === 'published' ? ': только время того же дня, дату меняет перенос' : ''}</label>
            <input id="ed-when" className="ks-input" type="datetime-local" value={edit.when} onChange={e => setEdit({ ...edit, when: e.target.value })} />
            <label className="ks-label" htmlFor="ed-venue">Место</label>
            <input id="ed-venue" className="ks-input" value={edit.venue} onChange={e => setEdit({ ...edit, venue: e.target.value })} />
            <label className="ks-label" htmlFor="ed-addr">Адрес или ссылка на карту</label>
            <input id="ed-addr" className="ks-input" value={edit.address} onChange={e => setEdit({ ...edit, address: e.target.value })} />
            <label className="ks-label" htmlFor="ed-notes">Заметка для родителей</label>
            <input id="ed-notes" className="ks-input" value={edit.notes} onChange={e => setEdit({ ...edit, notes: e.target.value })} />
            <button type="button" className="ks-btn" disabled={busy} onClick={() => void saveEdit()}>Сохранить</button>
            <div style={{ height: 8 }} />
            <button type="button" className="ks-btn secondary" disabled={busy} onClick={() => setEdit(null)}>Отмена</button>
          </div>
        ) : (
          <>
            <div style={{ height: 8 }} />
            <button type="button" className="ks-btn secondary" disabled={busy} onClick={openEdit}>Изменить данные матча</button>
          </>
        )
      )}

      {snapshot && st === 'published' && (
        <button type="button" className="ks-btn secondary" disabled={busy} onClick={() => void restore()}>Вернуть отметки до переноса</button>
      )}

      <h2>Приглашённые</h2>
      {invited.length === 0 && <p className="muted">Состав пока пуст.</p>}
      {invited.length > 0 && (
        <div role="group" aria-label="Фильтр по ответам" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {(Object.keys(FILTER_LABEL) as SummaryFilter[]).map(f => (
            <button key={f} type="button" className={`ks-btn ${filter === f ? '' : 'secondary'}`} style={{ width: 'auto', minHeight: 36 }} aria-pressed={filter === f}
              onClick={() => setFilter(f)}>{FILTER_LABEL[f]} ({invited.filter(p => matchesFilter(p.response, f)).length})</button>
          ))}
        </div>
      )}
      {invited.length > 0 && shown.length === 0 && <p className="muted">В этой группе никого нет.</p>}
      {shown.map(p => (
        <div key={p.player_id} className="ks-card">
          <ListRow title={p.full_name} avatar={p.full_name} sub={[p.group_name ?? '', responseText(p.response) + (p.responded_by_coach ? ' (отметил тренер)' : p.responded_by_name ? ` (${p.responded_by_name})` : '')]} />
          {(st === 'draft' || live) && (
            <button type="button" className="ks-btn secondary" style={{ minHeight: 36, marginBottom: 8 }} disabled={busy} aria-label={`Убрать из состава: ${p.full_name}`} onClick={() => void removePlayer(p)}>Убрать из состава</button>
          )}
          {live && (
            <div style={{ display: 'flex', gap: 8 }}>
              {(['yes', 'no'] as RsvpResponse[]).map(v => (
                <button key={v} type="button" className={`ks-btn ${p.response === v ? '' : 'secondary'}`} style={{ minHeight: 40 }} disabled={busy} aria-pressed={p.response === v} aria-label={`${p.full_name}: ${responseText(v)}`} onClick={() => void setFor(p, v)}>{responseText(v)}</button>
              ))}
            </div>
          )}
        </div>
      ))}
      {(st === 'draft' || live) && (
        <div className="ks-card" aria-label="Добавить игрока">
          <label className="ks-label" htmlFor="add-q">Добавить игрока в состав</label>
          <input id="add-q" className="ks-input" placeholder="Фамилия или имя" value={q} onChange={e => setQ(e.target.value)} />
          {found.filter(f => !invited.some(r => r.player_id === f.id)).map(f => (
            <ListRow key={f.id} avatar={f.full_name} title={f.full_name} end={<button type="button" className="ks-btn secondary" style={{ width: 'auto', minHeight: 40 }} disabled={busy} onClick={() => void addPlayer(f)}>Добавить</button>} />
          ))}
        </div>
      )}

      <h2>История</h2>
      {!showHistory && <button type="button" className="ks-btn secondary" onClick={() => setShowHistory(true)}>Показать историю действий</button>}
      {showHistory && history === null && <p className="muted">Загрузка…</p>}
      {showHistory && history?.length === 0 && <p className="muted">Записей пока нет.</p>}
      {history?.map(a => <p key={a.id} className="muted">{activityLine(a)}</p>)}
    </main>
  );
}
