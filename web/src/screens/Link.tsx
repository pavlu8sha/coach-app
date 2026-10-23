import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

interface Found { player_id: string; full_name: string; group_name: string | null }
interface Req { id: string; status: 'pending' | 'approved' | 'rejected'; players: { full_name: string } | null }

const STATUS = { pending: 'ждёт подтверждения', approved: 'подтверждено', rejected: 'отклонено' } as const;

// Родитель ищет ребёнка по имени и отправляет запрос; связь создаёт администратор.
export default function Link({ onApproved }: { onApproved?: () => void }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Found[] | null>(null);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadReqs = useCallback(async () => {
    const me = (await supabase.auth.getUser()).data.user?.id;
    if (!me) return;
    // только свои запросы: администратору RLS отдаёт чужие, они показываются во вкладке «Запросы»
    const r = await supabase.from('link_requests').select('id, status, players(full_name)').eq('user_id', me).order('created_at', { ascending: false });
    if (r.error) return setError(r.error.message);
    const rows = (r.data ?? []) as unknown as Req[];
    setReqs(rows);
    if (rows.some(x => x.status === 'approved')) onApproved?.();
  }, [onApproved]);

  useEffect(() => {
    void loadReqs();
  }, [loadReqs]);

  const search = async () => {
    setError(null);
    setBusy(true);
    const r = await supabase.rpc('search_players_for_link', { q });
    setBusy(false);
    if (r.error) return setError(r.error.message);
    setFound((r.data ?? []) as Found[]);
  };

  const request = async (id: string) => {
    setError(null);
    setBusy(true);
    const r = await supabase.rpc('request_link', { p: id });
    setBusy(false);
    if (r.error) return setError(r.error.message.includes('too many') ? 'Слишком много неподтверждённых запросов. Дождитесь ответа администратора.' : r.error.message);
    setFound(f => (f ?? []).filter(x => x.player_id !== id));
    await loadReqs();
  };

  return (
    <section className="card">
      <h2>Добавить ребёнка</h2>
      <p className="muted">Введите фамилию или имя (от 3 букв). Администратор клуба подтвердит, что это ваш ребёнок.</p>
      <form
        className="search"
        onSubmit={e => {
          e.preventDefault();
          void search();
        }}
      >
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Фамилия Имя" autoComplete="off" />
        <button className="btn" disabled={busy || q.trim().length < 3}>
          Найти
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      {found && found.length === 0 && <p className="muted">Ничего не найдено. Проверьте написание.</p>}
      {found && found.length > 0 && (
        <ul className="events">
          {found.map(f => (
            <li key={f.player_id}>
              <span>
                {f.full_name}
                {f.group_name && <span className="muted"> · {f.group_name}</span>}
              </span>
              <button className="btn small" disabled={busy} onClick={() => void request(f.player_id)}>
                Это мой ребёнок
              </button>
            </li>
          ))}
        </ul>
      )}
      {reqs.length > 0 && (
        <ul className="events reqs">
          {reqs.map(r => (
            <li key={r.id}>
              <span>{r.players?.full_name ?? 'Игрок'}</span>
              <span className="muted">{STATUS[r.status]}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
