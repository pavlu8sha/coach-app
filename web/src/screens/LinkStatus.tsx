import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Avatar, EmptyState, Pill, type Tone } from '../ui/components';
import { BackNav } from '../ui/nav';
import { Failure, Loading } from './Message';

export interface Req { id: string; status: 'pending' | 'approved' | 'rejected'; players: { full_name: string } | null }

// Статус и пояснение показываем только те, что следуют из самого статуса: сроков не обещаем, причин отказа не знаем.
export const STATUS: Record<Req['status'], { label: string; tone: Tone; text: string }> = {
  pending: { label: 'Ждёт подтверждения', tone: 'warning', text: 'Администратор клуба проверит запрос. Пока ждёте, приложением можно пользоваться: ребёнок появится на вкладке «Ребёнок» после подтверждения.' },
  approved: { label: 'Подтверждено', tone: 'success', text: 'Ребёнок привязан и виден на вкладке «Ребёнок».' },
  rejected: { label: 'Отклонено', tone: 'danger', text: 'Можно попробовать снова или спросить администратора клуба.' },
};

// Сообщения по ответам функций cancel_link / retry_link (см. db/migrations/0017_link_cancel_retry.sql)
const actionError = (m: string) =>
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
            : m;

// Запросы родителя на привязку ребёнка и их статусы. Можно отменить неподтверждённый запрос и повторить отклонённый.
export default function LinkStatus({ onBack }: { onBack: () => void }) {
  const [reqs, setReqs] = useState<Req[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(null);

  useEffect(() => {
    void (async () => {
      const me = (await supabase.auth.getUser()).data.user?.id;
      if (!me) return setError('Нет сессии');
      // только свои запросы: администратору RLS отдаёт чужие, они показываются во вкладке «Запросы»
      const r = await supabase.from('link_requests').select('id, status, players(full_name)').eq('user_id', me).order('created_at', { ascending: false });
      if (r.error) return setError(r.error.message);
      setReqs((r.data ?? []) as unknown as Req[]);
    })();
  }, [reload]);

  const act = async (id: string, fn: 'cancel_link' | 'retry_link') => {
    setBusyId(id);
    setNotice(null);
    const r = await supabase.rpc(fn, { r: id });
    setBusyId(null);
    setConfirmId(null);
    if (r.error) setNotice({ id, text: actionError(r.error.message) });
    setReload(n => n + 1);
  };

  if (error) return <Failure title="Не удалось загрузить запросы" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} back={<BackNav onBack={onBack} />} />;
  if (!reqs) return <Loading />;

  return (
    <main className="page">
      <BackNav onBack={onBack} />
      <h1>Статус привязки</h1>
      {reqs.length === 0 ? (
        <EmptyState icon="users" title="Запросов пока нет" text="Найдите ребёнка и отправьте запрос на привязку." />
      ) : (
        reqs.map(r => {
          const s = STATUS[r.status];
          const name = r.players?.full_name ?? 'Игрок';
          const busy = busyId === r.id;
          return (
            <div className="ks-card" key={r.id}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <Avatar name={name} />
                <span className="ks-row-main">
                  <span className="ks-row-title">{name}</span>
                  <span className="ks-row-sub">
                    <Pill tone={s.tone} dot>{s.label}</Pill>
                  </span>
                  <span className="ks-row-sub">{s.text}</span>
                </span>
              </div>
              {notice?.id === r.id && <p className="error">{notice.text}</p>}
              {r.status === 'pending' &&
                (confirmId === r.id ? (
                  <div style={{ marginTop: 10 }}>
                    <p style={{ marginBottom: 8 }}>Отменить запрос? Ребёнок снова появится в поиске.</p>
                    <button type="button" className="ks-btn" disabled={busy} onClick={() => void act(r.id, 'cancel_link')}>Отменить запрос</button>
                    <div style={{ height: 8 }} />
                    <button type="button" className="ks-btn secondary" disabled={busy} onClick={() => setConfirmId(null)}>Не отменять</button>
                  </div>
                ) : (
                  <button type="button" className="ks-btn secondary" style={{ marginTop: 10 }} onClick={() => setConfirmId(r.id)}>Отменить запрос</button>
                ))}
              {r.status === 'rejected' && (
                <button type="button" className="ks-btn secondary" style={{ marginTop: 10 }} disabled={busy} onClick={() => void act(r.id, 'retry_link')}>Попробовать снова</button>
              )}
            </div>
          );
        })
      )}
    </main>
  );
}
