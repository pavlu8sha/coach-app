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
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [codes, setCodes] = useState<Record<string, string>>({}); // выданные в этой сессии коды для ребёнка
  const [linkedKids, setLinkedKids] = useState<Set<string>>(new Set());

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

  useEffect(() => {
    if (!kids) return;
    void (async () => {
      const res = await Promise.all(kids.map(async k => ((await supabase.rpc('child_linked', { p: k.id })).data === true ? k.id : null)));
      setLinkedKids(new Set(res.filter((x): x is string => x !== null)));
    })();
  }, [kids]);

  const makeCode = async (id: string) => {
    setBusy(true);
    setMsg(null);
    const r = await supabase.rpc('create_child_code', { p: id });
    setBusy(false);
    if (r.error) return setMsg(r.error.message.includes('Could not find the function') ? 'Это действие пока недоступно.' : r.error.message);
    setCodes(c => ({ ...c, [id]: r.data as string }));
  };

  const unlinkChild = async (id: string) => {
    setBusy(true);
    setMsg(null);
    const r = await supabase.rpc('unlink_child', { p: id });
    setBusy(false);
    if (r.error) return setMsg(r.error.message);
    setCodes(c => { const n = { ...c }; delete n[id]; return n; });
    setReload(n => n + 1);
  };

  const revoke = async (id: string) => {
    setBusy(true);
    setMsg(null);
    const r = await supabase.rpc('revoke_consent', { p: id });
    setBusy(false);
    setConfirmId(null);
    if (r.error) setMsg(r.error.message.includes('Could not find the function') ? 'Это действие пока недоступно.' : r.error.message);
    setReload(n => n + 1);
  };

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
        kids.map(k => (
          <div key={k.id}>
            <ListRow avatar={k.name} title={k.name} sub={k.group ? [k.group] : undefined} />
            {codes[k.id] ? (
              <div className="ks-card" style={{ marginTop: -4, marginBottom: 8 }}>
                <p className="muted">Код для ребёнка (действует 3 дня): ребёнок выбирает роль «Ребёнок» и вводит его при входе.</p>
                <p style={{ fontSize: 24, letterSpacing: 4, fontWeight: 600 }}>{codes[k.id]}</p>
              </div>
            ) : linkedKids.has(k.id) ? (
              <button type="button" className="ks-back" style={{ marginBottom: 8 }} disabled={busy} onClick={() => void unlinkChild(k.id)}>Отвязать аккаунт ребёнка</button>
            ) : (
              <button type="button" className="ks-back" style={{ marginBottom: 8 }} disabled={busy} onClick={() => void makeCode(k.id)}>Код для ребёнка</button>
            )}
            {confirmId === k.id ? (
              <div className="ks-card" style={{ marginTop: -4 }}>
                <p style={{ marginBottom: 10 }}>Отозвать согласие? Ребёнок и все его данные пропадут из вашего приложения. Чтобы вернуть ребёнка, нужно будет подать новый запрос и снова дать согласие.</p>
                <button type="button" className="ks-btn" disabled={busy} onClick={() => void revoke(k.id)}>Отозвать согласие</button>
                <div style={{ height: 8 }} />
                <button type="button" className="ks-btn secondary" disabled={busy} onClick={() => setConfirmId(null)}>Не отзывать</button>
              </div>
            ) : (
              <button type="button" className="ks-back" style={{ marginBottom: 8 }} onClick={() => setConfirmId(k.id)}>Отозвать согласие</button>
            )}
          </div>
        ))
      )}
      {msg && <p className="error">{msg}</p>}
      <div style={{ height: 8 }} />
      <Link onApproved={() => setReload(n => n + 1)} onOpenStatus={() => setStatusOpen(true)} />
    </main>
  );
}
