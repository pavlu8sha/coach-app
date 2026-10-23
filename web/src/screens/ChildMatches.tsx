import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { EmptyState, ListRow, Pill, Segmented, type Tone } from '../ui/components';
import { Failure, Loading } from './Message';
import type { ChildPlayer } from './ChildHome';

interface Match { id: string; team: string; played_on: string; opponent: string | null; goals_for: number | null; goals_against: number | null }
interface Part { played: boolean; goals: number }
type Filter = 'upcoming' | 'past';

const fmtDate = (iso: string) => iso.split('-').reverse().join('.');
const today = () => new Date().toLocaleDateString('en-CA');
const outcome = (m: Match): { tone: Tone; text: string } => {
  const d = (m.goals_for ?? 0) - (m.goals_against ?? 0);
  return d > 0 ? { tone: 'success', text: 'Победа' } : d < 0 ? { tone: 'danger', text: 'Поражение' } : { tone: 'neutral', text: 'Ничья' };
};

// Матчи группы ребёнка: предстоящие и результаты, с его участием и голами.
export default function ChildMatches({ player }: { player: ChildPlayer }) {
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [parts, setParts] = useState<Map<string, Part>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('upcoming');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    void (async () => {
      const mp = await supabase.from('match_players').select('match_id, played, goals').eq('player_id', player.id);
      if (mp.error) return setError(mp.error.message);
      const map = new Map<string, Part>();
      for (const r of (mp.data ?? []) as { match_id: string; played: boolean; goals: number }[]) map.set(r.match_id, { played: r.played, goals: r.goals });
      setParts(map);
      const q = supabase.from('matches').select('id, team, played_on, opponent, goals_for, goals_against').order('played_on', { ascending: false }).limit(100);
      const m = await (player.group ? q.eq('team', player.group) : q.in('id', [...map.keys()]));
      if (m.error) return setError(m.error.message);
      setMatches((m.data ?? []) as Match[]);
    })();
  }, [player.id, player.group, reload]);

  if (error) return <Failure title="Не удалось загрузить матчи" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} />;
  if (!matches) return <Loading />;

  const t = today();
  const upcoming = matches.filter(m => m.played_on >= t && m.goals_for === null).reverse();
  const past = matches.filter(m => m.goals_for !== null && m.goals_against !== null);
  const mine = (m: Match) => {
    const r = parts.get(m.id);
    return r?.played ? [`ты играл${r.goals > 0 ? `, голов: ${r.goals}` : ''}`] : [];
  };
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
          past.map(m => {
            const o = outcome(m);
            return (
              <ListRow
                key={m.id}
                title={m.opponent ?? 'Матч'}
                sub={[fmtDate(m.played_on), ...mine(m)]}
                end={
                  <>
                    <span className="ks-score">{m.goals_for}:{m.goals_against}</span>
                    <Pill tone={o.tone}>{o.text}</Pill>
                  </>
                }
              />
            );
          })
        ) : (
          <EmptyState icon="trophy" title="Нет результатов" text="Сыгранных матчей пока нет." />
        ))}
    </main>
  );
}
