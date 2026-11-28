import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { userError } from '../lib/userError';
import { Avatar, EmptyState, Pill, type Tone } from '../ui/components';
import { BackNav } from '../ui/nav';
import { Failure, Loading } from './Message';
import { useConfirm } from '../ui/ConfirmSheet';
import { loadMyLinkRequests, loadPendingConsents } from '../lib/linkRequests';
import { loadMyChildren } from '../lib/myChildren';

export interface Req { id: string; status: 'pending' | 'approved' | 'rejected'; player_id?: string | null; players: { full_name: string } | null }

// Фактический доступ к ребёнку по подтверждённому запросу (#761): текст берётся из него, а не из одного статуса
type Access = 'visible' | 'consent' | 'missing' | 'unknown';

// Статус и пояснение показываем только те, что следуют из самого статуса: сроков не обещаем, причин отказа не знаем.
export const STATUS: Record<Req['status'], { label: string; tone: Tone; text: string }> = {
  pending: { label: 'Ждёт подтверждения', tone: 'warning', text: 'Администратор клуба проверит запрос. Пока ждёте, приложением можно пользоваться: ребёнок появится на вкладке «Ребёнок» после подтверждения.' },
  approved: { label: 'Подтверждено', tone: 'success', text: 'Запрос подтверждён.' }, // подробный текст зависит от фактического доступа: ACCESS_TEXT
  rejected: { label: 'Отклонено', tone: 'danger', text: 'Можно попробовать снова или спросить администратора клуба.' },
};

const ACCESS_TEXT: Record<Access, string> = {
  visible: 'Ребёнок привязан и виден на вкладке «Ребёнок».',
  consent: 'Запрос подтверждён. Осталось принять согласие, после этого ребёнок появится на вкладке «Ребёнок».',
  missing: 'Запрос подтверждён, но ребёнок пока не отображается. Нажмите «Проверить снова». Если не помогло, напишите администратору клуба.',
  unknown: 'Запрос подтверждён. Не удалось проверить, виден ли ребёнок. Нажмите «Проверить снова».',
};

// Сообщения по ответам функций cancel_link / retry_link (см. db/migrations/0017_link_cancel_retry.sql)
const actionKnown = (m: string): string | null =>
  m.includes('link request limit')
    ? 'Слишком много запросов и отмен за час. Попробуйте позже.'
    : m.includes('retry too soon')
    ? 'Повторить можно не раньше чем через сутки после отказа.'
    : m.includes('too many pending')
      ? 'Слишком много неподтверждённых запросов. Дождитесь ответа администратора.'
      : m.includes('already decided') || m.includes('not rejected')
        ? 'Запрос уже обработан администратором. Список обновлён.'
        : m.includes('consent required')
          ? 'Для повторного запроса нужно действующее согласие. Обратитесь к администратору клуба.'
          : m.includes('Could not find the function') || m.includes('schema cache')
            ? 'Это действие пока недоступно.'
            : null;
const actionError = (e: unknown) => userError(e, actionKnown);

