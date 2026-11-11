import { useCallback, useEffect, useRef, useState } from 'react';
import { useNav, useSubEntry } from '../nav';
import { peekCampSlug, takeCampSlug } from '../lib/startParam';
import { supabase } from '../lib/supabase';
import { fetchLedgerTotals } from '../lib/pointsLedger';
import { Avatar, EmptyState, ListRow, Pill } from '../ui/components';
import Link from './Link';
import LinkOnboarding from './LinkOnboarding';
import LinkStatus, { STATUS, type Req } from './LinkStatus';
import { Failure, Loading } from './Message';
import ParentCamps from './ParentCamps';
import PointsLedger from './PointsLedger';

interface Child {
  id: string;
  name: string;
  group: string | null;
  points: number;
  played: number;
  goals: number;
}

const plural = (n: number) => {
  const a = Math.abs(n);
  return a % 10 === 1 && a % 100 !== 11 ? 'балл' : a % 10 >= 2 && a % 10 <= 4 && (a % 100 < 10 || a % 100 >= 20) ? 'балла' : 'баллов';
};

// Карточка ребёнка: имя, группа, сумма баллов и история начислений по новому журналу. Других детей и голов здесь нет.
function ChildCard({ c }: { c: Child }) {
  return (
    <section className="ks-card ks-kid" aria-label={c.name}>
      <div className="ks-kid-head">
        <Avatar name={c.name} />
        <div className="ks-kid-who">
          <h2>{c.name}</h2>
          {c.group && <p className="muted">{c.group}</p>}
        </div>
        <div className="ks-kid-score" aria-label={`${c.points} ${plural(c.points)}`}>
          <strong>{c.points}</strong>
          <span>{plural(c.points)}</span>
        </div>
      </div>
      <p className="muted ks-kid-stats">Матчей сыграно: {c.played} · голов: {c.goals}</p>
      <PointsLedger playerId={c.id} showEmpty />
    </section>
  );
}

export default function Home({ isAdmin = false, onGuest }: { isAdmin?: boolean; onGuest?: () => void }) {
  const [children, setChildren] = useState<Child[] | null>(null);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [showLink, setShowLink] = useState(false);
  const [addMore, setAddMore] = useState(false);
  const nav = useNav();
  const statusOpen = Boolean(useSubEntry('hm.status')); // статусы запросов — запись стека
  const campsEntry = useSubEntry('hm.camps'); // сборы родителя (#470, условие 49)
  const campsOpen = Boolean(campsEntry);
  const wasStatus = useRef(false);
  const retry = () => {
    setError(null);
    setReload(n => n + 1);
  };
  const openStatus = () => nav.push('hm.status');
  // после просмотра статусов (и «Назад», и системной) подтянуть новых детей
  useEffect(() => {
    if (wasStatus.current && !statusOpen) setReload(n => n + 1);
    wasStatus.current = statusOpen;
  }, [statusOpen]);
  const refresh = useCallback(() => setReload(n => n + 1), []);
  // Ссылка t.me/kicksapp?startapp=camp_<имя> (условие 62): родителю с детьми один раз за запуск открываем сборы с этим именем
  const hasKids = Boolean(children && children.length > 0);
  useEffect(() => {
    if (!hasKids || !peekCampSlug()) return;
    const slug = takeCampSlug();
    if (slug) nav.push('hm.camps', { open: slug });
  }, [hasKids, nav]);

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
      const led = ids.length ? await fetchLedgerTotals(ids) : { totals: {} as Record<string, number>, error: null };
      if (led.error) return setError(led.error);
      // Голы и матчи видны только своему ребёнку: чужие карточки родитель не получает (RLS), других детей здесь нет
      const mp = ids.length
        ? await supabase.from('match_players').select('player_id, played, goals').in('player_id', ids)
        : { data: [], error: null };
      if (mp.error) return setError(mp.error.message);
      const parts = (mp.data ?? []) as { player_id: string; played: boolean; goals: number }[];
      // Запросы нужны только для строки «ждёт подтверждения»; сбой этой выборки не мешает показать детей
      const rq = await supabase.from('link_requests').select('id, status, players(full_name)').eq('user_id', me).order('created_at', { ascending: false });
      setReqs(rq.error ? [] : ((rq.data ?? []) as unknown as Req[]));
      setChildren(
        kids.map(k => {
          const played = parts.filter(p => p.player_id === k.id);
          return { ...k, points: led.totals[k.id] ?? 0, played: played.filter(p => p.played).length, goals: played.reduce((s, p) => s + (p.goals ?? 0), 0) };
        }),
      );
    })();
  }, [reload]);

  if (error) return <Failure title="Не удалось загрузить данные" text={error} onRetry={retry} />;
  if (!children) return <Loading />;
  if (statusOpen) return <LinkStatus onBack={() => nav.back()} />;
  if (campsOpen) return <ParentCamps onBack={() => nav.back()} openSlug={campsEntry?.params.open ?? null} />;

  const waiting = reqs.filter(r => r.status === 'pending').length;
  const rejected = reqs.filter(r => r.status === 'rejected').length;
  const statusRow = waiting + rejected > 0 && (
    <ListRow
      title="Запросы на привязку"
      sub={[
        ...(waiting ? [<Pill tone={STATUS.pending.tone} dot>{STATUS.pending.label}: {waiting}</Pill>] : []),
        ...(rejected ? [<Pill tone={STATUS.rejected.tone} dot>{STATUS.rejected.label}: {rejected}</Pill>] : []),
      ]}
      onClick={openStatus}
    />
  );

  if (!children.length) {
    // Администратору форма поиска ребёнка не нужна: он подтверждает запросы родителей во вкладке «Запросы»
    if (isAdmin && !showLink) {
      return (
        <main className="page">
          <h1>Мой ребёнок</h1>
          <p className="muted" style={{ marginBottom: 14 }}>У вас нет привязанных детей. Запросы родителей — во вкладке «Запросы».</p>
          <button className="ks-btn secondary" onClick={() => setShowLink(true)}>
            Привязать своего ребёнка
          </button>
        </main>
      );
    }
    return <LinkOnboarding reqs={reqs} onApproved={refresh} onOpenStatus={openStatus} onGuest={onGuest} />;
  }
  return (
    <main className="page">
      <h1>{children.length > 1 ? 'Мои дети' : 'Мой ребёнок'}</h1>
      {children.map(c => (
        <ChildCard c={c} key={c.id} />
      ))}
      <ListRow title="Сборы" sub={['Запись, оплаты, документы']} onClick={() => nav.push('hm.camps')} />
      {addMore ? (
        <Link onApproved={refresh} onOpenStatus={openStatus} />
      ) : (
        <>
          {statusRow}
          <button className="ks-btn secondary" onClick={() => setAddMore(true)}>
            + Добавить ещё одного ребёнка
          </button>
        </>
      )}
    </main>
  );
}
