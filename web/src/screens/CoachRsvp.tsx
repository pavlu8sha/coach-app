import { useEffect, useState } from 'react';
import { compareGroups, matchTeam, playsMatches, type CoachGroup } from '../lib/coach';
import { LIFECYCLE_LABEL, fmtWhen, fromTbilisiLocal, responseText, rsvpError, toTbilisiLocal, type Lifecycle, type RsvpResponse } from '../lib/matchRsvp';
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
  if (view) return view.id ? <RsvpDetail id={view.id} onBack={back} /> : <RsvpCreate groups={groups} onBack={back} onCreated={id => setView({ id })} />;
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
    setBusy(false);
    if (r.error) return setError(rsvpError(r.error.message));
    onCreated(String(r.data));
  };
  return (
    <main className="page">
      <BackNav onBack={onBack} />
      <h1>Новый матч</h1>
      <label className="ks-label" htmlFor="rs-team">Команда</label>
      <select id="rs-team" className="ks-select" value={team} onChange={e => { setTeam(e.target.value); setTour(''); }}>
        {teams.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <label className="ks-label" htmlFor="rs-kind">Тип</label>
      <select id="rs-kind" className="ks-select" value={kind} onChange={e => setKind(e.target.value as 'friendly' | 'game')}>
        <option value="friendly">Товарищеский матч</option>
        <option value="game">Матч чемпионата</option>
      </select>
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

function RsvpDetail({ id, onBack }: { id: string; onBack: () => void }) {
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
  useEffect(() => {
    void (async () => {
      const r = await supabase.from('matches').select(COLS).eq('id', id).maybeSingle();
      if (r.error) return setError(r.error.message);
      setM((r.data ?? null) as RsvpMatch | null);
      const s = await supabase.rpc('match_rsvp_summary', { m: id });
      setSum(s.error ? null : (((s.data ?? []) as Summary[])[0] ?? null));
      const ro = await supabase.rpc('match_rsvp_roster', { m: id });
      setRoster(ro.error ? [] : ((ro.data ?? []) as RosterRow[]));
    })();
  }, [id, reload]);

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
          <button type="button" className="ks-btn secondary" disabled={busy} onClick={() => void run('match_rsvp_seed', { m: id }, () => 'Состав заполнен активными игроками')}>Заполнить состав</button>
          <div style={{ height: 8 }} />
          <button type="button" className="ks-btn" disabled={busy || roster.length === 0} onClick={() => void run('match_rsvp_publish', { m: id }, () => 'Матч опубликован, родители видят приглашение')}>Опубликовать</button>
          <div style={{ height: 8 }} />
          <button type="button" className="ks-btn secondary" disabled={busy} onClick={() => void del()}>Удалить черновик</button>
        </>
      )}
      {live && (
        <>
          <button type="button" className="ks-btn" disabled={busy || (sum?.unanswered ?? 0) === 0} onClick={() => void remind()}>Напомнить не ответившим</button>
          <label className="ks-label" htmlFor="rs-new">Новая дата и время (Тбилиси)</label>
          <input id="rs-new" className="ks-input" type="datetime-local" value={newWhen} onChange={e => setNewWhen(e.target.value)} placeholder={m.starts_at ? toTbilisiLocal(m.starts_at) : ''} />
          <button type="button" className="ks-btn secondary" disabled={busy} onClick={() => void reschedule()}>Перенести матч</button>
          <label className="ks-label" htmlFor="rs-reason">Причина отмены</label>
          <input id="rs-reason" className="ks-input" value={reason} onChange={e => setReason(e.target.value)} />
          <button type="button" className="ks-btn secondary" disabled={busy} onClick={() => void cancel()}>Отменить матч</button>
        </>
      )}

      <h2>Приглашённые</h2>
      {roster.length === 0 && <p className="muted">Состав пока пуст.</p>}
      {roster.map(p => (
        <div key={p.player_id} className="ks-card">
          <ListRow title={p.full_name} avatar={p.full_name} sub={[p.group_name ?? '', responseText(p.response) + (p.responded_by_coach ? ' (отметил тренер)' : p.responded_by_name ? ` (${p.responded_by_name})` : '')]} />
          {live && (
            <div style={{ display: 'flex', gap: 8 }}>
              {(['yes', 'no'] as RsvpResponse[]).map(v => (
                <button key={v} type="button" className={`ks-btn ${p.response === v ? '' : 'secondary'}`} style={{ minHeight: 40 }} disabled={busy} aria-pressed={p.response === v} aria-label={`${p.full_name}: ${responseText(v)}`} onClick={() => void setFor(p, v)}>{responseText(v)}</button>
              ))}
            </div>
          )}
        </div>
      ))}
    </main>
  );
}
