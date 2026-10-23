import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { EmptyState, ListRow, Pill, type Tone } from '../ui/components';
import { BackNav } from '../ui/nav';
import { Failure, Loading } from './Message';

export interface Req { id: string; status: 'pending' | 'approved' | 'rejected'; players: { full_name: string } | null }

// Статус и пояснение показываем только те, что следуют из самого статуса: сроков не обещаем, причин отказа не знаем.
export const STATUS: Record<Req['status'], { label: string; tone: Tone; text: string }> = {
  pending: { label: 'Ждёт подтверждения', tone: 'warning', text: 'Администратор клуба проверит запрос.' },
  approved: { label: 'Подтверждено', tone: 'success', text: 'Ребёнок привязан и виден на вкладке «Ребёнок».' },
  rejected: { label: 'Отклонено', tone: 'danger', text: 'Вопросы по запросу — администратору клуба.' },
};

// Запросы родителя на привязку ребёнка и их статусы. Только просмотр: отмены и повторной отправки в приложении нет.
export default function LinkStatus({ onBack }: { onBack: () => void }) {
  const [reqs, setReqs] = useState<Req[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

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
          return <ListRow key={r.id} avatar={r.players?.full_name ?? 'Игрок'} title={r.players?.full_name ?? 'Игрок'} sub={[<Pill tone={s.tone} dot>{s.label}</Pill>, s.text]} />;
        })
      )}
    </main>
  );
}
