import { useEffect, useState } from 'react';
import { useNavState } from '../nav';
import { supabase } from '../lib/supabase';
import { EmptyState, ListRow, Pill, Segmented } from '../ui/components';
import MatchResultRow from '../ui/MatchResultRow';
import { firstRecordDate, participation, type Part } from '../lib/parentMatches';
import { Failure, Loading } from './Message';
import type { ChildPlayer } from './ChildHome';
import { errMsg } from '../lib/coach';

interface Match { id: string; team: string; played_on: string; opponent: string | null; goals_for: number | null; goals_against: number | null }
type Filter = 'upcoming' | 'past';

const fmtDate = (iso: string) => iso.split('-').reverse().join('.');
const today = () => new Date().toLocaleDateString('en-CA');

// Матчи группы ребёнка: предстоящие и результаты, с его участием и голами.
export default function ChildMatches({ player }: { player: ChildPlayer }) {
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [parts, setParts] = useState<Map<string, Part>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useNavState<Filter>('cm.filter', 'upcoming', { persist: { kind: 'enum', values: ['upcoming', 'past'] } });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    void (async () => {
      const mp = await supabase.from('match_players').select('match_id, played, goals, best, performance_rating').eq('player_id', player.id);
      if (mp.error) return setError(errMsg(mp.error));
      const map = new Map<string, Part>();
      for (const r of (mp.data ?? []) as { match_id: string; played: boolean; goals: number; best?: boolean; performance_rating?: number | null }[]) map.set(r.match_id, { played: r.played, goals: r.goals, best: r.best, rating: r.performance_rating });
      setParts(map);
      const q = supabase.from('matches').select('id, team, played_on, opponent, goals_for, goals_against').order('played_on', { ascending: false }).limit(100);
      const m = await (player.group ? q.eq('team', player.group) : q.in('id', [...map.keys()]));
      if (m.error) return setError(errMsg(m.error));
      setMatches((m.data ?? []) as Match[]);
    })();
  }, [player.id, player.group, reload]);

  if (error) return <Failure title="Не удалось загрузить матчи" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} />;
  if (!matches) return <Loading />;

  const t = today();
  const upcoming = matches.filter(m => m.played_on >= t && m.goals_for === null).reverse();
  const past = matches.filter(m => m.goals_for !== null && m.goals_against !== null);
  const firstOn = firstRecordDate(matches.filter(m => parts.has(m.id)).map(m => m.played_on));
  const mine = (m: Match) => { const r = parts.get(m.id); return [{ status: participation(r, m.played_on, firstOn), goals: r?.goals, best: r?.best, rating: r?.rating }]; };
  return (
    <main className="page">
      <h1>Матчи</h1>
      <Segmented label="Фильтр матчей" value={filter} onChange={setFilter} items={[{ value: 'upcoming', label: 'Предстоящие' }, { value: 'past', label: 'Результаты' }]} />
      {filter === 'upcoming' &&
        (upcoming.length ? (
          upcoming.map(m => <ListRow key={m.id} title={m.opponent ?? 'Соперник уточняется'} sub={[fmtDate(m.played_on)]} end={<Pill tone="primary">Предстоит</Pill>} />)
        ) : (
          <EmptyState icon="trophy" title="Нет ближайших матчей" text="Когда матч появится в расписании группы, он будет здесь." />
        ))}
      {filter === 'past' &&
        (past.length ? (
          past.map(m => <MatchResultRow key={m.id} title={m.opponent ?? 'Матч'} meta={fmtDate(m.played_on)} gf={m.goals_for} ga={m.goals_against} kids={mine(m)} />)
        ) : (
          <EmptyState icon="trophy" title="Нет результатов" text="Сыгранных матчей пока нет." />
        ))}
    </main>
  );
}
