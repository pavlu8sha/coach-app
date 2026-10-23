import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { EmptyState, ListRow } from '../ui/components';
import { BackNav } from '../ui/nav';
import Link from './Link';
import LinkStatus from './LinkStatus';
import { Failure, Loading } from './Message';

interface Kid { id: string; name: string; group: string | null }

// «Мои дети»: привязанные дети текущего пользователя, добавление ребёнка и статус запросов.
export default function MyKids({ onBack }: { onBack: () => void }) {
  const [kids, setKids] = useState<Kid[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [statusOpen, setStatusOpen] = useState(false);

  useEffect(() => {
    void (async () => {
      const me = (await supabase.auth.getUser()).data.user?.id;
      if (!me) return setError('Нет сессии');
      const links = await supabase.from('player_guardians').select('players(id, full_name, groups(name))').eq('user_id', me).is('consent_revoked_at', null);
      if (links.error) return setError(links.error.message);
      setKids(
        ((links.data ?? []) as any[])
          .filter(l => l.players)
          .map(l => ({ id: l.players.id as string, name: (l.players.full_name ?? '') as string, group: (l.players.groups?.name ?? null) as string | null })),
      );
    })();
  }, [reload]);

  if (statusOpen) return <LinkStatus onBack={() => { setStatusOpen(false); setReload(n => n + 1); }} />;
  if (error) return <Failure title="Не удалось загрузить детей" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} back={<BackNav onBack={onBack} />} />;
  if (!kids) return <Loading />;

  return (
    <main className="page">
      <BackNav onBack={onBack} />
      <h1>Мои дети</h1>
      {kids.length === 0 ? (
        <EmptyState icon="users" title="Нет привязанных детей" text="Найдите ребёнка ниже. Администратор клуба подтвердит запрос." />
      ) : (
        kids.map(k => <ListRow key={k.id} avatar={k.name} title={k.name} sub={k.group ? [k.group] : undefined} />)
      )}
      <div style={{ height: 8 }} />
      <Link onApproved={() => setReload(n => n + 1)} onOpenStatus={() => setStatusOpen(true)} />
    </main>
  );
}
