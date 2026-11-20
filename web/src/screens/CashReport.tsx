import { useEffect, useState } from 'react';
import { coachError, fmtDate, today } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { EmptyState, ListRow, Pill, Segmented } from '../ui/components';
import { Loading } from './Message';
import { gel } from './MonthPayments';
import { useNavState } from '../nav';

interface StaffSum { staff_id: string | null; name: string; sum: number }
interface MethodSum { method: string; sum: number }
interface Row { id: string; kind: string; player: string; amount: number; paid_on: string; method: string; staff: string; recorded_at: string | null; location: string | null }
interface Report { total: number; by_method: MethodSum[]; by_staff: StaffSum[]; rows: Row[] }

type Preset = 'today' | 'day' | 'month' | 'custom';
interface LocRes { data: Record<string, string | null>[] | null; error: { message: string } | null }
const LOCATION_SOURCES = [{ table: 'groups', column: 'location' }, { table: 'camps', column: 'location' }, { table: 'equipment_orders', column: 'location' }, { table: 'extra_sessions', column: 'place' }];
const METHOD_FILTERS = [{ value: '', label: 'Все' }, { value: 'Наличные', label: 'Наличные' }, { value: 'Перевод', label: 'Перевод' }, { value: 'не указан', label: 'Не указан' }];

// Кассовый отчёт (#264): поступления за день, месяц или период. Суммы считает сервер (0078): по сотрудникам и способам они сходятся с итогом.
// Отмена — строка с минусом. Способ вне «Наличные»/«Перевод» показан как «не указан».
export default function CashReport() {
  const [preset, setPreset] = useNavState<Preset>('cr.preset', 'today');
  const [from, setFrom] = useNavState('cr.from', today());
  const [to, setTo] = useNavState('cr.to', today());
  const [location, setLocation] = useNavState('cr.location', '');
  const [method, setMethod] = useNavState('cr.method', '');
  const [report, setReport] = useState<Report | null>(null);
  const [locations, setLocations] = useState<string[]>([]);
  const [locErr, setLocErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const choose = (p: Preset) => {
    setPreset(p);
    if (p === 'today') { setFrom(today()); setTo(today()); }
    if (p === 'day') setTo(from);
    if (p === 'month') { setFrom(today().slice(0, 8) + '01'); setTo(today()); }
  };

  // список локаций для выбора: те же источники, по которым cash_report (0210) определяет локацию платежа:
  // groups.location (абонементы, доп. посещения, оплата за визит), camps.location (сборы), equipment_orders.location (экипировка), extra_sessions.place (доп. занятия)
  useEffect(() => {
    let live = true;
    void Promise.all(LOCATION_SOURCES.map(src => (supabase.from(src.table).select(src.column) as unknown) as PromiseLike<LocRes>)).then(res => {
      if (!live) return;
      const failed = res.find(r => r.error);
      if (failed?.error) { setLocErr(coachError(failed.error.message)); return; }
      const names = res.flatMap((r, i) => (r.data ?? []).map(x => (x[LOCATION_SOURCES[i].column] ?? '').trim()));
      setLocations([...new Set(names.filter(Boolean))].sort((x, y) => x.localeCompare(y)));
    }, () => { if (live) setLocErr('Нет связи, список локаций не загрузился'); });
    return () => { live = false; };
  }, []);

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
    <main style={{ maxWidth: 560, margin: '0 auto', padding: '12px 16px calc(88px + var(--ks-safe-b))' }}>
      <h1>Кассовый отчёт</h1>
      <Segmented label="Период отчёта" value={preset} onChange={choose} items={[{ value: 'today', label: 'Сегодня' }, { value: 'day', label: 'День' }, { value: 'month', label: 'Месяц' }, { value: 'custom', label: 'Период' }]} />
      {preset === 'day' && (
        <div style={{ marginTop: 8 }}>
          <label className="field">Дата<input type="date" value={from} onChange={e => { setFrom(e.target.value); setTo(e.target.value); }} /></label>
        </div>
      )}
      {preset === 'custom' && (
        <div className="ks-pair">
          <label className="field">С<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
          <label className="field">По<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <label className="field" style={{ flex: 1 }}>Локация
          <select value={location} onChange={e => setLocation(e.target.value)}>
            <option value="">Все локации</option>
            {(location && !locations.includes(location) ? [location, ...locations] : locations).map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
      </div>
      {locErr && <p role="status" className="ks-muted" style={{ margin: '4px 0 0' }}>Список локаций не загрузился: {locErr}. Отчёт по всем локациям работает.</p>}
      <div style={{ marginTop: 8 }}>
        <Segmented label="Способ оплаты" value={method} onChange={setMethod} items={METHOD_FILTERS} />
      </div>

      {to < from && <p role="alert" className="ks-muted">Конец периода раньше начала.</p>}
      {err && <p role="alert" className="ks-muted">{err}</p>}
      {!err && to >= from && !report && <Loading />}

      {report && (
        <>
          <h2 className="ks-list-head"><span>{from === to ? fmtDate(from) : `${fmtDate(from)} — ${fmtDate(to)}`}</span><span>{gel(report.total)}</span></h2>
          <div className="ks-tiles">
            {report.by_method.map(m => <div key={m.method} className="ks-tile"><b>{m.method}</b>{gel(m.sum)}</div>)}
          </div>

          <h2 className="ks-list-head"><span>По сотрудникам</span></h2>
          {report.by_staff.length === 0 && <div className="ks-muted">Нет поступлений</div>}
          {report.by_staff.map(s => <ListRow key={s.staff_id ?? 'none'} title={s.name} end={<Pill tone={s.sum < 0 ? 'danger' : 'success'}>{gel(s.sum)}</Pill>} />)}

          <h2 className="ks-list-head"><span>Операции</span><span>{report.rows.length}</span></h2>
          {report.rows.length === 0 && <EmptyState icon="box" title="За период платежей нет" />}
          {report.rows.map(x => (
            <ListRow key={x.id} title={x.player}
              sub={[[x.kind, x.method, x.staff, x.location].filter(Boolean).join(' · ')]}
              end={<Pill tone={x.amount < 0 ? 'danger' : 'success'}>{gel(x.amount)}</Pill>} />
          ))}
        </>
      )}
    </main>
  );
}
