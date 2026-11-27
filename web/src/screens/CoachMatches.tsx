import { useEffect, useRef, useState } from 'react';
import { coachError, compareGroups, fmtDate, matchTeam, playsMatches, today, type CoachGroup, errMsg } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { useDirtySignature, useNav, useNavState } from '../nav';
import { EmptyState, ListRow, Pill } from '../ui/components';
import { PlayerSearch } from '../ui/PlayerSearch';
import { Stepper } from '../ui/coach';
import { BackNav, useMainButton } from '../ui/nav';
import EventFees from './EventFees';
import { EventForm, EventScreen, eventCounts, eventTitle, isFinished, type EventRow } from './Events';
import { Failure, Loading } from './Message';
import CoachRsvp, { RsvpDetail, type RsvpMatch } from './CoachRsvp';
import { useConfirm } from '../ui/ConfirmSheet';
import { MoreMenu } from '../ui/MoreMenu';

interface Match { id: string; club_id?: string; team: string; played_on: string; opponent: string | null; goals_for: number | null; goals_against: number | null; technical?: boolean; lifecycle_status?: string; starts_at?: string | null }
// Матч с подтверждением участия (PR 2–4 по #274): до начала им управляют «Матчи с подтверждением», здесь он появляется после начала — для отметок игроков и счёта
const isRsvp = (m: Pick<Match, 'lifecycle_status'>) => Boolean(m.lifecycle_status) && m.lifecycle_status !== 'legacy';
interface Tour { match_id: string; tournament_id: string | null; tournament_name: string | null; tournament_kind: string | null; match_kind: string | null }
interface Player { id: string; full_name: string }
interface Line { played: boolean; goals: number; rating: number | null }

