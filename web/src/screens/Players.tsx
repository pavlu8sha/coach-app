import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import Message from './Message';

interface Row { id: string; full_name: string; group_id: string | null }
interface GroupRow { id: string; name: string }

const plural = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'балл' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'балла' : 'баллов');

// Для администратора: все активные игроки по группам с суммой баллов. Права проверяет база (администратор читает всё).
export default function Players() {
  const [groups, setGroups] = useState<(GroupRow & { players: (Row & { points: number })[] })[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const g = await supabase.from('groups').select('id, name').order('name');
      if (g.error) return setError(g.error.message);
      const p = await supabase.from('players').select('id, full_name, group_id').eq('status', 'active').order('full_name').limit(1000);
      if (p.error) return setError(p.error.message);

      // сервер отдаёт не больше 1000 строк за запрос, поэтому журнал баллов читаем страницами
      const points = new Map<string, number>();
      for (let from = 0; ; from += 1000) {
        const e = await supabase.from('point_events').select('player_id, points').order('id').range(from, from + 999);
        if (e.error) return setError(e.error.message);
        for (const r of (e.data ?? []) as { player_id: string; points: number }[]) points.set(r.player_id, (points.get(r.player_id) ?? 0) + r.points);
        if ((e.data ?? []).length < 1000) break;
      }

      const rows = (p.data ?? []) as Row[];
      setGroups(
        ((g.data ?? []) as GroupRow[])
          .map(gr => ({ ...gr, players: rows.filter(r => r.group_id === gr.id).map(r => ({ ...r, points: points.get(r.id) ?? 0 })) }))
          .filter(gr => gr.players.length > 0),
      );
    })();
  }, []);

  if (error) return <Message title="Не удалось загрузить игроков" text={error} />;
  if (!groups) return <Message title="Загрузка…" />;
  return (
    <main className="page">
      <h1>Дети</h1>
      {groups.map(g => (
        <section className="card" key={g.id}>
          <div className="row">
            <h2>{g.name}</h2>
            <span className="muted">{g.players.length} игр.</span>
          </div>
          <ul className="events">
            {g.players.map(p => (
              <li key={p.id}>
                <span>{p.full_name}</span>
                <span className="muted">
                  {p.points} {plural(p.points)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