// Запросы родителя на привязку ребёнка и их статусы. Можно отменить неподтверждённый запрос и повторить отклонённый.
export default function LinkStatus({ onBack }: { onBack: () => void }) {
  const { ask, dialog: confirmDialog } = useConfirm();
  const [reqs, setReqs] = useState<Req[] | null>(null);
  const [access, setAccess] = useState<{ kids: { id: string; name: string }[]; pending: { id: string; name: string }[] } | null>(null); // null: доступ проверить не удалось
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(null);
  const askCancel = async (id: string) => {
    if (!(await ask({ title: 'Отменить запрос?', note: 'Ребёнок снова появится в поиске.', confirmLabel: 'Отменить запрос', danger: true }))) return;
    await act(id, 'cancel_link');
  };

  useEffect(() => {
    let cancelled = false; // ответ устаревшей загрузки не применяется
    void (async () => {
      try {
        const me = (await supabase.auth.getUser()).data.user?.id;
        if (cancelled) return;
        if (!me) return setError('Нет сессии');
        const r = await loadMyLinkRequests(me); // имя ребёнка из my_link_requests() (0217): до подтверждения родитель не видит строку players
        if (cancelled) return;
        if (r.error) return setError(actionError(r.error));
        const list = r.reqs ?? [];
        // фактический доступ нужен только для подтверждённых запросов; сбой проверки не блокирует список статусов (#761)
        let acc: typeof access = null;
        if (list.some(x => x.status === 'approved')) {
          const [ch, pc] = await Promise.all([loadMyChildren(), loadPendingConsents()]);
          if (cancelled) return;
          if (!ch.error && !pc.error) acc = { kids: (ch.kids ?? []).map(k => ({ id: k.player_id, name: k.full_name ?? '' })), pending: pc.items.map(k => ({ id: k.player_id, name: k.full_name ?? '' })) };
        }
        setAccess(acc);
        setReqs(list);
      } catch (e) {
        if (!cancelled) setError(actionError(e)); // отказ загрузки не остаётся необработанным, «Повторить» доступна
      }
    })();
    return () => { cancelled = true; };
  }, [reload]);

  const accessOf = (r: Req): Access => {
    if (!access) return 'unknown';
    const same = (x: { id: string; name: string }) => (r.player_id ? x.id === r.player_id : x.name === (r.players?.full_name ?? ''));
    return access.kids.some(same) ? 'visible' : access.pending.some(same) ? 'consent' : 'missing';
  };

  const act = async (id: string, fn: 'cancel_link' | 'retry_link') => {
    setBusyId(id);
    setNotice(null);
    try {
      const r = await supabase.rpc(fn, { r: id });
      if (r.error) setNotice({ id, text: actionError(r.error) });
    } catch (e) {
      setNotice({ id, text: actionError(e) });
    } finally {
      setBusyId(null);
      setReload(n => n + 1);
    }
  };

  if (error) return <Failure title="Не удалось загрузить запросы" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} back={<BackNav onBack={onBack} managed />} />;
  if (!reqs) return <Loading />;

  return (
    <main className="page">
      <BackNav onBack={onBack} managed />
      <h1>Статус привязки</h1>
      {reqs.length === 0 ? (
        <EmptyState icon="users" title="Запросов пока нет" text="Найдите ребёнка и отправьте запрос на привязку." />
      ) : (
        reqs.map(r => {
          const s = STATUS[r.status];
          const name = r.players?.full_name ?? 'Игрок';
          const busy = busyId === r.id;
          const acc = r.status === 'approved' ? accessOf(r) : null;
          return (
            <div className="ks-card" key={r.id}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <Avatar name={name} />
                <span className="ks-row-main">
                  <span className="ks-row-title">{name}</span>
                  <span className="ks-row-sub">
                    <Pill tone={s.tone} dot>{s.label}</Pill>
                  </span>
                  <span className="ks-row-sub">{acc ? ACCESS_TEXT[acc] : s.text}</span>
                </span>
              </div>
              {notice?.id === r.id && <p className="error" role="alert">{notice.text}</p>}
              {r.status === 'pending' &&
                <button type="button" className="ks-btn secondary" style={{ marginTop: 10 }} disabled={busy} onClick={() => void askCancel(r.id)}>Отменить запрос</button>
              }
              {(acc === 'missing' || acc === 'unknown') &&
                <button type="button" className="ks-btn secondary" style={{ marginTop: 10 }} onClick={() => setReload(n => n + 1)}>Проверить снова</button>
              }
              {r.status === 'rejected' && (
                <button type="button" className="ks-btn secondary" style={{ marginTop: 10 }} disabled={busy} onClick={() => void act(r.id, 'retry_link')}>Попробовать снова</button>
              )}
            </div>
          );
        })
      )}
      {confirmDialog}
    </main>
  );
}
