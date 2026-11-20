import { useCallback, useEffect, useRef, useState } from 'react';
import { coachError, errMsg } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { EmptyState, Pill } from '../ui/components';
import { Failure, Loading } from './Message';

type Kind = 'individual' | 'goalkeeper' | 'extra';
interface Mine { player_id: string; name: string; paid: boolean; amount: number | string }
interface Row { kind: Kind; session_id: string; starts_at: string; ends_at?: string | null; title: string; place: string | null; capacity: number | null; amount: number | string | null; booked: string[]; mine: Mine[]; eligible?: string[] | null }
interface Kid { id: string; name: string }
interface Clash { kind: string; label: string; starts_at: string; ends_at: string | null }
interface Wait { kind: Kind; session_id: string; player_id: string; pos: number; total: number; offer: boolean }

const err = (m: string) =>
  m.includes('session full') ? 'Мест уже нет: место успел занять другой родитель. Вы остаётесь в очереди.'
  : m.includes('seat available') ? 'Появилось свободное место, обновите список и запишитесь.'
  : m.includes('not in waitlist') ? 'Ребёнка уже нет в очереди.'
  : m.includes('already booked') ? 'Ребёнок уже записан.'
  : m.includes('session in the past') ? 'Занятие уже прошло.'
  : m.includes('not eligible') ? 'Эта тренировка не для группы ребёнка. Если нужно записаться, напишите администратору.'
  : m.includes('player not active') ? 'Запись недоступна: ребёнок сейчас не в статусе «Занимается». Напишите администратору.'
  : m.includes('session already started') ? 'Занятие уже началось, отменить запись нельзя. Напишите администратору.'
  : m.includes('attendance marked') ? 'На занятии уже отмечена посещаемость. Отменить запись может администратор, напишите ему.'
  : m.includes('too late') ? 'Слишком поздно отменять через приложение. Напишите администратору.'
  : m.includes('Could not find the function') ? 'Запись пока недоступна (миграция 0045).'
  : coachError(m);
const KIND_LABEL: Record<Kind, string> = { individual: 'Индивидуальная', goalkeeper: 'Вратарская', extra: 'Дополнительная' };
const clockOf = (iso: string) => iso.slice(11, 16);
const gel = (n: number | string | null) => (n === null ? '' : `${Number(n)} ₾`);
const when = (iso: string, kind: Kind, endIso?: string | null) => {
  const d = new Date(iso);
  const day = d.toLocaleDateString('ru', { weekday: 'short', day: '2-digit', month: '2-digit' });
  // у дополнительной тренировки время бывает не указано: тогда приходит полночь дня
  const timed = kind !== 'extra' || d.getHours() !== 0 || d.getMinutes() !== 0;
  const hm = (x: Date) => x.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  if (!timed) return day;
  return endIso ? `${day}, ${hm(d)}–${hm(new Date(endIso))}` : `${day}, ${hm(d)}`;
};

