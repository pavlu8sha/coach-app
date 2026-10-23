import { useEffect, useMemo, useState } from 'react';
import { addDays, coachError, today } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { EmptyState, Pill, Segmented } from '../ui/components';
import { Failure, Loading } from './Message';

interface Row { group_id: string; group_name: string; player_id: string; full_name: string; attended: number; total: number }

const LOW_PCT = 50; // порог «низкой посещаемости» (в старом приложении настройка stats.lowPct, по умолчанию 50)
const pct = (a: number, t: number) => (t ? Math.round((a * 1000) / t) / 10 : null);
const monthStart = (iso: string) => iso.slice(0, 8) + '01';
const prevMonthStart = (iso: string) => {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.toLocaleDateString('en-CA');
};

type Range = 'month' | 'prev' | 'custom';

// Посещаемость по группам за период (docs/FEATURE_PARITY.md). Занятие считается проведённым, если кто-то отмечен «был».
export default function Stats() {
  const [range, setRange] = useState<Range>('month');
  const [from, setFrom] = useState(monthStart(today()));
  const [to, setTo] = useState(today());
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const period = useMemo(() => {
    if (range === 'month') return { f: monthStart(today()), t: today() };
    if (range === 'prev') {
      const f = prevMonthStart(today());
      return { f, t: addDays(monthStart(today()), -1) };
    }
    return { f: from, t: to };
  }, [range, from, to]);

  useEffect(() => {
    void (async () => {
      if (period.f > period.t) return setError('Начало периода позже конца.');
      const r = await supabase.rpc('attendance_stats', { p_from: period.f, p_to: period.t });
      if (r.error) return setError(r.error.message.includes('period too large') ? 'Период слишком большой: не больше 13 месяцев.' : coachError(r.error.message));
      setRows((r.data ?? []) as Row[]);
    })();
  }, [period, reload]);

  const groups = useMemo(() => {
    const m = new Map<string, Row[]>();
    (rows ?? []).forEach(r => m.set(r.group_name, [...(m.get(r.group_name) ?? []), r]));
    return [...m.entries()];
  }, [rows]);

  if (error) return <Failure title="Не удалось загрузить статистику" text={error} onRetry={() => { setError(null); setRows(null); setReload(n => n + 1); }} />;

  return (
    <main className="page">
      <h1>Статистика</h1>
      <Segmented
        label="Период"
        value={range}
        onChange={v => { setRows(null); setRange(v); }}
        items={[
          { value: 'month', label: 'Месяц' },
          { value: 'prev', label: 'Прошлый' },
          { value: 'custom', label: 'Период' },
        ]}
      />
      {range === 'custom' && (
        <div className="two" style={{ margin: '10px 0' }}>
          <input type="date" aria-label="С даты" value={from} max={to} onChange={e => { setRows(null); setFrom(e.target.value); }} />
          <input type="date" aria-label="По дату" value={to} min={from} onChange={e => { setRows(null); setTo(e.target.value); }} />
        </div>
      )}
      {!rows ? (
        <Loading />
      ) : groups.length === 0 ? (
        <EmptyState icon="trophy" title="Нет проведённых занятий" text="За выбранный период ни на одном занятии не отмечены присутствующие." />
      ) : (
        groups.map(([name, list]) => {
          const total = list[0].total;
          const att = list.reduce((s, r) => s + r.attended, 0);
          const p = pct(att, list.length * total);
          return (
            <section key={name}>
              <h3>{name}</h3>
              <p className="muted" style={{ marginBottom: 8 }}>Занятий: {total} · игроков: {list.length} · посещаемость {p === null ? '—' : `${p}%`}</p>
              {[...list].sort((a, b) => a.attended - b.attended).map(r => {
                const v = pct(r.attended, r.total);
                return (
                  <div className="ks-card" key={r.player_id}>
                    <div className="ks-line">
                      <span style={{ overflowWrap: 'anywhere', minWidth: 0 }}>{r.full_name}</span>
                      <Pill tone={v !== null && v < LOW_PCT ? 'danger' : 'primary'}>{r.attended} из {r.total}{v !== null ? ` · ${v}%` : ''}</Pill>
                    </div>
                  </div>
                );
              })}
            </section>
          );
        })
      )}
    </main>
  );
}
