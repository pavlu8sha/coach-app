import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { addDays, coachError, today } from '../lib/coach';
import { matchHighlights, seasonStart, type ScoredMatch } from '../lib/seasonStats';
import { settingNumber, settingNumberError, useClubSettings } from '../lib/clubSettings';
import { supabase } from '../lib/supabase';
import { EmptyState, Pill, Segmented } from '../ui/components';
import { Failure, Loading } from './Message';
import { useNavState } from '../nav';

interface Row { group_id: string; group_name: string; player_id: string; full_name: string; attended: number; total: number }

const pct = (a: number, t: number) => (t ? Math.round((a * 1000) / t) / 10 : null);
const monthStart = (iso: string) => iso.slice(0, 8) + '01';
const prevMonthStart = (iso: string) => {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.toLocaleDateString('en-CA');
};

type Range = 'thisweek' | 'week' | 'month' | 'prev' | 'season' | 'custom';
const RANGES = ['thisweek', 'week', 'month', 'prev', 'season', 'custom'];

// Эта неделя: с понедельника по сегодня.
function thisWeek(iso: string) {
  const dow = (new Date(iso + 'T12:00:00').getDay() + 6) % 7;
  return { f: addDays(iso, -dow), t: iso };
}

// Прошлая неделя: понедельник–воскресенье перед текущей неделей.
function prevWeek(iso: string) {
  const dow = (new Date(iso + 'T12:00:00').getDay() + 6) % 7; // понедельник = 0
  const f = addDays(iso, -dow - 7);
  return { f, t: addDays(f, 6) };
}

type Kind = 'att' | 'matches';

// Статистика для администратора и тренера: посещаемость групп и матчи за период.
// own — экран тренера: база отдаёт только его группы и их команды (0080), пустой результат объясняем отдельно.
export default function Stats({ own = false }: { own?: boolean }) {
  const [kind, setKind] = useNavState<Kind>('st.kind', 'att', { entry: 0, persist: { kind: 'enum', values: ['att', 'matches'] } });
  return (
    <>
      <header style={{ maxWidth: 560, margin: '0 auto', padding: '8px 16px 0' }}>
        <Segmented label="Статистика" value={kind} onChange={setKind} items={[{ value: 'att', label: 'Посещаемость' }, { value: 'matches', label: 'Матчи' }]} />
      </header>
      {kind === 'att' ? <Attendance own={own} /> : <Matches own={own} />}
    </>
  );
}

function usePeriod(scope: string) {
  // период каждой вкладки статистики хранится отдельно и возвращается после ухода в другой раздел
  const [range, setRange] = useNavState<Range>(`st.${scope}.range`, 'month', { persist: { kind: 'enum', values: RANGES } });
  const [from, setFrom] = useNavState(`st.${scope}.from`, monthStart(today()));
  const [to, setTo] = useNavState(`st.${scope}.to`, today());
  const period = useMemo(() => {
    if (range === 'thisweek') return thisWeek(today());
    if (range === 'week') return prevWeek(today());
    if (range === 'month') return { f: monthStart(today()), t: today() };
    if (range === 'prev') return { f: prevMonthStart(today()), t: addDays(monthStart(today()), -1) };
    if (range === 'season') return { f: seasonStart(today()), t: today() };
    return { f: from, t: to };
  }, [range, from, to]);
  const picker = (onChange: () => void) => (
    <>
      <Segmented label="Период" value={range} onChange={v => { onChange(); setRange(v); }} items={[{ value: 'thisweek', label: 'Эта неделя' }, { value: 'week', label: 'Прошлая неделя' }, { value: 'month', label: 'Месяц' }, { value: 'prev', label: 'Прошлый' }, { value: 'season', label: 'Сезон' }, { value: 'custom', label: 'Период' }]} />
      {range === 'custom' && (
        <div className="two" style={{ margin: '10px 0' }}>
          <input type="date" aria-label="С даты" value={from} max={to} onChange={e => { onChange(); setFrom(e.target.value); }} />
          <input type="date" aria-label="По дату" value={to} min={from} onChange={e => { onChange(); setTo(e.target.value); }} />
        </div>
      )}
    </>
  );
  return { period, picker };
}

interface MRow { kind: 'team' | 'player'; team: string; name: string | null; games: number | null; wins: number | null; draws: number | null; losses: number | null; goals_for: number | null; goals_against: number | null; played: number | null; goals: number | null }

