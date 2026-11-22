import { useEffect, useState } from 'react';
import { coachError, fmtDate, today } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { EmptyState, ListRow, Pill, Segmented } from '../ui/components';
import { canonicalLocation, locationOptions } from '../lib/branches';
import { Loading } from './Message';
import { gel } from './MonthPayments';
import { useNavState } from '../nav';

interface StaffSum { staff_id: string | null; name: string; sum: number }
interface MethodSum { method: string; sum: number }
interface Row { id: string; kind: string; player: string; amount: number; paid_on: string; method: string; staff: string; recorded_at: string | null; location: string | null }
interface Report { total: number; by_method: MethodSum[]; by_staff: StaffSum[]; rows: Row[] }

type Preset = 'today' | 'day' | 'month' | 'custom';
type Kind = 'all' | 'camps' | 'nocamps';
const KIND_FILTERS: { value: Kind; label: string }[] = [{ value: 'all', label: 'Всё' }, { value: 'camps', label: 'Сборы' }, { value: 'nocamps', label: 'Без сборов' }];
const CAMP_KIND = 'Сбор'; // вид операции из cash_report (0210)
const METHOD_FILTERS = [{ value: '', label: 'Все' }, { value: 'Наличные', label: 'Наличные' }, { value: 'Перевод', label: 'Перевод' }, { value: 'не указан', label: 'Не указан' }];

/** Фильтр вида операций на экране: итоги, суммы по способам и по сотрудникам пересчитываются из показанных операций и сходятся с ними. «Всё» — данные сервера как есть. */
function byKind(r: Report, kind: Kind): Report {
  if (kind === 'all') return r;
  const rows = r.rows.filter(x => (x.kind === CAMP_KIND) === (kind === 'camps'));
  const sum = (key: (x: Row) => string) => {
    const m = new Map<string, number>();
    for (const x of rows) m.set(key(x), (m.get(key(x)) ?? 0) + x.amount);
    return [...m.entries()];
  };
  return {
    total: rows.reduce((a, x) => a + x.amount, 0),
    by_method: sum(x => x.method).map(([method, s]) => ({ method, sum: s })).sort((a, b) => a.method.localeCompare(b.method)),
    by_staff: sum(x => x.staff).map(([name, s]) => ({ staff_id: null, name, sum: s })).sort((a, b) => a.name.localeCompare(b.name)),
    rows,
  };
}

// Кассовый отчёт (#264): поступления за день, месяц или период. Суммы считает сервер (0078): по сотрудникам и способам они сходятся с итогом.
// Отмена — строка с минусом. Способ вне «Наличные»/«Перевод» показан как «не указан».
export default function CashReport() {
  const [preset, setPreset] = useNavState<Preset>('cr.preset', 'today');
  const [from, setFrom] = useNavState('cr.from', today());
  const [to, setTo] = useNavState('cr.to', today());
  const [location, setLocation] = useNavState('cr.location', '');
  const [method, setMethod] = useNavState('cr.method', '');
  const [report, setReport] = useState<Report | null>(null);
  const [kind, setKind] = useNavState<Kind>('cr.kind', 'all');
  const [err, setErr] = useState<string | null>(null);

  const choose = (p: Preset) => {
    setPreset(p);
    if (p === 'today') { setFrom(today()); setTo(today()); }
    if (p === 'day') setTo(from);
    if (p === 'month') { setFrom(today().slice(0, 8) + '01'); setTo(today()); }
  };

  useEffect(() => {
    if (!from || !to || to < from) return;
    setErr(null);
    setReport(null);
    void supabase.rpc('cash_report', { p_from: from, p_to: to, p_location: canonicalLocation(location) || null, p_staff: null, p_method: method || null }).then(r => {
      if (r.error) return setErr(coachError(r.error.message));
      setReport(r.data as Report);
    });
  }, [from, to, location, method]);

  // в rows нет идентификатора сотрудника: при двух сотрудниках с одним именем суммы по людям после фильтра вида были бы склеены, поэтому фильтр недоступен
  const ambiguousStaff = report ? new Set(report.by_staff.map(x => x.name)).size < report.by_staff.length : false;
  const shown = report ? byKind(report, ambiguousStaff ? 'all' : kind) : null;

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
          <select value={canonicalLocation(location)} onChange={e => setLocation(e.target.value)}>
            <option value="">Все локации</option>
            {locationOptions(location).map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
      </div>
      <div style={{ marginTop: 8 }}>
        <Segmented label="Способ оплаты" value={method} onChange={setMethod} items={METHOD_FILTERS} />
      </div>
      <div style={{ marginTop: 8 }}>
        <Segmented label="Что показывать" value={ambiguousStaff ? 'all' : kind} onChange={v => { if (!ambiguousStaff) setKind(v); }} items={KIND_FILTERS} />
        {ambiguousStaff && <p role="status" className="ks-muted" style={{ margin: '4px 0 0' }}>Фильтр по виду недоступен: в отчёте есть сотрудники с одинаковым именем, суммы по ним нельзя разделить.</p>}
      </div>

      {to < from && <p role="alert" className="ks-muted">Конец периода раньше начала.</p>}
      {err && <p role="alert" className="ks-muted">{err}</p>}
      {!err && to >= from && !report && <Loading />}

      {report && shown && (
        <>
          <h2 className="ks-list-head"><span>{from === to ? fmtDate(from) : `${fmtDate(from)} — ${fmtDate(to)}`}</span><span>{gel(shown.total)}</span></h2>
          <div className="ks-tiles">
            {shown.by_method.map(m => <div key={m.method} className="ks-tile"><b>{m.method}</b>{gel(m.sum)}</div>)}
          </div>

          <h2 className="ks-list-head"><span>По сотрудникам</span></h2>
          {shown.by_staff.length === 0 && <div className="ks-muted">Нет поступлений</div>}
          {shown.by_staff.map(s => <ListRow key={s.staff_id ?? s.name} title={s.name} end={<Pill tone={s.sum < 0 ? 'danger' : 'success'}>{gel(s.sum)}</Pill>} />)}

          <h2 className="ks-list-head"><span>Операции</span><span>{shown.rows.length}</span></h2>
          {shown.rows.length === 0 && <EmptyState icon="box" title="За период платежей нет" />}
          {shown.rows.map(x => (
            <ListRow key={x.id} title={x.player}
              sub={[[x.kind, x.method, x.staff, x.location].filter(Boolean).join(' · ')]}
              end={<Pill tone={x.amount < 0 ? 'danger' : 'success'}>{gel(x.amount)}</Pill>} />
          ))}
        </>
      )}
    </main>
  );
}
