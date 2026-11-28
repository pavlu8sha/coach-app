import { useCallback, useEffect, useRef, useState } from 'react';
import { useNav, useSubEntry } from '../nav';
import { peekCampSlug, takeCampSlug } from '../lib/startParam';
import { loadMyChildren } from '../lib/myChildren';
import { loadMyLinkRequests, loadPendingConsents, type PendingConsent } from '../lib/linkRequests';
import ConsentAccept from './ConsentAccept';
import { supabase } from '../lib/supabase';
import { Avatar, EmptyState, ListRow, Pill } from '../ui/components';
import { BackNav } from '../ui/nav';
import Link, { HideWhen, useLinkPolicyOpen } from './Link';
import LinkOnboarding from './LinkOnboarding';
import LinkStatus, { STATUS, type Req } from './LinkStatus';
import { Failure, Loading } from './Message';
import ParentCamps from './ParentCamps';
import PlayerProfile from './PlayerProfile';
import { errMsg } from '../lib/coach';

interface Child {
  id: string;
  name: string;
  group: string | null;
  played: number;
  goals: number;
}

// Карточка ребёнка: имя, группа, сыгранные матчи и вход в профиль (баллы — во вкладке «Баллы» профиля). Других детей здесь нет.
function ChildCard({ c, onProfile }: { c: Child; onProfile: () => void }) {
  return (
    <section className="ks-card ks-kid" aria-label={c.name}>
      <div className="ks-kid-head">
        <Avatar name={c.name} />
        <div className="ks-kid-who">
          <h2>{c.name}</h2>
          {c.group && <p className="muted">{c.group}</p>}
        </div>
      </div>
      <p className="muted ks-kid-stats">Матчей сыграно: {c.played} · голов: {c.goals}</p>
      <button type="button" className="ks-btn secondary" onClick={onProfile} aria-label={`Профиль игрока: ${c.name}`}>
        Профиль игрока
      </button>
    </section>
  );
}

