import { useEffect, useState } from 'react';
import { coachError, fmtShort } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { EmptyState, ListRow, Pill, SwitchRow } from '../ui/components';
import { Failure, Loading } from './Message';

export interface Period { f: string; t: string }
interface Staff { coach: string; role: 'Тренер' | 'Оператор'; reg: boolean }
interface GameRow { match_id: string; played_on: string; team: string; opponent: string | null; goals_for: number | null; goals_against: number | null; staff: Staff[] }
interface StatRow { coach: string; trainings: number; hours: number | null; as_coach: number; as_operator: number; parts: number; reg_pct: number | null }

const errText = (m: string) =>
  m.includes('Could not find the function') ? 'Функция ещё не установлена в базе (миграция 0043).' : m.includes('bad role') ? 'Неизвестная роль.' : m.includes('fields required') ? 'Выберите сотрудника.' : coachError(m);

/** Период месяца «YYYY-MM» → первый и последний день. */
export function monthPeriod(ym: string): Period {
  const [y, m] = ym.split('-').map(Number);
  return { f: `${ym}-01`, t: new Date(y, m, 0).toLocaleDateString('en-CA') };
}

// Игры периода со штатом (тренер, оператор). Администратор правит штат; тренер только смотрит (миграция 0043).
export function StaffGames({ period, admin }: { period: Period; admin: boolean }) {
  const [rows, setRows] = useState<GameRow[] | null>(null);
  const [names, setNames] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [edit, setEdit] = useState<{ id: string; staff: Staff[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const r = await supabase.rpc('match_staff_list', { p_from: period.f, p_to: period.t });
      if (r.error) return setError(errText(r.error.message));
      setRows((r.data ?? []) as GameRow[]);
      if (admin) {
        const k = await supabase.from('training_log').select('coach').order('held_on', { ascending: false }).limit(1000);
        setNames([...new Set(((k.data ?? []) as { coach: string }[]).map(x => x.coach))].sort((a, b) => a.localeCompare(b, 'ru')));
      }
    })();
  }, [period.f, period.t, reload, admin]);

  async function save() {
    if (!edit) return;
    setBusy(true);
    setMsg(null);
    const r = await supabase.rpc('match_staff_set', { m: edit.id, staff: edit.staff });
    setBusy(false);
    if (r.error) return setMsg(errText(r.error.message));
    setEdit(null);
    setRows(null);
    setReload(n => n + 1);
  }
  const patch = (i: number, p: Partial<Staff>) => setEdit(e => (e ? { ...e, staff: e.staff.map((s, j) => (j === i ? { ...s, ...p } : s)) } : e));

  if (error) return <Failure title="Не удалось загрузить игры" text={error} onRetry={() => { setError(null); setRows(null); setReload(n => n + 1); }} />;
  if (!rows) return <Loading />;
  if (rows.length === 0) return <EmptyState icon="users" title="Нет игр" text="За выбранный период нет сыгранных игр со счётом." />;
  return (
    <>
      {msg && <p className="error" role="alert">{msg}</p>}
      {rows.map(g => {
        const editing = edit?.id === g.match_id;
        return (
          <div className="ks-card" key={g.match_id}>
            <div className="ks-line"><b>{fmtShort(g.played_on)} · {g.team}</b><span>{g.goals_for}:{g.goals_against}</span></div>
            {g.opponent && <div className="ks-muted" style={{ fontSize: 13 }}>{g.opponent}</div>}
            {!editing && (g.staff.length === 0 ? <div className="ks-muted" style={{ fontSize: 13 }}>Сотрудники не указаны</div> : g.staff.map(s => (
              <div className="ks-line" key={s.coach + s.role}><span>{s.coach} ({s.role})</span>{!s.reg && <Pill tone="warning">регламент не выполнен</Pill>}</div>
            )))}
            {admin && !editing && <button type="button" className="ks-btn secondary" style={{ marginTop: 8 }} onClick={() => { setMsg(null); setEdit({ id: g.match_id, staff: g.staff.map(s => ({ ...s })) }); }}>Изменить</button>}
            {editing && edit && (
              <>
                {edit.staff.map((s, i) => (
                  <div key={i} style={{ marginTop: 8 }}>
                    <select className="ks-select" aria-label="Сотрудник" value={s.coach} onChange={e => patch(i, { coach: e.target.value })}>
                      <option value="">Сотрудник…</option>
                      {[...new Set([...names, s.coach].filter(Boolean))].map(n => <option key={n}>{n}</option>)}
                    </select>
                    <select className="ks-select" aria-label="Роль" value={s.role} onChange={e => patch(i, { role: e.target.value as Staff['role'] })}>
                      <option>Тренер</option>
                      <option>Оператор</option>
                    </select>
                    <SwitchRow id={`reg-${g.match_id}-${i}`} label="Регламент выполнен" checked={s.reg} onChange={v => patch(i, { reg: v })} />
                    <button type="button" className="ks-btn secondary" style={{ marginTop: 8 }} onClick={() => setEdit(e => (e ? { ...e, staff: e.staff.filter((_, j) => j !== i) } : e))}>Убрать</button>
                  </div>
                ))}
                <button type="button" className="ks-btn secondary" style={{ marginTop: 8 }} onClick={() => setEdit(e => (e ? { ...e, staff: [...e.staff, { coach: '', role: e.staff.some(x => x.role === 'Тренер') ? 'Оператор' : 'Тренер', reg: true }] } : e))}>+ сотрудник</button>
                <button type="button" className="ks-btn" style={{ marginTop: 8 }} disabled={busy} onClick={() => void save()}>Сохранить</button>
                <button type="button" className="ks-btn secondary" style={{ marginTop: 8 }} disabled={busy} onClick={() => setEdit(null)}>Отмена</button>
              </>
            )}
          </div>
        );
      })}
    </>
  );
}

