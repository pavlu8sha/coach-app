import { useEffect, useMemo, useState } from 'react';
import { addDays, coachError, fmtShort, hm, today } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { EmptyState, ListRow, Pill, Segmented } from '../ui/components';
import { Failure, Loading } from './Message';

interface Row { held_on: string; coach: string; group_label: string; kind: string; starts_at: string | null; ends_at: string | null; location: string | null; held: boolean }

const monthStart = (iso: string) => iso.slice(0, 8) + '01';
const prevMonthStart = (iso: string) => {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.toLocaleDateString('en-CA');
};
type Range = 'month' | 'prev';

// Посещаемость тренеров для тренера: только просмотр (кто и когда проводил занятия), без часов и денег (миграция 0042).
export default function TrainerAttendance() {
  const [range, setRange] = useState<Range>('month');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const period = useMemo(() => (range === 'month' ? { f: monthStart(today()), t: today() } : { f: prevMonthStart(today()), t: addDays(monthStart(today()), -1) }), [range]);

  useEffect(() => {
    void (async () => {
      const r = await supabase.rpc('trainer_attendance', { p_from: period.f, p_to: period.t });
      if (r.error) return setError(r.error.message.includes('Could not find the function') ? 'Функция ещё не установлена в базе (миграция 0042).' : coachError(r.error.message));
      setRows((r.data ?? []) as Row[]);
    })();
  }, [period, reload]);

  const days = useMemo(() => {
    const m = new Map<string, Row[]>();
    (rows ?? []).forEach(r => m.set(r.held_on, [...(m.get(r.held_on) ?? []), r]));
    return [...m.entries()];
  }, [rows]);

  if (error) return <Failure title="Не удалось загрузить посещаемость тренеров" text={error} onRetry={() => { setError(null); setRows(null); setReload(n => n + 1); }} />;
  return (
    <main className="page">
      <h1>Посещаемость тренеров</h1>
      <Segmented label="Период" value={range} onChange={v => { setRows(null); setRange(v); }} items={[{ value: 'month', label: 'Месяц' }, { value: 'prev', label: 'Прошлый' }]} />
      {!rows ? (
        <Loading />
      ) : days.length === 0 ? (
        <EmptyState icon="users" title="Нет записей" text="За выбранный период в журнале нет проведённых тренировок." />
      ) : (
        days.map(([day, list]) => (
          <section key={day}>
            <h3>{fmtShort(day)}</h3>
            {list.map((r, i) => (
              <ListRow
                key={day + i}
                title={r.coach}
                sub={[[r.group_label, r.starts_at ? hm(r.starts_at) : null, r.location].filter(Boolean).join(' · ')]}
                end={r.held ? <Pill tone="success">Проведена</Pill> : <Pill tone="neutral">Не проведена</Pill>}
              />
            ))}
          </section>
        ))
      )}
    </main>
  );
}