export default function Home({ isAdmin = false, onGuest }: { isAdmin?: boolean; onGuest?: () => void }) {
  const [children, setChildren] = useState<Child[] | null>(null);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [pendingConsents, setPendingConsents] = useState<PendingConsent[]>([]); // подтверждено, но не принято согласие (0217)
  const [error, setError] = useState<string | null>(null);
  const [reqsError, setReqsError] = useState(false); // запросы не загрузились, а дети да: дети остаются, рядом предупреждение с повтором (#761)
  const [syncing, setSyncing] = useState(false); // идёт перечитывание после «Проверить снова»
  const [checks, setChecks] = useState(0); // сколько загрузок завершено (для «Проверили: пока не отображается»)
  const [reload, setReload] = useState(0);
  const [showLink, setShowLink] = useState(false);
  const nav = useNav();
  const policyOpen = useLinkPolicyOpen();
  const addMore = Boolean(useSubEntry('hm.link')); // «Добавить ещё одного ребёнка» — запись стека (#732)
  const statusOpen = Boolean(useSubEntry('hm.status')); // статусы запросов — запись стека
  const campsEntry = useSubEntry('hm.camps'); // сборы родителя (#470, условие 49)
  const campsOpen = Boolean(campsEntry);
  const profileEntry = useSubEntry('hm.profile'); // профиль выбранного ребёнка (#266, П1.1)
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
  // закрыть запись поиска вместе со всем, что открыто поверх неё (политика): снимается именно hm.link, а не верхний экран
  const closeSearch = useCallback(() => {
    const i = nav.entries.findIndex(e => e.screen === 'hm.link');
    if (i < 0) return;
    for (let n = nav.entries.length - i; n > 0; n--) nav.back();
  }, [nav]);
  // первый ребёнок подтверждён (Link увидел одобрение), пока открыт поиск онбординга: закрываем запись, как раньше исчезал локальный поиск
  const hadKids = useRef<boolean | null>(null); // null: данные ещё не загружены
  useEffect(() => {
    if (hasKids && hadKids.current === false && addMore) closeSearch();
    if (children) hadKids.current = hasKids;
  }, [hasKids, children, addMore, closeSearch]);
  // после выхода из поиска (и «Назад», и системной) подтянуть новых детей и запросы, как после статусов
  const wasLink = useRef(false);
  useEffect(() => {
    if (wasLink.current && !addMore) setReload(n => n + 1);
    wasLink.current = addMore;
  }, [addMore]);
  useEffect(() => {
    if (!hasKids || !peekCampSlug()) return;
    const slug = takeCampSlug();
    if (slug) nav.push('hm.camps', { open: slug });
  }, [hasKids, nav]);

  useEffect(() => {
    let cancelled = false; // ответ устаревшей загрузки (повтор, уход с экрана) не применяется
    void (async () => {
      setSyncing(true);
      try {
        // Администратору RLS отдаёт все связи, поэтому берём только свои: «Мой ребёнок» — это дети текущего пользователя
        const me = (await supabase.auth.getUser()).data.user?.id;
        if (cancelled) return;
        if (!me) return setError('Нет сессии');
        // Запросы читаются раньше связей: если одобрение пришло между чтениями, связи уже новые, а запросы устаревшие, что безопаснее обратного (#761)
        const rq = await loadMyLinkRequests(me); // имя ребёнка из my_link_requests() (0217)
        if (cancelled) return;
        let links = await loadMyChildren(); // доступ решает сервер (my_children, 0215), как RLS
        // «одобрен, а связей нет»: один контролируемый повтор чтения связей, дальше — кнопка «Проверить снова»
        if (!cancelled && !links.error && !links.kids?.length && rq.reqs?.some(r => r.status === 'approved')) links = await loadMyChildren();
        if (cancelled) return;
        if (links.error) return setError(errMsg(links.error));
        const kids = (links.kids ?? []).map(k => ({ id: k.player_id, name: k.full_name ?? '', group: k.group_name })).filter(k => k.id);
        // сбой запросов без детей не выдаём за онбординг «запросов нет»: ошибка с повтором; с детьми — предупреждение рядом с ними
        if (rq.error && !kids.length) return setError(errMsg(rq.error));
        const ids = kids.map(k => k.id);
        // Голы и матчи видны только своему ребёнку: чужие карточки родитель не получает (RLS), других детей здесь нет
        const mp = ids.length
          ? await supabase.from('match_players').select('player_id, played, goals').in('player_id', ids)
          : { data: [], error: null };
        if (cancelled) return;
        if (mp.error) return setError(errMsg(mp.error));
        const parts = (mp.data ?? []) as { player_id: string; played: boolean; goals: number }[];
        // «подтверждён, но не виден»: и когда детей нет, и когда второй ребёнок ждёт согласия. Сбой проверки не выдаём за «согласий нет»: ошибка с повтором
        const pc = await loadPendingConsents();
        if (cancelled) return;
        if (pc.error) return setError(errMsg(pc.error));
        setReqs((rq.error ? [] : rq.reqs ?? []) as Req[]);
        setReqsError(Boolean(rq.error));
        setPendingConsents(pc.items);
        setChildren(
          kids.map(k => {
            const played = parts.filter(p => p.player_id === k.id);
            return { ...k, played: played.filter(p => p.played).length, goals: played.reduce((s, p) => s + (p.goals ?? 0), 0) };
          }),
        );
      } finally {
        if (!cancelled) { setSyncing(false); setChecks(n => n + 1); }
      }
    })();
    return () => { cancelled = true; };
  }, [reload]);

  if (error) return <Failure title="Не удалось загрузить данные" text={error} onRetry={retry} />;
  if (!children) return <Loading />;
  if (statusOpen) return <LinkStatus onBack={() => nav.back()} />;
  if (profileEntry?.params.pid) return <PlayerProfile key={profileEntry.params.pid} playerId={profileEntry.params.pid} onBack={() => nav.back()} />;
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
    if (pendingConsents.length && !showLink) return <ConsentAccept items={pendingConsents} onDone={refresh} />;
    return <LinkOnboarding reqs={reqs} onApproved={refresh} onOpenStatus={openStatus} onGuest={onGuest} onRetry={refresh} checking={syncing} checks={checks} />;
  }
  return (
    <main className="page">
      {pendingConsents.length > 0 && !addMore && <ConsentAccept embedded items={pendingConsents} onDone={refresh} />}
      <HideWhen hide={policyOpen}>
        <h1>{children.length > 1 ? 'Мои дети' : 'Мой ребёнок'}</h1>
        {children.map(c => (
          <ChildCard c={c} key={c.id} onProfile={() => nav.push('hm.profile', { pid: c.id })} />
        ))}
      </HideWhen>
      {addMore ? (
        <>
          <HideWhen hide={policyOpen}><BackNav onBack={() => nav.back()} managed /></HideWhen>
          <Link onApproved={refresh} onOpenStatus={openStatus} />
        </>
      ) : (
        <>
          {reqsError && (
            <div className="ks-card" role="alert" style={{ marginBottom: 12 }}>
              <b>Не удалось загрузить запросы на привязку</b>
              <p className="muted" style={{ margin: '4px 0 8px' }}>Дети показаны, а статусы запросов пока недоступны.</p>
              <button type="button" className="ks-btn secondary" disabled={syncing} onClick={refresh}>{syncing ? 'Загружаю…' : 'Повторить загрузку'}</button>
            </div>
          )}
          {statusRow}
          <button className="ks-btn secondary" onClick={() => nav.push('hm.link')}>
            + Добавить ещё одного ребёнка
          </button>
        </>
      )}
    </main>
  );
}
