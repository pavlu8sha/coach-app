import { useEffect, useState } from 'react';
import { coachError, fmtDate, today, type CoachGroup } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { EmptyState, ListRow, Pill } from '../ui/components';
import { GroupPicker, Stepper } from '../ui/coach';
import { BackNav, useMainButton } from '../ui/nav';
import { Failure, Loading } from './Message';

interface Match { id: string; team: string; played_on: string; opponent: string | null; goals_for: number | null; goals_against: number | null }
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
  const [form, setForm] = useState<{ match: Match | null } | null>(null);
  const [team, setTeam] = useState('');
  const [tours, setTours] = useState<Map<string, Tour>>(new Map());

  useEffect(() => {
    void (async () => {
      // турниры матчей: без них (старая база, нет связи) список остаётся плоским
      const t = await supabase.rpc('match_tournaments');
      if (!t.error) setTours(new Map(((t.data ?? []) as Tour[]).map(x => [x.match_id, x])));
      let q = supabase.from('matches').select('id, team, played_on, opponent, goals_for, goals_against');
      if (!showAll) q = q.in('team', groups.map(g => g.name));
      const r = await q.order('played_on', { ascending: false }).limit(showAll ? 150 : 60);
      if (r.error) return setError(r.error.message);
      setMatches((r.data ?? []) as Match[]);
    })();
  }, [groups, showAll, reload]);

  if (error) return <Failure title="Не удалось загрузить матчи" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} />;
  if (form) return <MatchForm groups={groups} match={form.match} admin={admin} onBack={() => { setForm(null); setReload(n => n + 1); }} />;
  if (!matches) return <Loading />;

  const teams = [...new Set(matches.map(m => m.team))].sort();
  const shown = team ? matches.filter(m => m.team === team) : matches;
  // чемпионаты и фестивали — по турниру (самый свежий сверху), товарищеские и кубки — одним разделом
  const sections: { key: string; title: string; items: Match[] }[] = [];
  const byTour = new Map<string, { title: string; items: Match[] }>();
  const other: Match[] = [];
  for (const m of shown) {
    const t = tours.get(m.id);
    if (t?.tournament_id && t.match_kind !== 'friendly' && t.tournament_kind !== 'cup') {
      const g = byTour.get(t.tournament_id) ?? { title: `${t.tournament_name ?? (t.tournament_kind === 'festival' ? 'Фестиваль' : 'Чемпионат')}${showAll || groups.length > 1 ? ' · ' + m.team : ''}`, items: [] };
      g.items.push(m);
      byTour.set(t.tournament_id, g);
    } else other.push(m);
  }
  for (const [id, g] of byTour) sections.push({ key: id, ...g });
  if (other.length) sections.push({ key: 'other', title: byTour.size ? 'Товарищеские и кубки' : 'Матчи', items: other });
  return (
    <main className="page">
      <h1>Матчи</h1>
      <button type="button" className="ks-btn" onClick={() => setForm({ match: null })}>Добавить матч</button>
      <div style={{ height: 12 }} />
      {showAll && teams.length > 1 && (
        <select className="ks-select" aria-label="Команда" value={team} onChange={e => setTeam(e.target.value)}>
          <option value="">Все команды</option>
          {teams.map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      )}
      {shown.length === 0 ? (
        <EmptyState icon="trophy" title="Матчей пока нет" text="Добавьте матч, чтобы внести состав, счёт и голы." />
      ) : (
        sections.map(sec => (
          <section key={sec.key}>
            <p className="ks-label">{sec.title}</p>
            {sec.items.map(m => {
              const done = m.goals_for !== null && m.goals_against !== null;
              const cup = sec.key === 'other' ? tours.get(m.id) : undefined;
              const cupName = cup && cup.match_kind !== 'friendly' ? cup.tournament_name : null;
              return (
                <ListRow
                  key={m.id}
                  title={m.opponent ?? 'Соперник не указан'}
                  sub={[`${fmtDate(m.played_on)}${showAll || groups.length > 1 ? ' · ' + m.team : ''}${cupName ? ' · ' + cupName : ''}`]}
                  end={done ? <span className="ks-score">{m.goals_for}:{m.goals_against}</span> : <Pill tone="primary">{m.played_on > today() ? 'Предстоит' : 'Без счёта'}</Pill>}
                  onClick={() => setForm({ match: m })}
                />
              );
            })}
          </section>
        ))
      )}
    </main>
  );
}

