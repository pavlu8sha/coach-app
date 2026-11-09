import { useEffect, useState } from 'react';
import { groupInOrder } from '../lib/coach';
import { useNavState } from '../nav';
import { supabase } from '../lib/supabase';
import { MATCH_DURATION_KEY, matchDurationFor, type ScopedValues, type SettingValues } from '../lib/clubSettings';
import { teamResults } from '../lib/teamResults';
import { EmptyState, ListRow, Pill, Segmented, type Tone } from '../ui/components';
import { type MyRsvp } from '../lib/matchRsvp';
import Message, { Failure, Loading } from './Message';
import RsvpSection from './MatchRsvp';

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
// матч без турнира считается товарищеским (так же в статистике: миграция 0060)
const tourLabel = (t: Tour | undefined) => (t && (t.match_kind === FRIENDLY || (!t.tournament_name && !t.tournament_kind)) ? 'Товарищеские' : t?.tournament_name ?? (t?.tournament_kind ? KIND_LABEL[t.tournament_kind] ?? null : null));

const matchWord = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'матч' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'матча' : 'матчей');
const fmtDate = (iso: string) => iso.split('-').reverse().join('.');
const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD по местному времени телефона

const isResult = (m: Match) => m.goals_for !== null && m.goals_against !== null;
const outcome = (m: Match): { tone: Tone; text: string } => {
  const d = (m.goals_for ?? 0) - (m.goals_against ?? 0);
  return d > 0 ? { tone: 'success', text: 'Победа' } : d < 0 ? { tone: 'danger', text: 'Поражение' } : { tone: 'neutral', text: 'Ничья' };
};

