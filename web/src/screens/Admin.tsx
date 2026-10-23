import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import Message from './Message';

interface Pending {
  id: string;
  created_at: string;
  users: { display_name: string | null; telegram_id: number } | null;
  players: { full_name: string; groups: { name: string } | null } | null;
}

// Подтверждение связей «родитель — ребёнок». Видно только администратору (проверяет и база).
export default function Admin() {
  const [rows, setRows] = useState<Pending[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await supabase
      .from('link_requests')
      .select('id, created_at, users!link_requests_user_id_fkey(display_name, telegram_id), players(full_name, groups(name))')
      .eq('status', 'pending')
      .order('created_at');
    if (r.error) return setError(r.error.message);
    setRows((r.data ?? []) as unknown as Pending[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (id: string, approve: boolean) => {
    setBusy(id);
    const r = await supabase.rpc('decide_link', { r: id, approve });
    setBusy(null);
    if (r.error) return setError(r.error.message);
    await load();
  };

  if (error) return <Message title="Ошибка" text={error} />;
  if (!rows) return <Message title="Загрузка…" />;
  return (
    <main className="page">
      <h1>Запросы родителей</h1>
      {rows.length === 0 && <p className="muted">Новых запросов нет.</p>}
      {rows.map(r => (
        <section className="card" key={r.id}>
          <h2>{r.players?.full_name}</h2>
          <p className="muted">{r.players?.groups?.name ?? 'без группы'}</p>
          <p>
            Запрашивает: <strong>{r.users?.display_name ?? 'без имени'}</strong> <span className="muted">(Telegram ID {r.users?.telegram_id})</span>
          </p>
          <div className="actions">
            <button className="btn" disabled={busy === r.id} onClick={() => void decide(r.id, true)}>
              Подтвердить
            </button>
            <button className="btn ghost" disabled={busy === r.id} onClick={() => void decide(r.id, false)}>
              Отклонить
            </button>
          </div>
        </section>
      ))}
    </main>
  );
}
