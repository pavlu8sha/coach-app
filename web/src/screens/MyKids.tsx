import { useCallback, useEffect, useRef, useState } from 'react';
import { useNav, useSubEntry } from '../nav';
import { supabase } from '../lib/supabase';
import { EmptyState, ListRow } from '../ui/components';
import { BackNav } from '../ui/nav';
import Link, { HideWhen, useLinkPolicyOpen } from './Link';
import LinkStatus from './LinkStatus';
import { Failure, Loading } from './Message';
import { useConfirm } from '../ui/ConfirmSheet';

interface Kid { id: string; name: string; group: string | null }
// Статус привязки аккаунта ребёнка (#735): пока он неизвестен или не удалось проверить, действий над кодом нет
type LinkState = 'loading' | 'linked' | 'free' | 'error';

// «Мои дети»: привязанные дети текущего пользователя, добавление ребёнка и статус запросов.
export default function MyKids({ onBack }: { onBack: () => void }) {
  const { ask, dialog: confirmDialog } = useConfirm();
  const [kids, setKids] = useState<Kid[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const nav = useNav();
  const policyOpen = useLinkPolicyOpen();
  const statusOpen = Boolean(useSubEntry('mk.status')); // статусы запросов — запись стека
  const wasStatus = useRef(false);
  useEffect(() => {
    if (wasStatus.current && !statusOpen) setReload(n => n + 1);
    wasStatus.current = statusOpen;
  }, [statusOpen]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [codes, setCodes] = useState<Record<string, string>>({}); // выданные в этой сессии коды для ребёнка
  const [linkStates, setLinkStates] = useState<Record<string, LinkState>>({});
  const linkStateOf = (id: string): LinkState => linkStates[id] ?? 'loading';
  const linkRef = useRef<Record<string, LinkState>>({}); // актуальный статус для обработчиков (защита от нажатия по устаревшему экрану)
  linkRef.current = linkStates;
  const seq = useRef<Record<string, number>>({}); // номер последней проверки ребёнка: ответ более ранней не применяется
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

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

  const checkLinked = useCallback(async (id: string) => {
    const n = (seq.current[id] = (seq.current[id] ?? 0) + 1);
    setLinkStates(m => ({ ...m, [id]: 'loading' }));
    const r = await supabase.rpc('child_linked', { p: id });
    if (!alive.current || seq.current[id] !== n) return;
    // ошибка и ответ не true/false не считаются «не привязан»
    const next: LinkState = r.error ? 'error' : r.data === true ? 'linked' : r.data === false ? 'free' : 'error';
    setLinkStates(m => ({ ...m, [id]: next }));
  }, []);

  useEffect(() => {
    if (!kids) return;
    kids.forEach(k => void checkLinked(k.id));
  }, [kids, checkLinked]);

  const makeCode = async (id: string) => {
    if (linkRef.current[id] !== 'free') return;
    setBusy(true);
    setMsg(null);
    const r = await supabase.rpc('create_child_code', { p: id });
    setBusy(false);
    if (r.error) return setMsg(r.error.message.includes('Could not find the function') ? 'Это действие пока недоступно.' : r.error.message);
    setCodes(c => ({ ...c, [id]: r.data as string }));
  };

  const unlinkChild = async (id: string) => {
    if (linkRef.current[id] !== 'linked') return;
    setBusy(true);
    setMsg(null);
    const r = await supabase.rpc('unlink_child', { p: id });
    setBusy(false);
    if (r.error) return setMsg(r.error.message);
    setCodes(c => { const n = { ...c }; delete n[id]; return n; });
    setReload(n => n + 1);
  };

  const askRevoke = async (k: Kid) => {
    if (!(await ask({ title: 'Отозвать согласие?', lines: [['Ребёнок', k.name]], note: 'Ребёнок и все его данные пропадут из вашего приложения. Чтобы вернуть ребёнка, нужен новый код.', confirmLabel: 'Отозвать согласие', danger: true }))) return;
    await revoke(k.id);
  };
  const revoke = async (id: string) => {
    setBusy(true);
    setMsg(null);
    const r = await supabase.rpc('revoke_consent', { p: id });
    setBusy(false);
    if (r.error) setMsg(r.error.message.includes('Could not find the function') ? 'Это действие пока недоступно.' : r.error.message);
    setReload(n => n + 1);
  };

  if (statusOpen) return <LinkStatus onBack={() => nav.back()} />;
  if (error) return <Failure title="Не удалось загрузить детей" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} back={<BackNav onBack={onBack} managed />} />;
  if (!kids) return <Loading />;

  return (
    <main className="page">
      <HideWhen hide={policyOpen}>
        <BackNav onBack={onBack} managed />
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
              ) : linkStateOf(k.id) === 'loading' ? (
                <p className="muted" role="status" style={{ marginBottom: 8 }}>Проверяю привязку аккаунта…</p>
              ) : linkStateOf(k.id) === 'error' ? (
                <div style={{ marginBottom: 8 }}>
                  <p className="error" role="alert">Не удалось проверить привязку аккаунта ребёнка. Действия с кодом скрыты, пока проверка не пройдёт.</p>
                  <button type="button" className="ks-back" onClick={() => void checkLinked(k.id)}>Повторить проверку</button>
                </div>
              ) : linkStateOf(k.id) === 'linked' ? (
                <button type="button" className="ks-back" style={{ marginBottom: 8 }} disabled={busy} onClick={() => void unlinkChild(k.id)}>Отвязать аккаунт ребёнка</button>
              ) : (
                <button type="button" className="ks-back" style={{ marginBottom: 8 }} disabled={busy} onClick={() => void makeCode(k.id)}>Код для ребёнка</button>
              )}
              <button type="button" className="ks-back" style={{ marginBottom: 8 }} disabled={busy} onClick={() => void askRevoke(k)}>Отозвать согласие</button>
            </div>
          ))
        )}
        {msg && <p className="error">{msg}</p>}
      </HideWhen>
      <div style={{ height: 8 }} />
      <Link onApproved={() => setReload(n => n + 1)} onOpenStatus={() => nav.push('mk.status')} />
      {confirmDialog}
    </main>
  );
}
