import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { EmptyState, ListRow, Pill, Segmented, type Tone } from '../ui/components';
import Message, { Loading } from './Message';

interface Match { id: string; team: string; played_on: string; opponent: string | null; goals_for: number | null; goals_against: number | null }
type Filter = 'all' | 'upcoming' | 'past';

const fmtDate = (iso: string) => iso.split('-').reverse().join('.');
const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD по местному времени телефона

const isResult = (m: Match) => m.goals_for !== null && m.goals_against !== null;
const outcome = (m: Match): { tone: Tone; text: string } => {
  const d = (m.goals_for ?? 0) - (m.goals_against ?? 0);
  return d > 0 ? { tone: 'success', text: 'Победа' } : d < 0 ? { tone: 'danger', text: 'Поражение' } : { tone: 'neutral', text: 'Ничья' };
};

// Матчи групп, в которых играют дети текущего пользователя: ближайшие и сыгранные.
export default function Matches() {
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [multi, setMulti] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    void (async () => {
      const me = (await supabase.auth.getUser()).data.user?.id;
      if (!me) return setError('Нет сессии');
      const links = await supabase.from('player_guardians').select('players(groups(name))').eq('user_id', me).is('consent_revoked_at', null);
      if (links.error) return setError(links.error.message);
      const names = [...new Set(((links.data ?? []) as any[]).map(l => l.players?.groups?.name as string | undefined).filter((n): n is string => Boolean(n)))];
      setMulti(names.length > 1);
      if (!names.length) return setMatches([]);
      const m = await supabase.from('matches').select('id, team, played_on, opponent, goals_for, goals_against').in('team', names).order('played_on', { ascending: false }).limit(100);
      if (m.error) return setError(m.error.message);
      setMatches((m.data ?? []) as Match[]);
    })();
  }, []);

  if (error) return <Message title="Не удалось загрузить матчи" text={error} />;
  if (!matches) return <Loading />;
  if (!matches.length) return <Message title="Матчи" text="Матчи появятся, когда администратор подтвердит связь с ребёнком и в группе будут матчи." />;

  const t = today();
  const upcoming = matches.filter(m => m.played_on >= t && m.goals_for === null).reverse();
  const past = matches.filter(isResult);
  const showUpcoming = filter !== 'past';
  const showPast = filter !== 'upcoming';
  const sub = (m: Match) => [fmtDate(m.played_on), ...(multi ? [m.team] : [])].join(' · ');

  return (
    <main className="page">
      <h1>Матчи</h1>
      <Segmented
        label="Фильтр матчей"
        value={filter}
        onChange={setFilter}
        items={[
          { value: 'all', label: 'Все' },
          { value: 'upcoming', label: 'Предстоящие' },
          { value: 'past', label: 'Прошедшие' },
        ]}
      />

      {showUpcoming && (
        <>
          {filter === 'all' && upcoming.length > 0 && <h3>Ближайшие</h3>}
          {upcoming.map(m => (
            <ListRow key={m.id} title={m.opponent ?? 'Соперник уточняется'} sub={[sub(m)]} end={<Pill tone="primary">Предстоит</Pill>} />
          ))}
          {filter === 'upcoming' && upcoming.length === 0 && <EmptyState icon="trophy" title="Нет ближайших матчей" text="Когда матч появится в расписании группы, он будет здесь." />}
        </>
      )}

      {showPast && (
        <>
          {filter === 'all' && past.length > 0 && <h3>Результаты</h3>}
          {past.map(m => {
            const o = outcome(m);
            return (
              <ListRow
                key={m.id}
                title={m.opponent ?? 'Матч'}
                sub={[sub(m)]}
                end={
                  <>
                    <span className="ks-score">
                      {m.goals_for}:{m.goals_against}
                    </span>
                    <Pill tone={o.tone}>{o.text}</Pill>
                  </>
                }
              />
            );
          })}
          {filter === 'past' && past.length === 0 && <EmptyState icon="trophy" title="Нет результатов" text="Сыгранных матчей пока нет." />}
        </>
      )}

      {filter === 'all' && upcoming.length === 0 && past.length === 0 && <EmptyState icon="trophy" title="Матчей пока нет" text="Ближайшие матчи и результаты появятся здесь." />}
    </main>
  );
}
