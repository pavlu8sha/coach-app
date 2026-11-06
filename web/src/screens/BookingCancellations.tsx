import { useCallback, useEffect, useState } from 'react';
import { coachError, fmtDate, hm } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { EmptyState, ListRow, Pill } from '../ui/components';
import { useConfirm } from '../ui/ConfirmSheet';
import { Loading } from './Message';

interface Row {
  id: string; kind: 'individual' | 'goalkeeper' | 'extra'; session_id: string; starts_at: string; label: string | null; amount: number | string;
  status: 'cancelled' | 'awaiting' | 'kept' | 'transferred' | 'refunded'; cancelled_at: string; decided_at: string | null; note: string | null;
  players: { full_name: string } | null;
}
interface Target { kind: string; session_id: string; starts_at: string; label: string | null; amount: number | string }

const METHODS = ['Наличные', 'Перевод'];
const KIND: Record<Row['kind'], string> = { individual: 'Индивидуальная', goalkeeper: 'Вратарская', extra: 'Дополнительная' };
const STATUS: Record<Row['status'], string> = { cancelled: 'Отменена', awaiting: 'Ждёт решения', kept: 'Оплата у клуба', transferred: 'Оплата перенесена', refunded: 'Возврат' };
const gel = (n: number | string) => `${Number(n)} ₾`;
const when = (r: Row) => `${fmtDate(r.starts_at.slice(0, 10))} ${hm(r.starts_at.slice(11, 16))}`;

const errText = (m: string) =>
  m.includes('already decided') ? 'Решение по этой записи уже принято.'
  : m.includes('amount mismatch') ? 'Сумма на выбранном занятии другая: перенос невозможен, выберите «Оставить клубу» или «Вернуть».'
  : m.includes('target booking not found') ? 'Выбранная запись не найдена или уже оплачена.'
  : m.includes('session already started') ? 'Занятие уже началось.'
  : m.includes('bad method') ? 'Выберите способ: наличные или перевод.'
  : coachError(m);