// Статистика по тренерам за период: проведённые тренировки, игры как тренер и как оператор, % выполнения регламента.
export function StaffStats({ period }: { period: Period }) {
  const [rows, setRows] = useState<StatRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    void (async () => {
      const r = await supabase.rpc('trainer_stats', { p_from: period.f, p_to: period.t });
      if (r.error) return setError(errText(r.error.message));
      setRows(((r.data ?? []) as StatRow[]).map(x => ({ ...x, hours: x.hours === null ? null : Number(x.hours) })));
    })();
  }, [period.f, period.t, reload]);

  if (error) return <Failure title="Не удалось загрузить статистику" text={error} onRetry={() => { setError(null); setRows(null); setReload(n => n + 1); }} />;
  if (!rows) return <Loading />;
  if (rows.length === 0) return <EmptyState icon="users" title="Нет данных" text="За выбранный период нет проведённых тренировок и игр." />;
  return (
    <>
      {rows.map(s => <StaffRow key={s.coach} s={s} period={period} />)}
      <p className="muted">Процент — доля игр, где выполнен регламент.</p>
    </>
  );
}

interface Held { id: string; held_on: string; group_label: string; hours: number | null }
const fmtHours = (h: number) => `${String(Math.round(h * 100) / 100).replace('.', ',')} ч`;

// Строка тренера: сводка; если у него есть проведённые тренировки, раскрывается в список по датам (журнал читается при первом раскрытии).
// Часы в списке показываются, только если база отдала их в сводке (администратору).
function StaffRow({ s, period }: { s: StatRow; period: Period }) {
  const [open, setOpen] = useState(false);
  // загруженный список привязан к тренеру и периоду; при смене периода он считается устаревшим и читается заново
  const key = `${s.coach}|${period.f}|${period.t}`;
  const [loaded, setLoaded] = useState<{ key: string; list: Held[] | null; err: string | null } | null>(null);
  const sub = `Тренировок: ${s.trainings}${s.hours === null ? '' : ` (${s.hours} ч)`} · игр как тренер: ${s.as_coach} · как оператор: ${s.as_operator}`;
  const end = s.reg_pct === null ? undefined : <Pill tone={s.reg_pct === 100 ? 'success' : 'warning'}>{s.reg_pct}%</Pill>;
  useEffect(() => {
    if (!open) return;
    let stale = false; // ответ прежнего периода не должен перезаписать новый
    void (async () => {
      const r = await supabase.from('training_log').select('id, held_on, group_label, hours').eq('coach', s.coach).eq('held', true).gte('held_on', period.f).lte('held_on', period.t).order('held_on').limit(500);
      if (stale) return;
      if (r.error) return setLoaded({ key, list: null, err: errText(r.error.message) });
      setLoaded({ key, list: ((r.data ?? []) as Held[]).map(x => ({ ...x, hours: x.hours === null ? null : Number(x.hours) })), err: null });
    })();
    return () => { stale = true; };
  }, [open, key, s.coach, period.f, period.t]);
  const cur = loaded?.key === key ? loaded : null;
  const list = cur?.list ?? null;
  const err = cur?.err ?? null;
  if (s.trainings === 0) return <ListRow title={s.coach} sub={[sub]} end={end} />;
  return (
    <details open={open}>
      <summary className="ks-disclosure" onClick={e => { e.preventDefault(); setOpen(o => !o); }}>
        <ListRow title={s.coach} sub={[sub]} end={end} />
      </summary>
      {err ? <p className="error">{err}</p> : !list ? <Loading /> : (
        <ul style={{ listStyle: "none", margin: "4px 0 8px", padding: "0 16px" }}>
          {list.map(x => (
            <li className="ks-line" key={x.id} style={{ padding: '4px 0' }}>
              <span>{fmtShort(x.held_on)} · {x.group_label}</span>
              {s.hours !== null && x.hours ? <b>{fmtHours(x.hours)}</b> : null}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