function MatchForm({ groups, match, admin, onBack }: { groups: CoachGroup[]; match: Match | null; admin: boolean; onBack: () => void }) {
  const matched = match ? groups.find(g => g.name === match.team)?.id : undefined;
  // у тренера матч всегда своей группы; у администратора название команды может не совпасть ни с одной группой — тогда группа не нужна
  const initialGid = match ? matched ?? (admin ? '' : groups[0]?.id ?? '') : groups[0]?.id ?? '';
  const [gid, setGid] = useState(initialGid);
  const [date, setDate] = useState(match?.played_on ?? today());
  const [opp, setOpp] = useState(match?.opponent ?? '');
  const [gf, setGf] = useState(match?.goals_for != null ? String(match.goals_for) : '');
  const [ga, setGa] = useState(match?.goals_against != null ? String(match.goals_against) : '');
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [lines, setLines] = useState<Record<string, Line>>({});
  const [bestId, setBestId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [savedId, setSavedId] = useState<string | null>(match?.id ?? null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Player[]>([]);

  useEffect(() => {
    setPlayers(null);
    void (async () => {
      let list: Player[] = [];
      if (gid) {
        const p = await supabase.from('players').select('id, full_name').eq('group_id', gid).eq('status', 'active').order('full_name');
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
        if (extra.length && admin) {
          const ex = await supabase.from('players').select('id, full_name').in('id', extra);
          if (ex.error) return setError(ex.error.message);
          list = [...list, ...((ex.data ?? []) as Player[])].sort((a, b) => a.full_name.localeCompare(b.full_name));
        }
      }
      setLines(init);
      setBestId(best);
      setPlayers(list);
    })();
    // состав подгружается при смене группы и при повторной попытке; сохранённый матч не перезагружаем из-за savedId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gid, reload]);

  // Администратор: найти любого игрока клуба и добавить в состав
  useEffect(() => {
    if (!admin || q.trim().length < 2) return setFound([]);
    const t = setTimeout(() => {
      void supabase.from('players').select('id, full_name').ilike('full_name', `%${q.trim()}%`).order('full_name').limit(8).then(r => {
        if (!r.error) setFound((r.data ?? []) as Player[]);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [q, admin]);

  const line = (id: string): Line => lines[id] ?? { played: false, goals: 0 };
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
    setBusy(true);
    setMsg(null);
    const roster = (players ?? []).map(pl => ({ player_id: pl.id, played: line(pl.id).played, goals: line(pl.id).played ? line(pl.id).goals : 0, best: bestId === pl.id && line(pl.id).played }));
    const r = await supabase.rpc('save_match', { m: savedId, g: gid || null, d: date, opp, gf: gf === '' ? null : Number(gf), ga: ga === '' ? null : Number(ga), roster });
    setBusy(false);
    if (r.error) return setMsg({ ok: false, text: coachError(r.error.message) });
    setSavedId(r.data as string);
    setMsg({ ok: true, text: 'Матч сохранён. Баллы за матч начислены автоматически.' });
  };
  const remove = async () => {
    if (!savedId || !window.confirm('Удалить матч вместе с составом и начисленными за него баллами? Отменить нельзя.')) return;
    setBusy(true);
    const r = await supabase.rpc('delete_match', { m: savedId });
    setBusy(false);
    if (r.error) return setMsg({ ok: false, text: coachError(r.error.message) });
    onBack();
  };
  const native = useMainButton({ text: 'Сохранить матч', visible: true, enabled: !busy && Boolean(players), loading: busy, onClick: () => void save() });

  if (error) return <Failure title="Не удалось загрузить состав" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} back={<BackNav onBack={onBack} />} />;
  if (!players) return <Loading />;

  const canPickGroup = !match && !savedId;
  return (
    <main className="page">
      <BackNav onBack={onBack} />
      <h1>{match ? 'Матч' : 'Новый матч'}</h1>
      {canPickGroup && <GroupPicker groups={groups} value={gid} onChange={setGid} />}
      {match && admin && <p className="muted" style={{ marginBottom: 8 }}>Команда: {match.team}</p>}
      <label className="ks-label" htmlFor="m-date">Дата</label>
      <input id="m-date" className="ks-input" type="date" value={date} onChange={e => { setDate(e.target.value); setMsg(null); }} />
      <label className="ks-label" htmlFor="m-opp">Соперник</label>
      <input id="m-opp" className="ks-input" value={opp} onChange={e => setOpp(e.target.value)} placeholder="Название команды" maxLength={80} />
      <p className="ks-label">Счёт (наша команда : соперник)</p>
      <div className="ks-line">
        <input className="ks-input" style={{ width: 90 }} inputMode="numeric" aria-label="Забила наша команда" value={gf} onChange={e => setGf(e.target.value.replace(/\D/g, '').slice(0, 2))} placeholder="—" />
        <b>:</b>
        <input className="ks-input" style={{ width: 90 }} inputMode="numeric" aria-label="Забил соперник" value={ga} onChange={e => setGa(e.target.value.replace(/\D/g, '').slice(0, 2))} placeholder="—" />
      </div>
      <h3>Состав</h3>
      <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
        Баллы начисляются автоматически, когда внесён счёт: победа — 2 играющим, лучшему игроку — 3; поражение или ничья — 1 играющим; за каждый гол +1. Лучший игрок учитывается только при победе.
      </p>
      {players.length === 0 ? (
        <EmptyState icon="users" title="В составе пока никого" text={admin ? 'Найдите игрока ниже, чтобы добавить его в состав.' : 'В группе нет игроков.'} />
      ) : (
        players.map(p => (
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
          </div>
        ))
      )}
      {admin && (
        <>
          <h3>Добавить в состав</h3>
          <input className="ks-input" value={q} onChange={e => setQ(e.target.value)} placeholder="Фамилия или имя игрока (от 2 букв)" aria-label="Найти игрока" />
          {found.filter(f => !players.some(p => p.id === f.id)).map(f => (
            <ListRow key={f.id} avatar={f.full_name} title={f.full_name} end={<button type="button" className="ks-btn secondary" style={{ width: 'auto', minHeight: 40 }} onClick={() => { setPlayers(list => [...(list ?? []), f].sort((a, b) => a.full_name.localeCompare(b.full_name))); setQ(''); setFound([]); }}>Добавить</button>} />
          ))}
        </>
      )}
      {msg && <p className={msg.ok ? 'ks-ok' : 'error'}>{msg.text}</p>}
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
    </main>
  );
}
