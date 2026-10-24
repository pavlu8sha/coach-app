import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import Link from './Link';
import LinkStatus from './LinkStatus';
import { Failure, Loading } from './Message';

interface Child {
  id: string;
  name: string;
  group: string | null;
  points: number;
  recent: { points: number; explanation: string; occurred_on: string }[];
}

const fmtDate = (iso: string) => iso.split('-').reverse().join('.');
const plural = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'балл' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'балла' : 'баллов');

export default function Home({ isAdmin = false }: { isAdmin?: boolean }) {
  const [children, setChildren] = useState<Child[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [showLink, setShowLink] = useState(false);
  const [addMore, setAddMore] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const retry = () => {
    setError(null);
    setReload(n => n + 1);
  };
  const openStatus = () => setStatusOpen(true);
  const closeStatus = () => {
    setStatusOpen(false);
    setReload(n => n + 1); // после просмотра статусов подтянуть новых детей
  };

  useEffect(() => {
    void (async () => {
      // Администратору RLS отдаёт все связи, поэтому берём только свои: «Мой ребёнок» — это дети текущего пользователя
      const me = (await supabase.auth.getUser()).data.user?.id;
      if (!me) return setError('Нет сессии');
      const links = await supabase
        .from('player_guardians')
        .select('player_id, players(id, full_name, groups(name))')
        .eq('user_id', me)
        .is('consent_revoked_at', null);
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
  }, [reload]);

  if (error) return <Failure title="Не удалось загрузить данные" text={error} onRetry={retry} />;
  if (!children) return <Loading />;
  if (statusOpen) return <LinkStatus onBack={closeStatus} />;
  if (!children.length) {
    // Администратору форма поиска ребёнка не нужна: он подтверждает запросы родителей во вкладке «Запросы»
    if (isAdmin && !showLink) {
      return (
        <main className="page">
          <h1>Мой ребёнок</h1>
          <p className="muted">У вас нет привязанных детей. Запросы родителей — во вкладке «Запросы».</p>
          <button className="ks-btn secondary" onClick={() => setShowLink(true)}>
            Привязать своего ребёнка
          </button>
        </main>
      );
    }
    return (
      <main className="page">
        <h1>Мой ребёнок</h1>
        <p className="muted" style={{ marginBottom: 14 }}>Найдите ребёнка, чтобы смотреть его баллы. Администратор клуба подтвердит запрос.</p>
        <Link onApproved={() => setReload(n => n + 1)} onOpenStatus={openStatus} />
      </main>
    );
  }
  return (
    <main className="page">
      <h1>Мой ребёнок</h1>
      {children.map(c => (
        <section className="ks-card" key={c.id}>
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
            <div>
              {c.recent.map((e, i) => (
                <div className="ks-slot" key={i}>
                  <span>{e.explanation}</span>
                  <span className="muted">
                    {fmtDate(e.occurred_on)} · +{e.points}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
      {addMore ? (
        <Link onApproved={() => setReload(n => n + 1)} onOpenStatus={openStatus} />
      ) : (
        <button className="ks-btn secondary sm" onClick={() => setAddMore(true)}>
          + Добавить ещё одного ребёнка
        </button>
      )}
    </main>
  );
}
