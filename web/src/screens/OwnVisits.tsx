import { useEffect, useState } from 'react';
import { coachError } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { useConfirm } from '../ui/ConfirmSheet';

// Оплата за визит (миграция 0200): игрок без абонемента платит за каждое посещение своей группы (20 ₾).
// Визит создаётся автоматически при отметке «Был»; оплату можно принять сразу или позже (долг остаётся).
// Не абонемент и не доп. посещение чужой группы (то в блоке GuestVisits).
interface Visit { player_id: string; amount: number; paid: boolean; paid_amount: number | null; method: string | null; players: { full_name: string } | null }

const METHODS = ['Наличные', 'Перевод'];
const gel = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2)} ₾`;
const errText = (m: string) =>
  m.includes('bad method') ? 'Выберите способ оплаты: наличные или перевод.' :
  m.includes('forbidden') ? 'Нет прав на это действие. Оплату снимает администратор.' :
  coachError(m);
/** Событие, которое отправляет экран отметок после сохранения: визиты появляются на сервере по триггеру. */
export const ATTENDANCE_SAVED = 'ks-attendance-saved';

export default function OwnVisits({ gid, date, admin = false }: { gid: string; date: string; admin?: boolean }) {
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const { ask, dialog } = useConfirm();

  useEffect(() => {
    const h = () => setReload(n => n + 1);
    window.addEventListener(ATTENDANCE_SAVED, h);
    return () => window.removeEventListener(ATTENDANCE_SAVED, h);
  }, []);

  useEffect(() => {
    void (async () => {
      const s = await supabase.from('sessions').select('id').eq('group_id', gid).eq('source_key', 'ATT|' + date).maybeSingle();
      if (s.error) return setError(s.error.message);
      const id = (s.data as { id: string } | null)?.id ?? null;
      setSessionId(id);
      if (!id) return setVisits([]);
      const v = await supabase.from('own_visits').select('player_id, amount, paid, paid_amount, method, players(full_name)').eq('session_id', id);
      if (v.error) return setError(v.error.message);
      setVisits(((v.data ?? []) as unknown as Visit[]).sort((a, b) => (a.players?.full_name ?? '').localeCompare(b.players?.full_name ?? '', 'ru')));
    })();
  }, [gid, date, reload]);

  const run = async (key: string, call: () => PromiseLike<{ error: { message: string } | null }>) => {
    setBusy(key);
    setMsg(null);
    const r = await call();
    setBusy(null);
    if (r.error) return setMsg({ ok: false, text: errText(r.error.message) });
    setReload(n => n + 1);
  };
  const pay = async (v: Visit, mth: string) => {
    if (!(await ask({ title: 'Принять оплату за визит?', lines: [['Игрок', v.players?.full_name ?? 'Игрок'], ['Сумма', gel(Number(v.amount))], ['Способ', mth]], confirmLabel: 'Принять оплату' }))) return;
    await run(v.player_id + mth, () => supabase.rpc('own_visit_set_paid', { s: sessionId, p: v.player_id, is_paid: true, mth }));
  };
  const unpay = async (v: Visit) => {
    if (!(await ask({ title: 'Отменить оплату?', lines: [['Игрок', v.players?.full_name ?? 'Игрок'], ['Сумма', gel(Number(v.paid_amount ?? v.amount))]], note: 'Визит снова станет неоплаченным, в кассе появится строка с минусом.', confirmLabel: 'Отменить оплату', danger: true }))) return;
    await run(v.player_id + 'unpay', () => supabase.rpc('own_visit_set_paid', { s: sessionId, p: v.player_id, is_paid: false }));
  };

  if (error) return <p className="error">Не удалось загрузить оплату за визит: {error}</p>;
  if (visits === null || visits.length === 0) return null; // у группы нет игроков «за визит» с отметкой «Был»: блок не нужен
  return (
    <section aria-label="Оплата за визит" style={{ marginTop: 20 }}>
      <h2>Оплата за визит</h2>
      <p className="muted">Игроки без абонемента платят за каждое посещение. Если не оплатили сейчас, визит остаётся в долге и виден в «Кассе».</p>
      {visits.map(v => (
        <div className="ks-mark" key={v.player_id} role="group" aria-label={`Визит: ${v.players?.full_name ?? ''}`} style={{ flexWrap: 'wrap' }}>
          <b>{v.players?.full_name ?? 'Игрок'}</b>
          <span className="muted">{gel(Number(v.amount))}</span>
          {v.paid ? <span className="ks-ok">Оплачено{v.method ? ` (${v.method})` : ''}</span> : <span className="error">Не оплачено</span>}
          <span className="ks-actions">
            {!v.paid && METHODS.map(m => (
              <button key={m} type="button" className="ks-btn secondary sm" disabled={busy !== null} onClick={() => void pay(v, m)}>{m}</button>
            ))}
            {v.paid && admin && <button type="button" className="ks-btn secondary sm" disabled={busy !== null} onClick={() => void unpay(v)}>Отменить оплату</button>}
          </span>
        </div>
      ))}
      {msg && <p className={msg.ok ? 'ks-ok' : 'error'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}
      {dialog}
    </section>
  );
}
