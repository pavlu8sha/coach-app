import { useEffect, useState } from 'react';
import { groupInOrder } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { teamResults } from '../lib/teamResults';
import { EmptyState, ListRow, Pill, Segmented, type Tone } from '../ui/components';
import Message, { Failure, Loading } from './Message';

interface Kid { id: string; name: string }
interface Part { played: boolean; goals: number }
interface Match { id: string; team: string; played_on: string; opponent: string | null; goals_for: number | null; goals_against: number | null }
// Команда матча совпадает с группой по названию или по названию без суффикса -A/-B/-C («U10-A» → «U10»); то же правило в can_see_team (миграция 0048)
export function teamNames(groupNames: string[]): string[] {
  return [...new Set(groupNames.flatMap(n => [n, n.replace(/-[ABC]$/, '')]))];
}
type Filter = 'all' | 'upcoming' | 'past';
interface Tour { match_id: string; tournament_name: string | null; tournament_kind: string | null; match_kind: string | null }
interface MyTour { id: string; team: string; kind: string; name: string | null; starts_on: string | null; games: number }
const FORM: Record<'w' | 'd' | 'l', { letter: string; name: string; tone: Tone }> = { w: { letter: 'В', name: 'Победа', tone: 'success' }, d: { letter: 'Н', name: 'Ничья', tone: 'neutral' }, l: { letter: 'П', name: 'Поражение', tone: 'danger' } };
const KIND_LABEL: Record<string, string> = { championship: 'Чемпионат', festival: 'Фестиваль', cup: 'Кубок' };
const FRIENDLY = 'friendly';
// подпись турнира для фильтра: название, иначе тип; товарищеские — отдельным пунктом
const tourLabel = (t: Tour | undefined) => (t?.match_kind === FRIENDLY ? 'Товарищеские' : t?.tournament_name ?? (t?.tournament_kind ? KIND_LABEL[t.tournament_kind] ?? null : null));

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
  const [tours, setTours] = useState<Map<string, string>>(new Map()); // матч → подпись турнира
  const [myTours, setMyTours] = useState<MyTour[]>([]); // турниры ребёнка, в том числе без матчей
  const [tour, setTour] = useState('');
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
      const m = await supabase.from('matches').select('id, team, played_on, opponent, goals_for, goals_against').in('team', teamNames(names)).order('played_on', { ascending: false }).limit(100);
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
      // турнир нужен только для фильтра: при ошибке просто не показываем фильтр
      const tr = await supabase.rpc('match_tournaments');
      const tm = new Map<string, string>();
      for (const t of (tr.data ?? []) as Tour[]) { const l = tourLabel(t); if (l) tm.set(t.match_id, l); }
      setTours(tm);
      // турниры ребёнка без матчей: в источнике могут быть только состав и взносы
      const mt = await supabase.rpc('my_tournaments');
      setMyTours(((mt.data ?? []) as MyTour[]).filter(t => t.games === 0));
      setMatches(rows);
    })();
  }, [reload]);

  if (error) return <Failure title="Не удалось загрузить матчи" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} />;
  if (!matches) return <Loading />;
  if (noGroups) return <Message title="Матчи" text="Матчи появятся, когда администратор подтвердит связь с ребёнком." />;

  const t = today();
  const upcoming = matches.filter(m => m.played_on >= t && m.goals_for === null).reverse();
  const tourNames = [...new Set(matches.filter(isResult).map(m => tours.get(m.id)).filter((n): n is string => Boolean(n)))].sort();
  const past = matches.filter(isResult).filter(m => !tour || tours.get(m.id) === tour);
  const res = teamResults(past.map(m => ({ played_on: m.played_on, opponent: m.opponent, goals_for: m.goals_for ?? 0, goals_against: m.goals_against ?? 0 })));
  const showUpcoming = filter !== 'past';
  const showPast = filter !== 'upcoming';
  const eventCards = myTours.filter(e => filter === 'upcoming' ? (e.starts_on ?? '') >= t : filter === 'past' ? (!e.starts_on || e.starts_on < t) : true);
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

      {tourNames.length > 0 && filter !== 'upcoming' && (
        <select aria-label="Турнир" value={tour} onChange={e => setTour(e.target.value)} style={{ margin: '10px 0' }}>
          <option value="">Все турниры</option>
          {tourNames.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      )}

      {eventCards.length > 0 && (
        <>
          <h3>Турниры</h3>
          {eventCards.map(e => (
            <ListRow key={e.id} title={e.name ?? KIND_LABEL[e.kind] ?? 'Турнир'} sub={[e.starts_on ? fmtDate(e.starts_on) : '', e.team, 'Матчей пока нет'].filter(Boolean)} end={<Pill tone="primary">Турнир</Pill>} />
          ))}
        </>
      )}

      {filter !== 'upcoming' && res.games > 0 && (
        <div className="ks-card" aria-label="Итоги команды">
          <div className="ks-line"><span>Сыграно: {res.games}</span><span className="ks-muted">Побед {res.wins} · Ничьих {res.draws} · Поражений {res.losses}</span></div>
          <div className="ks-line">
            <span className="ks-muted">Последние матчи</span>
            <span role="list" aria-label="Последние матчи" style={{ display: 'inline-flex', gap: 4 }}>
              {res.form.map((k, i) => <span role="listitem" key={i} aria-label={FORM[k].name}><Pill tone={FORM[k].tone}>{FORM[k].letter}</Pill></span>)}
            </span>
          </div>
          <div className="ks-line"><span className="ks-muted">Мячи: {res.goalsFor}:{res.goalsAgainst}</span>{res.unbeaten > 1 && <span className="ks-muted">Без поражений: {res.unbeaten}</span>}</div>
          {res.best && <div className="ks-line"><span className="ks-muted">Лучший матч: {res.best.opponent ?? 'Матч'}</span><span className="ks-score">{res.best.goals_for}:{res.best.goals_against}</span></div>}
        </div>
      )}

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
          {groupInOrder(past, m => m.played_on.slice(0, 7)).map(([ym, items], i) => (
            <details className="ks-group" key={ym} open={i === 0}>
              <summary><div className="ks-line"><b>{ym.slice(5)}.{ym.slice(0, 4)}</b><span className="muted">{items.length} матч.</span></div></summary>
              {items.map(m => {
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
            </details>
          ))}
          {filter === 'past' && past.length === 0 && <EmptyState icon="trophy" title="Нет результатов" text="Сыгранных матчей пока нет." />}
        </>
      )}

      {filter === 'all' && upcoming.length === 0 && past.length === 0 && eventCards.length === 0 && <EmptyState icon="trophy" title="Матчей пока нет" text="Ближайшие матчи и результаты появятся здесь." />}
    </main>
  );
}
