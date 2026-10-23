import { useEffect, useState } from 'react';
import { coachError, fmtDate, plural, type CoachGroup } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { EmptyState, ListRow, Pill, Segmented } from '../ui/components';
import { GroupPicker } from '../ui/coach';
import { BackNav } from '../ui/nav';
import { Failure, Loading } from './Message';
import Stats from './Stats';

interface Player { id: string; full_name: string }
interface Ev { id: string; points: number; explanation: string; occurred_on: string; source_type: string }
interface Parent { player_id: string; parent_name: string | null; telegram_id: number }

// «Группа»: игроки группы; карточка игрока с ручными баллами и контактами родителей.
export default function Group({ groups, withStats = false }: { groups: CoachGroup[]; withStats?: boolean }) {
  const [stats, setStats] = useState(false);
  const [gid, setGid] = useState(groups[0]?.id ?? '');
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [open, setOpen] = useState<Player | null>(null);

  useEffect(() => {
    setPlayers(null);
    void (async () => {
      const p = await supabase.from('players').select('id, full_name').eq('group_id', gid).eq('status', 'active').order('full_name');
      if (p.error) return setError(p.error.message);
      setPlayers((p.data ?? []) as Player[]);
    })();
  }, [gid, reload]);

  if (error) return <Failure title="Не удалось загрузить группу" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} />;
  if (stats) return <><div style={{ maxWidth: 560, margin: '0 auto', padding: '8px 16px 0' }}><button type="button" className="ks-back" onClick={() => setStats(false)}><span className="ks-chev back" aria-hidden="true" />Группа</button></div><Stats /></>;
  if (open) return <PlayerCard gid={gid} player={open} onBack={() => setOpen(null)} />;
  if (!players) return <Loading />;

  return (
    <main className="page">
      <h1>Группа</h1>
      <GroupPicker groups={groups} value={gid} onChange={setGid} />
      {withStats && <ListRow title="Статистика посещаемости" sub={['Ваши группы за период']} onClick={() => setStats(true)} />}
      {players.length === 0 ? (
        <EmptyState icon="users" title="В группе нет игроков" />
      ) : (
        players.map(p => <ListRow key={p.id} avatar={p.full_name} title={p.full_name} onClick={() => setOpen(p)} />)
      )}
    </main>
  );
}

function PlayerCard({ gid, player, onBack }: { gid: string; player: Player; onBack: () => void }) {
  const [events, setEvents] = useState<Ev[] | null>(null);
  const [parents, setParents] = useState<Parent[] | null | 'na'>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [pts, setPts] = useState('1');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    void (async () => {
      const all: Ev[] = [];
      for (let from = 0; ; from += 1000) {
        const e = await supabase.from('point_events').select('id, points, explanation, occurred_on, source_type').eq('player_id', player.id).order('occurred_on', { ascending: false }).order('id').range(from, from + 999);
        if (e.error) return setError(e.error.message);
        all.push(...((e.data ?? []) as Ev[]));
        if ((e.data ?? []).length < 1000) break;
      }
      setEvents(all);
    })();
  }, [player.id, reload]);

  useEffect(() => {
    void (async () => {
      const r = await supabase.rpc('group_parents', { g: gid });
      if (r.error) return setParents('na'); // функции нет или нет прав: контакты просто не показываем
      setParents(((r.data ?? []) as Parent[]).filter(x => x.player_id === player.id));
    })();
  }, [gid, player.id]);

  const award = async () => {
    setBusy(true);
    setMsg(null);
    const r = await supabase.rpc('award_bonus', { p: player.id, pts: Number(pts), note });
    setBusy(false);
    if (r.error) return setMsg({ ok: false, text: coachError(r.error.message) });
    setNote('');
    setMsg({ ok: true, text: 'Баллы начислены.' });
    setReload(n => n + 1);
  };
  const revoke = async (id: string) => {
    setBusy(true);
    setMsg(null);
    const r = await supabase.rpc('revoke_bonus', { e: id });
    setBusy(false);
    setConfirmId(null);
    if (r.error) setMsg({ ok: false, text: coachError(r.error.message) });
    setReload(n => n + 1);
  };

  if (error) return <Failure title="Не удалось загрузить игрока" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} back={<BackNav onBack={onBack} />} />;
  if (!events) return <Loading />;

  const total = events.reduce((s, e) => s + e.points, 0);
  return (
    <main className="page">
      <BackNav onBack={onBack} />
      <h1 style={{ overflowWrap: 'anywhere' }}>{player.full_name}</h1>
      <p className="muted" style={{ marginBottom: 12 }}>Всего: {total} {plural(total)}</p>

      <h3>Ручные баллы</h3>
      <div className="ks-card">
        <Segmented
          label="Сколько баллов"
          value={pts}
          onChange={setPts}
          items={['1', '2', '3', '4', '5'].map(v => ({ value: v, label: '+' + v }))}
        />
        <label className="ks-label" htmlFor="b-note">За что (увидит родитель)</label>
        <input id="b-note" className="ks-input" value={note} maxLength={200} onChange={e => { setNote(e.target.value); setMsg(null); }} placeholder="Например: отлично играл в защите" />
        {msg && <p className={msg.ok ? 'ks-ok' : 'error'}>{msg.text}</p>}
        <div style={{ height: 10 }} />
        <button type="button" className="ks-btn" disabled={busy || note.trim() === ''} onClick={() => void award()}>
          Начислить
        </button>
      </div>

      <h3>Родители</h3>
      {parents === null ? (
        <p className="muted">Загрузка…</p>
      ) : parents === 'na' ? (
        <p className="muted">Контакты недоступны.</p>
      ) : parents.length === 0 ? (
        <p className="muted">Контактов нет: родитель не привязан или не дал согласие на показ контакта тренеру.</p>
      ) : (
        parents.map(p => (
          <div className="ks-card" key={p.telegram_id}>
            <b style={{ overflowWrap: 'anywhere' }}>{p.parent_name ?? 'Без имени'}</b>
            <div className="ks-muted">Telegram ID {p.telegram_id}</div>
            <div style={{ height: 8 }} />
            <a className="ks-btn secondary" style={{ textDecoration: 'none' }} href={`tg://user?id=${p.telegram_id}`}>Написать в Telegram</a>
          </div>
        ))
      )}

      <h3>История баллов</h3>
      {events.length === 0 ? (
        <p className="muted">Начислений пока нет.</p>
      ) : (
        events.slice(0, 15).map(e => (
          <div className="ks-card" key={e.id}>
            <div className="ks-line">
              <span style={{ overflowWrap: 'anywhere', minWidth: 0 }}>{e.explanation}</span>
              <Pill tone="primary">+{e.points}</Pill>
            </div>
            <div className="ks-muted" style={{ fontSize: 13 }}>{fmtDate(e.occurred_on)}</div>
            {e.source_type === 'coach' &&
              (confirmId === e.id ? (
                <div style={{ marginTop: 8 }}>
                  <button type="button" className="ks-btn" disabled={busy} onClick={() => void revoke(e.id)}>Отменить начисление</button>
                  <div style={{ height: 8 }} />
                  <button type="button" className="ks-btn secondary" disabled={busy} onClick={() => setConfirmId(null)}>Не отменять</button>
                </div>
              ) : (
                <button type="button" className="ks-btn secondary" style={{ marginTop: 8 }} onClick={() => setConfirmId(e.id)}>Отменить</button>
              ))}
          </div>
        ))
      )}
    </main>
  );
}
