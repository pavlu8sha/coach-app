import { useEffect, useState } from 'react';
import { coachError, fmtDate, plural, type CoachGroup } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { useNav, useNavState } from '../nav';
import { EmptyState, ListRow, Pill, Segmented } from '../ui/components';
import { GroupPicker } from '../ui/coach';
import NotifyToggle from '../ui/NotifyToggle';
import { BackNav } from '../ui/nav';
import { Failure, Loading } from './Message';
import PointsLedger from './PointsLedger';

interface Player { id: string; full_name: string }
interface ManualRow { id: string; points: number; event_date: string; status: string; cancel_reason: string | null; components: { note?: string } | null }
interface ManualStatus { active: boolean; remaining?: Record<string, number>; month_total?: number; month_cap?: number }
interface Parent { player_id: string; parent_name: string | null; telegram_id: number }

// «Группа»: игроки группы; карточка игрока с ручными баллами и контактами родителей.
export default function Group({ groups, notify = false }: { groups: CoachGroup[]; notify?: boolean }) {
  // Выбранная группа возвращается при «Назад» из карточки игрока; карточка — запись стека раздела
  const nav = useNav();
  const [gidPick, setGid] = useNavState('gid', groups[0]?.id ?? '', { entry: 0, persist: { kind: 'uuid' } });
  const gid = groups.some(g => g.id === gidPick) ? gidPick : groups[0]?.id ?? ''; // сохранённой группы может уже не быть
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [totals, setTotals] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    setPlayers(null);
    setTotals(null);
    void (async () => {
      const p = await supabase.from('players').select('id, full_name').eq('group_id', gid).eq('status', 'active').order('full_name');
      if (p.error) return setError(p.error.message);
      const list = (p.data ?? []) as Player[];
      setPlayers(list);
      // Рейтинг по баллам: если баллы не загрузились, список остаётся по алфавиту
      const sums: Record<string, number> = {};
      const ids = list.map(x => x.id);
      for (let i = 0; i < ids.length; i += 100) {
        for (let from = 0; ; from += 1000) {
          const e = await supabase.from('points_ledger').select('player_id, points').eq('status', 'active').in('player_id', ids.slice(i, i + 100)).order('id').range(from, from + 999);
          if (e.error) return;
          for (const r of (e.data ?? []) as { player_id: string; points: number }[]) sums[r.player_id] = (sums[r.player_id] ?? 0) + r.points;
          if ((e.data ?? []).length < 1000) break;
        }
      }
      setTotals(sums);
    })();
  }, [gid, reload, nav.top.screen]);

  if (error) return <Failure title="Не удалось загрузить группу" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} />;
  const open = nav.top.screen === 'player' ? (players ?? []).find(p => p.id === nav.top.params.id) : undefined;
  if (open) return <PlayerCard gid={gid} player={open} onBack={() => nav.back()} />;
  if (!players) return <Loading />;

  return (
    <main className="page">
      <h1>Группа</h1>
      <GroupPicker groups={groups} value={gid} onChange={setGid} />
      {players.length === 0 ? (
        <EmptyState icon="users" title="В группе нет игроков" />
      ) : (
        (() => {
          const list = totals ? [...players].sort((a, b) => (totals[b.id] ?? 0) - (totals[a.id] ?? 0) || a.full_name.localeCompare(b.full_name, 'ru')) : players;
          const places = totals ? competitionPlaces(list.map(p => totals[p.id] ?? 0)) : [];
          return list.map((p, i) => (
            <ListRow
              key={p.id}
              avatar={p.full_name}
              title={p.full_name}
              sub={totals ? [`Место ${places[i]} по баллам`] : undefined}
              end={totals && <Pill tone="primary">{totals[p.id] ?? 0}</Pill>}
              onClick={() => nav.push('player', { id: p.id })}
            />
          ));
        })()
      )}
      {notify && <NotifyToggle hint="Бот пришлёт сообщение, когда вам назначат группу. Чтобы сообщения приходили, один раз нажмите «Старт» в чате с ботом клуба." />}
    </main>
  );
}

// Места при равных баллах: равные баллы делят место, следующее пропускается (1, 1, 1, 4).
// Вход отсортирован по убыванию баллов.
export function competitionPlaces(sortedDesc: number[]): number[] {
  const out: number[] = [];
  sortedDesc.forEach((v, i) => out.push(i > 0 && v === sortedDesc[i - 1] ? out[i - 1] : i + 1));
  return out;
}

