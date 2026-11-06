import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

// Очередь ожидания занятия (миграция 0149): администратор и тренер только читают.
export default function WaitlistList({ sessionId }: { sessionId: string }) {
  const [rows, setRows] = useState<{ pos: number; name: string }[]>([]);
  useEffect(() => {
    let alive = true;
    void supabase.rpc('waitlist_session', { s: sessionId }).then(r => { if (alive && !r.error) setRows((r.data ?? []) as { pos: number; name: string }[]); });
    return () => { alive = false; };
  }, [sessionId]);
  if (rows.length === 0) return null;
  return (
    <>
      <h3>Очередь ожидания</h3>
      <ol style={{ margin: '4px 0 0', paddingLeft: 22 }}>{rows.map(r => <li key={r.pos}>{r.name}</li>)}</ol>
      <p className="ks-muted" style={{ fontSize: 13 }}>Когда место освобождается, уведомление получают все из очереди; место достаётся первому, кто подтвердил.</p>
    </>
  );
}
