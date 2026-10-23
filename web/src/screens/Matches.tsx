import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { EmptyState, ListRow, Pill, Segmented, type Tone } from '../ui/components';
import Message, { Failure, Loading } from './Message';

interface Kid { id: string; name: string }
interface Part { played: boolean; goals: number }
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
  const [noGroups, setNoGroups] = useState(false);
  const [kids, setKids] = useState<Kid[]>([]);
  const [parts, setParts] = useState<Map<string, Part>>(new Map()); // «матч|ребёнок» → участие
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    void (async () => {
      const me = (await supabase.auth.getUser()).data.user?.id;
      if (!me) return setError('Нет сессии');
      const links = await supabase.from('player_guardians').select('players(id, full_name, groups(name))').eq('user_id', me).is('consent_revoked_at', null);
      if (links.error) return setError(links.error.message);
      const ps = ((links.data ?? []) as any[]).map(l => l.players).filter(Boolean);
      const names = [...new Set(ps.map(p => p.groups?.name as string | undefined).filter((n): n is string => Boolean(n)))];
      const myKids = ps.map(p => ({ id: p.id as string, name: (p.full_name ?? '') as string }));
      setKids(myKids);
      setMulti(names.length > 1);
      setNoGroups(!names.length);
      if (!names.length) return setMatches([]);
      // участие своих детей: база отдаёт родителю только записи его ребёнка (без чужих голов)
      const mp = await supabase.from('match_players').select('match_id, player_id, played, goals').in('player_id', myKids.map(k => k.id));
      if (mp.error) return setError(mp.error.message);
      const map = new Map<string, Part>();
      for (const r of (mp.data ?? []) as { match_id: string; player_id: string; played: boolean; goals: number }[]) map.set(`${r.match_id}|${r.player_id}`, { played: r.played, goals: r.goals });
      setParts(map);
      const m = await supabase.from('matches').select('id, team, played_on, opponent, goals_for, goals_against').in('team', names).order('played_on', { ascending: false }).limit(100);
      if (m.error) return setError(m.error.message);
      const rows = (m.data ?? []) as Match[];
      // матчи другой команды, в которых играл ребёнок (например, гостем)
      const extraIds = [...new Set([...map.entries()].filter(([, v]) => v.played).map(([k]) => k.split('|')[0]))].filter(id => !rows.some(r => r.id === id));
      if (extraIds.length) {
        const ex = await supabase.from('matches').select('id, team, played_on, opponent, goals_for, goals_against').in('id', extraIds);
        if (ex.error) return setError(ex.error.message);
        rows.push(...((ex.data ?? []) as Match[]));
        rows.sort((a, b) => (a.played_on < b.played_on ? 1 : -1));
      }
      setMatches(rows);
    })();
  }, [reload]);

  if (error) return <Failure title="Не удалось загрузить матчи" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} />;
  if (!matches) return <Loading />;
  if (noGroups) return <Message title="Матчи" text="Матчи появятся, когда администратор подтвердит связь с ребёнком." />;

  const t = today();
  const upcoming = matches.filter(m => m.played_on >= t && m.goals_for === null).reverse();
  const past = matches.filter(isResult);
  const showUpcoming = filter !== 'past';
  const showPast = filter !== 'upcoming';
  const sub = (m: Match) => [fmtDate(m.played_on), ...(multi ? [m.team] : [])].join(' · ');
  // «играл, голов: N» показываем только там, где запись об участии есть; отсутствие записи не значит «не играл»
  const kidShort = (n: string) => n.split(/\s+/)[1] ?? n;
  const lines = (m: Match) =>
    kids.flatMap(k => {
      const r = parts.get(`${m.id}|${k.id}`);
      return r?.played ? [`${kids.length > 1 ? kidShort(k.name) + ': ' : ''}играл${r.goals > 0 ? `, голов: ${r.goals}` : ''}`] : [];
    });

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
            <ListRow key={m.id} title={m.opponent ?? 'Соперник уточняется'} sub={[sub(m), ...lines(m)]} end={<Pill tone="primary">Предстоит</Pill>} />
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
                sub={[sub(m), ...lines(m)]}
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