// Матчи групп, в которых играют дети текущего пользователя: ближайшие и сыгранные.
export default function Matches() {
  const [matches0, setMatches] = useState<Match[] | null>(null);
  const [multi, setMulti] = useState(false);
  const [noGroups, setNoGroups] = useState(false);
  const [kids, setKids] = useState<Kid[]>([]);
  const [parts, setParts] = useState<Map<string, Part>>(new Map()); // «матч|ребёнок» → участие
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useNavState<Filter>('pm.filter', 'all', { persist: { kind: 'enum', values: ['all', 'upcoming', 'past'] } });
  const [tours, setTours] = useState<Map<string, string>>(new Map()); // матч → подпись турнира
  const [myTours, setMyTours] = useState<MyTour[]>([]); // турниры ребёнка, в том числе без матчей
  const [tour, setTour] = useNavState('pm.tour', ''); // название турнира на диск не пишем
  const [reload, setReload] = useState(0);
  const [rsvp, setRsvp] = useState<MyRsvp[]>([]); // матчи с подтверждением участия (миграция 0134); без неё список пуст
  const [rsvpScored, setRsvpScored] = useState<Set<string>>(new Set()); // матчи с подтверждением, у которых внесён счёт
  const [durations, setDurations] = useState<{ values: SettingValues; scoped: ScopedValues }>({ values: {}, scoped: {} }); // длительность матча из настроек клуба (0168)

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
      const rs = await supabase.rpc('match_rsvp_my_matches');
      const rsRows = rs.error ? [] : ((rs.data ?? []) as MyRsvp[]);
      setRsvp(rsRows);
      // счёт прошедших матчей с подтверждением: без него статус «Прошёл» не определить
      const rsIds = [...new Set(rsRows.map(r => r.match_id))];
      const sc = rsIds.length ? await supabase.from('matches').select('id, goals_for').in('id', rsIds) : null;
      // длительность матча по командам; без миграции 0168 или при ошибке действует 90 минут
      const du = rsIds.length ? await supabase.rpc('match_duration_minutes') : null;
      const dv: SettingValues = {};
      const dt: Record<string, string> = {};
      for (const x of ((du && !du.error ? du.data : null) ?? []) as { team: string | null; value: string | null }[]) {
        if ((x.team ?? '') === '') dv[MATCH_DURATION_KEY] = x.value ?? '';
        else dt[x.team as string] = x.value ?? '';
      }
      setDurations({ values: dv, scoped: { [MATCH_DURATION_KEY]: dt } });
      setRsvpScored(new Set(((sc?.data ?? []) as { id: string; goals_for: number | null }[]).filter(x => x.goals_for !== null).map(x => x.id)));
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
  if (!matches0) return <Loading title="Матчи" card rows={3} />;
  let matches = matches0;
  if (noGroups) return <main className="page"><h1>Матчи</h1><EmptyState icon="box" title="Пока пусто" text="Матчи появятся, когда администратор подтвердит связь с ребёнком." /></main>;

  const t = today();
  // матчи с подтверждением показываются карточками ниже и в общем списке не дублируются
  const rsvpIds = new Set(rsvp.map(r => r.match_id));
  matches = matches.filter(m => !rsvpIds.has(m.id));
  const hasRsvpUpcoming = rsvp.some(r => r.lifecycle_status === 'published' && new Date(r.starts_at).getTime() > Date.now());
  const hasRsvpPast = rsvp.length > 0 && rsvp.some(r => !(r.lifecycle_status === 'published' && new Date(r.starts_at).getTime() > Date.now()));
  const upcoming = matches.filter(m => m.played_on >= t && m.goals_for === null).reverse();
  // сыгранные: со счётом, а также прошедшие без счёта (например, товарищеские без результата): их тоже показываем, но в итоги команды они не входят
  const finished = (m: Match) => isResult(m) || m.played_on < t;
  const tourNames = [...new Set(matches.filter(finished).map(m => tours.get(m.id)).filter((n): n is string => Boolean(n)))].sort();
  const played = matches.filter(finished).filter(m => !tour || tours.get(m.id) === tour);
  const past = played.filter(isResult);
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
        <select aria-label="Турнир" className="ks-select" value={tour} onChange={e => setTour(e.target.value)}>
          <option value="">Все турниры</option>
          {tourNames.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      )}

      {eventCards.length > 0 && (
        <>
          <h2 className="ks-sub">Турниры</h2>
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
          <RsvpSection rows={rsvp} part="upcoming" onChanged={() => setReload(n => n + 1)} />
          {filter === 'all' && upcoming.length > 0 && <h2 className="ks-sub">Ближайшие</h2>}
          {upcoming.map(m => (
            <ListRow key={m.id} title={m.opponent ?? 'Соперник уточняется'} sub={[sub(m), ...lines(m)]} end={<Pill tone="primary">Предстоит</Pill>} />
          ))}
          {filter === 'upcoming' && upcoming.length === 0 && !hasRsvpUpcoming && <EmptyState icon="trophy" title="Нет ближайших матчей" text="Когда матч появится в расписании группы, он будет здесь." />}
        </>
      )}

      {showPast && (
        <>
          <RsvpSection rows={rsvp} part="past" withResult={rsvpScored} durationMin={team => matchDurationFor(durations.values, durations.scoped, team)} onChanged={() => setReload(n => n + 1)} />
          {filter === 'all' && played.length > 0 && <h2 className="ks-sub">Результаты</h2>}
          {groupInOrder(played, m => m.played_on.slice(0, 7)).map(([ym, items]) => (
            <details className="ks-group" key={ym}>
              <summary><div className="ks-line"><b>{ym.slice(5)}.{ym.slice(0, 4)}</b><span className="muted">{items.length} {matchWord(items.length)}</span></div></summary>
              {items.map(m => {
                if (!isResult(m)) {
                  const friendly = tours.get(m.id) === 'Товарищеские';
                  return <ListRow key={m.id} title={m.opponent ?? (friendly ? 'Товарищеская игра' : 'Матч')} sub={[sub(m), ...lines(m)]} end={<Pill>Без счёта</Pill>} />;
                }
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
          {filter === 'past' && played.length === 0 && !hasRsvpPast && <EmptyState icon="trophy" title="Нет результатов" text="Сыгранных матчей пока нет." />}
        </>
      )}

      {filter === 'all' && upcoming.length === 0 && played.length === 0 && eventCards.length === 0 && !rsvp.length && <EmptyState icon="trophy" title="Матчей пока нет" text="Ближайшие матчи и результаты появятся здесь." />}
    </main>
  );
}
