import { useEffect, useState } from 'react';
import { errMsg, fmtDate } from '../lib/coach';
import { supabase } from '../lib/supabase';

// Перенос начала текущей группы на более раннюю дату (миграция 0219, docs/acceptance/group-since-2026-11-21.md, П1-П5).
// Историю читает только администратор (RLS); у остальных, у новых игроков и без предыдущей группы блока нет.
interface Hist { group_id: string | null; valid_from: string; valid_to: string | null }
interface Preview { from: string; to: string; ledger_rows: number; manual_rows: number }

const addDay = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// «Функции в базе нет» (0219 не применена): только PGRST202 или точное сообщение про эту функцию, текст пользователю не показывается
const missing = (e: unknown): boolean => {
  if (e && typeof e === 'object' && (e as { code?: unknown }).code === 'PGRST202') return true;
  let m = '';
  try { m = JSON.stringify(e) ?? ''; } catch { /* считаем обычной ошибкой */ }
  return m.includes('Could not find the function public.player_group_since');
};

export default function PlayerGroupSince({ playerId, groups }: { playerId: string; groups: { id: string; name: string }[] }) {
  const [hist, setHist] = useState<{ cur: Hist; prev: Hist } | null>(null);
  const [day, setDay] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewDay, setPreviewDay] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [reload, setReload] = useState(0);
  const name = (id: string | null) => groups.find(g => g.id === id)?.name ?? 'без группы';

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const r = await supabase.from('player_group_history').select('group_id, valid_from, valid_to').eq('player_id', playerId).order('valid_from', { ascending: false }).limit(2);
        if (!live) return;
        const rows = (r.data ?? []) as Hist[];
        const cur = rows.find(x => x.valid_to === null);
        const prev = cur ? rows.find(x => x.valid_to === cur.valid_from) : undefined;
        setHist(!r.error && cur && prev ? { cur, prev } : null);
      } catch (e) {
        console.error('PlayerGroupSince.history', e);
        if (live) setHist(null);
      }
    })();
    return () => { live = false; };
  }, [playerId, reload]);

  if (hidden || !hist) return null;
  const min = addDay(hist.prev.valid_from, 1);
  const max = hist.cur.valid_from;
  const inRange = day >= min && day <= max;

  const call = async (apply: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const r = await supabase.rpc('player_group_since', { p: playerId, d: day, apply });
      if (r.error) {
        if (missing(r.error)) return setHidden(true);
        console.error('player_group_since', r.error);
        return setError(errMsg(r.error));
      }
      if (apply) {
        setDone(true);
        setPreview(null);
        setDay('');
        setReload(n => n + 1);
      } else {
        setPreview(r.data as Preview);
        setPreviewDay(day);
        setDone(false);
      }
    } catch (e) {
      console.error('PlayerGroupSince.call', e);
      setError('Не удалось выполнить. Попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ks-card" aria-label="Начало занятий в группе">
      <b>В группе {name(hist.cur.group_id)} с {fmtDate(hist.cur.valid_from)}</b>
      <p className="muted" style={{ fontSize: 13, margin: '4px 0 8px' }}>До этого: {name(hist.prev.group_id)}. Если перевод внесли позже, чем он был на самом деле, перенесите начало на более раннюю дату: баллы за эти дни пересчитаются в новую группу.</p>
      <label className="field">
        Перенести начало на более раннюю дату
        <input type="date" min={min} max={max} value={day} onChange={e => { setDay(e.target.value); setPreview(null); setDone(false); setError(null); }} />
      </label>
      {done && <p role="status">Готово: начало группы перенесено, баллы пересчитаны.</p>}
      {error && <p className="error">{error}</p>}
      {preview && previewDay === day && (
        <p role="status">
          Пересчитается начислений: {preview.ledger_rows}. Ручных начислений, которые останутся в прежней группе: {preview.manual_rows}.
        </p>
      )}
      <div className="ks-btns">
        <button type="button" className="ks-btn secondary" disabled={busy || !inRange || day === max} onClick={() => void call(false)}>
          Показать, что изменится
        </button>
        {preview && previewDay === day && (
          <button type="button" className="ks-btn" disabled={busy} onClick={() => void call(true)}>
            Перенести
          </button>
        )}
      </div>
    </section>
  );
}
