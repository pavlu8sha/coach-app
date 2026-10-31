import { useEffect, useState } from 'react';
import { coachError, fmtDate, plural } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { EmptyState, Pill } from '../ui/components';
import { Loading } from './Message';
import { gel } from './MonthPayments';

// Вкладки карточки игрока (только просмотр; платежи — вкладки «Абонемент» и «К оплате»). Каждая вкладка читает свои таблицы по player_id.
function useRows<T>(load: () => PromiseLike<{ data: unknown; error: { message: string } | null }>, deps: unknown[]) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setRows(null);
    setError(null);
    void load().then(r => (r.error ? setError(r.error.message) : setRows((r.data ?? []) as T[])));
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return { rows, error };
}
const Err = ({ text }: { text: string }) => <p className="error">{coachError(text)}</p>;

interface Ind { session_id: string; amount: number; paid: boolean; attended: boolean | null; individual_sessions: { starts_at: string; goalkeepers: boolean; topic: string | null } | null }
interface Ext { session_id: string; paid: boolean; paid_amount: number | null; attended: boolean | null; extra_sessions: { starts_on: string; amount: number; place: string | null } | null }

export function SessionsTab({ playerId }: { playerId: string }) {
  const ind = useRows<Ind>(() => supabase.from('individual_bookings').select('session_id, amount, paid, attended, individual_sessions(starts_at, goalkeepers, topic)').eq('player_id', playerId).limit(300), [playerId]);
  const ext = useRows<Ext>(() => supabase.from('extra_bookings').select('session_id, paid, paid_amount, attended, extra_sessions(starts_on, amount, place)').eq('player_id', playerId).limit(300), [playerId]);
  if (ind.error || ext.error) return <Err text={(ind.error ?? ext.error)!} />;
  if (!ind.rows || !ext.rows) return <Loading />;
  const items = [
    ...ind.rows.filter(b => b.individual_sessions).map(b => ({ key: 'i' + b.session_id, date: b.individual_sessions!.starts_at.slice(0, 10), title: b.individual_sessions!.goalkeepers ? 'Вратари' : 'Индивидуальное', sub: b.individual_sessions!.topic, due: Number(b.amount), paid: b.paid, attended: b.attended })),
    ...ext.rows.filter(b => b.extra_sessions).map(b => ({ key: 'e' + b.session_id, date: b.extra_sessions!.starts_on, title: 'Дополнительная тренировка', sub: b.extra_sessions!.place, due: Number(b.extra_sessions!.amount), paid: b.paid, attended: b.attended })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  if (items.length === 0) return <EmptyState icon="users" title="Занятий нет" text="Игрок не записан на индивидуальные, вратарские и дополнительные тренировки." />;
  return (
    <>
      <p className="muted" style={{ marginBottom: 8 }}>Всего: {items.length} · не оплачено: {items.filter(i => !i.paid && i.due > 0).length}</p>
      {items.map(i => (
        <div className="ks-card" key={i.key}>
          <div className="ks-line"><b>{fmtDate(i.date)} · {i.title}</b><Pill tone={i.paid ? 'success' : i.due > 0 ? 'danger' : 'neutral'} dot>{i.paid ? 'Оплачено' : i.due > 0 ? gel(i.due) : 'Без оплаты'}</Pill></div>
          <div className="ks-muted" style={{ fontSize: 13 }}>{[i.sub, i.attended === true ? 'был' : i.attended === false ? 'не был' : null].filter(Boolean).join(' · ')}</div>
        </div>
      ))}
    </>
  );
}

interface Ord { id: string; ordered_on: string | null; total: number; paid: number; installment: boolean; number: string | null; equipment_order_lines: { kit: string; size: string | null; quantity: number }[]; equipment_issues: { kit: string; issued_on: string }[] }

export function EquipmentTab({ playerId }: { playerId: string }) {
  const { rows, error } = useRows<Ord>(() => supabase.from('equipment_orders').select('id, ordered_on, total, paid, installment, number, equipment_order_lines(kit, size, quantity), equipment_issues(kit, issued_on)').eq('player_id', playerId).order('ordered_on', { ascending: false }), [playerId]);
  if (error) return <Err text={error} />;
  if (!rows) return <Loading />;
  if (rows.length === 0) return <EmptyState icon="box" title="Заказов нет" text="У игрока нет заказов экипировки." />;
  const playerNumber = [...rows].sort((x, y) => (y.ordered_on ?? '').localeCompare(x.ordered_on ?? '')).map(o => (o.number ?? '').trim()).find(Boolean);
  return (
    <>
      {playerNumber && <p style={{ marginBottom: 8 }}>Номер игрока: <b>{playerNumber}</b></p>}
      {rows.map(o => {
        const kits = [...new Set(o.equipment_order_lines.map(l => l.kit))];
        const issued = new Set(o.equipment_issues.map(i => i.kit));
        const left = Number(o.total) - Number(o.paid);
        return (
          <div className="ks-card" key={o.id}>
            <div className="ks-line"><b style={{ overflowWrap: 'anywhere' }}>{kits.join(' + ') || 'Заказ'}</b><Pill tone={left <= 0 ? 'success' : 'danger'} dot>{left <= 0 ? 'Оплачен' : `${gel(Number(o.paid))} из ${gel(Number(o.total))}`}</Pill></div>
            <div className="ks-muted" style={{ fontSize: 13 }}>{[o.ordered_on ? fmtDate(o.ordered_on) : 'без даты', o.number ? `№ ${o.number}` : null, o.installment ? 'рассрочка' : null].filter(Boolean).join(' · ')}</div>
            <div className="ks-muted" style={{ fontSize: 13 }}>Выдано: {kits.filter(k => issued.has(k)).length} из {kits.length}{kits.length > 0 && kits.every(k => issued.has(k)) ? ' (всё)' : ''}</div>
          </div>
        );
      })}
    </>
  );
}

interface Mp { played: boolean; goals: number; matches: { played_on: string; team: string; opponent: string | null; goals_for: number | null; goals_against: number | null } | null }

export function MatchesTab({ playerId }: { playerId: string }) {
  const { rows, error } = useRows<Mp>(() => supabase.from('match_players').select('played, goals, matches(played_on, team, opponent, goals_for, goals_against)').eq('player_id', playerId).limit(300), [playerId]);
  if (error) return <Err text={error} />;
  if (!rows) return <Loading />;
  const list = rows.filter(r => r.matches && (r.played || r.goals > 0)).sort((a, b) => b.matches!.played_on.localeCompare(a.matches!.played_on));
  if (list.length === 0) return <EmptyState icon="trophy" title="Матчей нет" text="Игрок ещё не выходил в матчах." />;
  const goals = list.reduce((s, r) => s + Number(r.goals), 0);
  return (
    <>
      <p className="muted" style={{ marginBottom: 8 }}>Матчей: {list.filter(r => r.played).length} · голов: {goals}</p>
      {list.map((r, i) => {
        const m = r.matches!;
        const score = m.goals_for !== null && m.goals_against !== null ? `${m.goals_for}:${m.goals_against}` : '—';
        return (
          <div className="ks-card" key={i}>
            <div className="ks-line"><b>{fmtDate(m.played_on)} · {m.team}{m.opponent ? ` — ${m.opponent}` : ''}</b><Pill tone="primary">{score}</Pill></div>
            <div className="ks-muted" style={{ fontSize: 13 }}>{r.played ? 'играл' : 'не играл'}{r.goals > 0 ? ` · голов: ${r.goals}` : ''}</div>
          </div>
        );
      })}
    </>
  );
}

interface Ev { id: string; points: number; explanation: string; occurred_on: string; source_type: string }

export function PointsTab({ playerId }: { playerId: string }) {
  const { rows, error } = useRows<Ev>(() => supabase.from('point_events').select('id, points, explanation, occurred_on, source_type').eq('player_id', playerId).order('occurred_on', { ascending: false }).limit(1000), [playerId]);
  if (error) return <Err text={error} />;
  if (!rows) return <Loading />;
  if (rows.length === 0) return <EmptyState icon="trophy" title="Баллов нет" text="Начислений за выбранный период подсчёта пока нет." />;
  const total = rows.reduce((s, e) => s + e.points, 0);
  return (
    <>
      <p className="muted" style={{ marginBottom: 8 }}>Всего: {total} {plural(total)} · начислений: {rows.length}</p>
      {rows.slice(0, 30).map(e => (
        <div className="ks-card" key={e.id}>
          <div className="ks-line"><span style={{ overflowWrap: 'anywhere', minWidth: 0 }}>{e.explanation}</span><Pill tone={e.points < 0 ? 'danger' : 'primary'}>{e.points > 0 ? '+' : ''}{e.points}</Pill></div>
          <div className="ks-muted" style={{ fontSize: 13 }}>{fmtDate(e.occurred_on)}</div>
        </div>
      ))}
      {rows.length > 30 && <p className="muted">Показаны последние 30 начислений.</p>}
    </>
  );
}
