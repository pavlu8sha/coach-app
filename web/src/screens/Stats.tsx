import { useEffect, useMemo, useState } from 'react';
import { addDays, coachError, today } from '../lib/coach';
import { matchHighlights, seasonStart, type ScoredMatch } from '../lib/seasonStats';
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

type Range = 'month' | 'prev' | 'season' | 'custom';

type Kind = 'att' | 'matches';

// Статистика для администратора и тренера: посещаемость групп и матчи за период.
// own — экран тренера: база отдаёт только его группы и их команды (0080), пустой результат объясняем отдельно.
export default function Stats({ own = false }: { own?: boolean }) {
  const [kind, setKind] = useState<Kind>('att');
  return (
    <>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '8px 16px 0' }}>
        <Segmented label="Статистика" value={kind} onChange={setKind} items={[{ value: 'att', label: 'Посещаемость' }, { value: 'matches', label: 'Матчи' }]} />
      </div>
      {kind === 'att' ? <Attendance own={own} /> : <Matches own={own} />}
    </>
  );
}

function usePeriod() {
  const [range, setRange] = useState<Range>('month');
  const [from, setFrom] = useState(monthStart(today()));
  const [to, setTo] = useState(today());
  const period = useMemo(() => {
    if (range === 'month') return { f: monthStart(today()), t: today() };
    if (range === 'prev') return { f: prevMonthStart(today()), t: addDays(monthStart(today()), -1) };
    if (range === 'season') return { f: seasonStart(today()), t: today() };
    return { f: from, t: to };
  }, [range, from, to]);
  const picker = (onChange: () => void) => (
    <>
      <Segmented label="Период" value={range} onChange={v => { onChange(); setRange(v); }} items={[{ value: 'month', label: 'Месяц' }, { value: 'prev', label: 'Прошлый' }, { value: 'season', label: 'Сезон' }, { value: 'custom', label: 'Период' }]} />
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

function Matches({ own }: { own: boolean }) {
  const { period, picker } = usePeriod();
  const [rows, setRows] = useState<MRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [cat, setCat] = useState('');
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
  const teams = (rows ?? []).filter(r => r.kind === 'team');
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
      {!rows ? <Loading /> : teams.length === 0 ? (
        <EmptyState icon="trophy" title={own ? 'Нет матчей ваших команд' : 'Нет матчей со счётом'} text={own ? 'За выбранный период нет матчей со счётом у команд ваших групп. Здесь только ваши группы; матчи других команд видны в разделе «Матчи».' : 'За выбранный период нет сыгранных матчей с внесённым счётом.'} />
      ) : teams.map(t => (
        <section key={t.team}>
          <h3>{t.team}</h3>
          <SeasonTiles t={t} games={games.filter(g => g.team === t.team)} />
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

function SeasonTiles({ t, games }: { t: MRow; games: ScoredMatch[] }) {
  const diff = (t.goals_for ?? 0) - (t.goals_against ?? 0);
  const { streak, best } = matchHighlights(games);
  const tiles: [string, string | number][] = [
    ['Матчей', t.games ?? 0], ['Победы', t.wins ?? 0], ['Ничьи', t.draws ?? 0], ['Поражения', t.losses ?? 0],
    ['Забито', t.goals_for ?? 0], ['Пропущено', t.goals_against ?? 0], ['Разница', diff > 0 ? `+${diff}` : diff],
  ];
  if (games.length) tiles.push(['Серия побед', streak]);
  return (
    <div className="ks-card">
      <div className="ks-tiles">{tiles.map(([k, v]) => <div className="ks-tile" key={k}><b>{k}</b>{v}</div>)}</div>
      {best && <p className="ks-muted" style={{ margin: '10px 0 0' }}>Лучший матч: {best.goals_for}:{best.goals_against}{best.opponent ? ` с ${best.opponent}` : ''}, {best.played_on.slice(8, 10)}.{best.played_on.slice(5, 7)}</p>}
    </div>
  );
}

// Посещаемость по группам за период. Занятие считается проведённым, если кто-то отмечен «был».
function Attendance({ own }: { own: boolean }) {
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
        <EmptyState icon="trophy" title={own ? 'Нет проведённых занятий в ваших группах' : 'Нет проведённых занятий'} text={own ? 'За выбранный период ни на одном занятии ваших групп не отмечены присутствующие. Здесь только ваши группы.' : 'За выбранный период ни на одном занятии не отмечены присутствующие.'} />
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
