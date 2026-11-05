import { useEffect, useState } from 'react';
import { coachError, fmtDate, plural, type CoachGroup } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { EmptyState, ListRow, Pill, Segmented } from '../ui/components';
import { GroupPicker } from '../ui/coach';
import NotifyToggle from '../ui/NotifyToggle';
import { BackNav } from '../ui/nav';
import { Failure, Loading } from './Message';
import { useConfirm } from '../ui/ConfirmSheet';

interface Player { id: string; full_name: string }
interface Ev { id: string; points: number; explanation: string; occurred_on: string; source_type: string }
interface ManualRow { id: string; points: number; event_date: string; status: string; cancel_reason: string | null; components: { note?: string } | null }
interface ManualStatus { active: boolean; remaining?: Record<string, number>; month_total?: number; month_cap?: number }
interface Parent { player_id: string; parent_name: string | null; telegram_id: number }

// «Группа»: игроки группы; карточка игрока с ручными баллами и контактами родителей.
export default function Group({ groups, notify = false }: { groups: CoachGroup[]; notify?: boolean }) {
  const [gid, setGid] = useState(groups[0]?.id ?? '');
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [open, setOpen] = useState<Player | null>(null);
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
          const e = await supabase.from('point_events').select('player_id, points').in('player_id', ids.slice(i, i + 100)).order('id').range(from, from + 999);
          if (e.error) return;
          for (const r of (e.data ?? []) as { player_id: string; points: number }[]) sums[r.player_id] = (sums[r.player_id] ?? 0) + r.points;
          if ((e.data ?? []).length < 1000) break;
        }
      }
      setTotals(sums);
    })();
  }, [gid, reload, open]);

  if (error) return <Failure title="Не удалось загрузить группу" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} />;
  if (open) return <PlayerCard gid={gid} player={open} onBack={() => setOpen(null)} />;
  if (!players) return <Loading />;

  return (
    <main className="page">
      <h1>Группа</h1>
      <GroupPicker groups={groups} value={gid} onChange={setGid} />
      {players.length === 0 ? (
        <EmptyState icon="users" title="В группе нет игроков" />
      ) : (
        (totals ? [...players].sort((a, b) => (totals[b.id] ?? 0) - (totals[a.id] ?? 0) || a.full_name.localeCompare(b.full_name, 'ru')) : players).map((p, i) => (
          <ListRow
            key={p.id}
            avatar={p.full_name}
            title={p.full_name}
            sub={totals ? [`Место ${i + 1} по баллам`] : undefined}
            end={totals && <Pill tone="primary">{totals[p.id] ?? 0}</Pill>}
            onClick={() => setOpen(p)}
          />
        ))
      )}
      {notify && <NotifyToggle hint="Бот пришлёт сообщение, когда вам назначат группу. Чтобы сообщения приходили, один раз нажмите «Старт» в чате с ботом клуба." />}
    </main>
  );
}

function PlayerCard({ gid, player, onBack }: { gid: string; player: Player; onBack: () => void }) {
  const { ask, dialog: confirmDialog } = useConfirm();
  const [events, setEvents] = useState<Ev[] | null>(null);
  const [parents, setParents] = useState<Parent[] | null | 'na'>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [pts, setPts] = useState('1');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // новые правила (миграция 0123): пока они не действуют, работают прежние ручные баллы
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
    // новая система: заявка с постоянным req, повтор после обрыва связи не создаёт второе начисление
    const r = manual
      ? await supabase.rpc('points_manual_award', { p: player.id, pts: Number(pts), note, req })
      : await supabase.rpc('award_bonus', { p: player.id, pts: Number(pts), note });
    setBusy(false);
    if (r.error) return setMsg({ ok: false, text: coachError(r.error.message) });
    setReq(crypto.randomUUID());
    setNote('');
    setMsg({ ok: true, text: 'Баллы начислены.' });
    setReload(n => n + 1);
  };
  const askRevoke = async (e: Ev) => {
    if (!(await ask({ title: 'Отменить начисление?', lines: [['Начисление', e.explanation], ['Баллы', `+${e.points}`], ['Дата', fmtDate(e.occurred_on)]], note: 'Баллы будут сняты у игрока.', confirmLabel: 'Отменить начисление', danger: true }))) return;
    await revoke(e.id);
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
  const revoke = async (id: string) => {
    setBusy(true);
    setMsg(null);
    const r = await supabase.rpc('revoke_bonus', { e: id });
    setBusy(false);
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

      <h2 className="ks-sub">Ручные баллы</h2>
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
              (
                <button type="button" className="ks-btn secondary" style={{ marginTop: 8 }} disabled={busy} onClick={() => void askRevoke(e)}>Отменить</button>
              )}
          </div>
        ))
      )}
      {confirmDialog}
    </main>
  );
}