// Отменённые родителем записи и решения по оплате (миграция 0145, Issue #274): оставить клубу, перенести на другое занятие, вернуть.
export default function BookingCancellations() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [method, setMethod] = useState('');
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [target, setTarget] = useState('');
  const { ask, dialog } = useConfirm();

  const load = useCallback(async () => {
    const r = await supabase.from('booking_cancellations').select('id, kind, session_id, starts_at, label, amount, status, cancelled_at, decided_at, note, players(full_name)').order('cancelled_at', { ascending: false }).limit(200);
    if (r.error) return setError(errText(r.error.message));
    setRows((r.data ?? []) as unknown as Row[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const choose = async (r: Row) => {
    setOpen(open === r.id ? null : r.id);
    setTargets(null);
    setTarget('');
    setMsg(null);
    if (open === r.id) return;
    const t = await supabase.rpc('booking_transfer_targets', { c: r.id });
    setTargets(t.error ? [] : ((t.data ?? []) as Target[]));
  };

  const run = async (r: Row, fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) => {
    setBusy(r.id);
    setMsg(null);
    const res = await fn();
    setBusy(null);
    if (res.error) return setMsg({ ok: false, text: errText(res.error.message) });
    setMsg({ ok: true, text: ok });
    setOpen(null);
    await load();
  };

  const keep = async (r: Row) => {
    if (!(await ask({ title: 'Оставить оплату клубу?', lines: [['Игрок', r.players?.full_name ?? 'Игрок'], ['Занятие', when(r)], ['Сумма', gel(r.amount)]], note: 'Оплата останется за клубом, в кассе ничего не изменится.', confirmLabel: 'Оставить клубу' }))) return;
    await run(r, () => supabase.rpc('booking_cancel_keep', { c: r.id }), 'Оплата оставлена клубу.');
  };
  const refund = async (r: Row) => {
    if (!(await ask({ title: 'Оформить возврат?', lines: [['Игрок', r.players?.full_name ?? 'Игрок'], ['Занятие', when(r)], ['Сумма', gel(r.amount)], ['Способ', method]], note: 'В кассовом отчёте появится строка возврата со знаком минус. Исходная оплата не меняется.', confirmLabel: 'Оформить возврат', danger: true }))) return;
    await run(r, () => supabase.rpc('booking_cancel_refund', { c: r.id, mth: method }), 'Возврат оформлен.');
  };
  const transfer = async (r: Row) => {
    const t = (targets ?? []).find(x => x.session_id === target);
    if (!t) return;
    if (!(await ask({ title: 'Перенести оплату?', lines: [['Игрок', r.players?.full_name ?? 'Игрок'], ['С занятия', when(r)], ['На занятие', `${fmtDate(t.starts_at.slice(0, 10))} ${hm(t.starts_at.slice(11, 16))}`], ['Сумма', gel(r.amount)]], note: 'Запись на выбранное занятие станет оплаченной. Новых денег в кассе не появится.', confirmLabel: 'Перенести' }))) return;
    await run(r, () => supabase.rpc('booking_cancel_transfer', { c: r.id, tk: t.kind, ts: t.session_id }), 'Оплата перенесена.');
  };

  if (error) return <p className="error">{error}</p>;
  if (!rows) return <Loading />;
  const waiting = rows.filter(r => r.status === 'awaiting');
  const rest = rows.filter(r => r.status !== 'awaiting');
  return (
    <>
      {msg && <p className={msg.ok ? 'muted' : 'error'} role={msg.ok ? undefined : 'alert'}>{msg.text}</p>}
      <h3>Ждут решения по оплате</h3>
      {waiting.length === 0 ? <EmptyState icon="box" title="Решений не требуется" text="Оплаченные записи, отменённые родителями или клубом, появятся здесь." /> : waiting.map(r => (
        <div className="ks-card" key={r.id}>
          <ListRow title={r.players?.full_name ?? 'Игрок'} sub={[`${KIND[r.kind]} · ${when(r)}`, r.label ?? '']} end={<Pill tone="warning" dot>{gel(r.amount)}</Pill>} onClick={() => void choose(r)} />
          {open === r.id && (
            <div style={{ marginTop: 8 }}>
              <button type="button" className="ks-btn secondary" disabled={busy === r.id} onClick={() => void keep(r)}>Оставить клубу</button>
              <label className="field" style={{ marginTop: 8 }}>Способ возврата<select value={method} onChange={e => setMethod(e.target.value)}><option value="">Выберите способ</option>{METHODS.map(m => <option key={m}>{m}</option>)}</select></label>
              <button type="button" className="ks-btn secondary" disabled={busy === r.id || !method} onClick={() => void refund(r)}>Вернуть</button>
              <label className="field" style={{ marginTop: 8 }}>Перенести на занятие
                <select value={target} onChange={e => setTarget(e.target.value)} disabled={!targets || targets.length === 0}>
                  <option value="">{targets === null ? 'Загрузка…' : targets.length === 0 ? 'Нет подходящих записей' : 'Выберите занятие'}</option>
                  {(targets ?? []).map(t => <option key={t.session_id} value={t.session_id}>{`${fmtDate(t.starts_at.slice(0, 10))} ${hm(t.starts_at.slice(11, 16))} · ${KIND[t.kind as Row['kind']] ?? t.kind}`}</option>)}
                </select>
              </label>
              <p className="ks-muted" style={{ fontSize: 13 }}>Перенос возможен на неоплаченную запись ребёнка на ту же сумму: сначала запишите его на нужное занятие.</p>
              <button type="button" className="ks-btn secondary" disabled={busy === r.id || !target} onClick={() => void transfer(r)}>Перенести</button>
            </div>
          )}
        </div>
      ))}
      <h3>История отмен</h3>
      {rest.length === 0 ? <p className="muted">Пока пусто.</p> : rest.map(r => (
        <ListRow key={r.id} title={r.players?.full_name ?? 'Игрок'} sub={[`${KIND[r.kind]} · ${when(r)}`, r.note ?? '']} end={<Pill tone={r.status === 'cancelled' ? 'neutral' : 'success'}>{STATUS[r.status]}{Number(r.amount) > 0 ? ` · ${gel(r.amount)}` : ''}</Pill>} />
      ))}
      {dialog}
    </>
  );
}