// «Матчи»: матчи групп тренера (у администратора — всех команд), добавление матча, ввод результата, состава, голов и лучшего игрока.
// Тренеры видят матчи всех команд (allTeams), как и администратор; взносы и поиск чужих игроков остаются у администратора.
export default function CoachMatches({ groups, admin = false, allTeams = false }: { groups: CoachGroup[]; admin?: boolean; allTeams?: boolean }) {
  const showAll = admin || allTeams;
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  // Вложенные экраны (матч, событие, матчи с подтверждением) — записи стека раздела; список остаётся под ними
  const nav = useNav();
  const [team, setTeam] = useNavState('cm.team', '', { entry: 0 });
  const [tours, setTours] = useState<Map<string, Tour>>(new Map());
  const [events, setEvents] = useState<EventRow[]>([]);
  const [playedBy, setPlayedBy] = useState<Map<string, number>>(new Map());
  // «Добавить матч»: одно окно — события (чемпионаты, фестивали), где добавляется игра, и команды для товарищеского или кубкового матча
  const [addStep, setAddStep] = useState<'pick' | null>(null);
  // по умолчанию матч создаётся с подтверждением участия; уже сыгранный матч вводится старой формой (решение владельца 2026-11-20)
  const [played, setPlayed] = useState(false);
  const [addTeam, setAddTeam] = useNavState('cm.addTeam', '', { entry: 0 });

  useEffect(() => {
    void (async () => {
      // турниры матчей: без них (старая база, нет связи) список остаётся плоским
      const t = await supabase.rpc('match_tournaments');
      if (!t.error) setTours(new Map(((t.data ?? []) as Tour[]).map(x => [x.match_id, x])));
      // события (чемпионаты, фестивали, кубки) со счётчиками; без миграции 0051 список остаётся прежним
      const ev = await supabase.rpc('event_list');
      setEvents(ev.error ? [] : ((ev.data ?? []) as EventRow[]));
      let q = supabase.from('matches').select('id, club_id, team, played_on, opponent, goals_for, goals_against, technical, lifecycle_status, starts_at');
      if (!showAll) q = q.in('team', groups.map(g => g.name));
      const r = await q.order('played_on', { ascending: false }).limit(showAll ? 150 : 60);
      if (r.error) return setError(errMsg(r.error));
      // единый экран матча (PR 1): в общем списке матчи с подтверждением во всех состояниях, черновик и отменённый с пометкой (раньше решение владельца 2026-11-13 показывало только опубликованные)
      const list = (r.data ?? []) as Match[];
      setMatches(list);
      // сколько сыграло в каждом матче; порциями, чтобы не упереться в лимит строк; без доступа список остаётся прежним
      const ids = list.map(m => m.id);
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += 40) chunks.push(ids.slice(i, i + 40));
      const res = await Promise.all(chunks.map(c => supabase.from('match_players').select('match_id').eq('played', true).in('match_id', c).limit(2000)));
      const n = new Map<string, number>();
      for (const x of res) for (const row of (x.error ? [] : (x.data ?? [])) as { match_id: string }[]) n.set(row.match_id, (n.get(row.match_id) ?? 0) + 1);
      setPlayedBy(n);
    })();
  }, [groups, showAll, reload]);

  if (error) return <Failure title="Не удалось загрузить матчи" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} />;
  const screen = nav.top.screen;
  const topId = nav.top.params.id;
  const back = () => { nav.back(); setReload(n => n + 1); };
  if (screen.startsWith('rsvp')) return <CoachRsvp groups={groups} all={showAll} admin={admin} onBack={() => nav.back()} />;
  const openEvent = events.find(e => e.id === topId);
  // форму нового события открывает только администратор (миграция 0195); тренер ведёт состав и игры уже созданных событий
  if (screen === 'event' && (openEvent || (!topId && admin))) {
    if (openEvent) return <EventScreen event={openEvent} groups={groups} admin={admin} onBack={back} />;
    const openCreated = async (id: string) => {
      const ev = await supabase.rpc('event_list');
      const list = ev.error ? [] : ((ev.data ?? []) as EventRow[]);
      setEvents(list);
      nav.back(); // форма создания заменяется экраном созданного события
      if (list.some(e => e.id === id)) nav.push('event', { id });
      else setReload(n => n + 1);
    };
    const allTeams2 = [...new Set([...groups.map(g => g.name), ...(matches ?? []).map(m => m.team), ...events.map(e => e.team)].filter(playsMatches).map(matchTeam))].sort(compareGroups);
    return <EventForm teams={allTeams2} events={events} admin={admin} onBack={back} onCreated={id => void openCreated(id)} />;
  }
  const formMatch = screen === 'form' ? (matches ?? []).find(m => m.id === topId) ?? null : null;
  // матч с подтверждением: один экран с разделами «Состав и ответы» и «Результат»; форма результата та же, что у обычного матча
  if (screen === 'form' && formMatch && isRsvp(formMatch)) {
    const t = tours.get(formMatch.id);
    const friendly = !t?.tournament_id || t?.match_kind === 'friendly' || t?.tournament_kind === 'cup';
    return <MatchHub match={formMatch} groups={groups} admin={admin} onBack={back} renderResult={(row, active, ctl) => <MatchForm groups={groups} match={row} admin={admin} rosterOf={friendly ? null : t?.tournament_id ?? null} feeMode={friendly} embedded active={active} onDirty={ctl.onDirty} blocked={ctl.blocked} onBack={back} onSaved={() => setReload(n => n + 1)} />} />;
  }
  if (screen === 'form' && (formMatch || !topId)) return <MatchForm groups={groups} match={formMatch} admin={admin} rosterOf={formMatch && !(!tours.get(formMatch.id)?.tournament_id || tours.get(formMatch.id)?.match_kind === 'friendly' || tours.get(formMatch.id)?.tournament_kind === 'cup') ? tours.get(formMatch.id)?.tournament_id ?? null : null} feeMode={!formMatch || !tours.get(formMatch.id)?.tournament_id || tours.get(formMatch.id)?.match_kind === 'friendly' || tours.get(formMatch.id)?.tournament_kind === 'cup'} presetTeam={addTeam} onBack={back} onSaved={() => setReload(n => n + 1)} />;
  if (!matches) return <Loading title="Матчи" />;

  const teams = [...new Set(matches.map(m => m.team))].sort(compareGroups);
  const shown = team ? matches.filter(m => m.team === team) : matches;
  // чемпионаты и фестивали — по турниру (самый свежий сверху), товарищеские и кубки — одним разделом
  const evById = new Map(events.map(e => [e.id, e]));
  const sections: { key: string; title: string; items: Match[]; event?: EventRow }[] = [];
  const byTour = new Map<string, { title: string; items: Match[]; event?: EventRow }>();
  const other: Match[] = [];
  const multi = showAll || groups.length > 1;
  for (const m of shown) {
    const t = tours.get(m.id);
    const ev = t?.tournament_id ? evById.get(t.tournament_id) : undefined;
    if (t?.tournament_id && t.match_kind !== 'friendly' && (ev || t.tournament_kind !== 'cup')) {
      const g = byTour.get(t.tournament_id) ?? { title: `${t.tournament_name ?? (t.tournament_kind === 'festival' ? 'Фестиваль' : t.tournament_kind === 'cup' ? 'Кубок' : 'Чемпионат')}${multi ? ' · ' + m.team : ''}`, items: [], event: ev };
      g.items.push(m);
      byTour.set(t.tournament_id, g);
    } else other.push(m);
  }
  // события без игр тоже показываем (для своих команд), чтобы вести состав до первого матча
  for (const e of events) {
    if (byTour.has(e.id) || (team && e.team !== team) || !(showAll || groups.some(g => g.name === e.team || matchTeam(g.name) === e.team))) continue;
    byTour.set(e.id, { title: `${eventTitle(e)}${multi ? ' · ' + e.team : ''}`, items: [], event: e });
  }
  for (const [id, g] of byTour) sections.push({ key: id, ...g });
  // события, в которые можно добавить игру: только идущие, свои команды тренера (администратор и тренеры со всеми командами — все)
  const champEvents = events.filter(e => !isFinished(e) && (showAll || groups.some(g => g.name === e.team || matchTeam(g.name) === e.team)));
  // команды для «Добавить матч»: свои группы тренера; у администратора и тренера со всеми командами — все команды клуба
  const addTeams = [...new Set((showAll ? [...groups.map(g => g.name), ...matches.map(m => m.team), ...events.map(e => e.team)] : groups.map(g => g.name)).filter(playsMatches).map(matchTeam))].sort(compareGroups);
  if (other.length) sections.push({ key: 'other', title: byTour.size ? 'Товарищеские и кубки' : 'Матчи', items: other });
  // предстоящие опубликованные матчи с подтверждением: из уже загруженного списка, без нового запроса
  const upcomingRsvp = matches.filter(m => m.lifecycle_status === 'published' && m.starts_at && new Date(m.starts_at).getTime() > Date.now()).length;
  return (
    <main className="page">
      <div className="ks-head">
        <h1>Матчи</h1>
        <div className="ks-head-actions">
          <button type="button" className="ks-btn sm" onClick={() => { setPlayed(false); setAddStep('pick'); }}>+ Матч</button>
          <MoreMenu
            badge={upcomingRsvp}
            items={[
              ...(admin ? [{ label: 'Новое событие', onSelect: () => nav.push('event') }] : []),
              { label: upcomingRsvp > 0 ? `Матчи с подтверждением · ${upcomingRsvp}` : 'Матчи с подтверждением', onSelect: () => nav.push('rsvp') },
            ]}
          />
        </div>
      </div>
      {addStep === 'pick' && (
        <div className="ks-card" aria-label="Добавить матч">
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
            <input type="checkbox" checked={played} onChange={e => setPlayed(e.target.checked)} />
            <span>Матч уже сыгран, ввести результат</span>
          </label>
          {!played ? (
            <>
              <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>Родители получат приглашение и ответят, придёт ли игрок. Команду, чемпионат и группу выберете в следующем окне.</p>
              <button type="button" className="ks-btn" onClick={() => { setAddStep(null); nav.push('rsvp.create'); }}>Создать матч с подтверждением</button>
            </>
          ) : (
            <>
          <p className="ks-label">Матч чемпионата или фестиваля</p>
          {champEvents.length === 0 ? (
            <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>Событий пока нет.{admin ? ' Создайте чемпионат или фестиваль кнопкой «Новое событие».' : ' Чемпионаты и фестивали создаёт администратор.'}</p>
          ) : (
            champEvents.map(e => (
              <ListRow key={e.id} title={eventTitle(e)} sub={[e.team, eventCounts(e)]} onClick={() => { setAddStep(null); nav.push('event', { id: e.id }); }} />
            ))
          )}
          <p className="ks-label">Товарищеский или кубковый матч</p>
          {addTeams.length === 0 && <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>Нет команд, для которых можно добавить матч.</p>}
          {addTeams.map(t => (
            <ListRow key={t} title={t} onClick={() => { setAddTeam(t); setAddStep(null); nav.push('form'); }} />
          ))}
            </>
          )}
          <div style={{ height: 8 }} />
          <button type="button" className="ks-btn secondary" onClick={() => setAddStep(null)}>Отмена</button>
        </div>
      )}
      <div style={{ height: 12 }} />
      {showAll && teams.length > 1 && (
        <select className="ks-select" aria-label="Команда" value={team} onChange={e => setTeam(e.target.value)}>
          <option value="">Все команды</option>
          {teams.map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      )}
      {shown.length === 0 && sections.length === 0 ? (
        <EmptyState icon="trophy" title="Матчей пока нет" text="Добавьте матч, чтобы внести состав, счёт и голы." />
      ) : (
        sections.map(sec => (
          <section key={sec.key}>
            <p className="ks-label">{sec.title}</p>
            {sec.event && <ListRow title="Состав и игры события" sub={[eventCounts(sec.event), ...(isFinished(sec.event) ? ['завершено'] : [])]} onClick={() => nav.push('event', sec.event ? { id: sec.event.id } : undefined)} />}
            {sec.items.map(m => {
              const done = m.goals_for !== null && m.goals_against !== null;
              const cup = sec.key === 'other' ? tours.get(m.id) : undefined;
              const cupName = cup && cup.match_kind !== 'friendly' ? cup.tournament_name : null;
              return (
                <ListRow
                  key={m.id}
                  title={m.opponent ?? 'Соперник не указан'}
                  sub={[`${fmtDate(m.played_on)}${showAll || groups.length > 1 ? ' · ' + m.team : ''}${cupName ? ' · ' + cupName : ''}${playedBy.get(m.id) ? ' · играло ' + playedBy.get(m.id) : ''}`]}
                  end={m.lifecycle_status === 'cancelled' ? <Pill tone="danger">Отменён</Pill> : m.lifecycle_status === 'draft' ? <Pill tone="warning">Черновик</Pill> : done ? <span className="ks-score">{m.goals_for}:{m.goals_against}{m.technical ? ' (тех.)' : ''}</span> : <Pill tone="primary">{m.played_on > today() ? 'Предстоит' : 'Без счёта'}</Pill>}
                  onClick={() => nav.push('form', { id: m.id })}
                />
              );
            })}
          </section>
        ))
      )}
    </main>
  );
}