function PlayerCard({ gid, player, onBack }: { gid: string; player: Player; onBack: () => void }) {
  const [ledger, setLedger] = useState<{ total: number; count: number } | null>(null);
  const [parents, setParents] = useState<Parent[] | null | 'na'>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [pts, setPts] = useState('1');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // ручные баллы по правилам (миграция 0123); пока правила не действуют, начислять нельзя
  const [manual, setManual] = useState<ManualStatus | null>(null);
  const [manualRows, setManualRows] = useState<ManualRow[]>([]);
  const [req, setReq] = useState(() => crypto.randomUUID());
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  useEffect(() => {
    void (async () => {
      const st = await supabase.rpc('points_manual_status', { p: player.id });
      const info = st.error ? null : (st.data as ManualStatus | null);
      setManual(info?.active ? info : null);
      if (!info?.active) return setManualRows([]);
      const rows = await supabase.from('points_ledger').select('id, points, event_date, status, cancel_reason, components').eq('player_id', player.id).eq('source_type', 'manual').order('event_date', { ascending: false }).order('created_at', { ascending: false }).limit(30);
      setManualRows(rows.error ? [] : ((rows.data ?? []) as ManualRow[]));
    })();
  }, [player.id, reload]);

  useEffect(() => {
    void (async () => {
      let total = 0;
      let count = 0;
      for (let from = 0; ; from += 1000) {
        const e = await supabase.from('points_ledger').select('id, points').eq('player_id', player.id).eq('status', 'active').order('id').range(from, from + 999);
        if (e.error) return setError(e.error.message);
        for (const r of (e.data ?? []) as { points: number }[]) { total += r.points; count += 1; }
        if ((e.data ?? []).length < 1000) break;
      }
      setLedger({ total, count });
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
    // новая система: заявка с постоянным req, повтор после обрыва связи не создаёт второе начисление
    const r = await supabase.rpc('points_manual_award', { p: player.id, pts: Number(pts), note, req });
    setBusy(false);
    if (r.error) return setMsg({ ok: false, text: coachError(r.error.message) });
    setReq(crypto.randomUUID());
    setNote('');
    setMsg({ ok: true, text: 'Баллы начислены.' });
    setReload(n => n + 1);
  };
  const cancelManual = async (id: string) => {
    setBusy(true);
    setMsg(null);
    const r = await supabase.rpc('points_manual_cancel', { entry: id, reason });
    setBusy(false);
    if (r.error) return setMsg({ ok: false, text: coachError(r.error.message) });
    setCancelId(null);
    setReason('');
    setMsg({ ok: true, text: 'Начисление отменено.' });
    setReload(n => n + 1);
  };
  if (error) return <Failure title="Не удалось загрузить игрока" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} back={<BackNav onBack={onBack} managed />} />;
  if (!ledger) return <Loading />;

  const total = ledger.total;
  return (
    <main className="page">
      <BackNav onBack={onBack} managed />
      <h1 style={{ overflowWrap: 'anywhere' }}>{player.full_name}</h1>
      <p className="muted" style={{ marginBottom: 12 }}>Всего: {total} {plural(total)}{ledger.count > 0 ? ` · начислений: ${ledger.count}` : ''}</p>

      <h2 className="ks-sub">Ручные баллы</h2>
      {!manual ? (
        <p className="muted">Ручные баллы доступны, когда действуют правила баллов.</p>
      ) : (
      <div className="ks-card">
        <Segmented
          label="Сколько баллов"
          value={pts}
          onChange={setPts}
          items={(manual?.remaining ? Object.keys(manual.remaining).sort() : ['1', '2', '3', '4', '5']).map(v => ({ value: v, label: '+' + v }))}
        />
        {manual?.remaining && (
          <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
            Осталось в этом месяце: {Object.keys(manual.remaining).sort().map(k => `+${k} — ${manual.remaining?.[k] ?? 0}`).join(', ')}. Всего за месяц {manual.month_total ?? 0} из {manual.month_cap ?? 0}.
          </p>
        )}
        <label className="ks-label" htmlFor="b-note">За что (увидит родитель)</label>
        <input id="b-note" className="ks-input" value={note} maxLength={200} onChange={e => { setNote(e.target.value); setMsg(null); }} placeholder="Например: отлично играл в защите" />
        {msg && <p className={msg.ok ? 'ks-ok' : 'error'}>{msg.text}</p>}
        <div style={{ height: 10 }} />
        <button type="button" className="ks-btn" disabled={busy || note.trim() === ''} onClick={() => void award()}>
          Начислить
        </button>
      </div>
      )}

      <h2 className="ks-sub">Родители</h2>
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

      {manual && manualRows.length > 0 && (
        <>
          <h2 className="ks-sub">Ручные начисления</h2>
          {manualRows.map(m => (
            <div className="ks-card" key={m.id}>
              <div className="ks-line">
                <span style={{ overflowWrap: 'anywhere', minWidth: 0 }}>{m.components?.note ?? 'Без комментария'}</span>
                <Pill tone="primary">+{m.points}</Pill>
              </div>
              <div className="ks-muted" style={{ fontSize: 13 }}>{fmtDate(m.event_date)}{m.status === 'cancelled' ? ` · отменено: ${m.cancel_reason ?? ''}` : ''}</div>
              {m.status === 'active' && cancelId !== m.id && (
                <button type="button" className="ks-btn secondary" style={{ marginTop: 8 }} disabled={busy} onClick={() => { setCancelId(m.id); setReason(''); setMsg(null); }}>Отменить</button>
              )}
              {cancelId === m.id && (
                <div style={{ marginTop: 8 }}>
                  <label className="ks-label" htmlFor="b-reason">Причина отмены</label>
                  <input id="b-reason" className="ks-input" value={reason} maxLength={200} onChange={e => setReason(e.target.value)} placeholder="Например: начислил не тому ребёнку" />
                  <div className="ks-actions" style={{ marginTop: 8 }}>
                    <button type="button" className="ks-btn secondary" onClick={() => setCancelId(null)}>Не отменять</button>
                    <button type="button" className="ks-btn" disabled={busy || reason.trim() === ''} onClick={() => void cancelManual(m.id)}>Подтвердить отмену</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </>
      )}

      <h2 className="ks-sub">История баллов</h2>
      {ledger.count === 0 ? <p className="muted">Начислений пока нет.</p> : <PointsLedger playerId={player.id} />}
    </main>
  );
}
