import { useEffect, useState } from 'react';
import { coachError, compareGroups, fmtDate, matchTeam, playsMatches, today, type CoachGroup } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { useDirtySignature, useNav, useNavState } from '../nav';
import { EmptyState, ListRow, Pill, NameDatalist, searchFocusProps } from '../ui/components';
import { GroupPicker, Stepper } from '../ui/coach';
import { BackNav, useMainButton } from '../ui/nav';
import EventFees from './EventFees';
import { EventForm, EventScreen, eventCounts, eventTitle, isFinished, type EventRow } from './Events';
import { Failure, Loading } from './Message';
import CoachRsvp from './CoachRsvp';
import { useConfirm } from '../ui/ConfirmSheet';

interface Match { id: string; team: string; played_on: string; opponent: string | null; goals_for: number | null; goals_against: number | null; technical?: boolean; lifecycle_status?: string; starts_at?: string | null }
// Матч с подтверждением участия (PR 2–4 по #274): до начала им управляют «Матчи с подтверждением», здесь он появляется после начала — для отметок игроков и счёта
const isRsvp = (m: Pick<Match, 'lifecycle_status'>) => Boolean(m.lifecycle_status) && m.lifecycle_status !== 'legacy';
interface Tour { match_id: string; tournament_id: string | null; tournament_name: string | null; tournament_kind: string | null; match_kind: string | null }
interface Player { id: string; full_name: string }
interface Line { played: boolean; goals: number }

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
  const [addTeam, setAddTeam] = useNavState('cm.addTeam', '', { entry: 0 });

  useEffect(() => {
    void (async () => {
      // турниры матчей: без них (старая база, нет связи) список остаётся плоским
      const t = await supabase.rpc('match_tournaments');
      if (!t.error) setTours(new Map(((t.data ?? []) as Tour[]).map(x => [x.match_id, x])));
      // события (чемпионаты, фестивали, кубки) со счётчиками; без миграции 0051 список остаётся прежним
      const ev = await supabase.rpc('event_list');
      setEvents(ev.error ? [] : ((ev.data ?? []) as EventRow[]));
      let q = supabase.from('matches').select('id, team, played_on, opponent, goals_for, goals_against, technical, lifecycle_status, starts_at');
      if (!showAll) q = q.in('team', groups.map(g => g.name));
      const r = await q.order('played_on', { ascending: false }).limit(showAll ? 150 : 60);
      if (r.error) return setError(r.error.message);
      const now = Date.now();
      const list = ((r.data ?? []) as Match[]).filter(m => !isRsvp(m) || (m.lifecycle_status === 'published' && m.starts_at != null && new Date(m.starts_at).getTime() <= now));
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
  if (screen.startsWith('rsvp')) return <CoachRsvp groups={groups} onBack={() => nav.back()} />;
  const openEvent = events.find(e => e.id === topId);
  if (screen === 'event' && (openEvent || !topId)) {
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
  if (screen === 'form' && (formMatch || !topId)) return <MatchForm groups={groups} match={formMatch} admin={admin} rosterOf={formMatch && !(!tours.get(formMatch.id)?.tournament_id || tours.get(formMatch.id)?.match_kind === 'friendly' || tours.get(formMatch.id)?.tournament_kind === 'cup') ? tours.get(formMatch.id)?.tournament_id ?? null : null} feeMode={!formMatch || !tours.get(formMatch.id)?.tournament_id || tours.get(formMatch.id)?.match_kind === 'friendly' || tours.get(formMatch.id)?.tournament_kind === 'cup'} presetTeam={addTeam} onBack={back} onSaved={() => setReload(n => n + 1)} />;
  if (!matches) return <Loading />;

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
  return (
    <main className="page">
      <h1>Матчи</h1>
      <button type="button" className="ks-btn" onClick={() => setAddStep('pick')}>Добавить матч</button>
      <div style={{ height: 8 }} />
      <button type="button" className="ks-btn secondary" onClick={() => nav.push('event')}>Новое событие</button>
      <div style={{ height: 8 }} />
      <button type="button" className="ks-btn secondary" onClick={() => nav.push('rsvp')}>Матчи с подтверждением</button>
      {addStep === 'pick' && (
        <div className="ks-card" aria-label="Добавить матч">
          <p className="ks-label">Матч чемпионата или фестиваля</p>
          {champEvents.length === 0 ? (
            <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>Событий пока нет. Создайте чемпионат или фестиваль кнопкой «Новое событие».</p>
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
                  end={done ? <span className="ks-score">{m.goals_for}:{m.goals_against}{m.technical ? ' (тех.)' : ''}</span> : <Pill tone="primary">{m.played_on > today() ? 'Предстоит' : 'Без счёта'}</Pill>}
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

// feeMode: у товарищеских и кубковых матчей взнос свой (на матч); у чемпионатов и фестивалей он на событие
function MatchForm({ groups, match, admin, feeMode, rosterOf, presetTeam, onBack, onSaved }: { groups: CoachGroup[]; match: Match | null; admin: boolean; feeMode: boolean; rosterOf: string | null; presetTeam?: string; onBack: () => void; onSaved?: () => void }) {
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
  const rsvpLocked = Boolean(match && isRsvp(match)); // дату и соперника держит экран «Матчи с подтверждением»: иначе played_on разойдётся с временем начала
  const [date, setDate] = useState(match?.played_on ?? today());
  const [opp, setOpp] = useState(match?.opponent ?? '');
  const [gf, setGf] = useState(match?.goals_for != null ? String(match.goals_for) : '');
  const [ga, setGa] = useState(match?.goals_against != null ? String(match.goals_against) : '');
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [guestIds, setGuestIds] = useState<string[]>([]); // игроки с разовым взносом: играли, но не заявлены в этом чемпионате ни за одну команду
  const [lines, setLines] = useState<Record<string, Line>>({});
  const [bestId, setBestId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [savedId, setSavedId] = useState<string | null>(match?.id ?? null);
  // технический результат (матч фактически не играли): баллов нет; признак ставится отдельной функцией после сохранения матча
  const [technical, setTechnical] = useState(match?.technical ?? false);
  const [savedTech, setSavedTech] = useState(match?.technical ?? false);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Player[]>([]);
  // после первого сохранения в составе остаются только сыгравшие; остальных можно показать кнопкой, чтобы добавить забытого
  const [shownIds, setShownIds] = useState<string[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  // правки считаются от загруженного состояния; после сохранения на месте принимаются за исходные
  const markClean = useDirtySignature(JSON.stringify([gid, date, opp, gf, ga, lines, bestId, technical]), players !== null);
  const [editLineup, setEditLineup] = useState(false); // кнопки «Убрать из матча» показываем только в режиме правки состава

  useEffect(() => {
    setPlayers(null);
    void (async () => {
      let list: Player[] = [];
      const notActive = new Set<string>();
      if (rosterOf) {
        // матч чемпионата или фестиваля: в составе только заявленные на событие
        const r = await supabase.rpc('event_roster', { t: rosterOf });
        if (r.error) return setError(r.error.message);
        list = ((r.data ?? []) as { player_id: string; full_name: string }[]).map(x => ({ id: x.player_id, full_name: x.full_name }));
        // ушедшие и игроки на паузе не попадают в новые матчи события (заявка на событие статус не проверяет); без ответа базы список остаётся прежним
        const st = list.length ? await supabase.from('players').select('id, status').in('id', list.map(p => p.id)) : null;
        if (st && !st.error) for (const s of (st.data ?? []) as { id: string; status: string }[]) if (s.status !== 'active') notActive.add(s.id);
      } else if (gid) {
        // команда «U10» объединяет группы U10-A и U10-B: в составе игроки всех её групп
        const sel = groups.find(g => g.id === gid)?.name;
        let ids = [gid];
        if (sel) {
          const gr = await supabase.from('groups').select('id, name');
          if (!gr.error) ids = [...new Set([gid, ...((gr.data ?? []) as CoachGroup[]).filter(g => playsMatches(g.name) && matchTeam(g.name) === matchTeam(sel)).map(g => g.id)])];
        }
        const p = await supabase.from('players').select('id, full_name').in('group_id', ids).eq('status', 'active').order('full_name');
        if (p.error) return setError(p.error.message);
        list = (p.data ?? []) as Player[];
      }
      const init: Record<string, Line> = {};
      let best: string | null = null;
      if (savedId) {
        const mp = await supabase.from('match_players').select('player_id, played, goals, best').eq('match_id', savedId);
        if (mp.error) return setError(mp.error.message);
        const rows = (mp.data ?? []) as { player_id: string; played: boolean; goals: number; best: boolean }[];
        for (const r of rows) {
          init[r.player_id] = { played: r.played, goals: r.goals };
          if (r.best) best = r.player_id;
        }
        // в составе бывают игроки не из группы (гости, старые записи): администратор их видит и правит
        const extra = rows.map(r => r.player_id).filter(id => !list.some(p => p.id === id));
        if (extra.length) {
          const ex = await supabase.from('players').select('id, full_name').in('id', extra);
          if (ex.error) return setError(ex.error.message);
          list = [...list, ...((ex.data ?? []) as Player[])].sort((a, b) => a.full_name.localeCompare(b.full_name));
        }
      }
      // неактивные остаются только там, где у них уже есть запись в этом матче (прошлые матчи не меняются)
      list = list.filter(p => !notActive.has(p.id) || p.id in init);
      setLines(init);
      setBestId(best);
      const playedIds = Object.entries(init).filter(([, l]) => l.played).map(([id]) => id);
      setShownIds(playedIds.length ? playedIds : null);
      setPlayers(list);
    })();
    // состав подгружается при смене группы и при повторной попытке; сохранённый матч не перезагружаем из-за savedId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gid, reload]);

  // Найти любого игрока клуба и добавить в состав (тренеры и администратор)
  useEffect(() => {
    if (q.trim().length < 2) return setFound([]);
    const t = setTimeout(() => {
      void supabase.from('players').select('id, full_name').ilike('full_name', `%${q.trim()}%`).order('full_name').limit(8).then(r => {
        if (!r.error) setFound((r.data ?? []) as Player[]);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const line = (id: string): Line => lines[id] ?? { played: false, goals: 0 };
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
  const total = Object.values(lines).reduce((s, l) => s + (l.played ? l.goals : 0), 0);

  const problem = (): string | null => {
    if ((gf === '') !== (ga === '')) return 'Укажите оба числа счёта или оставьте оба пустыми.';
    if (gf !== '' && date > today()) return 'Счёт нельзя внести для матча, который ещё не прошёл.';
    if (gf !== '' && total > Number(gf)) return 'Голов у игроков больше, чем забила команда.';
    return null;
  };
  const save = async () => {
    const p = problem();
    if (p) return setMsg({ ok: false, text: p });
    // команда без группы: администратор создаёт товарищеский матч по названию команды (миграция 0106)
    const teamOnly = !savedId && !gid && admin && presetMissing;
    if (!savedId && !gid && !teamOnly) return setMsg({ ok: false, text: 'В клубе нет группы для этой команды, матч не сохранить.' });
    setBusy(true);
    setMsg(null);
    const roster = (players ?? []).map(pl => ({ player_id: pl.id, played: line(pl.id).played, goals: line(pl.id).played ? line(pl.id).goals : 0, best: bestId === pl.id && line(pl.id).played }));
    const score = { gf: gf === '' ? null : Number(gf), ga: ga === '' ? null : Number(ga) };
    const r = teamOnly
      ? await supabase.rpc('save_match_team', { tm: presetTeam, d: date, opp, gf: score.gf, ga: score.ga, roster })
      : await supabase.rpc('save_match', { m: savedId, g: gid || null, d: date, opp, gf: score.gf, ga: score.ga, roster });
    setBusy(false);
    if (r.error) return setMsg({ ok: false, text: coachError(r.error.message) });
    setSavedId(r.data as string);
    if (technical !== savedTech) {
      const t = await supabase.rpc('set_match_technical', { m: r.data as string, tech: technical });
      if (t.error) return setMsg({ ok: false, text: `Матч сохранён, но технический результат не записан: ${coachError(t.error.message)}` });
      setSavedTech(technical);
    }
    const playedNow = Object.entries(lines).filter(([, l]) => l.played).map(([id]) => id);
    setShownIds(playedNow.length ? playedNow : null);
    setShowAll(false);
    setMsg({ ok: true, text: 'Матч сохранён. Баллы за матч начислены автоматически.' });
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
  // Убрать игрока из матча совсем (администратор): снять отметку и очки сохранением, затем удалить строку состава.
  // Нужно для ушедших игроков: снятая отметка «играл» оставляла их в составе матча. Тренерам удаление недоступно (запись match_players только у администратора).
  const removeFromMatch = async (p: Player) => {
    if (!savedId) return;
    if (!(await ask({ title: 'Убрать игрока из матча?', note: `${p.full_name}: пропадут его отметка, голы и баллы за этот матч. Из чемпионата и команды он не удаляется.`, confirmLabel: 'Убрать', danger: true }))) return;
    const rest = { ...lines, [p.id]: { played: false, goals: 0 } };
    const g = Object.entries(rest).reduce((s, [, l]) => s + (l.played ? l.goals : 0), 0);
    if (gf !== '' && g > Number(gf)) return setMsg({ ok: false, text: 'Голов у игроков больше, чем забила команда.' });
    setBusy(true);
    setMsg(null);
    const roster = (players ?? []).map(pl => {
      const l = rest[pl.id] ?? { played: false, goals: 0 };
      return { player_id: pl.id, played: l.played, goals: l.played ? l.goals : 0, best: bestId === pl.id && pl.id !== p.id && l.played };
    });
    const r = await supabase.rpc('save_match', { m: savedId, g: gid || null, d: date, opp, gf: gf === '' ? null : Number(gf), ga: ga === '' ? null : Number(ga), roster });
    if (r.error) { setBusy(false); return setMsg({ ok: false, text: coachError(r.error.message) }); }
    const del = await supabase.from('match_players').delete().eq('match_id', savedId).eq('player_id', p.id);
    setBusy(false);
    if (del.error) return setMsg({ ok: false, text: coachError(del.error.message) });
    setPlayers(list => (list ?? []).filter(x => x.id !== p.id));
    setLines(s => { const n = { ...s }; delete n[p.id]; return n; });
    setShownIds(ids => (ids ? ids.filter(id => id !== p.id) : ids));
    if (bestId === p.id) setBestId(null);
    setMsg({ ok: true, text: `${p.full_name} убран из матча.` });
  };
  const native = useMainButton({ text: 'Сохранить матч', visible: true, enabled: !busy && Boolean(players), loading: busy, onClick: () => void save() });

  if (error) return <Failure title="Не удалось загрузить состав" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} back={<BackNav onBack={onBack} managed />} />;
  if (!players) return <Loading />;
  const guests = players.filter(p => guestIds.includes(p.id));

  const canPickGroup = !match && !savedId;
  return (
    <main className="page">
      <BackNav onBack={onBack} managed />
      <h1>{match ? 'Матч' : 'Новый матч'}</h1>
      {canPickGroup && presetMissing && !admin && <p className="error" style={{ marginBottom: 8 }}>В клубе нет группы «{presetTeam}», поэтому матч для неё не сохранить. Вернитесь и выберите другую команду.</p>}
      {canPickGroup && presetMissing && admin && <p className="muted" style={{ marginBottom: 8 }}>Команда «{presetTeam}» без группы: состав собирайте поиском по игрокам клуба.</p>}
      {canPickGroup && !presetMissing && <GroupPicker groups={matchGroups} value={gid} onChange={setGid} />}
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
        Баллы начисляются автоматически, когда внесён счёт: победа — 2 играющим, лучшему игроку — 3; поражение или ничья — 1 играющим; за каждый гол +1. Лучший игрок учитывается только при победе.
      </p>
      {admin && savedId && players.length > 0 && (
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
              <input type="checkbox" checked={line(p.id).played} onChange={e => setLine(p.id, { played: e.target.checked, goals: e.target.checked ? line(p.id).goals : 0 })} />
              <span style={{ overflowWrap: 'anywhere' }}>{p.full_name}</span>
            </label>
            {line(p.id).played && (
              <>
                <div className="ks-line">
                  <span className="ks-muted">Голы</span>
                  <Stepper label={`Голы: ${p.full_name}`} value={line(p.id).goals} max={30} onChange={n => setLine(p.id, { played: true, goals: n })} />
                </div>
                <button type="button" className={`ks-btn ${bestId === p.id ? '' : 'secondary'}`} style={{ marginTop: 8, minHeight: 40 }} aria-pressed={bestId === p.id} onClick={() => { setBestId(bestId === p.id ? null : p.id); setMsg(null); }}>
                  {bestId === p.id ? '★ Лучший игрок матча' : 'Назначить лучшим игроком'}
                </button>
              </>
            )}
            {admin && savedId && editLineup && (
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
      <input className="ks-input" value={q} onChange={e => setQ(e.target.value)} placeholder="Фамилия или имя игрока (от 2 букв)" aria-label="Найти игрока" list="ks-found-names" autoComplete="off" {...searchFocusProps} /><NameDatalist id="ks-found-names" names={found.map(f => f.full_name)} />
      <div style={{ marginTop: 8, marginBottom: 16, display: 'grid', gap: 8 }}>
      {found.filter(f => !players.some(p => p.id === f.id)).map(f => (
        <ListRow key={f.id} avatar={f.full_name} title={f.full_name} end={<button type="button" className="ks-btn secondary" style={{ width: 'auto', minHeight: 40 }} onClick={() => { setPlayers(list => [...(list ?? []), f].sort((a, b) => a.full_name.localeCompare(b.full_name))); setShownIds(ids => (ids ? [...ids, f.id] : ids)); setQ(''); setFound([]); }}>Добавить</button>} />
      ))}
      </div>
      </>
      {msg && <p className={msg.ok ? 'ks-ok' : 'error'}>{msg.text}</p>}
      {feeMode && savedId && (
        <EventFees mode="match" coach={!admin} eventId={savedId} reloadKey={reload} onChanged={() => undefined} addable={players.filter(p => line(p.id).played).map(p => ({ id: p.id, name: p.full_name }))} />
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
    </main>
  );
}