// Баллы игрока за матч по правилу владельца (2026-11-26): оценка тренера 1-5 и +1 лучшему игроку, не больше 6; технический результат баллов не даёт
const matchPoints = (rating: number | null, best: boolean) => (rating === null ? 0 : Math.min(rating + (best ? 1 : 0), 6));
// feeMode: у товарищеских и кубковых матчей взнос свой (на матч); у чемпионатов и фестивалей он на событие
// embedded: форма внутри единого экрана матча (без своей кнопки «Назад» и заголовка); active: раздел «Результат» открыт, только тогда видна кнопка «Сохранить матч»;
// onDirty сообщает о несохранённых правках; blocked: причина, по которой сохранять нельзя (данные матча изменились в другом разделе)
function MatchForm({ groups, match, admin, feeMode, rosterOf, presetTeam, onBack, onSaved, embedded = false, active = true, onDirty, blocked }: { groups: CoachGroup[]; match: Match | null; admin: boolean; feeMode: boolean; rosterOf: string | null; presetTeam?: string; onBack: () => void; onSaved?: () => void; embedded?: boolean; active?: boolean; onDirty?: (dirty: boolean) => void; blocked?: string | null }) {
  const { ask, dialog: confirmDialog } = useConfirm();
  const matchGroups = groups.filter(g => playsMatches(g.name));
  const matched = match ? (groups.find(g => g.name === match.team) ?? groups.find(g => matchTeam(g.name) === match.team))?.id : undefined;
  // у тренера матч всегда своей группы; у администратора название команды может не совпасть ни с одной группой — тогда группа не нужна
  // новый матч: группа команды, выбранной раньше (presetTeam), иначе первая группа
  const presetGid = presetTeam ? matchGroups.find(g => matchTeam(g.name) === presetTeam)?.id : undefined;
  // команда без своей группы (например, «U12» из кубка): чужую группу не подставляем, матч для неё не сохраняется
  const presetMissing = !match && Boolean(presetTeam) && !presetGid;
  const initialGid = match ? matched ?? (admin ? '' : groups[0]?.id ?? '') : presetTeam ? presetGid ?? '' : matchGroups[0]?.id ?? '';
  const [gid, setGid] = useState(initialGid);
  // выбор группы в списке значит «матч этой группы» (U13-B, не всей команды U13): команда матча получает название группы (миграция 0193), состав только её игроки.
  // Уже сохранённые матчи не меняются: «U13» остаётся общим, «U13-B» остаётся группой.
  const hasLetter = (name?: string) => Boolean(name && /-[A-Z]$/.test(name));
  const groupName = groups.find(g => g.id === gid)?.name;
  // «U9 (все группы)»: матч всей команды U9, состав из всех её групп (как раньше); по умолчанию, если команду выбрали в списке команд
  const [wholeTeam, setWholeTeam] = useState(!match && Boolean(presetTeam) && hasLetter(groups.find(g => g.id === presetGid)?.name));
  const groupOnly = match ? hasLetter(match.team) : hasLetter(groupName) && !wholeTeam;
  const [teamSet, setTeamSet] = useState(false);
  const rsvpLocked = Boolean(match && isRsvp(match)); // дату и соперника держит экран «Матчи с подтверждением»: иначе played_on разойдётся с временем начала
  const [date, setDate] = useState(match?.played_on ?? today());
  const [opp, setOpp] = useState(match?.opponent ?? '');
  const [gf, setGf] = useState(match?.goals_for != null ? String(match.goals_for) : '');
  const [ga, setGa] = useState(match?.goals_against != null ? String(match.goals_against) : '');
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [guestIds, setGuestIds] = useState<string[]>([]); // игроки с разовым взносом: играли, но не заявлены в этом чемпионате ни за одну команду
  const [lines, setLines] = useState<Record<string, Line>>({});
  const [bestId, setBestId] = useState<string | null>(null);
  // версии правил баллов: модель оценки действует только с даты версии, где match.model = 'rating' (0224); для прежних дат оценки не обязательны.
  // Не удалось прочитать версии: клиент не блокирует сохранение, решает сервер.
  const [ruleVersions, setRuleVersions] = useState<{ effective_from: string; params: { match?: { model?: string } } | null }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [savedId, setSavedId] = useState<string | null>(match?.id ?? null);
  // технический результат (матч фактически не играли): баллов нет; признак ставится отдельной функцией после сохранения матча
  const [technical, setTechnical] = useState(match?.technical ?? false);
  const [savedTech, setSavedTech] = useState(match?.technical ?? false);
  // после первого сохранения в составе остаются только сыгравшие; остальных можно показать кнопкой, чтобы добавить забытого
  const [shownIds, setShownIds] = useState<string[] | null>(null);
  const [invitedIds, setInvitedIds] = useState<string[]>([]); // приглашённые матча с подтверждением: остаются в составе и после сохранения
  const [showAll, setShowAll] = useState(false);
  // правки считаются от загруженного состояния; после сохранения на месте принимаются за исходные
  const sig = JSON.stringify([gid, date, opp, gf, ga, lines, bestId, technical]);
  const markCleanGuard = useDirtySignature(sig, players !== null);
  // то же «исходное состояние», что у useDirtySignature, чтобы сообщать о правках единому экрану
  const baseSig = useRef<string | null>(null);
  const sigNow = useRef(sig);
  sigNow.current = sig;
  if (players !== null && baseSig.current === null) baseSig.current = sig;
  const isDirty = baseSig.current !== null && sig !== baseSig.current;
  useEffect(() => { onDirty?.(isDirty); }, [isDirty]); // eslint-disable-line react-hooks/exhaustive-deps
  const markClean = () => { baseSig.current = sigNow.current; markCleanGuard(); };
  const [editLineup, setEditLineup] = useState(false); // кнопки «Убрать из матча» показываем только в режиме правки состава

  useEffect(() => {
    setPlayers(null);
    void (async () => {
      let list: Player[] = [];
      const notActive = new Set<string>();
      if (rosterOf) {
        // матч чемпионата или фестиваля: в составе только заявленные на событие
        const r = await supabase.rpc('event_roster', { t: rosterOf });
        if (r.error) return setError(errMsg(r.error));
        list = ((r.data ?? []) as { player_id: string; full_name: string }[]).map(x => ({ id: x.player_id, full_name: x.full_name }));
        // ушедшие и игроки на паузе не попадают в новые матчи события (заявка на событие статус не проверяет); без ответа базы список остаётся прежним
        const st = list.length ? await supabase.from('players').select('id, status').in('id', list.map(p => p.id)) : null;
        if (st && !st.error) for (const s of (st.data ?? []) as { id: string; status: string }[]) if (s.status !== 'active') notActive.add(s.id);
      } else if (gid) {
        // команда «U10» объединяет группы U10-A и U10-B: в составе игроки всех её групп
        const sel = groups.find(g => g.id === gid)?.name;
        let ids = [gid];
        if (sel && !groupOnly) {
          const gr = await supabase.from('groups').select('id, name');
          if (!gr.error) ids = [...new Set([gid, ...((gr.data ?? []) as CoachGroup[]).filter(g => playsMatches(g.name) && matchTeam(g.name) === matchTeam(sel)).map(g => g.id)])];
        }
        const p = await supabase.from('players').select('id, full_name').in('group_id', ids).eq('status', 'active').order('full_name');
        if (p.error) return setError(errMsg(p.error));
        list = (p.data ?? []) as Player[];
      }
      const init: Record<string, Line> = {};
      let best: string | null = null;
      if (savedId) {
        const mp = await supabase.from('match_players').select('player_id, played, goals, best, performance_rating').eq('match_id', savedId);
        if (mp.error) return setError(errMsg(mp.error));
        const rows = (mp.data ?? []) as { player_id: string; played: boolean; goals: number; best: boolean; performance_rating: number | null }[];
        for (const r of rows) {
          init[r.player_id] = { played: r.played, goals: r.goals, rating: r.performance_rating };
          if (r.best) best = r.player_id;
        }
        // в составе бывают игроки не из группы (гости, старые записи): администратор их видит и правит
        const extra = rows.map(r => r.player_id).filter(id => !list.some(p => p.id === id));
        if (extra.length) {
          const ex = await supabase.from('players').select('id, full_name').in('id', extra);
          if (ex.error) return setError(errMsg(ex.error));
          list = [...list, ...((ex.data ?? []) as Player[])].sort((a, b) => a.full_name.localeCompare(b.full_name));
        }
      }
      // матч с подтверждением: состав, собранный до публикации, лежит в приглашениях (match_invitations), а не в match_players;
      // показываем приглашённых (в том числе из других групп), «Играл» не ставим. Не прочиталось: форма как раньше
      let invitedIds: string[] = [];
      let rsvpRoster = false; // у матча с подтверждением в списке только приглашённые и игроки с отметкой, остальных добавляют поиском
      if (match && isRsvp(match)) {
        // без приглашений состав не известен: явная ошибка с «Повторить», а не вся группа (она показала бы тренеру неверный состав)
        const inv = await supabase.from('match_invitations').select('player_id').eq('match_id', match.id).eq('status', 'invited');
        if (inv.error) return setError(errMsg(inv.error));
        invitedIds = ((inv.data ?? []) as { player_id: string }[]).map(r => r.player_id);
        rsvpRoster = true;
        const miss = invitedIds.filter(id => !list.some(p => p.id === id));
        if (miss.length) {
          const ex = await supabase.from('players').select('id, full_name, status').in('id', miss);
          if (ex.error) return setError(errMsg(ex.error));
          list = [...list, ...((ex.data ?? []) as (Player & { status?: string })[]).filter(p => p.status === undefined || p.status === 'active').map(p => ({ id: p.id, full_name: p.full_name }))].sort((a, b) => a.full_name.localeCompare(b.full_name));
        }
      }
      // неактивные остаются только там, где у них уже есть запись в этом матче (прошлые матчи не меняются)
      list = list.filter(p => !notActive.has(p.id) || p.id in init);
      if (rsvpRoster) list = list.filter(p => invitedIds.includes(p.id) || p.id in init);
      setLines(init);
      setBestId(best);
      const playedIds = Object.entries(init).filter(([, l]) => l.played).map(([id]) => id);
      setInvitedIds(invitedIds);
      const shown = [...new Set([...invitedIds, ...playedIds])];
      setShownIds(shown.length ? shown : null);
      setPlayers(list);
    })();
    // состав подгружается при смене группы и при повторной попытке; сохранённый матч не перезагружаем из-за savedId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gid, reload]);

  // версии правил читаются только своего клуба: у существующего матча это его club_id; у нового матча клуб выбранной группы
  // (для команды без группы у первой группы тренера). Имя команды клуб не определяет: одинаковые названия бывают в разных клубах
  const matchClub = match?.club_id ?? '';
  const clubGroupId = matchClub ? '' : gid || groups[0]?.id || '';
  useEffect(() => {
    setRuleVersions(null);
    if (!matchClub && !clubGroupId) return;
    let off = false;
    void (async () => {
      let club = matchClub;
      if (!club) {
        const g = await supabase.from('groups').select('club_id').eq('id', clubGroupId).maybeSingle();
        club = (g.data as { club_id?: string } | null)?.club_id ?? '';
        if (g.error || !club) return;
      }
      const v = await supabase.from('points_rule_versions').select('effective_from, params').eq('club_id', club).order('effective_from', { ascending: false });
      if (!off && !v.error) setRuleVersions((v.data ?? []) as { effective_from: string; params: { match?: { model?: string } } | null }[]);
    })();
    return () => { off = true; };
  }, [matchClub, clubGroupId]);

  const line = (id: string): Line => lines[id] ?? { played: false, goals: 0, rating: null };
  // гости чемпионата определяет база (заявки всех команд этого чемпионата); после каждого сохранения список читается заново
  useEffect(() => {
    if (feeMode || !admin || !savedId || !rosterOf) return setGuestIds([]);
    let off = false;
    void supabase.rpc('champ_guest_ids', { m: savedId }).then(r => {
      if (!off) setGuestIds(r.error ? [] : ((r.data ?? []) as { player_id: string }[]).map(x => x.player_id));
    });
    return () => { off = true; };
  }, [feeMode, admin, savedId, rosterOf, reload]);
  const setLine = (id: string, l: Line) => {
    setLines(s => ({ ...s, [id]: l }));
    if (!l.played && bestId === id) setBestId(null);
    setMsg(null);
  };
  const ratingModel = (() => {
    const v = (ruleVersions ?? []).find(x => x.effective_from <= date);
    return v?.params?.match?.model === 'rating';
  })();
  const total = Object.values(lines).reduce((s, l) => s + (l.played ? l.goals : 0), 0);

  const problem = (): string | null => {
    if ((gf === '') !== (ga === '')) return 'Укажите оба числа счёта или оставьте оба пустыми.';
    if (gf !== '' && date > today()) return 'Счёт нельзя внести для матча, который ещё не прошёл.';
    if (gf !== '' && total > Number(gf)) return 'Голов у игроков больше, чем забила команда.';
    // баллы считаются по оценке тренера: при внесённом счёте (кроме технического результата) оценён каждый игравший и выбран лучший
    const playedPl = (players ?? []).filter(pl => line(pl.id).played);
    if (ratingModel && gf !== '' && !technical && playedPl.length > 0) {
      if (playedPl.some(pl => line(pl.id).rating === null)) return 'Выставьте оценку каждому, кто играл.';
      if (!playedPl.some(pl => bestId === pl.id)) return 'Выберите лучшего игрока матча.';
    }
    return null;
  };
  const save = async () => {
    if (blocked) return setMsg({ ok: false, text: blocked });
    const p = problem();
    if (p) return setMsg({ ok: false, text: p });
    // команда без группы: администратор создаёт товарищеский матч по названию команды (миграция 0106)
    const teamOnly = !savedId && !gid && admin && presetMissing;
    if (!savedId && !gid && !teamOnly) return setMsg({ ok: false, text: 'В клубе нет группы для этой команды, матч не сохранить.' });
    setBusy(true);
    setMsg(null);
    const roster = (players ?? []).map(pl => ({ player_id: pl.id, played: line(pl.id).played, goals: line(pl.id).played ? line(pl.id).goals : 0, best: bestId === pl.id && line(pl.id).played, performance_rating: line(pl.id).played ? line(pl.id).rating : null }));
    const score = { gf: gf === '' ? null : Number(gf), ga: ga === '' ? null : Number(ga) };
    // смена технического результата сохраняется вместе с матчем одной транзакцией (миграция 0186):
    // иначе родитель успевал получить уведомление о баллах, которые тут же снимались
    const techChanged = technical !== savedTech;
    const r = techChanged
      ? await supabase.rpc('save_match_tech', { m: savedId, g: gid || null, tm: teamOnly ? presetTeam : null, d: date, opp, gf: score.gf, ga: score.ga, roster, tech: technical })
      : teamOnly
        ? await supabase.rpc('save_match_team', { tm: presetTeam, d: date, opp, gf: score.gf, ga: score.ga, roster })
        : await supabase.rpc('save_match', { m: savedId, g: gid || null, d: date, opp, gf: score.gf, ga: score.ga, roster });
    setBusy(false);
    if (r.error) return setMsg({ ok: false, text: coachError(r.error.message) });
    if (!match && !teamSet && gid && groupOnly) {
      const sg = await supabase.rpc('set_match_team_group', { m: r.data as string, g: gid, exact: true });
      if (sg.error) {
        setSavedId(r.data as string);
        return setMsg({ ok: false, text: 'Матч сохранён, но группу матча записать не удалось: ' + coachError(sg.error.message) });
      }
      setTeamSet(true);
    }
    setSavedId(r.data as string);
    if (techChanged) setSavedTech(technical);
    const playedNow = Object.entries(lines).filter(([, l]) => l.played).map(([id]) => id);
    const shownNow = [...new Set([...invitedIds, ...playedNow])];
    setShownIds(shownNow.length ? shownNow : null);
    setShowAll(false);
    let saved = 'Матч сохранён. Баллы за матч начислены автоматически.';
    // взнос неигравших без оплаты снимается сам (0197); пока никто не отмечен «Играл», взносы остаются
    if (feeMode && playedNow.length > 0) {
      const sy = await supabase.rpc('match_fees_sync_played', { m: r.data as string });
      if (sy.error) saved += ' Взносы неигравших убрать не удалось: ' + coachError(sy.error.message);
      else if (Number(sy.data) > 0) saved += ` Убрано из взноса неигравших: ${Number(sy.data)}.`;
      setReload(n => n + 1);
    }
    setMsg({ ok: true, text: saved });
    markClean();
    // список матчей перечитывается сразу, чтобы счёт был виден без выхода из матча
    onSaved?.();
  };
  const remove = async () => {
    if (!savedId || !(await ask({ title: 'Удалить матч?', note: 'Матч удалится вместе с составом и начисленными за него баллами. Отменить нельзя.', confirmLabel: 'Удалить', danger: true }))) return;
    setBusy(true);
    const r = await supabase.rpc('delete_match', { m: savedId });
    setBusy(false);
    if (r.error) return setMsg({ ok: false, text: coachError(r.error.message) });
    onBack();
  };
  // Убрать игрока из матча совсем (администратор и тренер): функция remove_match_player (0192) снимает отметку, голы и баллы
  // и удаляет строку состава. Нужно для ушедших игроков: снятая отметка «играл» оставляла их в составе матча.
  const removeFromMatch = async (p: Player) => {
    if (!savedId) return;
    if (!(await ask({ title: 'Убрать игрока из матча?', note: `${p.full_name}: пропадут его отметка и баллы за этот матч. Из чемпионата и команды он не удаляется.${bestId === p.id ? ' Он назначен лучшим игроком матча: нового лучшего потом выберете вы сами.' : ''}`, confirmLabel: 'Убрать', danger: true }))) return;
    setBusy(true);
    setMsg(null);
    const r = await supabase.rpc('remove_match_player', { m: savedId, p: p.id });
    setBusy(false);
    if (r.error) return setMsg({ ok: false, text: coachError(r.error.message) });
    setPlayers(list => (list ?? []).filter(x => x.id !== p.id));
    setLines(s => { const n = { ...s }; delete n[p.id]; return n; });
    setShownIds(ids => (ids ? ids.filter(id => id !== p.id) : ids));
    setInvitedIds(ids => ids.filter(id => id !== p.id));
    const wasBest = bestId === p.id;
    if (wasBest) setBestId(null);
    // нового лучшего назначает только тренер: игрок убран, лучшего в матче сейчас нет
    setMsg({ ok: true, text: wasBest ? `${p.full_name} убран из матча. Он был лучшим игроком: выберите нового лучшего и сохраните матч.` : `${p.full_name} убран из матча.` });
  };
  const native = useMainButton({ text: 'Сохранить матч', visible: active, enabled: !busy && Boolean(players), loading: busy, onClick: () => void save() });

  if (error) return <Failure title="Не удалось загрузить состав" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} back={embedded ? undefined : <BackNav onBack={onBack} managed />} />;
  if (!players) return <Loading />;
  const guests = players.filter(p => guestIds.includes(p.id));

  const canPickGroup = !match && !savedId;
  const Wrap = embedded ? 'div' : 'main';
  return (
    <Wrap className={embedded ? undefined : 'page'}>
      {!embedded && <BackNav onBack={onBack} managed />}
      {!embedded && <h1>{match ? 'Матч' : 'Новый матч'}</h1>}
      {canPickGroup && presetMissing && !admin && <p className="error" style={{ marginBottom: 8 }}>В клубе нет группы «{presetTeam}», поэтому матч для неё не сохранить. Вернитесь и выберите другую команду.</p>}
      {canPickGroup && presetMissing && admin && <p className="muted" style={{ marginBottom: 8 }}>Команда «{presetTeam}» без группы: состав собирайте поиском по игрокам клуба.</p>}
      {canPickGroup && !presetMissing && matchGroups.length > 1 && (
        <select className="ks-select" aria-label="Группа" value={(wholeTeam && hasLetter(groupName) ? 't:' : 'g:') + gid} onChange={e => { setWholeTeam(e.target.value.startsWith('t:')); setGid(e.target.value.slice(2)); }}>
          {matchGroups.map((g, i) => {
            const lettered = hasLetter(g.name);
            const firstOfTeam = lettered && matchGroups.findIndex(x => matchTeam(x.name) === matchTeam(g.name)) === i;
            return [
              firstOfTeam && <option key={'t' + g.id} value={'t:' + g.id}>{matchTeam(g.name)} (все группы)</option>,
              <option key={g.id} value={'g:' + g.id}>{g.name}</option>,
            ];
          })}
        </select>
      )}
      {match && admin && <p className="muted" style={{ marginBottom: 8 }}>Команда: {match.team}</p>}
      <label className="ks-label" htmlFor="m-date">Дата</label>
      <input id="m-date" className="ks-input" type="date" value={date} disabled={rsvpLocked} onChange={e => { setDate(e.target.value); setMsg(null); }} />
      <label className="ks-label" htmlFor="m-opp">Соперник</label>
      <input id="m-opp" className="ks-input" value={opp} disabled={rsvpLocked} onChange={e => setOpp(e.target.value)} placeholder="Название команды" maxLength={80} />
      {rsvpLocked && <p className="muted" style={{ fontSize: 13 }}>Дата и соперник этого матча меняются в разделе «Матчи с подтверждением», здесь только отметки игроков и счёт.</p>}
      <p className="ks-label">Счёт (наша команда : соперник)</p>
      <div className="ks-line">
        <input className="ks-input" style={{ width: 90 }} inputMode="numeric" aria-label="Забила наша команда" value={gf} onChange={e => setGf(e.target.value.replace(/\D/g, '').slice(0, 2))} placeholder="—" />
        <b>:</b>
        <input className="ks-input" style={{ width: 90 }} inputMode="numeric" aria-label="Забил соперник" value={ga} onChange={e => setGa(e.target.value.replace(/\D/g, '').slice(0, 2))} placeholder="—" />
      </div>
      <label className="ks-check" style={{ marginTop: 8 }}>
        <input type="checkbox" checked={technical} onChange={e => { setTechnical(e.target.checked); setMsg(null); }} />
        <span>Технический результат (матч не играли)</span>
      </label>
      {technical && <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>За технический результат баллы игрокам не начисляются. Счёт остаётся в статистике команды.</p>}
      <h2 className="ks-sub">Состав{Object.values(lines).some(l => l.played) ? ` · играло ${Object.values(lines).filter(l => l.played).length}` : ''}</h2>
      <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
        Баллы начисляются автоматически, когда внесён счёт, только тем, кто играл: оценка тренера от 1 до 5, лучшему игроку матча ещё +1, всего не больше 6 за матч. Голы и результат команды на баллы игрока не влияют. За технический результат баллов нет.
      </p>
      {savedId && players.length > 0 && (
        <button type="button" className="ks-btn secondary" style={{ width: 'auto', minHeight: 36, marginBottom: 8 }} aria-pressed={editLineup} onClick={() => setEditLineup(v => !v)}>
          {editLineup ? 'Готово' : 'Править состав'}
        </button>
      )}
      {players.length === 0 ? (
        <EmptyState icon="users" title="В составе пока никого" text="Найдите игрока ниже, чтобы добавить его в состав." />
      ) : (
        (shownIds && !showAll ? players.filter(p => shownIds.includes(p.id) || line(p.id).played) : players).map(p => (
          <div className="ks-card" key={p.id}>
            <label className="ks-check">
              <input type="checkbox" checked={line(p.id).played} onChange={e => setLine(p.id, { played: e.target.checked, goals: e.target.checked ? line(p.id).goals : 0, rating: e.target.checked ? line(p.id).rating : null })} />
              <span style={{ overflowWrap: 'anywhere' }}>{p.full_name}</span>
            </label>
            {line(p.id).played && (
              <>
                <div className="ks-line" style={{ marginTop: 12 }}>
                  <span className="ks-muted">Голы</span>
                  <Stepper label={`Голы: ${p.full_name}`} value={line(p.id).goals} max={30} onChange={n => setLine(p.id, { played: true, goals: n, rating: line(p.id).rating })} />
                </div>
                <div className="ks-line" role="group" aria-label={`Оценка тренера: ${p.full_name}`} style={{ marginTop: 14, rowGap: 8 }}>
                  <span className="ks-muted">Оценка</span>
                  {[1, 2, 3, 4, 5].map(n => (
                    <button key={n} type="button" className={`ks-btn sm ${line(p.id).rating === n ? '' : 'secondary'}`} style={{ width: 'auto', minWidth: 40 }} aria-pressed={line(p.id).rating === n} aria-label={`Оценка ${n}: ${p.full_name}`} onClick={() => setLine(p.id, { ...line(p.id), played: true, rating: line(p.id).rating === n ? null : n })}>{n}</button>
                  ))}
                </div>
                {ratingModel && line(p.id).rating !== null && gf !== '' && !technical && <p className="muted" style={{ fontSize: 13, margin: '4px 0 0' }}>Баллов за матч: {matchPoints(line(p.id).rating, bestId === p.id)}</p>}
                <button type="button" className={`ks-btn ${bestId === p.id ? '' : 'secondary'}`} style={{ marginTop: 14, minHeight: 40 }} aria-pressed={bestId === p.id} onClick={() => { setBestId(bestId === p.id ? null : p.id); setMsg(null); }}>
                  {bestId === p.id ? '★ Лучший игрок матча' : 'Назначить лучшим игроком'}
                </button>
              </>
            )}
            {savedId && editLineup && !invitedIds.includes(p.id) && ( // приглашённых RSVP-матча «Убрать из матча» не стирает: приглашение остаётся, для «не играл» снимается галочка
              <button type="button" className="ks-btn secondary" style={{ marginTop: 8, minHeight: 40 }} disabled={busy} aria-label={`Убрать из матча: ${p.full_name}`} onClick={() => void removeFromMatch(p)}>
                Убрать из матча
              </button>
            )}
          </div>
        ))
      )}
      {shownIds && !showAll && players.some(p => !shownIds.includes(p.id) && !line(p.id).played) && (
        <button type="button" className="ks-btn secondary" onClick={() => setShowAll(true)}>Показать всех игроков команды ({players.filter(p => !shownIds.includes(p.id) && !line(p.id).played).length})</button>
      )}
      <>
      <h2 className="ks-sub">Добавить в состав</h2>
      <div style={{ marginBottom: 16 }}>
        <PlayerSearch id="ks-add-player" ariaLabel="Найти игрока" placeholder="Фамилия или имя игрока (от 2 букв)" datalist exclude={id => players.some(p => p.id === id)}
          onPick={f => { setPlayers(list => [...(list ?? []), f].sort((a, b) => a.full_name.localeCompare(b.full_name))); setShownIds(ids => (ids ? [...ids, f.id] : ids)); }} />
      </div>
      </>
      {msg && <p className={msg.ok ? 'ks-ok' : 'error'}>{msg.text}</p>}
      {/* взнос можно назначить и отметить оплаты до игры: добавляются все игроки из состава формы, а не только отмеченные «Играл» */}
      {feeMode && savedId && (
        <EventFees mode="match" coach={!admin} eventId={savedId} reloadKey={reload} onChanged={() => undefined} addable={players.map(p => ({ id: p.id, name: p.full_name }))} />
      )}
      {/* гости чемпионата или фестиваля (играли, но не в заявке события): при сохранении матча им автоматически назначается разовый взнос за матч */}
      {!feeMode && admin && savedId && guests.length > 0 && (
        <>
          <p className="muted">Не заявлены в этом чемпионате, разовый взнос за матч: {guests.map(g => g.full_name).join(', ')}.</p>
          <EventFees mode="match" coach={false} eventId={savedId} reloadKey={reload} onChanged={() => undefined} addable={guests.map(p => ({ id: p.id, name: p.full_name }))} />
        </>
      )}
      {!native && (
        <button type="button" className="ks-btn" disabled={busy} onClick={() => void save()}>
          Сохранить матч
        </button>
      )}
      {admin && savedId && (
        <>
          <div style={{ height: 12 }} />
          <button type="button" className="ks-btn secondary" disabled={busy} onClick={() => void remove()}>Удалить матч</button>
        </>
      )}
      {confirmDialog}
    </Wrap>
  );
}

// Единый экран матча с подтверждением (PR 1 «Один матч — один экран»): разделы «Состав и ответы» (RsvpDetail) и «Результат» (MatchForm).
// Раздел по умолчанию определяет момент начала матча (starts_at, абсолютное время); оба раздела остаются в памяти, чтобы несохранённые правки не терялись.
// «Состав и ответы» всегда загружается (скрытым, если открыт «Результат»): он даёт актуальный статус матча, а форма результата строится по свежей строке матча.
// Когда в «Составе» что-то изменилось (соперник, перенос, приглашённые), форма результата перечитывается; если в ней есть несохранённые отметки,
// сохранение блокируется до явного «Обновить форму», иначе форма отправила бы устаревшие дату, соперника и состав.
type HubTab = 'roster' | 'result';
type HubCtl = { onDirty: (dirty: boolean) => void; blocked: string | null };
const HUB_COLS = 'id, club_id, team, played_on, opponent, goals_for, goals_against, technical, lifecycle_status, starts_at';
function MatchHub({ match, groups, admin, onBack, renderResult }: { match: Match; groups: CoachGroup[]; admin: boolean; onBack: () => void; renderResult: (row: Match, active: boolean, ctl: HubCtl) => React.ReactNode }) {
  const [live, setLive] = useState<{ lifecycle_status?: string; starts_at?: string | null; opponent?: string | null; team?: string }>({ lifecycle_status: match.lifecycle_status, starts_at: match.starts_at, opponent: match.opponent, team: match.team });
  const [tab, setTab] = useState<HubTab>(() => (match.starts_at && new Date(match.starts_at).getTime() <= Date.now() ? 'result' : 'roster'));
  const [opened, setOpened] = useState(() => tab === 'result');
  const [row, setRow] = useState<{ rev: number; match: Match } | null>(null); // свежая строка матча и номер её чтения
  const [form, setForm] = useState<{ rev: number; match: Match } | null>(null); // строка, с которой собрана форма результата
  const [dirty, setDirty] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const rev = useRef(0);
  const choose = (t: HubTab) => { setTab(t); if (t === 'result') setOpened(true); };
  const refreshRow = async () => {
    const my = ++rev.current;
    const r = await supabase.from('matches').select(HUB_COLS).eq('id', match.id).maybeSingle();
    if (my !== rev.current) return; // пришёл более новый ответ
    if (r.error) return setRowError(errMsg(r.error));
    if (!r.data) return setRowError('Матч не найден');
    setRowError(null);
    setRow({ rev: my, match: r.data as Match });
  };
  useEffect(() => { if (retry > 0) void refreshRow(); }, [retry]); // eslint-disable-line react-hooks/exhaustive-deps
  // форма собирается по первой прочитанной строке и обновляется на лету, пока в ней нет несохранённых отметок
  useEffect(() => {
    if (row && (!form || (!dirty && row.rev !== form.rev))) setForm(row);
  }, [row, form, dirty]);
  const stale = Boolean(row && form && row.rev !== form.rev);
  const status = live.lifecycle_status;
  const tabs: [HubTab, string][] = [['roster', 'Состав и ответы'], ['result', 'Результат']];
  return (
    <main className="page">
      <BackNav onBack={onBack} managed />
      <h1>{live.opponent !== undefined && live.team ? (live.opponent ? `${live.team} · ${live.opponent}` : `${live.team} · соперник не указан`) : (match.opponent ? `${match.team} · ${match.opponent}` : `${match.team} · соперник не указан`)}</h1>
      <div role="tablist" aria-label="Разделы матча" style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {tabs.map(([k, label]) => (
          <button key={k} type="button" role="tab" id={`hub-tab-${k}`} aria-controls={`hub-panel-${k}`} aria-selected={tab === k} tabIndex={tab === k ? 0 : -1} className={`ks-btn ${tab === k ? '' : 'secondary'}`} style={{ flex: 1, minHeight: 44 }} onClick={() => choose(k)}
            onKeyDown={e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const n: HubTab = k === 'roster' ? 'result' : 'roster'; choose(n); document.getElementById(`hub-tab-${n}`)?.focus(); } }}>{label}</button>
        ))}
      </div>
      <div role="tabpanel" id="hub-panel-roster" aria-labelledby="hub-tab-roster" hidden={tab !== 'roster'}>
        <RsvpDetail id={match.id} groups={groups} admin={admin} onBack={onBack} embedded onOpenResult={() => choose('result')} onLoaded={(m: RsvpMatch) => { setLive({ lifecycle_status: m.lifecycle_status, starts_at: m.starts_at, opponent: m.opponent, team: m.team }); void refreshRow(); }} />
      </div>
      {opened && (
        <div role="tabpanel" id="hub-panel-result" aria-labelledby="hub-tab-result" hidden={tab !== 'result'}>
          {status === 'draft' || status === 'cancelled'
            ? <p className="muted">Результат вносится после публикации и начала матча{status === 'cancelled' ? '; отменённый матч результата не имеет' : ''}.</p>
            : rowError
              ? <Failure title="Не удалось загрузить матч" text={rowError} onRetry={() => setRetry(n => n + 1)} />
              : !form
                ? <Loading />
                : (
                  <>
                    {stale && (
                      <div className="card" role="status" style={{ marginBottom: 12 }}>
                        <p>В разделе «Состав и ответы» данные матча изменились. Сохранение отметок заблокировано, чтобы не затереть изменения.</p>
                        <button type="button" className="ks-btn secondary" style={{ minHeight: 44 }} onClick={() => { setDirty(false); if (row) setForm(row); }}>Обновить форму (несохранённые отметки сбросятся)</button>
                      </div>
                    )}
                    <div key={form.rev}>{renderResult(form.match, tab === 'result', { onDirty: setDirty, blocked: stale ? 'Данные матча изменились в разделе «Состав и ответы». Обновите форму.' : null })}</div>
                  </>
                )}
        </div>
      )}
    </main>
  );
}
