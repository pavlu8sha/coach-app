import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { EmptyState, ListRow, Pill, SearchInput } from '../ui/components';
import { BackNav } from '../ui/nav';
import { Failure, Loading } from './Message';

interface User { id: string; telegram_id: number; display_name: string | null }
interface Group { id: string; name: string }

const label = (u: User) => u.display_name ?? `Telegram ${u.telegram_id}`;

// Для администратора: назначение групп тренерам. Тренером становится любой вошедший пользователь, которому назначена группа.
// Права проверяет база (политика coach_groups_admin_write).
export default function Coaches() {
  const [users, setUsers] = useState<User[] | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [links, setLinks] = useState<Set<string>>(new Set()); // "userId|groupId"
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<User | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const u = await supabase.from('users').select('id, telegram_id, display_name').eq('is_admin', false).order('display_name').limit(1000);
      if (u.error) return setError(u.error.message);
      const g = await supabase.from('groups').select('id, name').order('name');
      if (g.error) return setError(g.error.message);
      const c = await supabase.from('coach_groups').select('user_id, group_id');
      if (c.error) return setError(c.error.message);
      setUsers((u.data ?? []) as User[]);
      setGroups((g.data ?? []) as Group[]);
      setLinks(new Set(((c.data ?? []) as { user_id: string; group_id: string }[]).map(r => `${r.user_id}|${r.group_id}`)));
    })();
  }, [reload]);

  const coachIds = useMemo(() => new Set([...links].map(k => k.split('|')[0])), [links]);

  const toggle = async (u: User, g: Group) => {
    const key = `${u.id}|${g.id}`;
    setBusy(key);
    setMsg(null);
    const r = links.has(key)
      ? await supabase.from('coach_groups').delete().eq('user_id', u.id).eq('group_id', g.id)
      : await supabase.from('coach_groups').insert({ user_id: u.id, group_id: g.id });
    setBusy(null);
    if (r.error) return setMsg(r.error.message);
    setLinks(s => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  };

  if (error) return <Failure title="Не удалось загрузить тренеров" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} back={open ? <BackNav onBack={() => setOpen(null)} /> : undefined} />;
  if (!users) return <Loading />;

  if (open) {
    return (
      <main className="page">
        <BackNav onBack={() => setOpen(null)} />
        <h1 style={{ overflowWrap: 'anywhere' }}>{label(open)}</h1>
        <p className="muted" style={{ marginBottom: 12 }}>Отметьте группы, в которых человек тренер. Тренер сможет отмечать занятия, вносить матчи и начислять баллы только в этих группах. Платежи ему не видны.</p>
        {groups.map(g => {
          const key = `${open.id}|${g.id}`;
          return (
            <div className="ks-card" key={g.id}>
              <label className="ks-check">
                <input type="checkbox" checked={links.has(key)} disabled={busy === key} onChange={() => void toggle(open, g)} />
                <span>{g.name}</span>
              </label>
            </div>
          );
        })}
        {msg && <p className="error">{msg}</p>}
      </main>
    );
  }

  const needle = q.trim().toLowerCase();
  const found = users.filter(u => !needle || label(u).toLowerCase().includes(needle) || String(u.telegram_id).includes(needle));
  const coaches = found.filter(u => coachIds.has(u.id));
  const others = needle ? found.filter(u => !coachIds.has(u.id)) : [];
  const row = (u: User) => (
    <ListRow key={u.id} avatar={label(u)} title={label(u)} sub={[`Telegram ID ${u.telegram_id}`]} end={coachIds.has(u.id) ? <Pill tone="primary">Тренер</Pill> : undefined} onClick={() => setOpen(u)} />
  );

  return (
    <main className="page">
      <h1>Тренеры</h1>
      <SearchInput label="Найти пользователя" placeholder="Имя или Telegram ID" value={q} onChange={setQ} />
      <div style={{ height: 12 }} />
      {coaches.length > 0 && <h3>Тренеры</h3>}
      {coaches.map(row)}
      {needle && (
        <>
          <h3>Другие пользователи</h3>
          {others.length === 0 ? <p className="muted">Никого не найдено. Человек должен хотя бы раз открыть приложение из Telegram.</p> : others.map(row)}
        </>
      )}
      {!needle && coaches.length === 0 && <EmptyState icon="users" title="Тренеров пока нет" text="Найдите человека по имени или Telegram ID: он должен хотя бы раз открыть приложение из Telegram." />}
    </main>
  );
}
