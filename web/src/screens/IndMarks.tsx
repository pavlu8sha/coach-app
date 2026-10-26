import { useState } from 'react';
import { coachError, DAYS, fmtShort, hm, isoDow } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { EmptyState } from '../ui/components';
import { BackNav, useMainButton } from '../ui/nav';

export interface IndSession { id: string; kind?: 'ind' | 'extra'; starts_at: string; topic: string | null; goalkeepers: boolean; individual_bookings: { player_id: string; attended: boolean | null; players: { full_name: string } | null }[] }
type Mark = 'present' | 'absent' | null;

const toMark = (a: boolean | null): Mark => (a === true ? 'present' : a === false ? 'absent' : null);
export const indDay = (s: IndSession) => s.starts_at.slice(0, 10);
export const indTitle = (s: IndSession) =>
  s.kind === 'extra' ? `${DAYS[isoDow(indDay(s))]}, ${fmtShort(indDay(s))} · Дополнительная` : `${DAYS[isoDow(indDay(s))]}, ${fmtShort(indDay(s))} · ${hm(s.starts_at.slice(11, 16))} · ${s.goalkeepers ? 'Вратари' : 'Индивидуальные'}`;

// Отметка посещения индивидуального или вратарского занятия: только записавшиеся на это занятие (не вся «группа»).
export default function IndMarks({ session, onBack }: { session: IndSession; onBack: () => void }) {
  const players = [...session.individual_bookings].sort((a, b) => (a.players?.full_name ?? '').localeCompare(b.players?.full_name ?? '', 'ru'));
  const [marks, setMarks] = useState<Record<string, Mark>>(() => Object.fromEntries(players.map(p => [p.player_id, toMark(p.attended)])));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const set = (id: string, m: Mark) => { setMarks(s => ({ ...s, [id]: m })); setDirty(true); setMsg(null); };
  const save = async () => {
    setBusy(true);
    setMsg(null);
    for (const p of players) {
      if (marks[p.player_id] === toMark(p.attended)) continue;
      const m = marks[p.player_id];
      const r = await supabase.rpc(session.kind === 'extra' ? 'extra_set_attended' : 'ind_set_attended', { s: session.id, p: p.player_id, was: m === 'present' ? true : m === 'absent' ? false : null });
      if (r.error) { setBusy(false); return setMsg({ ok: false, text: coachError(r.error.message) }); }
      p.attended = m === 'present' ? true : m === 'absent' ? false : null;
    }
    setBusy(false);
    setDirty(false);
    setMsg({ ok: true, text: 'Отметки сохранены.' });
  };
  const native = useMainButton({ text: 'Сохранить отметки', visible: true, enabled: dirty && !busy, loading: busy, onClick: () => void save() });

  const count = (m: Mark) => players.filter(p => marks[p.player_id] === m).length;
  const was = count('present'), absent = count('absent'), left = players.length - was - absent;
  return (
    <main className="page has-bar">
      <BackNav onBack={onBack} />
      <h1>{indTitle(session)}</h1>
      {session.topic && <p className="muted">{session.topic}</p>}
      {players.length === 0 ? (
        <EmptyState icon="users" title="На занятие никто не записан" text="Запись ведётся у администратора: «Ещё → Индивидуальные» или «Дополнительные»." />
      ) : (
        <>
          <div className="ks-progress" aria-hidden="true">{players.map(p => <span key={p.player_id} className={marks[p.player_id] ?? ''} />)}</div>
          <p className="ks-counts"><span><b>{was}</b> были</span><span><b>{absent}</b> не были</span><span><b>{left}</b> осталось</span></p>
          {players.map(p => (
            <div className="ks-mark" key={p.player_id} role="group" aria-label={`Посещаемость: ${p.players?.full_name ?? ''}`}>
              <b>{p.players?.full_name ?? 'Игрок'}</b>
              {([['present', 'Был'], ['absent', 'Не был']] as [Mark, string][]).map(([m, label]) => (
                <button key={m} type="button" className={`mk ${m}${marks[p.player_id] === m ? ' on' : ''}`} aria-pressed={marks[p.player_id] === m} onClick={() => set(p.player_id, marks[p.player_id] === m ? null : m)}>{label}</button>
              ))}
            </div>
          ))}
          {msg && <p className={msg.ok ? 'ks-ok' : 'error'}>{msg.text}</p>}
          {!native && (
            <div className="ks-savebar">
              <span>{left > 0 ? <>Осталось отметить: <b>{left}</b></> : <>Отмечено: <b>{players.length}</b> из {players.length}</>}</span>
              <button type="button" className="ks-btn" disabled={!dirty || busy} onClick={() => void save()}>Сохранить отметки</button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
