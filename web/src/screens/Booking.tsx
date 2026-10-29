import { useCallback, useEffect, useState } from 'react';
import { coachError } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { EmptyState, Pill } from '../ui/components';
import { Failure, Loading } from './Message';

type Kind = 'individual' | 'goalkeeper' | 'extra';
interface Mine { player_id: string; name: string; paid: boolean; amount: number | string }
interface Row { kind: Kind; session_id: string; starts_at: string; title: string; place: string | null; capacity: number | null; amount: number | string | null; booked: string[]; mine: Mine[] }
interface Kid { id: string; name: string }

const err = (m: string) =>
  m.includes('session full') ? 'Мест уже нет.'
  : m.includes('already booked') ? 'Ребёнок уже записан.'
  : m.includes('session in the past') ? 'Занятие уже прошло.'
  : m.includes('booking is paid') ? 'Запись оплачена: отменить её может администратор, напишите ему.'
  : m.includes('session already started') ? 'Занятие уже началось, отменить запись нельзя. Напишите администратору.'
  : m.includes('attendance marked') ? 'На занятии уже отмечена посещаемость. Отменить запись может администратор, напишите ему.'
  : m.includes('too late') ? 'Слишком поздно отменять через приложение. Напишите администратору.'
  : m.includes('Could not find the function') ? 'Запись пока недоступна (миграция 0045).'
  : coachError(m);
const KIND_LABEL: Record<Kind, string> = { individual: 'Индивидуальная', goalkeeper: 'Вратарская', extra: 'Дополнительная' };
const gel = (n: number | string | null) => (n === null ? '' : `${Number(n)} ₾`);
const when = (iso: string, kind: Kind) => {
  const d = new Date(iso);
  const day = d.toLocaleDateString('ru', { weekday: 'short', day: '2-digit', month: '2-digit' });
  // у дополнительной тренировки время бывает не указано: тогда приходит полночь дня
  const timed = kind !== 'extra' || d.getHours() !== 0 || d.getMinutes() !== 0;
  return timed ? `${day}, ${d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}` : day;
};

// Запись детей на индивидуальные, вратарские и дополнительные тренировки (миграция 0045). Оплату вносит администратор.
export default function Booking() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [kids, setKids] = useState<Kid[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const me = (await supabase.auth.getUser()).data.user?.id;
    const g = me ? await supabase.from('player_guardians').select('players(id, full_name)').eq('user_id', me).is('consent_revoked_at', null) : null;
    setKids(((g?.data ?? []) as unknown as { players: { id: string; full_name: string } | null }[]).filter(x => x.players).map(x => ({ id: x.players!.id, name: x.players!.full_name })));
    const r = await supabase.rpc('booking_board');
    if (r.error) return setError(err(r.error.message));
    setRows((r.data ?? []) as Row[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: 'booking_signup' | 'booking_cancel', r: Row, kid: Kid) => {
    setBusy(r.session_id + kid.id);
    setMsg(null);
    const res = await supabase.rpc(fn, { k: r.kind, s: r.session_id, p: kid.id });
    setBusy(null);
    if (res.error) return setMsg(err(res.error.message));
    await load();
  };

  if (error) return <Failure title="Не удалось загрузить занятия" text={error} onRetry={() => { setError(null); setRows(null); void load(); }} />;
  if (!rows) return <Loading />;
  if (rows.length === 0) return <EmptyState icon="box" title="Занятий для записи пока нет" text="Когда клуб объявит индивидуальные, вратарские или дополнительные тренировки, они появятся здесь." />;
  return (
    <>
      <p className="muted">Запишите ребёнка на свободное место. Оплату вносит администратор клуба, статус виден здесь.</p>
      {msg && <p className="error" role="alert">{msg}</p>}
      {rows.map(r => {
        const left = r.capacity === null ? null : Math.max(0, r.capacity - r.booked.length);
        return (
          <section className="ks-card" key={r.kind + r.session_id}>
            <div className="ks-line"><b>{KIND_LABEL[r.kind]}: {when(r.starts_at, r.kind)}</b>{left !== null && <Pill tone={left > 0 ? 'success' : 'neutral'}>{left > 0 ? `Мест: ${left}` : 'Мест нет'}</Pill>}</div>
            <div className="ks-muted" style={{ fontSize: 13 }}>{[r.title, r.place, r.amount !== null && Number(r.amount) > 0 ? gel(r.amount) : null].filter(Boolean).join(' · ')}</div>
            <p style={{ margin: '8px 0' }}>Записаны: {r.booked.length ? r.booked.join(', ') : 'пока никого'}</p>
            {kids.map(k => {
              const mine = r.mine.find(m => m.player_id === k.id);
              return mine ? (
                <div key={k.id} style={{ marginTop: 8 }}>
                  <div className="ks-line"><span>{k.name}</span>{mine.paid ? <Pill tone="success">Оплачено</Pill> : <Pill tone="warning">Не оплачено {gel(mine.amount)}</Pill>}</div>
                  <button type="button" className="ks-btn secondary" style={{ marginTop: 6 }} disabled={busy !== null} onClick={() => void act('booking_cancel', r, k)}>Отменить запись: {k.name}</button>
                </div>
              ) : (
                <button key={k.id} type="button" className="ks-btn" style={{ marginTop: 8 }} disabled={busy !== null || left === 0} onClick={() => void act('booking_signup', r, k)}>Записать: {k.name}</button>
              );
            })}
          </section>
        );
      })}
    </>
  );
}
