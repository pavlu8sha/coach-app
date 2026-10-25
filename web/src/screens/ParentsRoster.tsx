import { useEffect, useState } from 'react';
import { coachError } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { EmptyState, ListRow, Pill } from '../ui/components';
import { Failure, Loading } from './Message';

interface U { id: string; display_name: string | null; telegram_id: number; chosen_role: string | null; is_admin: boolean }
interface G { user_id: string; player_id: string }
interface Pl { id: string; full_name: string; group_id: string | null }
interface Rq { user_id: string; player_id: string }

// Кто из родителей уже вошёл в приложение и привязал ребёнка, а кто ещё нет; и дети без привязанного родителя. Только для администратора.
export default function ParentsRoster() {
  const [data, setData] = useState<{ users: U[]; guards: G[]; players: Pl[]; reqs: Rq[]; groups: Record<string, string> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    void (async () => {
      const [u, g, p, r, gr] = await Promise.all([
        supabase.from('users').select('id, display_name, telegram_id, chosen_role, is_admin').eq('is_admin', false).limit(1000),
        supabase.from('player_guardians').select('user_id, player_id').limit(3000),
        supabase.from('players').select('id, full_name, group_id').eq('status', 'active').limit(2000),
        supabase.from('link_requests').select('user_id, player_id').eq('status', 'pending').limit(1000),
        supabase.from('groups').select('id, name').limit(200),
      ]);
      const bad = [u, g, p, r, gr].find(x => x.error);
      if (bad?.error) return setError(coachError(bad.error.message));
      setData({
        users: (u.data ?? []) as U[],
        guards: (g.data ?? []) as G[],
        players: (p.data ?? []) as Pl[],
        reqs: (r.data ?? []) as Rq[],
        groups: Object.fromEntries(((gr.data ?? []) as { id: string; name: string }[]).map(x => [x.id, x.name])),
      });
    })();
  }, [reload]);

  if (error) return <Failure title="Не удалось загрузить родителей" text={error} onRetry={() => { setError(null); setData(null); setReload(n => n + 1); }} />;
  if (!data) return <Loading />;
  const name = (id: string) => data.players.find(x => x.id === id)?.full_name ?? 'ребёнок';
  // родители: выбравшие роль «Родитель», либо уже с детьми или запросом; тренеров и гостей без детей не показываем
  const kids = (uid: string) => data.guards.filter(g => g.user_id === uid).map(g => name(g.player_id));
  const asked = (uid: string) => data.reqs.filter(r => r.user_id === uid).map(r => name(r.player_id));
  const parents = data.users.filter(x => x.chosen_role === 'parent' || kids(x.id).length > 0 || asked(x.id).length > 0);
  const linked = parents.filter(x => kids(x.id).length > 0).sort((a, b) => (a.display_name ?? '').localeCompare(b.display_name ?? '', 'ru'));
  const notLinked = parents.filter(x => kids(x.id).length === 0).sort((a, b) => (a.display_name ?? '').localeCompare(b.display_name ?? '', 'ru'));
  const withParent = new Set(data.guards.map(g => g.player_id));
  const orphans = data.players.filter(p => !withParent.has(p.id)).sort((a, b) => a.full_name.localeCompare(b.full_name));
  const label = (x: U) => x.display_name ?? `Telegram ${x.telegram_id}`;

  return (
    <>
      <p className="muted">Родителей в приложении: {parents.length}. Привязали ребёнка: {linked.length}. Ещё нет: {notLinked.length}. Детей без привязанного родителя: {orphans.length} из {data.players.length}.</p>
      <h3>Привязали ребёнка ({linked.length})</h3>
      {linked.length === 0 && <EmptyState icon="users" title="Пока никого" />}
      {linked.map(x => <ListRow key={x.id} avatar={label(x)} title={label(x)} sub={[kids(x.id).join(', ')]} end={<Pill tone="success">Привязан</Pill>} />)}
      <h3>Вошли, но ребёнка не привязали ({notLinked.length})</h3>
      {notLinked.length === 0 && <EmptyState icon="users" title="Таких нет" />}
      {notLinked.map(x => (
        <ListRow key={x.id} avatar={label(x)} title={label(x)} sub={[asked(x.id).length ? `Запрос ждёт подтверждения: ${asked(x.id).join(', ')}` : 'Запроса нет']} end={asked(x.id).length ? <Pill tone="warning">Ждёт</Pill> : <Pill tone="neutral">Не привязан</Pill>} />
      ))}
      <h3>Дети без привязанного родителя ({orphans.length})</h3>
      {orphans.length === 0 && <EmptyState icon="users" title="У всех детей есть родитель" />}
      {orphans.map(p => <ListRow key={p.id} avatar={p.full_name} title={p.full_name} sub={[p.group_id ? data.groups[p.group_id] ?? '' : 'без группы']} />)}
    </>
  );
}