function Tile({ value, label, badge }: { value: string; label: string; badge?: ReactNode }) {
  // значок результата стоит рядом с числом, а не после подписи: иначе на узком экране он переносится на отдельную строку
  return (
    <div className="ks-tile" style={{ minWidth: 0, fontSize: '0.78rem', overflowWrap: 'break-word' }}>
      <b style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '1.25rem', color: 'var(--ks-text)', marginBottom: 4 }}>{value}{badge}</b>{label}
    </div>
  );
}

type Res = 'В' | 'Н' | 'П';
const RES_TONE = { В: 'success', Н: 'neutral', П: 'danger' } as const;
const resOf = (f: number, a: number): Res => (f > a ? 'В' : f < a ? 'П' : 'Н');
function ResPill({ r }: { r: Res }) { return <Pill tone={RES_TONE[r]}>{r}</Pill>; }

function Matches({ own }: { own: boolean }) {
  const { period, picker } = usePeriod('matches');
  const [rows, setRows] = useState<MRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [cat, setCat] = useState('');
  const [team, setTeam] = useState('');
  const [games, setGames] = useState<(ScoredMatch & { team: string })[]>([]);
  useEffect(() => {
    void (async () => {
      if (period.f > period.t) return setError('Начало периода позже конца.');
      // Серия побед и лучший матч считаем по самим матчам; вид турнира у них не виден, поэтому только для «Все матчи».
      if (!cat) {
        const g = await supabase.from('matches').select('team, played_on, opponent, goals_for, goals_against').gte('played_on', period.f).lte('played_on', period.t).order('played_on', { ascending: false }).limit(500);
        setGames(g.error ? [] : ((g.data ?? []) as (ScoredMatch & { team: string })[]));
      } else setGames([]);
      const r = await supabase.rpc('match_stats', cat ? { p_from: period.f, p_to: period.t, p_cat: cat } : { p_from: period.f, p_to: period.t });
      if (r.error) return setError(r.error.message.includes('period too large') ? 'Период слишком большой: не больше 13 месяцев.' : coachError(r.error.message));
      setRows((r.data ?? []) as MRow[]);
    })();
  }, [period, cat, reload]);
  if (error) return <Failure title="Не удалось загрузить статистику матчей" text={error} onRetry={() => { setError(null); setRows(null); setReload(n => n + 1); }} />;
  const allTeams = (rows ?? []).filter(r => r.kind === 'team');
  const teamSel = allTeams.some(t => t.team === team) ? team : ''; // выбранной команды нет в новом периоде или виде матчей: показываем все
  const teams = allTeams.filter(t => !teamSel || t.team === teamSel);
  const sum = (f: (t: MRow) => number | null) => teams.reduce((x, t) => x + (f(t) ?? 0), 0);
  const gf = sum(t => t.goals_for);
  const ga = sum(t => t.goals_against);
  const diffAll = gf - ga;
  const shownGames = games.filter(g => g.goals_for !== null && g.goals_against !== null && (!teamSel || g.team === teamSel)).slice(0, 10);
  return (
    <main className="page">
      <h1>Матчи</h1>
      {picker(() => setRows(null))}
      <select className="ks-select" aria-label="Вид матчей" value={cat} onChange={e => { setRows(null); setCat(e.target.value); }}>
        <option value="">Все матчи</option>
        <option value="championship">Чемпионат</option>
        <option value="festival">Фестиваль</option>
        <option value="cup">Кубок</option>
        <option value="friendly">Товарищеские</option>
      </select>
      {allTeams.length > 1 && (
        <select className="ks-select" aria-label="Команда" value={teamSel} onChange={e => setTeam(e.target.value)}>
          <option value="">Все команды</option>
          {allTeams.map(t => <option key={t.team} value={t.team}>{t.team}</option>)}
        </select>
      )}
      {rows && teams.length > 0 && (
        <>
          <div className="ks-tiles" role="group" aria-label="Сводка матчей" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', marginBottom: 8 }}>
            <Tile value={String(sum(t => t.games))} label="игр" />
            <Tile value={`${gf}:${ga}`} label="голы" />
            <Tile value={diffAll > 0 ? `+${diffAll}` : String(diffAll)} label="разница голов" />
            <Tile value={String(sum(t => t.wins))} label="побед" badge={<ResPill r="В" />} />
            <Tile value={String(sum(t => t.draws))} label="ничьих" badge={<ResPill r="Н" />} />
            <Tile value={String(sum(t => t.losses))} label="поражений" badge={<ResPill r="П" />} />
          </div>
          {shownGames.length > 0 && (
            <details className="ks-card">
              <summary className="ks-disclosure"><b>Последние матчи</b></summary>
              <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0 }}>
                {shownGames.map((g, i) => (
                  <li className="ks-line" key={i} style={{ padding: '4px 0' }}>
                    <span style={{ overflowWrap: 'anywhere', minWidth: 0 }}>{g.played_on.slice(8, 10)}.{g.played_on.slice(5, 7)} · {g.team}{g.opponent ? ` — ${g.opponent}` : ''}</span>
                    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><b>{g.goals_for}:{g.goals_against}</b><ResPill r={resOf(g.goals_for as number, g.goals_against as number)} /></span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {!rows ? <Loading /> : teams.length === 0 ? (
        <EmptyState icon="trophy" title={own ? 'Нет матчей ваших команд' : 'Нет матчей со счётом'} text={own ? 'За выбранный период нет матчей со счётом у команд ваших групп. Здесь только ваши группы; матчи других команд видны в разделе «Матчи».' : 'За выбранный период нет сыгранных матчей с внесённым счётом.'} />
      ) : teams.map(t => (
        <section key={t.team}>
          <h3>{t.team}</h3>
          <SeasonTiles t={t} games={games.filter(g => g.team === t.team)} compact={teams.length === 1} />
          <TopScorers players={rows.filter(r => r.kind === 'player' && r.team === t.team)} />
          {rows.filter(r => r.kind === 'player' && r.team === t.team).sort((a, b) => (b.goals ?? 0) - (a.goals ?? 0) || (b.played ?? 0) - (a.played ?? 0)).map(p => (
            <div className="ks-card" key={p.name ?? ''}>
              <div className="ks-line"><span style={{ overflowWrap: 'anywhere', minWidth: 0 }}>{p.name}</span><span className="ks-muted">матчей {p.played} · голов {p.goals}</span></div>
            </div>
          ))}
        </section>
      ))}
    </main>
  );
}

// Лучшие бомбардиры команды: до 5 игроков с голами. Экран только для тренера и администратора, родителям и детям он не виден.
function TopScorers({ players }: { players: MRow[] }) {
  const top = players.filter(p => (p.goals ?? 0) > 0).sort((a, b) => (b.goals ?? 0) - (a.goals ?? 0) || (a.played ?? 0) - (b.played ?? 0) || (a.name ?? '').localeCompare(b.name ?? '')).slice(0, 5);
  if (!top.length) return null;
  return (
    <div className="ks-card" aria-label="Лучшие бомбардиры">
      <div className="ks-label" style={{ margin: '0 0 6px' }}>Лучшие бомбардиры</div>
      {top.map((p, i) => (
        <div className="ks-line" key={p.name ?? i} style={{ padding: '4px 0' }}>
          <span style={{ overflowWrap: 'anywhere', minWidth: 0 }}>{i + 1}. {p.name}</span>
          <Pill tone="primary">{p.goals} ⚽</Pill>
        </div>
      ))}
    </div>
  );
}

// compact: команда одна (выбрана или единственная), её цифры уже в сводке выше, остаются только серия побед и лучший матч
function SeasonTiles({ t, games, compact = false }: { t: MRow; games: ScoredMatch[]; compact?: boolean }) {
  const diff = (t.goals_for ?? 0) - (t.goals_against ?? 0);
  const { streak, best } = matchHighlights(games);
  const tiles: [string, string | number][] = [
    ['Матчей', t.games ?? 0], ['Победы', t.wins ?? 0], ['Ничьи', t.draws ?? 0], ['Поражения', t.losses ?? 0],
    ['Забито', t.goals_for ?? 0], ['Пропущено', t.goals_against ?? 0], ['Разница', diff > 0 ? `+${diff}` : diff],
  ];
  if (games.length) tiles.push(['Серия побед', streak]);
  if (compact) tiles.splice(0, tiles.length - (games.length ? 1 : 0));
  return (
    <div className="ks-card">
      <div className="ks-tiles">{tiles.map(([k, v]) => <div className="ks-tile" key={k}><b>{k}</b>{v}</div>)}</div>
      {best && <p className="ks-muted" style={{ margin: '10px 0 0' }}>Лучший матч: {best.goals_for}:{best.goals_against}{best.opponent ? ` с ${best.opponent}` : ''}, {best.played_on.slice(8, 10)}.{best.played_on.slice(5, 7)}</p>}
    </div>
  );
}

// Посещаемость по группам за период. Занятие считается проведённым, если кто-то отмечен «был».
function Attendance({ own }: { own: boolean }) {
  const settings = useClubSettings().values;
  const lowPct = settingNumber(settings, 'stats.lowPct');
  const lowPctError = settingNumberError(settings, 'stats.lowPct');
  const [range, setRange] = useNavState<Range>('st.att.range', 'month', { persist: { kind: 'enum', values: RANGES } });
  const [from, setFrom] = useNavState('st.att.from', monthStart(today()));
  const [to, setTo] = useNavState('st.att.to', today());
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const period = useMemo(() => {
    if (range === 'thisweek') return thisWeek(today());
    if (range === 'week') return prevWeek(today());
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

  // сводка клуба: занятия групп, отметки «был» из возможных (игроки × занятия)
  const sumSessions = groups.reduce((x, [, l]) => x + l[0].total, 0);
  const sumAtt = (rows ?? []).reduce((x, r) => x + r.attended, 0);
  const sumPossible = groups.reduce((x, [, l]) => x + l.length * l[0].total, 0);
  const sumPct = pct(sumAtt, sumPossible);

  if (error) return <Failure title="Не удалось загрузить статистику" text={error} onRetry={() => { setError(null); setRows(null); setReload(n => n + 1); }} />;

  return (
    <main className="page">
      <h1>Статистика</h1>
      {lowPctError && <p className="error">Порог низкой посещаемости недопустим: {lowPctError} Подсветка отключена.</p>}
      <Segmented
        label="Период"
        value={range}
        onChange={v => { setRows(null); setRange(v); }}
        items={[
          { value: 'thisweek', label: 'Эта неделя' },
          { value: 'week', label: 'Прошлая неделя' },
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
        <EmptyState icon="trophy" title={own ? 'Нет проведённых занятий в ваших группах' : 'Нет проведённых занятий'} text={own ? 'За выбранный период ни на одном занятии ваших групп не отмечены присутствующие. Здесь только ваши группы.' : 'За выбранный период ни на одном занятии не отмечены присутствующие.'} />
      ) : (
        <>
          <div className="ks-tiles" role="group" aria-label="Сводка посещаемости" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', marginBottom: 12 }}>
            {[[String(sumSessions), 'групповых тренировок'], [`${sumAtt} из ${sumPossible}`, 'отметок «был»'], [sumPct === null ? '—' : `${sumPct}%`, 'посещаемость']].map(([v, k]) => <Tile key={k} value={v} label={k} />)}
          </div>
          {groups.map(([name, list]) => {
            const total = list[0].total;
            const att = list.reduce((x, r) => x + r.attended, 0);
            const p = pct(att, list.length * total);
            return (
              <details className="ks-card" key={name}>
                <summary className="ks-disclosure">
                  <div className="ks-line"><b>{name}</b><b>{p === null ? '—' : `${p}%`}</b></div>
                  <div className="ks-bar"><i style={{ width: `${p ?? 0}%` }} /></div>
                </summary>
                <p className="muted" style={{ marginBottom: 8 }}>Занятий: {total} · игроков: {list.length} · посещаемость {p === null ? '—' : `${p}%`}</p>
                {[...list].sort((x, y) => x.attended - y.attended).map(r => {
                  const v = pct(r.attended, r.total);
                  return (
                    <div className="ks-line" key={r.player_id} style={{ padding: '4px 0' }}>
                      <span style={{ overflowWrap: 'anywhere', minWidth: 0 }}>{r.full_name}</span>
                      <Pill tone={v !== null && v < lowPct ? 'danger' : 'primary'}>{r.attended} из {r.total}{v !== null ? ` · ${v}%` : ''}</Pill>
                    </div>
                  );
                })}
              </details>
            );
          })}
        </>
      )}
    </main>
  );
}
