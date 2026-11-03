import { useEffect, useMemo, useState } from 'react';
import { coachError, compareGroups, fmtDate, groupByGroupName } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { EmptyState, ListRow, Pill, SearchInput, Segmented } from '../ui/components';
import { BackNav } from '../ui/nav';
import { useConfirm } from '../ui/ConfirmSheet';
import { Failure, Loading } from './Message';

interface Line { kit: string; size: string | null; quantity: number }
interface Order {
  id: string; ordered_on: string | null; location: string | null;
  players: { full_name: string; groups?: { name: string } | null } | null;
  equipment_order_lines: Line[];
  equipment_issues: { kit: string; issued_on: string; issued_by: string | null }[];
}
const COLS = 'id, ordered_on, location, players(full_name, groups(name)), equipment_order_lines(kit, size, quantity), equipment_issues(kit, issued_on, issued_by)';

const kitsOf = (o: Order) => [...new Set(o.equipment_order_lines.map(l => l.kit))];
const pending = (o: Order) => kitsOf(o).filter(k => !o.equipment_issues.some(i => i.kit === k));
const errText = (m: string) => (m.includes('forbidden') ? 'Нет прав отметить выдачу этого заказа.' : coachError(m));

// Выдача экипировки локальным администратором (0107): только заказы своих локаций, только отметка «выдано».
// Снять выдачу, оплату и состав заказа здесь нельзя: это у администратора. Права проверяет база.
export default function LocationEquipment() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [q, setQ] = useState('');
  const [fGroup, setFGroup] = useState('');
  const [only, setOnly] = useState<'no' | 'all'>('no');
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const r = await supabase.from('equipment_orders').select(COLS).order('ordered_on', { ascending: false, nullsFirst: false }).limit(500);
      if (r.error) return setError(errText(r.error.message));
      setOrders((r.data ?? []) as unknown as Order[]);
    })();
  }, [reload]);

  const groups = useMemo(() => [...new Set((orders ?? []).map(o => o.players?.groups?.name).filter((x): x is string => !!x))].sort(compareGroups), [orders]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (orders ?? []).filter(o => (!t || (o.players?.full_name ?? '').toLowerCase().includes(t))
      && (!fGroup || o.players?.groups?.name === fGroup)
      && (only === 'all' || pending(o).length > 0));
  }, [orders, q, fGroup, only]);

  if (error) return <Failure title="Не удалось загрузить заказы" text={error} onRetry={() => { setError(null); setOrders(null); setReload(n => n + 1); }} />;
  const open = orders?.find(o => o.id === openId);
  if (open) return <OrderIssue order={open} onBack={() => { setOpenId(null); setOrders(null); setReload(n => n + 1); }} />;

  return (
    <main className="page">
      <h1>Выдача формы</h1>
      <Segmented label="Показать" value={only} onChange={setOnly} items={[{ value: 'no', label: 'Не выданы' }, { value: 'all', label: 'Все заказы' }]} />
      <div style={{ height: 10 }} />
      <SearchInput label="Найти игрока" placeholder="Фамилия или имя" value={q} onChange={setQ} suggestions={q.trim().length >= 2 ? shown.slice(0, 8).map(o => o.players?.full_name ?? '').filter(Boolean) : []} />
      <select className="ks-select" aria-label="Группа" value={fGroup} onChange={e => setFGroup(e.target.value)}><option value="">Все группы</option>{groups.map(g => <option key={g}>{g}</option>)}</select>
      {!orders ? <Loading /> : shown.length === 0 ? (
        <EmptyState icon="box" title={only === 'no' ? 'Всё выдано' : 'Заказов нет'} text="Заказы показываются только по вашим локациям." />
      ) : (
        groupByGroupName(shown, o => o.players?.groups?.name ?? 'Без группы').map(([group, items]) => (
          <details className="ks-group" key={group} open={!!fGroup || !!q.trim()}>
            <summary><div className="ks-line"><b>{group}</b><span className="muted">{items.length} заказ.</span></div></summary>
            {items.map(o => (
              <ListRow
                key={o.id}
                avatar={o.players?.full_name ?? '—'}
                title={o.players?.full_name ?? 'Игрок'}
                sub={[kitsOf(o).join(' + ') || 'без позиций', o.ordered_on ? fmtDate(o.ordered_on) : 'без даты']}
                end={<Pill tone={pending(o).length === 0 ? 'success' : 'neutral'} dot>{pending(o).length === 0 ? 'Выдано' : `Осталось: ${pending(o).length}`}</Pill>}
                onClick={() => setOpenId(o.id)}
              />
            ))}
          </details>
        ))
      )}
    </main>
  );
}

function OrderIssue({ order, onBack }: { order: Order; onBack: () => void }) {
  const [o, setO] = useState(order);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const { ask, dialog } = useConfirm();
  const issued = new Map(o.equipment_issues.map(i => [i.kit, i]));

  const mark = async (k: string) => {
    const lines = o.equipment_order_lines.filter(l => l.kit === k);
    if (!(await ask({
      title: 'Отметить выдачу?',
      lines: [['Игрок', o.players?.full_name ?? 'Игрок'], ['Комплект', k], ['Размер', lines.map(l => `${l.size ?? 'не указан'} × ${l.quantity}`).join('; ')]],
      note: 'Снять отметку сможет только администратор.',
      confirmLabel: 'Выдано',
    }))) return;
    setBusy(k);
    setMsg(null);
    const r = await supabase.rpc('eq_set_issued', { o: o.id, k, on_: true });
    setBusy(null);
    if (r.error) return setMsg({ ok: false, text: errText(r.error.message) });
    const f = await supabase.from('equipment_orders').select(COLS).eq('id', o.id).maybeSingle();
    if (!f.error && f.data) setO(f.data as unknown as Order);
    setMsg({ ok: true, text: `${k}: выдача отмечена.` });
  };

  return (
    <main className="page">
      <BackNav onBack={onBack} />
      <h1 style={{ overflowWrap: 'anywhere' }}>{o.players?.full_name ?? 'Заказ'}</h1>
      <p className="muted">{[o.players?.groups?.name, o.location, o.ordered_on ? fmtDate(o.ordered_on) : null].filter(Boolean).join(' · ')}</p>
      {msg && <p className={msg.ok ? 'muted' : 'error'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}
      {kitsOf(o).map(k => {
        const lines = o.equipment_order_lines.filter(l => l.kit === k);
        const i = issued.get(k);
        return (
          <div className="ks-card" key={k}>
            <div className="ks-line"><b>{k}</b><Pill tone={i ? 'success' : 'neutral'} dot>{i ? `Выдано ${fmtDate(i.issued_on)}` : 'Не выдано'}</Pill></div>
            <div className="ks-muted" style={{ fontSize: 13 }}>{lines.map(l => `${l.size ?? 'размер не указан'} × ${l.quantity}`).join('; ')}{i?.issued_by ? ` · выдал: ${i.issued_by}` : ''}</div>
            {!i && <button type="button" className="ks-btn" style={{ marginTop: 8 }} disabled={busy === k} onClick={() => void mark(k)}>Отметить выдачу</button>}
          </div>
        );
      })}
      {dialog}
    </main>
  );
}
