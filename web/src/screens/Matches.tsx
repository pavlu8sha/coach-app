import { useEffect, useState } from 'react';
import { groupInOrder, errMsg } from '../lib/coach';
import { useNavState } from '../nav';
import { loadMyChildren } from '../lib/myChildren';
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
type ScoreCheck = 'loading' | 'success' | 'error';
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
  const [ungrouped, setUngrouped] = useState<string[]>([]); // привязанные дети без группы (#733): состояние отличается от «нет привязанных детей»
  const [kids, setKids] = useState<Kid[]>([]);
  const [parts, setParts] = useState<Map<string, Part>>(new Map()); // «матч|ребёнок» → участие
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useNavState<Filter>('pm.filter', 'all', { persist: { kind: 'enum', values: ['all', 'upcoming', 'past'] } });
  const [tours, setTours] = useState<Map<string, string>>(new Map()); // матч → подпись турнира
  const [myTours, setMyTours] = useState<MyTour[]>([]); // турниры ребёнка, в том числе без матчей
  const [tour, setTour] = useNavState('pm.tour', ''); // название турнира на диск не пишем
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(false); // идёт загрузка: «Повторить» на это время отключена
  const [rsvpFailed, setRsvpFailed] = useState(false); // загрузка подтверждений не удалась (#737): это не «подтверждений нет»
  const [rsvp, setRsvp] = useState<MyRsvp[]>([]); // матчи с подтверждением участия (миграция 0134); без неё список пуст
  const [scoreCheck, setScoreCheck] = useState<ScoreCheck>('loading'); // проверка счёта матчей с подтверждением: до успеха «счёта нет» неизвестно (#770, #804)
  const [rsvpScored, setRsvpScored] = useState<Set<string>>(new Set()); // матчи с подтверждением, у которых внесён счёт
  const [durations, setDurations] = useState<{ values: SettingValues; scoped: ScopedValues }>({ values: {}, scoped: {} }); // длительность матча из настроек клуба (0168)

  useEffect(() => {
    // устаревший ответ (перекрывающиеся перезагрузки, #737) не применяется: после каждого ожидания проверяем, что эта загрузка последняя
    let cancelled = false;
    setLoading(true);
    // после ошибки оставляем error: блок с повтором остаётся видимым и на время новой проверки; при обычной перезагрузке счёт снова неизвестен
    setScoreCheck(s => s === 'error' ? 'error' : 'loading');
    const load = async () => {
      const me = (await supabase.auth.getUser()).data.user?.id;
      if (cancelled) return;
      if (!me) return setError('Нет сессии');
      const links = await loadMyChildren();
      if (cancelled) return;
      if (links.error) return setError(errMsg(links.error));
      const ps = (links.kids ?? []).map(k => ({ id: k.player_id, full_name: k.full_name, groups: k.group_name ? { name: k.group_name } : null }));
      const names = [...new Set(ps.map(p => p.groups?.name as string | undefined).filter((n): n is string => Boolean(n)))];
      const myKids = ps.map(p => ({ id: p.id as string, name: (p.full_name ?? '') as string }));
      setKids(myKids);
      setMulti(names.length > 1);
      setNoGroups(!names.length);
      setUngrouped(ps.filter(p => !p.groups?.name).map(p => (p.full_name ?? '') as string).filter(Boolean));
      if (!names.length) return setMatches([]);
      // участие своих детей: база отдаёт родителю только записи его ребёнка (без чужих голов)
      const mp = await supabase.from('match_players').select('match_id, player_id, played, goals').in('player_id', myKids.map(k => k.id));
      if (cancelled) return;
      if (mp.error) return setError(errMsg(mp.error));
      const map = new Map<string, Part>();
      for (const r of (mp.data ?? []) as { match_id: string; player_id: string; played: boolean; goals: number }[]) map.set(`${r.match_id}|${r.player_id}`, { played: r.played, goals: r.goals });
      setParts(map);
      const rs = await supabase.rpc('match_rsvp_my_matches');
      if (cancelled) return;
      setRsvpFailed(Boolean(rs.error)); // ошибку не выдаём за пустой список: ниже показывается блок с повтором
      const rsRows = rs.error ? [] : ((rs.data ?? []) as MyRsvp[]);
      setRsvp(rsRows);
      // счёт прошедших матчей с подтверждением: без него статус «Прошёл» не определить
      const rsIds = [...new Set(rsRows.map(r => r.match_id))];
      // сбой сети (отклонённый запрос) тоже ошибка проверки счёта, а не «счёта нет»
      let sc: { error?: unknown; data?: unknown } | null = null;
      if (rsIds.length) {
        try {
          sc = await supabase.from('matches').select('id, goals_for, goals_against').in('id', rsIds);
        } catch (e) {
          console.error('Matches.score', e);
          sc = { error: e, data: null };
        }
      }
      if (cancelled) return;
      // длительность матча по командам; без миграции 0168 или при ошибке действует 90 минут
      const du = rsIds.length ? await supabase.rpc('match_duration_minutes') : null;
      if (cancelled) return;
      const dv: SettingValues = {};
      const dt: Record<string, string> = {};
      for (const x of ((du && !du.error ? du.data : null) ?? []) as { team: string | null; value: string | null }[]) {
        if ((x.team ?? '') === '') dv[MATCH_DURATION_KEY] = x.value ?? '';
        else dt[x.team as string] = x.value ?? '';
      }
      setDurations({ values: dv, scoped: { [MATCH_DURATION_KEY]: dt } });
      // ошибка или некорректный ответ проверки счёта не равны «счёта нет»: матчи с неизвестным счётом ниже скрываются, показывается блок с повтором
      const scoreBad = Boolean(sc && (sc.error || !Array.isArray(sc.data)));
      setRsvpScored(new Set(scoreBad ? [] : ((sc?.data ?? []) as { id: string; goals_for: number | null; goals_against: number | null }[]).filter(x => x.goals_for !== null && x.goals_against !== null).map(x => x.id)));
      setScoreCheck(scoreBad ? 'error' : 'success');
      const m = await supabase.from('matches').select('id, team, played_on, opponent, goals_for, goals_against').in('team', teamNames(names)).order('played_on', { ascending: false }).limit(100);
      if (cancelled) return;
      if (m.error) return setError(errMsg(m.error));
      const rows = (m.data ?? []) as Match[];
      // матчи другой команды, в которых играл ребёнок (например, гостем)
      const extraIds = [...new Set([...map.entries()].filter(([, v]) => v.played).map(([k]) => k.split('|')[0]))].filter(id => !rows.some(r => r.id === id));
      if (extraIds.length) {
        const ex = await supabase.from('matches').select('id, team, played_on, opponent, goals_for, goals_against').in('id', extraIds);
        if (cancelled) return;
        if (ex.error) return setError(errMsg(ex.error));
        rows.push(...((ex.data ?? []) as Match[]));
        rows.sort((a, b) => (a.played_on < b.played_on ? 1 : -1));
      }
      // турнир нужен только для фильтра: при ошибке просто не показываем фильтр
      const tr = await supabase.rpc('match_tournaments');
      if (cancelled) return;
      const tm = new Map<string, string>();
      for (const t of (tr.data ?? []) as Tour[]) { const l = tourLabel(t); if (l) tm.set(t.match_id, l); }
      setTours(tm);
      // турниры ребёнка без матчей: в источнике могут быть только состав и взносы
      const mt = await supabase.rpc('my_tournaments');
      if (cancelled) return;
      setMyTours(((mt.data ?? []) as MyTour[]).filter(t => t.games === 0));
      setMatches(rows);
    };
    void load().finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reload]);

  if (error) return <Failure title="Не удалось загрузить матчи" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} />;
  if (!matches0) return <Loading title="Матчи" card rows={3} />;
  let matches = matches0;
  const nameList = ungrouped.join(', ');
  if (noGroups && ungrouped.length) {
    // ребёнок привязан, но группу ему ещё не назначили: это не «связь не подтверждена»
    return <main className="page"><h1>Матчи</h1><EmptyState icon="trophy" title="Группа ещё не назначена" text={`Матчи появятся, когда администратор клуба назначит группу: ${nameList}.`} /></main>;
  }
  if (noGroups) return <main className="page"><h1>Матчи</h1><EmptyState icon="box" title="Пока пусто" text="Матчи появятся, когда администратор подтвердит связь с ребёнком." /></main>;

  const t = today();
  // матчи с подтверждением показываются карточками ниже и в общем списке не дублируются
  // со счётом матч переходит в «Результаты» и в итоги команды; отменённый остаётся карточкой
  // пока проверка счёта не завершилась успешно (идёт или ошибка), начавшиеся неотменённые матчи с подтверждением не показываем ни карточкой «результат не внесён», ни в общем списке: счёт неизвестен
  const isUpcomingRsvp = (r: MyRsvp) => r.lifecycle_status === 'published' && new Date(r.starts_at).getTime() > Date.now();
  const scoreUnknown = (r: MyRsvp) => scoreCheck !== 'success' && r.lifecycle_status !== 'cancelled' && !isUpcomingRsvp(r);
  const rsvpShown = rsvp.filter(r => !scoreUnknown(r));
  const rsvpIds = new Set(rsvp.filter(r => r.lifecycle_status === 'cancelled' || !rsvpScored.has(r.match_id)).map(r => r.match_id));
  matches = matches.filter(m => !rsvpIds.has(m.id));
  const hasRsvpUpcoming = rsvpShown.some(isUpcomingRsvp);
  const hasRsvpPast = rsvpShown.some(r => !isUpcomingRsvp(r) && (r.lifecycle_status === 'cancelled' || !rsvpScored.has(r.match_id)));
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
      {ungrouped.length > 0 && (
        <p className="ks-card note" role="status">
          Группа ещё не назначена: {nameList}. Матчи появятся после назначения группы.
        </p>
      )}
      {rsvpFailed && (
        <div className="ks-card" role="alert">
          <b>Не удалось загрузить подтверждения участия</b>
          <p className="muted note">Матчи ниже показаны без запросов на подтверждение. Это не значит, что отвечать не нужно: повторите загрузку.</p>
          <button type="button" className="ks-btn secondary" disabled={loading} onClick={() => setReload(n => n + 1)}>
            {loading ? 'Загружаю…' : 'Повторить'}
          </button>
        </div>
      )}
      {scoreCheck === 'error' && (
        <div className="ks-card" role="alert">
          <b>Не удалось проверить результаты матчей</b>
          <p className="muted note">Часть прошедших матчей скрыта: пока неизвестно, внесён ли по ним счёт. Повторите загрузку.</p>
          <button type="button" className="ks-btn secondary" disabled={loading} onClick={() => setReload(n => n + 1)}>
            {loading ? 'Загружаю…' : 'Повторить'}
          </button>
        </div>
      )}
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
          <RsvpSection rows={rsvpShown} part="upcoming" onChanged={() => setReload(n => n + 1)} />
          {filter === 'all' && upcoming.length > 0 && <h2 className="ks-sub">Ближайшие</h2>}
          {upcoming.map(m => (
            <ListRow key={m.id} title={m.opponent ?? 'Соперник уточняется'} sub={[sub(m), ...lines(m)]} end={<Pill tone="primary">Предстоит</Pill>} />
          ))}
          {filter === 'upcoming' && upcoming.length === 0 && !hasRsvpUpcoming && !rsvpFailed && <EmptyState icon="trophy" title="Нет ближайших матчей" text="Когда матч появится в расписании группы, он будет здесь." />}
        </>
      )}

      {showPast && (
        <>
          <RsvpSection rows={rsvpShown} part="past" scored={rsvpScored} durationMin={team => matchDurationFor(durations.values, durations.scoped, team)} onChanged={() => setReload(n => n + 1)} />
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
          {filter === 'past' && played.length === 0 && !hasRsvpPast && !rsvpFailed && scoreCheck === 'success' && <EmptyState icon="trophy" title="Нет результатов" text="Сыгранных матчей пока нет." />}
        </>
      )}

      {filter === 'all' && upcoming.length === 0 && played.length === 0 && eventCards.length === 0 && !rsvp.length && !rsvpFailed && scoreCheck === 'success' && <EmptyState icon="trophy" title="Матчей пока нет" text="Ближайшие матчи и результаты появятся здесь." />}
    </main>
  );
}
