import { useEffect, useState } from 'react';
import { coachError, fmtDate, today } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { EmptyState, ListRow, Pill, Segmented } from '../ui/components';
import { Loading } from './Message';
import { gel } from './MonthPayments';

interface StaffSum { staff_id: string | null; name: string; sum: number }
interface MethodSum { method: string; sum: number }
interface Row { id: string; kind: string; player: string; amount: number; paid_on: string; method: string; staff: string; recorded_at: string | null; location: string | null }
interface Report { total: number; by_method: MethodSum[]; by_staff: StaffSum[]; rows: Row[] }

type Preset = 'today' | 'month' | 'custom';
const METHOD_FILTERS = [{ value: '', label: 'Все' }, { value: 'Наличные', label: 'Наличные' }, { value: 'Перевод', label: 'Перевод' }, { value: 'не указан', label: 'Не указан' }];

// Кассовый отчёт (#264): поступления за день, месяц или период. Суммы считает сервер (0078): по сотрудникам и способам они сходятся с итогом.
// Отмена — строка с минусом. Способ вне «Наличные»/«Перевод» показан как «не указан».
export default function CashReport() {
  const [preset, setPreset] = useState<Preset>('today');
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [location, setLocation] = useState('');
  const [method, setMethod] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const choose = (p: Preset) => {
    setPreset(p);
    if (p === 'today') { setFrom(today()); setTo(today()); }
    if (p === 'month') { setFrom(today().slice(0, 8) + '01'); setTo(today()); }
  };

  useEffect(() => {
    if (!from || !to || to < from) return;
    setErr(null);
    setReport(null);
    void supabase.rpc('cash_report', { p_from: from, p_to: to, p_location: location.trim() || null, p_staff: null, p_method: method || null }).then(r => {
      if (r.error) return setErr(coachError(r.error.message));
      setReport(r.data as Report);
    });
  }, [from, to, location, method]);

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '12px 16px 24px' }}>
      <h1>Кассовый отчёт</h1>
      <Segmented label="Период отчёта" value={preset} onChange={choose} items={[{ value: 'today', label: 'Сегодня' }, { value: 'month', label: 'Месяц' }, { value: 'custom', label: 'Период' }]} />
      {preset === 'custom' && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <label className="field">С<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
          <label className="field">По<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <label className="field" style={{ flex: 1 }}>Локация<input value={location} placeholder="все" onChange={e => setLocation(e.target.value)} /></label>
      </div>
      <div style={{ marginTop: 8 }}>
        <Segmented label="Способ оплаты" value={method} onChange={setMethod} items={METHOD_FILTERS} />
      </div>

      {to < from && <p role="alert" className="ks-muted">Конец периода раньше начала.</p>}
      {err && <p role="alert" className="ks-muted">{err}</p>}
      {!err && to >= from && !report && <Loading />}

      {report && (
        <>
          <h3 className="ks-list-head"><span>{from === to ? fmtDate(from) : `${fmtDate(from)} — ${fmtDate(to)}`}</span><span>{gel(report.total)}</span></h3>
          <div className="ks-tiles">
            {report.by_method.map(m => <div key={m.method} className="ks-tile"><b>{m.method}</b>{gel(m.sum)}</div>)}
          </div>

          <h3 className="ks-list-head"><span>По сотрудникам</span></h3>
          {report.by_staff.length === 0 && <div className="ks-muted">Нет поступлений</div>}
          {report.by_staff.map(s => <ListRow key={s.staff_id ?? 'none'} title={s.name} end={<Pill tone={s.sum < 0 ? 'danger' : 'success'}>{gel(s.sum)}</Pill>} />)}

          <h3 className="ks-list-head"><span>Операции</span><span>{report.rows.length}</span></h3>
          {report.rows.length === 0 && <EmptyState icon="box" title="За период платежей нет" />}
          {report.rows.map(x => (
            <ListRow key={x.id} title={x.player}
              sub={[[x.kind, x.method, x.staff, x.location].filter(Boolean).join(' · ')]}
              end={<Pill tone={x.amount < 0 ? 'danger' : 'success'}>{gel(x.amount)}</Pill>} />
          ))}
        </>
      )}
    </div>
  );
}
