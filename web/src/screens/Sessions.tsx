import { useEffect, useMemo, useState } from 'react';
import { addDays, coachError, DAYS, fmtShort, hm, isoDow, today, type CoachGroup } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { EmptyState, ListRow, Pill, Segmented } from '../ui/components';
import { GroupPicker } from '../ui/coach';
import { BackNav, useMainButton } from '../ui/nav';
import IndMarks, { indDay, indTitle, type IndSession } from './IndMarks';
import { Failure, Loading } from './Message';

type Status = 'present' | 'absent' | 'excused';
interface Slot { weekday: number; starts_at: string; location: string | null; kind: string }
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

const DAYS_BACK = 21; // сколько последних дней показываем: занятия можно отметить и задним числом

// «Занятия»: занятия группы по расписанию за последние дни; тренер открывает день и отмечает, кто был.
export default function Sessions({ groups }: { groups: CoachGroup[] }) {
  const [gid, setGid] = useState(groups[0]?.id ?? '');
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [date, setDate] = useState<string | null>(null);
  // группа без групповых тренировок («Индивидуальные / Вратарские»): вместо состава группы — реальные занятия и записавшиеся на них
  const [indList, setIndList] = useState<IndSession[] | null>(null);
  const [indOpen, setIndOpen] = useState<string | null>(null);

  useEffect(() => {
    setSlots(null);
    setIndList(null);
    void (async () => {
      const r = await supabase.from('weekly_schedule').select('weekday, starts_at, location, kind').eq('group_id', gid).order('starts_at');
      if (r.error) return setError(r.error.message);
      // обычная группа — её групповые тренировки; у групп вроде «Индивидуальные / Вратарские» групповых нет, показываем все слоты
      const all = (r.data ?? []) as Slot[];
      const group = all.filter(x => x.kind === 'Групповая');
      setSlots(group.length ? group : all);
      if (!group.length && all.length) {
        const t = today();
        // Тренер читает занятия через функцию базы (без сумм и оплаты); таблицы записей с деньгами ему закрыты
        const ind = await supabase.rpc('ind_roster_list', { d_from: addDays(t, -DAYS_BACK), d_to: t });
        setIndList(ind.error ? [] : groupRoster((ind.data ?? []) as RosterRow[]));
      }
    })();
  }, [gid, reload]);

  const days = useMemo(() => {
    const out: { date: string; slot: Slot }[] = [];
    for (let i = 0; i < DAYS_BACK && slots; i++) {
      const d = addDays(today(), -i);
      for (const slot of slots) if (slot.weekday === isoDow(d)) out.push({ date: d, slot });
    }
    return out;
  }, [slots]);

  const group = groups.find(g => g.id === gid);
  if (error) return <Failure title="Не удалось загрузить расписание" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} />;
  const openInd = indList?.find(x => x.id === indOpen);
  if (openInd) return <IndMarks session={openInd} onBack={() => { setIndOpen(null); setReload(n => n + 1); }} />;
  if (date && group) return <Roster gid={gid} date={date} onBack={() => setDate(null)} />;
  if (!slots) return <Loading />;
  const indMode = slots.length > 0 && slots.every(x => x.kind !== 'Групповая');
  if (indMode && !indList) return <Loading />;

  return (
    <main className="page">
      <h1>Занятия</h1>
      <GroupPicker groups={groups} value={gid} onChange={setGid} />
      {indMode ? (
        indList && indList.length > 0 ? indList.map(x => (
          <ListRow key={x.id} title={indTitle(x)} sub={[x.topic ?? 'без темы', `Записано: ${x.individual_bookings.length}`]} end={indDay(x) === today() ? <Pill tone="primary">Сегодня</Pill> : undefined} onClick={() => setIndOpen(x.id)} />
        )) : <EmptyState icon="box" title="Занятий нет" text="За последние дни индивидуальных и вратарских занятий не было (их ведёт администратор в «Ещё → Индивидуальные»)." />
      ) : days.length === 0 ? (
        <EmptyState icon="box" title="Нет занятий в расписании" text={`У группы ${group?.name ?? ''} нет тренировок в расписании за последние ${DAYS_BACK} дней.`} />
      ) : (
        days.map(d => (
          <ListRow key={d.date + d.slot.starts_at} title={`${DAYS[isoDow(d.date)]}, ${fmtShort(d.date)}`} sub={[`${hm(d.slot.starts_at)}${d.slot.kind !== 'Групповая' ? ' · ' + d.slot.kind : ''}${d.slot.location ? ' · ' + d.slot.location : ''}`]} end={d.date === today() ? <Pill tone="primary">Сегодня</Pill> : undefined} onClick={() => setDate(d.date)} />
        ))
      )}
    </main>
  );
}

function Roster({ gid, date, onBack }: { gid: string; date: string; onBack: () => void }) {
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
  const canSave = dirty && !busy && Object.keys(marks).length > 0;
  const native = useMainButton({ text: 'Сохранить отметки', visible: true, enabled: canSave, loading: busy, onClick: () => void save() });

  if (error) return <Failure title="Не удалось загрузить занятие" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} back={<BackNav onBack={onBack} />} />;
  if (!players) return <Loading />;

  const count = (st: Status) => players.filter(p => marks[p.id] === st).length;
  const was = count('present'), absent = count('absent'), excused = count('excused');
  const left = players.length - was - absent - excused;
  const setAll = (st: Status | null) => {
    const all: Record<string, Status> = {};
    if (st) players.forEach(p => (all[p.id] = st));
    setMarks(all);
    setDirty(true);
    setMsg(null);
  };
  return (
    <main className="page has-bar">
      <BackNav onBack={onBack} />
      <h1>{`${DAYS[isoDow(date)]}, ${fmtShort(date)}`}</h1>
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
            <button type="button" className="ks-btn secondary sm" onClick={() => setAll('present')}>Отметить всех «Был»</button>
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
    </main>
  );
}
