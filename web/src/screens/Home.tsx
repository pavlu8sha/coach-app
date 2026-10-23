import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import Message from './Message';

interface Child {
  id: string;
  name: string;
  group: string | null;
  points: number;
  recent: { points: number; explanation: string; occurred_on: string }[];
}

const fmtDate = (iso: string) => iso.split('-').reverse().join('.');
const plural = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'балл' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'балла' : 'баллов');

export default function Home() {
  const [children, setChildren] = useState<Child[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      // RLS отдаёт только детей, связанных с этим родителем
      const links = await supabase.from('player_guardians').select('player_id, players(id, full_name, groups(name))');
      if (links.error) return setError(links.error.message);
      const kids = (links.data ?? []).map((l: any) => ({
        id: l.players?.id as string,
        name: (l.players?.full_name ?? '') as string,
        group: (l.players?.groups?.name ?? null) as string | null,
      })).filter(k => k.id);
      const ids = kids.map(k => k.id);
      const events = ids.length
        ? await supabase.from('point_events').select('player_id, points, explanation, occurred_on').in('player_id', ids).order('occurred_on', { ascending: false }).limit(1000)
        : { data: [], error: null };
      if (events.error) return setError(events.error.message);
      const rows = (events.data ?? []) as { player_id: string; points: number; explanation: string; occurred_on: string }[];
      setChildren(
        kids.map(k => {
          const mine = rows.filter(r => r.player_id === k.id);
          return { ...k, points: mine.reduce((s, r) => s + r.points, 0), recent: mine.slice(0, 5) };
        }),
      );
    })();
  }, []);

  if (error) return <Message title="Не удалось загрузить данные" text={error} />;
  if (!children) return <Message title="Загрузка…" />;
  if (!children.length) {
    return (
      <Message
        title="Пока нет привязанных детей"
        text="Вы вошли. Администратор клуба подтвердит, что вы родитель, и здесь появится ваш ребёнок."
      />
    );
  }
  return (
    <main className="page">
      <h1>Мой ребёнок</h1>
      {children.map(c => (
        <section className="card" key={c.id}>
          <div className="row">
            <div>
              <h2>{c.name}</h2>
              {c.group && <p className="muted">{c.group}</p>}
            </div>
            <div className="score">
              <strong>{c.points}</strong>
              <span className="muted"> {plural(c.points)}</span>
            </div>
          </div>
          {c.recent.length > 0 && (
            <ul className="events">
              {c.recent.map((e, i) => (
                <li key={i}>
                  <span>{e.explanation}</span>
                  <span className="muted">
                    {fmtDate(e.occurred_on)} · +{e.points}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </main>
  );
}
