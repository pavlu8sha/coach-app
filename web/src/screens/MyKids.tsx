import { useCallback, useEffect, useRef, useState } from 'react';
import { useNav, useSubEntry } from '../nav';
import { loadMyChildren } from '../lib/myChildren';
import { supabase } from '../lib/supabase';
import { EmptyState, ListRow } from '../ui/components';
import { BackNav } from '../ui/nav';
import Link, { HideWhen, useLinkPolicyOpen } from './Link';
import LinkStatus from './LinkStatus';
import { Failure, Loading } from './Message';
import { useConfirm } from '../ui/ConfirmSheet';
import { errMsg } from '../lib/coach';

interface Kid { id: string; name: string; group: string | null }
// Статус привязки аккаунта ребёнка (#735): пока он неизвестен или не удалось проверить, действий над кодом нет
type LinkState = 'loading' | 'linked' | 'free' | 'error';
// Статус действует только для того поколения списка (счётчик reload), в котором получен: с началом новой загрузки
// списка он недействителен в том же рендере (состояние «loading»), без промежутка до эффекта.
interface LinkEntry { gen: number; s: LinkState }

// Память между открытиями экрана: список детей и последний известный статус привязки показываются сразу,
// свежие данные подтягиваются тихо (иначе при каждом открытии заглушка и смена текста). Сбрасывается при выходе/смене пользователя.
let kidsMemory: { kids: Kid[]; links: Record<string, LinkState> } | null = null;
let memoryUser: string | undefined;
export function resetMyKidsCache() { kidsMemory = null; memoryUser = undefined; }
export function myKidsAuthEvent(ev: string, session: { user?: { id?: string } } | null) {
  const id = session?.user?.id;
  if (ev === 'SIGNED_OUT' || (id && memoryUser && id !== memoryUser)) kidsMemory = null;
  if (id) memoryUser = id;
}

// «Мои дети»: привязанные дети текущего пользователя, добавление ребёнка и статус запросов.
export default function MyKids({ onBack }: { onBack: () => void }) {
  const { ask, dialog: confirmDialog } = useConfirm();
  const [kids, setKids] = useState<Kid[] | null>(() => kidsMemory?.kids ?? null);
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
  const [linkStates, setLinkStates] = useState<Record<string, LinkEntry>>(() => Object.fromEntries(Object.entries(kidsMemory?.links ?? {}).map(([id, st]) => [id, { gen: 0, s: st }])));
  const linkStateOf = (id: string): LinkState => { const e = linkStates[id]; return e && e.gen === reload ? e.s : 'loading'; };
  const linkStateRef = useRef(linkStateOf); // актуальный статус для обработчиков (защита от нажатия по устаревшему экрану)
  linkStateRef.current = linkStateOf;
  const kidsGen = useRef(0); // поколение списка, из которого получен текущий список детей
  const seq = useRef<Record<string, number>>({}); // номер последней проверки ребёнка: ответ более ранней не применяется
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true; // при повторном запуске эффекта (StrictMode) снова «жив»
    return () => { alive.current = false; };
  }, []);
  const seqNext = useRef(0); // общий счётчик проверок (номера не повторяются)

  useEffect(() => {
    let cancelled = false; // устаревший ответ прежней загрузки списка не применяется
    const gen = reload;
    void (async () => {
      const me = (await supabase.auth.getUser()).data.user?.id;
      if (cancelled) return;
      if (!me) return setError('Нет сессии');
      const links = await loadMyChildren();
      if (cancelled) return;
      if (links.error) return setError(errMsg(links.error));
      kidsGen.current = gen;
      const list = (links.kids ?? []).map(k => ({ id: k.player_id, name: k.full_name ?? '', group: k.group_name }));
      kidsMemory = { kids: list, links: Object.fromEntries(list.filter(k => kidsMemory?.links[k.id]).map(k => [k.id, kidsMemory!.links[k.id]])) };
      setKids(list); // новый массив: статусы привязки перепроверяются для этого поколения списка
    })();
    return () => { cancelled = true; };
  }, [reload]);

  const checkLinked = useCallback(async (id: string, gen: number) => {
    const n = (seq.current[id] = ++seqNext.current);
    setLinkStates(m => (m[id]?.gen === gen && m[id].s !== 'loading' ? m : { ...m, [id]: { gen, s: 'loading' } })); // известный статус не затираем «Проверяю…»: тихая перепроверка
    let next: LinkState;
    try {
      const r = await supabase.rpc('child_linked', { p: id });
      // ошибка и ответ не true/false не считаются «не привязан»
      next = r.error ? 'error' : r.data === true ? 'linked' : r.data === false ? 'free' : 'error';
    } catch {
      next = 'error'; // отклонённый запрос (сеть и т.п.): тот же безопасный error, текст исключения не показываем
    }
    if (!alive.current || seq.current[id] !== n) return;
    if (kidsMemory) kidsMemory.links[id] = next;
    setLinkStates(m => ({ ...m, [id]: { gen, s: next } }));
  }, []);

  useEffect(() => {
    if (!kids) return;
    kids.forEach(k => void checkLinked(k.id, kidsGen.current));
  }, [kids, checkLinked]);

  const makeCode = async (id: string) => {
    if (linkStateRef.current(id) !== 'free') return;
    setBusy(true);
    setMsg(null);
    const r = await supabase.rpc('create_child_code', { p: id });
    setBusy(false);
    if (r.error) return setMsg(r.error.message.includes('Could not find the function') ? 'Это действие пока недоступно.' : errMsg(r.error));
    setCodes(c => ({ ...c, [id]: r.data as string }));
  };

  const unlinkChild = async (id: string) => {
    if (linkStateRef.current(id) !== 'linked') return;
    setBusy(true);
    setMsg(null);
    const r = await supabase.rpc('unlink_child', { p: id });
    setBusy(false);
    if (r.error) return setMsg(errMsg(r.error));
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
    if (r.error) setMsg(r.error.message.includes('Could not find the function') ? 'Это действие пока недоступно.' : errMsg(r.error));
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
                <div className="ks-link-row" style={{ display: 'flex', marginBottom: 8 }}><div className="ks-back" role="status" style={{ color: 'var(--ks-text-muted)', fontWeight: 400, cursor: 'default' }}>Проверяю привязку аккаунта…</div></div> /* своя строка на всю ширину, как у кнопок «Код для ребёнка» / «Отвязать»: страница не прыгает, когда проверка закончилась */
              ) : linkStateOf(k.id) === 'error' ? (
                <div style={{ marginBottom: 8 }}>
                  <p className="error" role="alert">Не удалось проверить привязку аккаунта ребёнка. Действия с кодом скрыты, пока проверка не пройдёт.</p>
                  <button type="button" className="ks-back" onClick={() => void checkLinked(k.id, reload)}>Повторить проверку</button>
                </div>
              ) : linkStateOf(k.id) === 'linked' ? (
                <div className="ks-link-row" style={{ display: 'flex', marginBottom: 8 }}><button type="button" className="ks-back" disabled={busy} onClick={() => void unlinkChild(k.id)}>Отвязать аккаунт ребёнка</button></div>
              ) : (
                <div className="ks-link-row" style={{ display: 'flex', marginBottom: 8 }}><button type="button" className="ks-back" disabled={busy} onClick={() => void makeCode(k.id)}>Код для ребёнка</button></div>
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
