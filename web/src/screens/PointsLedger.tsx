import { useEffect, useState } from 'react';
import { fmtDate, plural } from '../lib/coach';
import { grandTotal, latestMonth, ledgerLabel, monthLabel, monthOf, monthTotal, shiftMonth, type LedgerRow } from '../lib/pointsLedger';
import { supabase } from '../lib/supabase';
import { Pill } from '../ui/components';

interface SeriesInfo {
  current: number;
  record: number;
  current_from: string | null;
  last_break: string | null;
  next_threshold: string | null;
  next_bonus: string | null;
  remaining: number | null;
  finished_runs: { length: number; from: string; to: string }[];
}

const today = () => new Date().toISOString().slice(0, 7);

// Баллы по новым правилам (#18): итог за месяц, всего накоплено, история начислений с пояснениями и серия посещаемости.
// Блок появляется, когда у игрока есть хотя бы одно начисление в новом журнале; до этого остаётся прежний показ баллов.
export default function PointsLedger({ playerId }: { playerId: string }) {
  const [rows, setRows] = useState<LedgerRow[] | null>(null);
  const [series, setSeries] = useState<SeriesInfo | null>(null);
  const [month, setMonth] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    void (async () => {
      const r = await supabase.from('points_ledger').select('id, event_date, points, source_type, reason_code, components, status').eq('player_id', playerId).eq('status', 'active').order('event_date', { ascending: false }).limit(1000);
      const list = r.error ? [] : ((r.data ?? []) as LedgerRow[]);
      setRows(list);
      setMonth(m => m ?? latestMonth(list, today()));
      if (list.length > 0) {
        const s = await supabase.rpc('points_series_info', { p: playerId });
        setSeries(s.error ? null : (s.data as SeriesInfo | null));
      }
    })();
  }, [playerId]);

  if (!rows || rows.length === 0 || !month) return null;
  const inMonth = rows.filter(r => monthOf(r.event_date) === month);
  const total = monthTotal(rows, month);
  const all = grandTotal(rows);
  const first = monthOf(rows[rows.length - 1].event_date);
  const last = latestMonth(rows, today());

  return (
    <section className="ks-card" aria-label="Баллы по новым правилам">
      <h2 style={{ marginTop: 0 }}>Баллы</h2>
      <div className="ks-line">
        <button type="button" className="ks-btn secondary sm" aria-label="Предыдущий месяц" disabled={month <= first} onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
        <b>{monthLabel(month)}</b>
        <button type="button" className="ks-btn secondary sm" aria-label="Следующий месяц" disabled={month >= last} onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
      </div>
      <p style={{ margin: '8px 0 0' }}>За месяц: <b>{total}</b> {plural(total)}</p>
      <p className="muted" style={{ margin: '2px 0 10px' }}>Всего накоплено: {all} {plural(all)}</p>

      {inMonth.length === 0 ? (
        <p className="muted">В этом месяце начислений нет.</p>
      ) : (
        inMonth.map(r => {
          const l = ledgerLabel(r);
          return (
            <div className="ks-slot" key={r.id}>
              <span className="ks-slot-main">
                {l.title}
                <span className="ks-muted">{fmtDate(r.event_date)}{l.detail ? ` · ${l.detail}` : ''}</span>
              </span>
              <Pill tone="success">+{r.points}</Pill>
            </div>
          );
        })
      )}

      {series && (series.current > 0 || series.record > 0 || series.last_break) && (
        <>
          <h3 style={{ marginTop: 14 }}>Серия посещений</h3>
          {series.current > 0 ? (
            <p>Посещено подряд: <b>{series.current}</b>{series.remaining != null && series.next_threshold ? `. До бонуса за ${series.next_threshold} тренировок (+${series.next_bonus}) осталось ${series.remaining}.` : '.'}</p>
          ) : (
            <p className="muted">{series.last_break ? `Серия прервана после пропуска тренировки ${fmtDate(series.last_break)}. Новая серия начнётся с ближайшего занятия.` : 'Новая серия начнётся с ближайшего занятия.'}</p>
          )}
          {series.record > 0 && <p className="muted">Личный рекорд: {series.record} подряд</p>}
          {series.finished_runs.length > 0 && (
            <div>
              <p className="ks-label">Завершённые серии</p>
              {[...series.finished_runs].reverse().map((s, i) => (
                <div className="ks-slot" key={i}>
                  <span className="ks-slot-main">{s.length} подряд<span className="ks-muted">{fmtDate(s.from)} — {fmtDate(s.to)}</span></span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
