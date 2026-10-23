import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import Message from './Message';

interface Pending {
  id: string;
  created_at: string;
  users: { display_name: string | null; telegram_id: number } | null;
  players: { full_name: string; groups: { name: string } | null } | null;
}

interface Del { id: string; created_at: string; users: { display_name: string | null; telegram_id: number } | null }

// Подтверждение связей «родитель — ребёнок». Видно только администратору (проверяет и база).
export default function Admin() {
  const [rows, setRows] = useState<Pending[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dels, setDels] = useState<Del[]>([]);

  const load = useCallback(async () => {
    const r = await supabase
      .from('link_requests')
      .select('id, created_at, users!link_requests_user_id_fkey(display_name, telegram_id), players(full_name, groups(name))')
      .eq('status', 'pending')
      .order('created_at');
    if (r.error) return setError(r.error.message);
    setRows((r.data ?? []) as unknown as Pending[]);
    // запросы на удаление данных (миграция 0025); если таблицы ещё нет, блок просто пуст
    const d = await supabase.from('data_requests').select('id, created_at, users!data_requests_user_id_fkey(display_name, telegram_id)').eq('status', 'open').order('created_at');
    setDels(d.error ? [] : ((d.data ?? []) as unknown as Del[]));
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

  const erase = async (d: Del) => {
    if (!window.confirm(`Удалить данные родителя ${d.users?.display_name ?? 'без имени'}? Будут удалены его связи с детьми, запросы и отметки о согласии; имя в профиле очистится. Отменить нельзя.`)) return;
    setBusy(d.id);
    const r = await supabase.rpc('erase_parent', { r: d.id });
    setBusy(null);
    if (r.error) return setError(r.error.message.includes('admin or coach') ? 'Нельзя: это администратор или тренер, за ними числятся действия в журналах. Разберите вручную.' : r.error.message);
    await load();
  };
  const rejectDel = async (d: Del) => {
    const why = window.prompt('Причина отказа (её увидит родитель; можно оставить пустой)');
    if (why === null) return;
    setBusy(d.id);
    const r = await supabase.rpc('reject_data_request', { r: d.id, why });
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
      {dels.length > 0 && (
        <>
          <h1 style={{ marginTop: 24 }}>Запросы на удаление данных</h1>
          <p className="muted" style={{ marginBottom: 10 }}>
            «Удалить» убирает связи родителя с детьми, его запросы, отметки о согласии и имя в профиле. Данные игроков остаются у клуба. Учётную запись Telegram в Supabase (Authentication) при необходимости удалите вручную.
          </p>
          {dels.map(d => (
            <section className="card" key={d.id}>
              <h2>{d.users?.display_name ?? 'без имени'}</h2>
              <p className="muted">Telegram ID {d.users?.telegram_id} · {d.created_at.slice(0, 10).split('-').reverse().join('.')}</p>
              <div className="actions">
                <button className="btn" disabled={busy === d.id} onClick={() => void erase(d)}>Удалить данные</button>
                <button className="btn ghost" disabled={busy === d.id} onClick={() => void rejectDel(d)}>Отклонить</button>
              </div>
            </section>
          ))}
        </>
      )}
    </main>
  );
}
