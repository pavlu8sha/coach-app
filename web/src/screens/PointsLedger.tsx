import { useEffect, useState } from 'react';
import { useNavState } from '../nav';
import { errMsg, fmtDate, plural } from '../lib/coach';
import { grandTotal, latestMonth, ledgerLabel, monthLabel, monthOf, monthTotal, shiftMonth, type LedgerRow } from '../lib/pointsLedger';
import { supabase } from '../lib/supabase';
import { EmptyState, Pill, SkeletonRows } from '../ui/components';
import { Failure } from './Message';

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

interface Bench {
  groups: { group_id: string | null; group_name: string | null; personal: number; status: 'ok' | 'insufficient' | 'no_data' | 'off'; avg: number | null; max: number | null; place?: number | null }[];
}

const fmtAvg = (n: number) => String(n).replace('.', ',');

// Строка «подпись — значение»: подпись переносится, значение не сжимается; на 320 px не выходит за карточку.
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="ks-slot" style={{ padding: '6px 0' }}>
      <span className="ks-slot-main">{label}</span>
      <b style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{value}</b>
    </div>
  );
}
const today = () => new Date().toISOString().slice(0, 7);
// История читается страницами: сервер отдаёт не больше 1000 строк за запрос, больше ограничения в приложении нет
const PAGE = 1000;

// Последние загруженные баллы игрока держатся в памяти: повторное открытие вкладки показывает их сразу (без пустого экрана и прыжка страницы),
// свежие данные подтягиваются в фоне. prefetchPoints вызывается при открытии карточки игрока, чтобы и первое открытие вкладки было мгновенным.
type Loaded = { rows: LedgerRow[]; series: SeriesInfo | null };
const ledgerCache = new Map<string, Loaded & { at: number }>();
const benchCache = new Map<string, Bench>();
const inflight = new Map<string, Promise<Loaded>>();
const seqOf = new Map<string, number>();
const CACHE_LIMIT = 50; // игроков в памяти: дальше вытесняются самые старые
const FRESH_MS = 30_000; // предзагрузка не повторяется, пока запомненное моложе

function remember(playerId: string, v: Loaded) {
  ledgerCache.delete(playerId);
  ledgerCache.set(playerId, { ...v, at: Date.now() });
  while (ledgerCache.size > CACHE_LIMIT) ledgerCache.delete(ledgerCache.keys().next().value as string);
}

async function fetchLedger(playerId: string): Promise<Loaded> {
  const list: LedgerRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const r = await supabase.from('points_ledger').select('id, event_date, points, source_type, reason_code, components, status').eq('player_id', playerId).eq('status', 'active')
      .order('event_date', { ascending: false }).order('id', { ascending: false }).range(from, from + PAGE - 1);
    if (r.error) throw r.error;
    const page = (r.data ?? []) as LedgerRow[];
    list.push(...page);
    if (page.length < PAGE) break;
  }
  let series: SeriesInfo | null = null;
  if (list.length > 0) {
    const s = await supabase.rpc('points_series_info', { p: playerId });
    series = s.error ? null : (s.data as SeriesInfo | null);
  }
  return { rows: list, series };
}

// Один запрос на игрока: предзагрузка и вкладка делят его. Повтор (force) начинает новый запрос; в память пишет только самый поздний запущенный,
// поэтому запоздавший ответ старого запроса не затирает свежие баллы.
export function loadLedger(playerId: string, force = false): Promise<Loaded> {
  const running = inflight.get(playerId);
  if (running && !force) return running;
  const mine = (seqOf.get(playerId) ?? 0) + 1;
  seqOf.set(playerId, mine);
  const p = fetchLedger(playerId).then(v => {
    if (seqOf.get(playerId) === mine) remember(playerId, v);
    return v;
  }).finally(() => { if (inflight.get(playerId) === p) inflight.delete(playerId); });
  inflight.set(playerId, p);
  return p;
}

/** Забыть всё, что запомнено между экранами: при выходе из аккаунта, смене пользователя и в тестах. */
export function resetPointsCache(): void {
  lastAuthUser = undefined;
  ledgerCache.clear();
  benchCache.clear();
  inflight.clear();
  seqOf.clear();
}

let lastAuthUser: string | undefined;
/** Событие входа/выхода: при выходе и смене пользователя запомненные баллы забываются (чужие баллы не показываются новому пользователю). */
export function pointsAuthEvent(ev: string, session: { user?: { id?: string } } | null): void {
  const id = session?.user?.id;
  if (ev === 'SIGNED_OUT' || (id && lastAuthUser && id !== lastAuthUser)) resetPointsCache();
  if (ev === 'SIGNED_OUT') lastAuthUser = undefined;
  else if (id) lastAuthUser = id;
}

/** Заранее загружает баллы игрока (ошибки молча игнорируются: вкладка загрузит сама). Свежие данные не перезапрашиваются. */
export function prefetchPoints(playerId: string): void {
  const c = ledgerCache.get(playerId);
  if (c && Date.now() - c.at < FRESH_MS) return;
  void loadLedger(playerId).catch(() => undefined);
}

