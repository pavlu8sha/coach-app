import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import Message, { Splash } from './Message';
import PlayerEdit, { type PlayerForm } from './PlayerEdit';

interface Row { id: string; full_name: string; group_id: string | null; birth_date: string | null; status: 'active' | 'inactive' }
interface GroupRow { id: string; name: string; club_id: string }

const plural = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'балл' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'балла' : 'баллов');

// Для администратора: все активные игроки по группам с суммой баллов. Права проверяет база (администратор читает всё).
export default function Players() {
  const [groups, setGroups] = useState<(GroupRow & { players: (Row & { points: number })[] })[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState<GroupRow[]>([]);
  const [showInactive, setShowInactive] = useState(false);
  const [edit, setEdit] = useState<PlayerForm | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    void (async () => {
      const g = await supabase.from('groups').select('id, name, club_id').order('name');
      if (g.error) return setError(g.error.message);
      const p = await supabase.from('players').select('id, full_name, group_id, birth_date, status').order('full_name').limit(1000);
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
      const visible = rows.filter(r => showInactive || r.status === 'active');
      setAll((g.data ?? []) as GroupRow[]);
      setGroups(
        ((g.data ?? []) as GroupRow[])
          .map(gr => ({ ...gr, players: visible.filter(r => r.group_id === gr.id).map(r => ({ ...r, points: points.get(r.id) ?? 0 })) }))
          .filter(gr => gr.players.length > 0),
      );
    })();
  }, [reload, showInactive]);

  if (error) return <Message title="Не удалось загрузить игроков" text={error} />;
  if (!groups) return <Splash />;
  const done = () => {
    setEdit(null);
    setReload(n => n + 1);
  };
  if (edit) return <main className="page"><PlayerEdit initial={edit} groups={all} clubId={all[0]?.club_id ?? null} onDone={done} onCancel={() => setEdit(null)} /></main>;
  return (
    <main className="page">
      <h1>Дети</h1>
      <div className="actions">
        <button className="btn small" onClick={() => setEdit({ full_name: '', birth_date: null, group_id: null, status: 'active' })}>
          Добавить ребёнка
        </button>
      </div>
      <label className="check" style={{ margin: '12px 0' }}>
        <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
        <span>Показывать неактивных</span>
      </label>
      {groups.map(g => (
        <section className="card" key={g.id}>
          <div className="row">
            <h2>{g.name}</h2>
            <span className="muted">{g.players.length} игр.</span>
          </div>
          <ul className="events">
            {g.players.map(p => (
              <li key={p.id}>
                <button className="link-btn" onClick={() => setEdit({ id: p.id, full_name: p.full_name, birth_date: p.birth_date, group_id: p.group_id, status: p.status })}>
                  {p.full_name}
                  {p.status === 'inactive' && <span className="muted"> · не занимается</span>}
                </button>
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