// Запись детей на индивидуальные, вратарские и дополнительные тренировки (миграция 0045). Оплату вносит администратор.
export default function Booking() {
  const [rows, setRows] = useState<Row[] | null>(null);
  // null = состояние неизвестно (идёт загрузка или она не удалась); [] = успешно пусто (#765, #766)
  const [kids, setKids] = useState<Kid[] | null>(null);
  const [kidsError, setKidsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [waits, setWaits] = useState<Wait[] | null>(null);
  const [waitsError, setWaitsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState(false); // однократное информационное сообщение (миграция 0151)
  // Только предупреждение о пересечении или неудачная проверка: запись родитель подтверждает сам
  const [clash, setClash] = useState<{ key: string; list: Clash[] | null } | null>(null); // list === null: проверка не удалась
  const seq = useRef(0); // номер последней загрузки: ответы более ранних не применяются
  const user = useRef<string | null | undefined>(undefined); // пользователь, для которого загружен экран
  const lock = useRef(false); // запись/проверка идёт: повторное нажатие не запускает вторую

  const load = useCallback(async () => {
    const mine = ++seq.current;
    const live = () => mine === seq.current;
    setLoading(true);
    try {
      let me: string | undefined;
      try { me = (await supabase.auth.getUser()).data.user?.id; } catch { me = undefined; }
      if (!live()) return;
      user.current = me ?? null;
      if (!me) return setError(errMsg({ message: 'not authenticated' })); // как сервер: без пользователя booking_board отвечает forbidden
      let kidsNext: Kid[] | null = null;
      let kidsErr: string | null = null;
      {
        try {
          const g = await supabase.from('player_guardians').select('players(id, full_name)').eq('user_id', me).is('consent_revoked_at', null);
          if (g.error) kidsErr = errMsg(g.error);
          else kidsNext = ((g.data ?? []) as unknown as { players: { id: string; full_name: string } | null }[]).filter(x => x.players).map(x => ({ id: x.players!.id, name: x.players!.full_name }));
        } catch (e) { kidsErr = errMsg(e); }
      }
      if (!live()) return;
      let board: Row[];
      try {
        const r = await supabase.rpc('booking_board');
        if (!live()) return;
        if (r.error) return setError(err(r.error.message));
        board = (r.data ?? []) as Row[];
      } catch (e) {
        if (live()) setError(errMsg(e));
        return;
      }
      let infoNext = false;
      try { const ip = await supabase.rpc('booking_info_pending'); infoNext = !ip.error && ip.data === true; } catch { infoNext = false; }
      if (!live()) return;
      let waitsNext: Wait[] | null = null;
      let waitsErr: string | null = null;
      try {
        const w = await supabase.rpc('waitlist_board');
        if (w.error) waitsErr = errMsg(w.error);
        else waitsNext = (w.data ?? []) as Wait[];
      } catch (e) { waitsErr = errMsg(e); }
      if (!live()) return;
      // всё применяется разом: экран не показывает промежуточное «очереди нет»
      setKids(kidsNext); setKidsError(kidsErr);
      setWaits(waitsNext); setWaitsError(waitsErr);
      setInfo(infoNext);
      setRows(board);
    } finally {
      if (live()) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    // смена пользователя: прежнее состояние сбрасывается, ответы прежних загрузок отбрасываются; обновление токена того же пользователя не перезагружает
    const sub = supabase.auth.onAuthStateChange?.((_ev: string, session: { user?: { id?: string } } | null) => {
      const id = session?.user?.id ?? null;
      if (user.current === undefined || id === user.current) return;
      user.current = id;
      setRows(null); setKids(null); setKidsError(null); setWaits(null); setWaitsError(null); setClash(null); setMsg(null); setError(null);
      void load();
    });
    return () => { seq.current++; sub?.data?.subscription?.unsubscribe(); };
  }, [load]);

  // Перед записью проверяем пересечения ребёнка с другими занятиями: только предупреждение, запись не блокируется.
  // Если проверка не удалась, запись сама не начинается: родитель выбирает, повторить, продолжить без проверки или отказаться.
  const trySignup = async (r: Row, kid: Kid) => {
    if (lock.current) return;
    lock.current = true;
    const key = r.session_id + kid.id;
    setMsg(null);
    setBusy(key);
    try {
      let list: Clash[] | null;
      try {
        const c = await supabase.rpc('booking_conflicts', { k: r.kind, s: r.session_id, p: kid.id });
        list = c.error ? null : ((c.data ?? []) as Clash[]);
      } catch { list = null; }
      if (list === null) { setBusy(null); return setClash({ key, list: null }); }
      if (list.length === 0) return await run('booking_signup', r, kid);
      setBusy(null);
      setClash({ key, list });
    } finally { lock.current = false; }
  };

  const act = async (fn: 'booking_signup' | 'booking_cancel' | 'waitlist_join' | 'waitlist_leave' | 'waitlist_claim', r: Row, kid: Kid) => {
    if (lock.current) return;
    lock.current = true;
    try { await run(fn, r, kid); } finally { lock.current = false; }
  };

  const run = async (fn: 'booking_signup' | 'booking_cancel' | 'waitlist_join' | 'waitlist_leave' | 'waitlist_claim', r: Row, kid: Kid) => {
    setBusy(r.session_id + kid.id);
    setMsg(null);
    let res: { error: { message: string } | null };
    try { res = await supabase.rpc(fn, { k: r.kind, s: r.session_id, p: kid.id }); } catch (e) { setBusy(null); return setMsg(errMsg(e)); }
    setBusy(null);
    if (res.error) return setMsg(err(res.error.message));
    setClash(null);
    await load();
  };

  if (error) return <Failure title="Не удалось загрузить занятия" text={error} onRetry={() => { setError(null); setRows(null); void load(); }} />;
  if (!rows) return <Loading />;
  if (rows.length === 0) return <EmptyState icon="box" title="Занятий для записи пока нет" text="Когда клуб объявит индивидуальные, вратарские или дополнительные тренировки, они появятся здесь." />;
  return (
    <>
      {info && (
        <section className="ks-card" role="note">
          <b>Запись на тренировки теперь здесь</b>
          <p style={{ margin: '6px 0' }}>Индивидуальные, вратарские и дополнительные тренировки: записывайте ребёнка на свободные места. Уведомления о новых тренировках включаются и выключаются в профиле.</p>
          <button type="button" className="ks-btn secondary" onClick={() => { setInfo(false); void supabase.rpc('booking_info_seen').then(() => undefined); }}>Понятно</button>
        </section>
      )}
      <p className="muted">Запишите ребёнка на свободное место. Оплату вносит администратор клуба, статус виден здесь.</p>
      {msg && <p className="error" role="alert">{msg}</p>}
      {kidsError && (
        <section className="ks-card" role="alert">
          <b>Не удалось загрузить список детей</b>
          <p style={{ margin: '6px 0' }}>{kidsError} Пока список не загружен, записывать детей нельзя.</p>
          <button type="button" className="ks-btn secondary" disabled={loading} onClick={() => void load()}>{loading ? 'Загружаю…' : 'Повторить'}</button>
        </section>
      )}
      {waitsError && (
        <section className="ks-card" role="alert">
          <b>Не удалось загрузить очередь ожидания</b>
          <p style={{ margin: '6px 0' }}>{waitsError} Пока неизвестно, стоит ли ребёнок в очереди, записаться или встать в очередь нельзя.</p>
          <button type="button" className="ks-btn secondary" disabled={loading} onClick={() => void load()}>{loading ? 'Загружаю…' : 'Повторить'}</button>
        </section>
      )}
      {kids && kids.length === 0 && <p className="muted">К профилю не привязан ни один ребёнок, записывать некого.</p>}
      {rows.map(r => {
        const left = r.capacity === null ? null : Math.max(0, r.capacity - r.booked.length);
        return (
          <section className="ks-card" key={r.kind + r.session_id}>
            <b>{KIND_LABEL[r.kind]}: {when(r.starts_at, r.kind, r.ends_at)}</b>
            {left !== null && <div style={{ margin: '6px 0 0' }}><Pill tone={left > 0 ? 'success' : 'neutral'}>{left > 0 ? `Мест: ${left}` : 'Мест нет'}</Pill></div>}
            <div className="ks-muted" style={{ fontSize: 13 }}>{[r.title, r.place, r.amount !== null && Number(r.amount) > 0 ? gel(r.amount) : null].filter(Boolean).join(' · ')}</div>
            {r.booked.length ? (
              <div style={{ margin: '8px 0' }}>
                <div>Записаны:</div>
                <ol style={{ margin: '4px 0 0', paddingLeft: 22 }}>{r.booked.map((n, i) => <li key={i}>{n}</li>)}</ol>
              </div>
            ) : (
              <p style={{ margin: '8px 0' }}>Записаны: пока никого</p>
            )}
            {(kids ?? []).map(k => {
              const mine = r.mine.find(m => m.player_id === k.id);
              return mine ? (
                <div key={k.id} style={{ marginTop: 8 }}>
                  <div className="ks-line"><span>{k.name}</span>{mine.paid ? <Pill tone="success">Оплачено</Pill> : <Pill tone="warning">Не оплачено {gel(mine.amount)}</Pill>}</div>
                  <button type="button" className="ks-btn secondary" style={{ marginTop: 6 }} disabled={busy !== null} onClick={() => void act('booking_cancel', r, k)}>Отменить запись: {k.name}</button>
                  {mine.paid && <p className="ks-muted" style={{ fontSize: 13, margin: '4px 0 0' }}>Оплата сохранится: администратор решит, оставить её клубу, перенести на другое занятие или вернуть.</p>}
                </div>
              ) : r.eligible && !r.eligible.includes(k.id) ? null : (() => {
                if (waits === null) return null; // очередь неизвестна: не предполагаем, что ребёнка в ней нет
                const w = waits.find(x => x.session_id === r.session_id && x.player_id === k.id);
                if (w) {
                  return (
                    <div key={k.id} style={{ marginTop: 8 }}>
                      <div className="ks-line"><span>{k.name}</span><Pill tone={w.offer ? 'success' : 'neutral'}>{w.offer ? 'Есть место' : `В очереди: ${w.pos} из ${w.total}`}</Pill></div>
                      {w.offer && <button type="button" className="ks-btn" style={{ marginTop: 6 }} disabled={busy !== null} onClick={() => void act('waitlist_claim', r, k)}>Занять место: {k.name}</button>}
                      <button type="button" className="ks-btn secondary" style={{ marginTop: 6 }} disabled={busy !== null} onClick={() => void act('waitlist_leave', r, k)}>Выйти из очереди: {k.name}</button>
                      {!w.offer && <p className="ks-muted" style={{ fontSize: 13, margin: '4px 0 0' }}>Когда место освободится, уведомление получат все из очереди. Место достанется тому, кто подтвердит первым, до начала занятия.</p>}
                    </div>
                  );
                }
                return left === 0
                  ? <button key={k.id} type="button" className="ks-btn secondary" style={{ marginTop: 8 }} disabled={busy !== null} onClick={() => void act('waitlist_join', r, k)}>Встать в очередь: {k.name}</button>
                  : clash?.key === r.session_id + k.id ? (
                    <div key={k.id} style={{ marginTop: 8 }} role="alert">
                      {clash.list === null ? (
                        <>
                          <p className="error" style={{ margin: '0 0 6px' }}>Не удалось проверить, есть ли у {k.name} другие занятия в это время.</p>
                          <button type="button" className="ks-btn secondary" disabled={busy !== null} onClick={() => void trySignup(r, k)}>Повторить проверку: {k.name}</button>
                          <button type="button" className="ks-btn" style={{ marginTop: 6 }} disabled={busy !== null} onClick={() => void act('booking_signup', r, k)}>Продолжить без проверки: {k.name}</button>
                        </>
                      ) : (
                        <>
                          <p className="error" style={{ margin: '0 0 6px' }}>В это время у {k.name} уже есть: {clash.list.map(c => `${c.label} (${clockOf(c.starts_at)}${c.ends_at ? `–${clockOf(c.ends_at)}` : ''})`).join(', ')}.</p>
                          <button type="button" className="ks-btn" disabled={busy !== null} onClick={() => void act('booking_signup', r, k)}>Всё равно записать: {k.name}</button>
                        </>
                      )}
                      <button type="button" className="ks-btn secondary" style={{ marginTop: 6 }} onClick={() => setClash(null)}>Не записывать</button>
                    </div>
                  )
                  : <button key={k.id} type="button" className="ks-btn" style={{ marginTop: 8 }} disabled={busy !== null} onClick={() => void trySignup(r, k)}>Записать: {k.name}</button>;
              })();
            })}
          </section>
        );
      })}
    </>
  );
}
