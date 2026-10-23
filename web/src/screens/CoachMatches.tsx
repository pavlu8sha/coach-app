import { useEffect, useState } from 'react';
import { coachError, fmtDate, today, type CoachGroup } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { EmptyState, ListRow, Pill } from '../ui/components';
import { GroupPicker, Stepper } from '../ui/coach';
import { BackNav, useMainButton } from '../ui/nav';
import { Failure, Loading } from './Message';

interface Match { id: string; team: string; played_on: string; opponent: string | null; goals_for: number | null; goals_against: number | null }
interface Player { id: string; full_name: string }
interface Line { played: boolean; goals: number }

// «Матчи» тренера: матчи своих групп, добавление матча и ввод результата, состава и голов.
export default function CoachMatches({ groups }: { groups: CoachGroup[] }) {
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [form, setForm] = useState<{ match: Match | null } | null>(null);

  useEffect(() => {
    void (async () => {
      const r = await supabase.from('matches').select('id, team, played_on, opponent, goals_for, goals_against').in('team', groups.map(g => g.name)).order('played_on', { ascending: false }).limit(60);
      if (r.error) return setError(r.error.message);
      setMatches((r.data ?? []) as Match[]);
    })();
  }, [groups, reload]);

  if (error) return <Failure title="Не удалось загрузить матчи" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} />;
  if (form) return <MatchForm groups={groups} match={form.match} onBack={() => { setForm(null); setReload(n => n + 1); }} />;
  if (!matches) return <Loading />;

  return (
    <main className="page">
      <h1>Матчи</h1>
      <button type="button" className="ks-btn" onClick={() => setForm({ match: null })}>Добавить матч</button>
      <div style={{ height: 12 }} />
      {matches.length === 0 ? (
        <EmptyState icon="trophy" title="Матчей пока нет" text="Добавьте матч, чтобы внести состав, счёт и голы." />
      ) : (
        matches.map(m => {
          const done = m.goals_for !== null && m.goals_against !== null;
          return (
            <ListRow
              key={m.id}
              title={m.opponent ?? 'Соперник не указан'}
              sub={[`${fmtDate(m.played_on)}${groups.length > 1 ? ' · ' + m.team : ''}`]}
              end={done ? <span className="ks-score">{m.goals_for}:{m.goals_against}</span> : <Pill tone="primary">{m.played_on > today() ? 'Предстоит' : 'Без счёта'}</Pill>}
              onClick={() => setForm({ match: m })}
            />
          );
        })
      )}
    </main>
  );
}

function MatchForm({ groups, match, onBack }: { groups: CoachGroup[]; match: Match | null; onBack: () => void }) {
  const initialGid = match ? groups.find(g => g.name === match.team)?.id ?? groups[0]?.id ?? '' : groups[0]?.id ?? '';
  const [gid, setGid] = useState(initialGid);
  const [date, setDate] = useState(match?.played_on ?? today());
  const [opp, setOpp] = useState(match?.opponent ?? '');
  const [gf, setGf] = useState(match?.goals_for != null ? String(match.goals_for) : '');
  const [ga, setGa] = useState(match?.goals_against != null ? String(match.goals_against) : '');
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [lines, setLines] = useState<Record<string, Line>>({});
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [savedId, setSavedId] = useState<string | null>(match?.id ?? null);

  useEffect(() => {
    setPlayers(null);
    void (async () => {
      const p = await supabase.from('players').select('id, full_name').eq('group_id', gid).eq('status', 'active').order('full_name');
      if (p.error) return setError(p.error.message);
      const init: Record<string, Line> = {};
      if (savedId) {
        const mp = await supabase.from('match_players').select('player_id, played, goals').eq('match_id', savedId);
        if (mp.error) return setError(mp.error.message);
        for (const r of (mp.data ?? []) as { player_id: string; played: boolean; goals: number }[]) init[r.player_id] = { played: r.played, goals: r.goals };
      }
      setLines(init);
      setPlayers((p.data ?? []) as Player[]);
    })();
    // состав подгружается при смене группы и при повторной попытке; сохранённый матч не перезагружаем из-за savedId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gid, reload]);

  const line = (id: string): Line => lines[id] ?? { played: false, goals: 0 };
  const setLine = (id: string, l: Line) => {
    setLines(s => ({ ...s, [id]: l }));
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
    const roster = (players ?? []).map(pl => ({ player_id: pl.id, played: line(pl.id).played, goals: line(pl.id).played ? line(pl.id).goals : 0 }));
    const r = await supabase.rpc('save_match', { m: savedId, g: gid, d: date, opp, gf: gf === '' ? null : Number(gf), ga: ga === '' ? null : Number(ga), roster });
    setBusy(false);
    if (r.error) return setMsg({ ok: false, text: coachError(r.error.message) });
    setSavedId(r.data as string);
    setMsg({ ok: true, text: 'Матч сохранён. Баллы за матч начислены автоматически.' });
  };
  const native = useMainButton({ text: 'Сохранить матч', visible: true, enabled: !busy && Boolean(players), loading: busy, onClick: () => void save() });

  if (error) return <Failure title="Не удалось загрузить состав" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} back={<BackNav onBack={onBack} />} />;
  if (!players) return <Loading />;

  return (
    <main className="page">
      <BackNav onBack={onBack} />
      <h1>{match ? 'Матч' : 'Новый матч'}</h1>
      {!match && !savedId && <GroupPicker groups={groups} value={gid} onChange={setGid} />}
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
      {players.length === 0 ? (
        <EmptyState icon="users" title="В группе нет игроков" />
      ) : (
        players.map(p => (
          <div className="ks-card" key={p.id}>
            <label className="ks-check">
              <input type="checkbox" checked={line(p.id).played} onChange={e => setLine(p.id, { played: e.target.checked, goals: e.target.checked ? line(p.id).goals : 0 })} />
              <span style={{ overflowWrap: 'anywhere' }}>{p.full_name}</span>
            </label>
            {line(p.id).played && (
              <div className="ks-line">
                <span className="ks-muted">Голы</span>
                <Stepper label={`Голы: ${p.full_name}`} value={line(p.id).goals} max={30} onChange={n => setLine(p.id, { played: true, goals: n })} />
              </div>
            )}
          </div>
        ))
      )}
      {msg && <p className={msg.ok ? 'ks-ok' : 'error'}>{msg.text}</p>}
      {!native && (
        <button type="button" className="ks-btn" disabled={busy} onClick={() => void save()}>
          Сохранить матч
        </button>
      )}
    </main>
  );
}