// Баллы по новым правилам (#18): итог за месяц, всего накоплено, история начислений с пояснениями и серия посещаемости.
// Блок появляется, когда у игрока есть хотя бы одно начисление в новом журнале; до этого остаётся прежний показ баллов.
export default function PointsLedger({ playerId, showEmpty = false }: { playerId: string; showEmpty?: boolean }) {
  const cached = ledgerCache.get(playerId);
  const [rows, setRows] = useState<LedgerRow[] | null>(cached?.rows ?? null);
  const [series, setSeries] = useState<SeriesInfo | null>(cached?.series ?? null);
  const [picked, setMonth] = useNavState<string | null>(`pl.month.${playerId}`, null); // выбранный вручную; пока не выбран — последний месяц с начислениями
  const month = picked ?? (rows ? latestMonth(rows, today()) : null);
  const [bench, setBench] = useState<Bench | null>(month ? benchCache.get(`${playerId}|${month}`) ?? null : null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [stale, setStale] = useState(false); // обновление не удалось: на экране сохранённые баллы

  useEffect(() => {
    // показанное из памяти остаётся на экране, пока тихо подтягиваются свежие данные: вкладка не мигает пустотой
    const c = ledgerCache.get(playerId);
    setRows(c?.rows ?? null);
    setSeries(c?.series ?? null);
    setError(null);
    setStale(false);
    let off = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const apply = (v: Loaded) => { if (!off) { setRows(v.rows); setSeries(v.series); setStale(false); } };
    const fail = (e: unknown, again: boolean) => {
      if (off) return;
      if (!ledgerCache.has(playerId)) return setError(errMsg(e)); // ошибка загрузки не превращается в пустой список
      if (again) retry = setTimeout(() => { loadLedger(playerId, true).then(apply, err => fail(err, false)); }, 2000); // один тихий повтор
      else setStale(true); // показаны сохранённые баллы: честно говорим, что они могли устареть
    };
    loadLedger(playerId, reload > 0).then(apply, e => fail(e, true));
    return () => { off = true; clearTimeout(retry); };
  }, [playerId, reload]);

  // ориентиры группы за выбранный месяц: анонимно, только числа; без функции (старая база) блок просто не показывается
  useEffect(() => {
    if (!month) return;
    const key = `${playerId}|${month}`;
    setBench(benchCache.get(key) ?? null);
    let off = false;
    void supabase.rpc('points_group_benchmark', { p: playerId, ym: `${month}-01` }).then(r => {
      const b = r.error ? null : (r.data as Bench | null);
      if (b) benchCache.set(key, b);
      if (!off) setBench(b); // ответ за прежний месяц не перекрывает выбранный
    });
    return () => { off = true; };
  }, [playerId, month]);

  if (error) return <Failure embedded title="Не удалось загрузить баллы" text={error} onRetry={() => setReload(n => n + 1)} />;
  if (rows && rows.length === 0 && showEmpty) return <EmptyState icon="trophy" title="Баллов пока нет" text="Они появятся после тренировок и матчей." />;
  if (!rows) return <section className="ks-card" aria-label="Баллы по новым правилам" aria-busy="true"><h2 style={{ marginTop: 0 }}>Баллы</h2><SkeletonRows count={3} /></section>;
  if (rows.length === 0 || !month) return null;
  const inMonth = rows.filter(r => monthOf(r.event_date) === month);
  const total = monthTotal(rows, month);
  const all = grandTotal(rows);
  const first = monthOf(rows[rows.length - 1].event_date);
  const last = latestMonth(rows, today());

  return (
    <section className="ks-card" aria-label="Баллы по новым правилам">
      <h2 style={{ marginTop: 0 }}>Баллы</h2>
      {stale && (
        <p className="muted" role="status" style={{ marginTop: 0 }}>
          Не удалось обновить, данные могли устареть.{' '}
          <button type="button" className="ks-back" onClick={() => setReload(n => n + 1)}>Обновить</button>
        </p>
      )}
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

      {bench && bench.groups.length > 1 && (
        <div style={{ marginTop: 10 }}>
          <p className="ks-label">Ваши баллы по группам</p>
          {bench.groups.map((g, i) => (
            <div className="ks-slot" key={i}><span className="ks-slot-main">{g.group_name ?? 'Группа не определена'}</span><Pill tone="primary">{g.personal}</Pill></div>
          ))}
        </div>
      )}
      {bench && (
        <div style={{ marginTop: 10 }}>
          <p className="ks-label">Сравнение с группой</p>
          {bench.groups.length === 0 ? (
            <p className="muted">Нет данных</p>
          ) : (
            bench.groups.filter(g => g.status !== 'off').map((g, i) => (
              <div key={i}>
                {g.group_name && <p style={{ margin: '8px 0 0', fontWeight: 700 }}>{g.group_name}</p>}
                {g.status === 'ok' && g.avg != null && g.max != null ? (
                  <>
                    <Row label="У вас" value={String(g.personal)} />
                    <Row label="Среднее по группе" value={fmtAvg(g.avg)} />
                    <Row label="Максимум в группе" value={String(g.max)} />
                    {g.place ? <Row label="Место в группе" value={String(g.place)} /> : null}
                  </>
                ) : (
                  <p className="muted" style={{ margin: '4px 0' }}>
                    {g.status === 'insufficient' ? 'Недостаточно данных для анонимного сравнения' : 'Нет данных'}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {series && (series.current > 0 || series.record > 0 || series.last_break) && (
        <>
          <h3 style={{ marginTop: 14 }}>Серия посещений</h3>
          {series.current > 0 ? (
            <>
              <Row label="Посещено подряд" value={String(series.current)} />
              {series.remaining != null && series.next_threshold && (
                <Row label={`До бонуса за ${series.next_threshold} тренировок (+${series.next_bonus})`} value={`осталось ${series.remaining}`} />
              )}
            </>
          ) : (
            <p className="muted">{series.last_break ? `Серия прервана после пропуска тренировки ${fmtDate(series.last_break)}. Новая серия начнётся с ближайшего занятия.` : 'Новая серия начнётся с ближайшего занятия.'}</p>
          )}
          {series.record > 0 && <Row label="Личный рекорд" value={`${series.record} подряд`} />}
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
