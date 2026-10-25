import { useEffect, useMemo, useState } from 'react';
import { coachError, fmtShort, hm, isoDow, today } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { EmptyState, Pill, Segmented } from '../ui/components';
import { Failure, Loading } from './Message';
import { monthPeriod, StaffGames, StaffStats } from './TrainerStaff';

interface Slot { weekday: number; starts_at: string; ends_at: string | null; location: string | null; coaches: string | null; kind: string; source_key: string }
interface Log { id: string; held_on: string; coach: string; location: string | null; group_label: string; kind: string; starts_at: string | null; ends_at: string | null; hours: number | null; held: boolean }
interface Item { label: string; kind: string; start: string | null; end: string | null; loc: string | null; plan: string[]; rows: Log[] }

const errText = (m: string) =>
  m.includes('date in the future') ? 'Тренировку, которая ещё не прошла, подтвердить нельзя.' : m.includes('coach already in') ? 'Этот тренер уже записан на тренировку.' : m.includes('fields required') ? 'Заполните все поля.' :
  m.includes('Could not find the function') || m.includes('tl_') ? 'Функция ещё не установлена в базе (миграция 0038).' : coachError(m);
const monthIso = (iso: string) => iso.slice(0, 7);
const monthName = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  const s = new Date(y, m - 1, 1).toLocaleDateString('ru', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const planCoaches = (s: string | null) => (s ?? '').split(/[,;]/).map(x => x.trim()).filter(Boolean);

type Tab = 'day' | 'month' | 'games' | 'stats';

// Учёт проведённых тренировок и часов тренеров для администратора (миграция 0038).
export default function TrainerLog() {
  const [tab, setTab] = useState<Tab>('day');
  return (
    <main className="page">
      <h1>Учёт тренеров</h1>
      <Segmented label="Раздел" value={tab} onChange={setTab} items={[{ value: 'day', label: 'День' }, { value: 'month', label: 'Месяц' }, { value: 'games', label: 'Игры' }, { value: 'stats', label: 'Статистика' }]} />
      {tab === 'day' ? <Day /> : tab === 'month' ? <Month /> : <StaffMonth tab={tab} />}
    </main>
  );
}

function Day() {
  const [date, setDate] = useState(today());
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [logs, setLogs] = useState<Log[] | null>(null);
  const [known, setKnown] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const s = await supabase.from('weekly_schedule').select('weekday, starts_at, ends_at, location, coaches, kind, source_key').eq('weekday', isoDow(date));
      if (s.error) return setError(errText(s.error.message));
      const l = await supabase.from('training_log').select('id, held_on, coach, location, group_label, kind, starts_at, ends_at, hours, held').eq('held_on', date).order('starts_at');
      if (l.error) return setError(errText(l.error.message));
      const k = await supabase.from('training_log').select('coach').order('held_on', { ascending: false }).limit(1000);
      setSlots((s.data ?? []) as Slot[]);
      setLogs(((l.data ?? []) as Log[]).map(x => ({ ...x, hours: x.hours === null ? null : Number(x.hours) })));
      setKnown([...new Set([...((k.data ?? []) as { coach: string }[]).map(x => x.coach), ...((s.data ?? []) as Slot[]).flatMap(x => planCoaches(x.coaches))])].sort((a, b) => a.localeCompare(b, 'ru')));
    })();
  }, [date, reload]);

  const items = useMemo<Item[]>(() => {
    if (!slots || !logs) return [];
    const seen = new Set<string>();
    const out: Item[] = [];
    slots.forEach(x => {
      const label = x.source_key.split('|')[2] ?? '';
      const key = `${label}|${hm(x.starts_at)}`;
      if (!label || seen.has(key)) return;
      seen.add(key);
      out.push({ label, kind: x.kind, start: hm(x.starts_at), end: x.ends_at ? hm(x.ends_at) : null, loc: x.location, plan: planCoaches(x.coaches), rows: logs.filter(r => r.group_label === label && hm(r.starts_at) === hm(x.starts_at)) });
    });
    logs.forEach(r => {
      const key = `${r.group_label}|${hm(r.starts_at)}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ label: r.group_label, kind: r.kind, start: r.starts_at ? hm(r.starts_at) : null, end: r.ends_at ? hm(r.ends_at) : null, loc: r.location, plan: [], rows: logs.filter(x => x.group_label === r.group_label && hm(x.starts_at) === hm(r.starts_at)) });
    });
    return out.sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''));
  }, [slots, logs]);

  const run = async (key: string, f: () => PromiseLike<{ error: { message: string } | null }>) => {
    setBusy(key);
    setMsg(null);
    const r = await f();
    setBusy(null);
    if (r.error) return setMsg(errText(r.error.message));
    setReload(n => n + 1);
  };

  if (error) return <Failure title="Не удалось загрузить тренировки" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} />;
  return (
    <>
      <label className="field" style={{ marginBottom: 12 }}>Дата<input type="date" value={date} onChange={e => { setSlots(null); setLogs(null); setDate(e.target.value); }} /></label>
      {msg && <p className="error">{msg}</p>}
      {!slots || !logs ? <Loading /> : items.length === 0 ? (
        <EmptyState icon="users" title="Тренировок нет" text="В этот день нет занятий по расписанию и записей в журнале." />
      ) : items.map(it => {
        const held = it.rows.filter(r => r.held);
        const k = `${it.label}|${it.start}`;
        return (
          <div className="ks-card" key={k}>
            <div className="ks-line"><b>{it.label} · {it.start}{it.end ? `–${it.end}` : ''}</b><Pill tone={held.length ? 'success' : 'neutral'} dot>{held.length ? 'Проведена' : 'Не отмечена'}</Pill></div>
            <div className="ks-muted" style={{ fontSize: 13 }}>{it.kind}{it.loc ? ` · ${it.loc}` : ''}{!held.length && it.plan.length ? ` · по плану: ${it.plan.join(', ')}` : ''}</div>
            {held.length === 0 ? (
              <button type="button" className="ks-btn" style={{ marginTop: 8 }} disabled={busy === k || it.plan.length === 0 || !it.start} onClick={() => void run(k, () => supabase.rpc('tl_confirm', { d: date, label: it.label, kind: it.kind, st: it.start, en: it.end, loc: it.loc, coaches: it.plan }))}>
                {it.plan.length ? 'Проведена' : 'В плане нет тренеров'}
              </button>
            ) : (
              <>
                {held.map(r => (
                  <div className="ks-line" key={r.id} style={{ marginTop: 8 }}>
                    <span>{r.coach}{r.hours ? ` · ${r.hours} ч` : ''}</span>
                    <span style={{ display: 'flex', gap: 6 }}>
                      <select className="ks-select" style={{ minHeight: 40, width: 150, marginBottom: 0 }} aria-label={`Заменить тренера ${r.coach}`} value="" disabled={busy === r.id} onChange={e => e.target.value && void run(r.id, () => supabase.rpc('tl_replace_coach', { i: r.id, new_coach: e.target.value }))}>
                        <option value="">Заменить…</option>
                        {known.filter(n => n !== r.coach).map(n => <option key={n}>{n}</option>)}
                      </select>
                      <button type="button" className="ks-btn secondary" style={{ width: 'auto', minHeight: 40 }} disabled={busy === r.id} onClick={() => void run(r.id, () => supabase.rpc('tl_set_held', { i: r.id, is_held: false }))}>Снять</button>
                    </span>
                  </div>
                ))}
                <select className="ks-select" aria-label="Добавить тренера" style={{ marginTop: 8, marginBottom: 0 }} value="" disabled={busy === k} onChange={e => e.target.value && void run(k, () => supabase.rpc('tl_add', { d: date, coach: e.target.value, label: it.label, kind: it.kind, st: it.start, en: it.end, loc: it.loc, is_held: true }))}>
                  <option value="">Добавить тренера…</option>
                  {known.filter(n => !held.some(r => r.coach === n)).map(n => <option key={n}>{n}</option>)}
                </select>
              </>
            )}
          </div>
        );
      })}
    </>
  );
}

function StaffMonth({ tab }: { tab: 'games' | 'stats' }) {
  const [ym, setYm] = useState(monthIso(today()));
  const months = useMemo(() => {
    const out: string[] = [];
    const now = new Date();
    for (let i = 0; i < 14; i++) out.push(new Date(now.getFullYear(), now.getMonth() - i, 1).toLocaleDateString('en-CA').slice(0, 7));
    return out;
  }, []);
  return (
    <>
      <select className="ks-select" aria-label="Месяц" value={ym} onChange={e => setYm(e.target.value)}>
        {months.map(m => <option key={m} value={m}>{monthName(m)}</option>)}
      </select>
      {tab === 'games' ? <StaffGames period={monthPeriod(ym)} admin /> : <StaffStats period={monthPeriod(ym)} />}
    </>
  );
}

function Month() {
  const [ym, setYm] = useState(monthIso(today()));
  const [rows, setRows] = useState<Log[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const months = useMemo(() => {
    const out: string[] = [];
    const now = new Date();
    for (let i = 0; i < 14; i++) out.push(new Date(now.getFullYear(), now.getMonth() - i, 1).toLocaleDateString('en-CA').slice(0, 7));
    return out;
  }, []);

  useEffect(() => {
    void (async () => {
      const [y, m] = ym.split('-').map(Number);
      const next = new Date(y, m, 1).toLocaleDateString('en-CA');
      const r = await supabase.from('training_log').select('id, held_on, coach, location, group_label, kind, starts_at, ends_at, hours, held').gte('held_on', `${ym}-01`).lt('held_on', next).eq('held', true).order('held_on').limit(2000);
      if (r.error) return setError(errText(r.error.message));
      setRows(((r.data ?? []) as Log[]).map(x => ({ ...x, hours: x.hours === null ? null : Number(x.hours) })));
    })();
  }, [ym, reload]);

  if (error) return <Failure title="Не удалось загрузить журнал" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} />;
  const byCoach = new Map<string, { n: number; h: number }>();
  (rows ?? []).forEach(r => { const c = byCoach.get(r.coach) ?? { n: 0, h: 0 }; byCoach.set(r.coach, { n: c.n + 1, h: c.h + (r.hours ?? 0) }); });
  return (
    <>
      <select className="ks-select" aria-label="Месяц" value={ym} onChange={e => { setRows(null); setYm(e.target.value); }}>
        {months.map(m => <option key={m} value={m}>{monthName(m)}</option>)}
      </select>
      {!rows ? <Loading /> : rows.length === 0 ? <EmptyState icon="users" title="Нет проведённых тренировок" /> : (
        <>
          <h3>Часы по тренерам</h3>
          {[...byCoach.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ru')).map(([c, v]) => (
            <div className="ks-card" key={c}><div className="ks-line"><b>{c}</b><Pill tone="primary">{Math.round(v.h * 10) / 10} ч</Pill></div><div className="ks-muted" style={{ fontSize: 13 }}>Тренировок: {v.n}</div></div>
          ))}
          <h3>Тренировки</h3>
          {rows.map(r => (
            <div className="ks-card" key={r.id}><div className="ks-line"><span>{fmtShort(r.held_on)} · {r.group_label} · {r.starts_at ? hm(r.starts_at) : ''}</span><span className="ks-muted">{r.coach}{r.hours ? ` · ${r.hours} ч` : ''}</span></div></div>
          ))}
          <p className="muted">Кнопка «Снять» на вкладке «День» убирает тренировку из месяца.</p>
        </>
      )}
    </>
  );
}
