import { useEffect, useState } from 'react';
import { coachError, DAYS, fmtShort, isoDow, today, type CoachGroup } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { EmptyState, ListRow, Segmented } from '../ui/components';
import { GroupPicker } from '../ui/coach';
import { useMainButton } from '../ui/nav';
import IndMarks, { indDay, indTitle, type IndSession } from './IndMarks';
import { Failure, Loading } from './Message';

type Status = 'present' | 'absent' | 'excused';
interface Slot { group_id: string; weekday: number; kind: string }
interface Player { id: string; full_name: string }

interface RosterRow { session_id: string; starts_at: string; topic: string | null; goalkeepers: boolean; player_id: string | null; full_name: string | null; attended: boolean | null }
/** Строки функции ind_roster_list (занятие × игрок) → занятия с составом, в том же порядке (позже — выше). */
export function groupRoster(rows: RosterRow[]): IndSession[] {
  const out = new Map<string, IndSession>();
  for (const r of rows) {
    let s = out.get(r.session_id);
    if (!s) out.set(r.session_id, (s = { id: r.session_id, starts_at: r.starts_at, topic: r.topic, goalkeepers: r.goalkeepers, individual_bookings: [] }));
    if (r.player_id) s.individual_bookings.push({ player_id: r.player_id, attended: r.attended, players: { full_name: r.full_name ?? '' } });
  }
  return [...out.values()];
}

interface ExtraRosterRow { session_id: string; starts_on: string; place: string | null; player_id: string | null; full_name: string | null; attended: boolean | null }
/** Строки функции extra_roster_list (тренировка × игрок) → тренировки с составом; для общего списка со временем 00:00. */
export function groupExtraRoster(rows: ExtraRosterRow[]): IndSession[] {
  const out = new Map<string, IndSession>();
  for (const r of rows) {
    let s = out.get(r.session_id);
    if (!s) out.set(r.session_id, (s = { id: r.session_id, kind: 'extra', starts_at: `${r.starts_on}T00:00:00`, topic: r.place, goalkeepers: false, individual_bookings: [] }));
    if (r.player_id) s.individual_bookings.push({ player_id: r.player_id, attended: r.attended, players: { full_name: r.full_name ?? '' } });
  }
  return [...out.values()];
}

// Вкладка «Индивидуальные» — группы «Индивидуальные», «Вратари…», «Дополнительные» (как в старом приложении)
const isIndGroup = (name: string) => /^(Индивидуальные|Вратар|Дополнительные)/.test(name);
const STATE_KEY = 'ks.att';

// «Отметки»: вкладки «Группы» и «Индивидуальные», выбор группы и даты, ниже сразу список детей — как в старом приложении.
export default function Sessions({ groups }: { groups: CoachGroup[] }) {
  const saved = (() => {
    try {
      const v = JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null') as { on: string; d: string; g: string; all: boolean; t: 'grp' | 'ind' } | null;
      return v && v.on === today() ? v : null;
    } catch {
      return null;
    }
  })();
  const [tab, setTab] = useState<'grp' | 'ind'>(saved?.t ?? 'grp');
  const [date, setDate] = useState(saved?.d ?? today());
  const [gidPick, setGidPick] = useState(saved?.g ?? '');
  const [all, setAll] = useState(saved?.all ?? false);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [indList, setIndList] = useState<IndSession[] | null>(null);
  const [indOpen, setIndOpen] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const r = await supabase.from('weekly_schedule').select('group_id, weekday, kind');
      if (r.error) return setError(r.error.message);
      setSlots((r.data ?? []) as Slot[]);
    })();
  }, [reload]);

  useEffect(() => {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify({ on: today(), d: date, g: gidPick, all, t: tab }));
    } catch { /* память браузера недоступна — не страшно */ }
  }, [date, gidPick, all, tab]);

  // Индивидуальные, вратарские и дополнительные занятия выбранной даты. Тренер читает их через функции базы (без сумм и оплаты).
  useEffect(() => {
    if (tab !== 'ind') return;
    setIndList(null);
    void (async () => {
      const ind = await supabase.rpc('ind_roster_list', { d_from: date, d_to: date });
      const ext = await supabase.rpc('extra_roster_list', { d_from: date, d_to: date });
      const list = [...(ind.error ? [] : groupRoster((ind.data ?? []) as RosterRow[])), ...(ext.error ? [] : groupExtraRoster((ext.data ?? []) as ExtraRosterRow[]))];
      setIndList(list.sort((a, b) => a.starts_at.localeCompare(b.starts_at)));
    })();
  }, [tab, date, reload]);

  if (error) return <Failure title="Не удалось загрузить расписание" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} />;
  const openInd = indList?.find(x => x.id === indOpen);
  if (openInd) return <IndMarks session={openInd} onBack={() => { setIndOpen(null); setReload(n => n + 1); }} />;
  if (!slots) return <Loading />;

  const dow = isoDow(date);
  const scheduled = (g: CoachGroup) => slots.some(x => x.group_id === g.id && x.weekday === dow && x.kind === 'Групповая');
  const shown = groups.filter(g => !isIndGroup(g.name) && (all || scheduled(g)));
  const gid = shown.some(g => g.id === gidPick) ? gidPick : shown[0]?.id ?? '';

  return (
    <main className="page has-bar">
      <h1>Отметки</h1>
      <Segmented label="Тип занятий" value={tab} onChange={setTab} items={[{ value: 'grp', label: 'Группы' }, { value: 'ind', label: 'Индивидуальные' }]} />
      <div className="ks-two">
        {tab === 'grp' && shown.length > 0 ? <GroupPicker groups={shown} value={gid} onChange={setGidPick} /> : <span />}
        <input className="ks-input" type="date" aria-label="Дата" value={date} onChange={e => e.target.value && setDate(e.target.value)} />
      </div>
      {tab === 'grp' && (
        <>
          <label className="ks-check">
            <input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} />
            <span>Показать все группы (доп. или перенесённая тренировка)</span>
          </label>
          {shown.length === 0 ? (
            <EmptyState icon="box" title="Нет занятий в расписании" text="В этот день по расписанию тренировок нет. Для дополнительной или перенесённой включите «Показать все группы»." />
          ) : (
            <Roster key={`${gid}|${date}`} gid={gid} date={date} />
          )}
        </>
      )}
      {tab === 'ind' && (
        !indList ? <Loading /> : indList.length === 0 ? (
          <EmptyState icon="users" title="Индивидуальных занятий нет" text="На выбранную дату нет индивидуальных, вратарских или дополнительных занятий." />
        ) : indList.map(x => (
          <ListRow key={x.id} title={indTitle(x)} sub={[x.topic ?? 'без темы', `Записано: ${x.individual_bookings.length}`]} onClick={() => setIndOpen(x.id)} />
        ))
      )}
    </main>
  );
}

function Roster({ gid, date }: { gid: string; date: string }) {
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [marks, setMarks] = useState<Record<string, Status>>({});
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    void (async () => {
      const p = await supabase.from('players').select('id, full_name').eq('group_id', gid).eq('status', 'active').order('full_name');
      if (p.error) return setError(p.error.message);
      const s = await supabase.from('sessions').select('id').eq('group_id', gid).eq('source_key', 'ATT|' + date).maybeSingle();
      if (s.error) return setError(s.error.message);
      const existing: Record<string, Status> = {};
      if (s.data) {
        const a = await supabase.from('attendance').select('player_id, status').eq('session_id', (s.data as { id: string }).id);
        if (a.error) return setError(a.error.message);
        for (const r of (a.data ?? []) as { player_id: string; status: Status }[]) existing[r.player_id] = r.status;
      }
      setMarks(existing);
      setPlayers((p.data ?? []) as Player[]);
    })();
  }, [gid, date, reload]);

  const set = (id: string, st: Status) => {
    setMarks(m => ({ ...m, [id]: st }));
    setDirty(true);
    setMsg(null);
  };
  const save = async () => {
    setBusy(true);
    setMsg(null);
    const o = await supabase.rpc('open_session', { g: gid, d: date });
    if (o.error) {
      setBusy(false);
      return setMsg({ ok: false, text: coachError(o.error.message) });
    }
    const list = Object.entries(marks).map(([player_id, status]) => ({ player_id, status }));
    const m = await supabase.rpc('mark_attendance', { s: o.data as string, marks: list });
    setBusy(false);
    if (m.error) return setMsg({ ok: false, text: coachError(m.error.message) });
    setDirty(false);
    setMsg({ ok: true, text: 'Отметки сохранены. Баллы за посещаемость начислены автоматически.' });
  };
  const left = players ? players.filter(p => !marks[p.id]).length : 1; // сохранить можно, когда отмечены все (как в старом приложении)
  const canSave = dirty && !busy && !!players && players.length > 0 && left === 0;
  const native = useMainButton({ text: 'Сохранить отметки', visible: true, enabled: canSave, loading: busy, onClick: () => void save() });

  if (error) return <Failure title="Не удалось загрузить занятие" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} />;
  if (!players) return <Loading />;

  const count = (st: Status) => players.filter(p => marks[p.id] === st).length;
  const was = count('present'), absent = count('absent'), excused = count('excused');
  const setAll = (st: Status | null) => {
    const all: Record<string, Status> = {};
    if (st) players.forEach(p => (all[p.id] = st));
    setMarks(all);
    setDirty(true);
    setMsg(null);
  };
  return (
    <>
      {players.length === 0 ? (
        <EmptyState icon="users" title="В группе нет игроков" text="Активных игроков в этой группе нет." />
      ) : (
        <>
          <div className="ks-progress" aria-hidden="true">
            {players.map(p => <span key={p.id} className={marks[p.id] ?? ''} />)}
          </div>
          <p className="ks-counts">
            <span><b>{was}</b> были</span>
            <span><b>{absent}</b> не были</span>
            {excused > 0 && <span><b>{excused}</b> уваж.</span>}
            <span><b>{left}</b> осталось</span>
          </p>
          <div className="ks-actions">
            <button type="button" className="ks-btn secondary sm" onClick={() => setAll('present')}>Все были</button>
            <button type="button" className="ks-btn secondary sm" disabled={Object.keys(marks).length === 0} onClick={() => setAll(null)}>Сбросить</button>
          </div>
          <p className="muted note">«Уваж.» — пропуск по уважительной причине (баллы не снижаются).</p>
          {players.map(p => (
            <div className="ks-mark" key={p.id} role="group" aria-label={`Посещаемость: ${p.full_name}`}>
              <b>{p.full_name}</b>
              {([['present', 'Был'], ['absent', 'Не был'], ['excused', 'Уваж.']] as [Status, string][]).map(([st, label]) => (
                <button key={st} type="button" className={`mk ${st}${marks[p.id] === st ? ' on' : ''}`} aria-pressed={marks[p.id] === st} onClick={() => set(p.id, st)}>
                  {label}
                </button>
              ))}
            </div>
          ))}
          {msg && <p className={msg.ok ? 'ks-ok' : 'error'}>{msg.text}</p>}
          {!native && (
            <div className="ks-savebar">
              <span>{left > 0 ? <>Осталось отметить: <b>{left}</b></> : <>Отмечено: <b>{players.length}</b> из {players.length}</>}</span>
              <button type="button" className="ks-btn" disabled={!canSave} onClick={() => void save()}>
                Сохранить отметки
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
