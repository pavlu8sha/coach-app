import { useEffect, useMemo, useState } from 'react';
import { coachError, fmtDate, today } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { EmptyState, ListRow, Pill, SearchInput, Segmented, SwitchRow } from '../ui/components';
import { BackNav } from '../ui/nav';
import { Failure, Loading } from './Message';

interface Line { kit: string; size: string | null; quantity: number }
interface Order {
  id: string; ordered_on: string | null; total: number; paid: number; installment: boolean; number: string | null; inscription: string | null; location: string | null;
  players: { full_name: string; groups?: { name: string } | null } | null; equipment_order_lines: Line[]; equipment_issues: { kit: string; issued_on: string; issued_by: string | null }[];
}
interface Kit { kit: string; price: number }

const gel = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2)} ₾`;
const num = (s: string) => Number(s.replace(',', '.'));
const errText = (m: string) =>
  m.includes('number taken') ? 'Этот номер уже занят в группе.' : m.includes('paid above total') ? 'Оплата больше суммы заказа.' : m.includes('paid below zero') ? 'Оплачено не может быть меньше нуля.' : m.includes('total below paid') ? 'Сумма заказа меньше уже оплаченного.' :
  m.includes('order has payments') ? 'У заказа есть оплата: сначала верните её записью с минусом.' : m.includes('order has issues') ? 'У заказа есть выданные вещи: сначала снимите выдачу.' : m.includes('kit not in catalog') ? 'Позиции нет в каталоге.' : m.includes('no items') ? 'Выберите хотя бы одну вещь.' : m.includes('bad amount') ? 'Сумма указана неверно.' :
  m.includes('Could not find the function') || m.includes('equipment_issues') ? 'Модуль ещё не установлен в базе (миграция 0036).' : coachError(m);
const issueState = (o: Order) => (o.equipment_issues.length === 0 ? 'Нет' : o.equipment_issues.length >= new Set(o.equipment_order_lines.map(l => l.kit)).size ? 'Да' : 'Частично');

type Tab = 'all' | 'unpaid' | 'noissue' | 'catalog';

// Экипировка для администратора (миграция 0036): заказы, оплата, выдача, каталог.
export default function Equipment() {
  const [tab, setTab] = useState<Tab>('all');
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [q, setQ] = useState('');
  const [fGroup, setFGroup] = useState('');
  const [fKit, setFKit] = useState('');
  const [fLoc, setFLoc] = useState('');
  const [fIssue, setFIssue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void (async () => {
      const r = await supabase
        .from('equipment_orders')
        .select('id, ordered_on, total, paid, installment, number, inscription, location, players(full_name, groups(name)), equipment_order_lines(kit, size, quantity), equipment_issues(kit, issued_on, issued_by)')
        .order('ordered_on', { ascending: false, nullsFirst: false })
        .limit(500);
      if (r.error) return setError(errText(r.error.message));
      setOrders(((r.data ?? []) as unknown as Order[]).map(o => ({ ...o, total: Number(o.total), paid: Number(o.paid) })));
    })();
  }, [reload]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (orders ?? []).filter(o => (!t || (o.players?.full_name ?? '').toLowerCase().includes(t))
      && (tab === 'unpaid' ? o.paid < o.total : tab === 'noissue' ? issueState(o) !== 'Да' : true)
      && (!fGroup || o.players?.groups?.name === fGroup)
      && (!fKit || o.equipment_order_lines.some(l => l.kit === fKit))
      && (!fLoc || (o.location ?? '') === fLoc)
      && (!fIssue || (fIssue === 'yes' ? issueState(o) === 'Да' : issueState(o) !== 'Да')));
  }, [orders, q, tab, fGroup, fKit, fLoc, fIssue]);
  const options = useMemo(() => {
    const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, 'ru'));
    return {
      groups: uniq((orders ?? []).map(o => o.players?.groups?.name)),
      kits: uniq((orders ?? []).flatMap(o => o.equipment_order_lines.map(l => l.kit))),
      locs: uniq((orders ?? []).map(o => o.location)),
    };
  }, [orders]);
  const sums = useMemo(() => {
    const total = shown.reduce((s, o) => s + o.total, 0), paid = shown.reduce((s, o) => s + Math.min(o.paid, o.total), 0);
    return { players: new Set(shown.map(o => o.players?.full_name ?? o.id)).size, total, paid, debt: total - paid };
  }, [shown]);

  const done = () => { setCreating(false); setOrders(null); setReload(n => n + 1); };
  if (error) return <Failure title="Не удалось загрузить заказы" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} />;
  if (creating) return <NewOrder onBack={() => setCreating(false)} onDone={done} />;
  if (tab === 'catalog') return <Catalog onTab={setTab} />;
  const open = orders?.find(o => o.id === openId);
  if (open) return <OrderView order={open} onBack={() => { setOpenId(null); done(); }} />;

  return (
    <main className="page">
      <h1>Экипировка</h1>
      <Segmented label="Раздел" value={tab} onChange={setTab} items={[{ value: 'all', label: 'Все' }, { value: 'unpaid', label: 'Не оплачены' }, { value: 'noissue', label: 'Не выданы' }, { value: 'catalog', label: 'Каталог' }]} />
      <div style={{ height: 10 }} />
      <button type="button" className="ks-btn" onClick={() => setCreating(true)}>Новый заказ</button>
      <div style={{ height: 10 }} />
      <SearchInput label="Найти игрока" placeholder="Фамилия или имя" value={q} onChange={setQ} />
      <div className="ks-pair">
        <select className="ks-select" aria-label="Группа" value={fGroup} onChange={e => setFGroup(e.target.value)}><option value="">Все группы</option>{options.groups.map(g => <option key={g}>{g}</option>)}</select>
        <select className="ks-select" aria-label="Товар" value={fKit} onChange={e => setFKit(e.target.value)}><option value="">Все товары</option>{options.kits.map(k => <option key={k}>{k}</option>)}</select>
      </div>
      <div className="ks-pair">
        <select className="ks-select" aria-label="Локация" value={fLoc} onChange={e => setFLoc(e.target.value)}><option value="">Все локации</option>{options.locs.map(l => <option key={l}>{l}</option>)}</select>
        <select className="ks-select" aria-label="Выдача" value={fIssue} onChange={e => setFIssue(e.target.value)}><option value="">Выдача: любая</option><option value="yes">Выдано</option><option value="no">Не выдано</option></select>
      </div>
      {orders && (
        <div className="ks-tiles" style={{ marginBottom: 12, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
          <div className="ks-tile"><b>{sums.players}</b>игроков в списке</div>
          <div className="ks-tile"><b>{gel(sums.total)}</b>заказано</div>
          <div className="ks-tile"><b>{gel(sums.paid)}</b>оплачено</div>
          <div className="ks-tile"><b style={{ color: sums.debt > 0 ? 'var(--ks-danger, #b3261e)' : undefined }}>{gel(sums.debt)}</b>долг</div>
        </div>
      )}
      {!orders ? <Loading /> : shown.length === 0 ? (
        <EmptyState icon="box" title="Заказов нет" text="Измените фильтр или создайте заказ." />
      ) : (
        shown.map(o => (
          <ListRow
            key={o.id}
            avatar={o.players?.full_name ?? '—'}
            title={o.players?.full_name ?? 'Игрок'}
            sub={[[...new Set(o.equipment_order_lines.map(l => l.kit))].join(' + ') || 'без позиций', `${o.ordered_on ? fmtDate(o.ordered_on) : 'без даты'} · выдано: ${issueState(o)}`]}
            end={<Pill tone={o.paid >= o.total ? 'success' : 'danger'} dot>{o.paid >= o.total ? 'Оплачен' : `${gel(o.paid)} из ${gel(o.total)}`}</Pill>}
            onClick={() => setOpenId(o.id)}
          />
        ))
      )}
    </main>
  );
}

function useCatalog() {
  const [kits, setKits] = useState<Kit[] | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    void supabase.from('equipment_catalog').select('kit, price, valid_from').lte('valid_from', today()).order('valid_from', { ascending: false }).then(r => {
      const seen = new Map<string, Kit>();
      ((r.data ?? []) as { kit: string; price: number }[]).forEach(k => { if (!seen.has(k.kit)) seen.set(k.kit, { kit: k.kit, price: Number(k.price) }); });
      setKits([...seen.values()].sort((a, b) => a.kit.localeCompare(b.kit, 'ru')));
    });
  }, [reload]);
  return { kits, refresh: () => setReload(n => n + 1) };
}

function Catalog({ onTab }: { onTab: (t: Tab) => void }) {
  const { kits, refresh } = useCatalog();
  const [kit, setKit] = useState('');
  const [price, setPrice] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const r = await supabase.rpc('eq_catalog_save', { k: kit, pr: num(price), d: today() });
    setBusy(false);
    if (r.error) return setMsg({ ok: false, text: errText(r.error.message) });
    setMsg({ ok: true, text: 'Сохранено. Старые заказы остаются по прежней цене.' });
    setKit('');
    setPrice('');
    refresh();
  };
  return (
    <main className="page">
      <BackNav onBack={() => onTab('all')} />
      <h1>Каталог</h1>
      {!kits ? <Loading /> : kits.map(k => <ListRow key={k.kit} title={k.kit} end={<b>{gel(k.price)}</b>} onClick={() => { setKit(k.kit); setPrice(String(k.price)); }} />)}
      <h3>Позиция и цена</h3>
      <p className="muted">Выберите позицию выше, чтобы изменить цену, или введите новое название. Новая цена действует с сегодняшнего дня.</p>
      <label className="field">Название<input value={kit} maxLength={80} onChange={e => setKit(e.target.value)} /></label>
      <label className="field">Цена, ₾<input inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} /></label>
      {msg && <p className={msg.ok ? 'muted' : 'error'}>{msg.text}</p>}
      <button type="button" className="ks-btn" disabled={busy || !kit.trim() || price.trim() === '' || Number.isNaN(num(price))} onClick={() => void save()}>Сохранить</button>
    </main>
  );
}

function NewOrder({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const { kits } = useCatalog();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<{ id: string; full_name: string }[]>([]);
  const [player, setPlayer] = useState<{ id: string; full_name: string } | null>(null);
  const [pick, setPick] = useState<Record<string, { size: string; quantity: number }>>({});
  const [insc, setInsc] = useState('');
  const [number, setNumber] = useState('');
  const [inst, setInst] = useState(false);
  const [loc, setLoc] = useState('');
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) return setFound([]);
    const t = setTimeout(() => {
      void supabase.from('players').select('id, full_name').ilike('full_name', `%${q.trim()}%`).order('full_name').limit(8).then(r => {
        if (!r.error) setFound((r.data ?? []) as { id: string; full_name: string }[]);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const total = (kits ?? []).reduce((s, k) => s + (pick[k.kit] ? k.price * pick[k.kit].quantity : 0), 0);
  const save = async () => {
    if (!player) return;
    setBusy(true);
    setErr(null);
    const lines = Object.entries(pick).map(([kit, v]) => ({ kit, size: v.size, quantity: v.quantity }));
    const r = await supabase.rpc('eq_create_order', { p: player.id, lines, insc, num: number, inst, loc, custom_total: custom.trim() === '' ? null : num(custom) });
    setBusy(false);
    if (r.error) return setErr(errText(r.error.message));
    onDone();
  };
  return (
    <main className="page">
      <BackNav onBack={onBack} />
      <h1>Новый заказ</h1>
      {player ? (
        <ListRow avatar={player.full_name} title={player.full_name} end={<button type="button" className="ks-btn secondary" style={{ width: 'auto', minHeight: 40 }} onClick={() => setPlayer(null)}>Сменить</button>} />
      ) : (
        <>
          <SearchInput label="Найти игрока" placeholder="Фамилия или имя (от 2 букв)" value={q} onChange={setQ} />
          {found.map(p => <ListRow key={p.id} avatar={p.full_name} title={p.full_name} onClick={() => setPlayer(p)} />)}
        </>
      )}
      <h3>Что заказываем</h3>
      {!kits ? <Loading /> : kits.map(k => {
        const v = pick[k.kit];
        return (
          <div className="ks-card" key={k.kit}>
            <label className="ks-line" style={{ cursor: 'pointer' }}>
              <span><input type="checkbox" checked={!!v} onChange={e => setPick(p => { const n = { ...p }; if (e.target.checked) n[k.kit] = { size: '', quantity: 1 }; else delete n[k.kit]; return n; })} /> {k.kit}</span>
              <b>{gel(k.price)}</b>
            </label>
            {v && (
              <div className="two" style={{ marginTop: 8 }}>
                <input aria-label={`Размер: ${k.kit}`} placeholder="Размер" value={v.size} onChange={e => setPick(p => ({ ...p, [k.kit]: { ...v, size: e.target.value } }))} />
                <input aria-label={`Количество: ${k.kit}`} type="number" min={1} max={10} value={v.quantity} onChange={e => setPick(p => ({ ...p, [k.kit]: { ...v, quantity: Math.max(1, Math.min(10, Number(e.target.value) || 1)) } }))} />
              </div>
            )}
          </div>
        );
      })}
      <label className="field">Надпись<input value={insc} maxLength={40} onChange={e => setInsc(e.target.value)} /></label>
      <label className="field">Номер<input value={number} maxLength={10} onChange={e => setNumber(e.target.value)} /></label>
      <label className="field">Локация<input value={loc} maxLength={40} onChange={e => setLoc(e.target.value)} /></label>
      <div style={{ marginTop: 12 }}><SwitchRow id="inst" label="Рассрочка" checked={inst} onChange={setInst} /></div>
      <label className="field">Своя сумма, ₾ (если со скидкой; иначе пусто)<input inputMode="decimal" value={custom} onChange={e => setCustom(e.target.value)} /></label>
      <p className="muted">По каталогу: {gel(total)}</p>
      {err && <p className="error">{err}</p>}
      <button type="button" className="ks-btn" disabled={busy || !player || Object.keys(pick).length === 0 || (custom.trim() !== '' && Number.isNaN(num(custom)))} onClick={() => void save()}>Создать заказ</button>
    </main>
  );
}

function OrderView({ order, onBack }: { order: Order; onBack: () => void }) {
  const [o, setO] = useState(order);
  const [amount, setAmount] = useState('');
  const [insc, setInsc] = useState(order.inscription ?? '');
  const [number, setNumber] = useState(order.number ?? '');
  const [loc, setLoc] = useState(order.location ?? '');
  const [inst, setInst] = useState(order.installment);
  const [total, setTotal] = useState(String(order.total));
  const [who, setWho] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [gone, setGone] = useState(false);
  useEffect(() => { if (gone) onBack(); }, [gone]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = async () => {
    const r = await supabase.from('equipment_orders').select('id, ordered_on, total, paid, installment, number, inscription, location, players(full_name), equipment_order_lines(kit, size, quantity), equipment_issues(kit, issued_on, issued_by)').eq('id', order.id).maybeSingle();
    if (!r.error && r.data) {
      const d = r.data as unknown as Order;
      setO({ ...d, total: Number(d.total), paid: Number(d.paid) });
    }
  };
  const run = async (key: string, f: () => PromiseLike<{ error: { message: string } | null }>, ok?: string) => {
    setBusy(key);
    setMsg(null);
    const r = await f();
    setBusy(null);
    if (r.error) { setMsg({ ok: false, text: errText(r.error.message) }); return false; }
    if (ok) setMsg({ ok: true, text: ok });
    await refresh();
    return true;
  };
  if (gone) return null;
  const issued = new Map(o.equipment_issues.map(i => [i.kit, i]));
  const kitsInOrder = [...new Set(o.equipment_order_lines.map(l => l.kit))];
  return (
    <main className="page">
      <BackNav onBack={onBack} />
      <h1 style={{ overflowWrap: 'anywhere' }}>{o.players?.full_name ?? 'Заказ'}</h1>
      <p className="muted">{o.ordered_on ? fmtDate(o.ordered_on) : 'Дата не указана'} · оплачено {gel(o.paid)} из {gel(o.total)}{o.installment ? ' · рассрочка' : ''}</p>
      {msg && <p className={msg.ok ? 'muted' : 'error'}>{msg.text}</p>}

      <h3>Вещи и выдача</h3>
      <label className="field">Кто выдаёт (для отметок)<input value={who} maxLength={40} onChange={e => setWho(e.target.value)} /></label>
      {kitsInOrder.map(k => {
        const lines = o.equipment_order_lines.filter(l => l.kit === k);
        const i = issued.get(k);
        return (
          <div className="ks-card" key={k}>
            <div className="ks-line"><b>{k}</b><Pill tone={i ? 'success' : 'neutral'} dot>{i ? `Выдано ${fmtDate(i.issued_on)}` : 'Не выдано'}</Pill></div>
            <div className="ks-muted" style={{ fontSize: 13 }}>{lines.map(l => `${l.size ?? 'размер не указан'} × ${l.quantity}`).join('; ')}{i?.issued_by ? ` · выдал: ${i.issued_by}` : ''}</div>
            <button type="button" className="ks-btn secondary" style={{ marginTop: 8 }} disabled={busy === k} onClick={() => void run(k, () => supabase.rpc('eq_set_issued', { o: o.id, k, on_: !i, who }))}>{i ? 'Снять выдачу' : 'Отметить выдачу'}</button>
          </div>
        );
      })}

      <h3>Оплата</h3>
      <label className="field">Сумма, ₾ (минус — исправление)<input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></label>
      <button type="button" className="ks-btn" disabled={busy === 'pay' || amount.trim() === '' || Number.isNaN(num(amount)) || num(amount) === 0} onClick={() => void run('pay', () => supabase.rpc('eq_add_payment', { o: o.id, amt: num(amount) }), 'Платёж записан.').then(ok => { if (ok) setAmount(''); })}>Записать платёж</button>

      <h3>Данные заказа</h3>
      <label className="field">Надпись<input value={insc} maxLength={40} onChange={e => setInsc(e.target.value)} /></label>
      <label className="field">Номер<input value={number} maxLength={10} onChange={e => setNumber(e.target.value)} /></label>
      <label className="field">Локация<input value={loc} maxLength={40} onChange={e => setLoc(e.target.value)} /></label>
      <label className="field">Сумма заказа, ₾<input inputMode="decimal" value={total} onChange={e => setTotal(e.target.value)} /></label>
      <div style={{ marginTop: 12 }}><SwitchRow id="inst" label="Рассрочка" checked={inst} onChange={setInst} /></div>
      <button type="button" className="ks-btn" disabled={busy === 'edit' || Number.isNaN(num(total))} onClick={() => void run('edit', () => supabase.rpc('eq_edit_order', { o: o.id, insc, num: number, inst, loc, new_total: num(total) }), 'Сохранено.')}>Сохранить</button>
      <div style={{ height: 8 }} />
      {confirmDel ? (
        <>
          <p className="muted">Удалить заказ? Это нельзя отменить.</p>
          <button type="button" className="ks-btn" disabled={busy === 'del'} onClick={() => void run('del', () => supabase.rpc('eq_delete_order', { o: o.id })).then(ok => { if (ok) setGone(true); })}>Да, удалить</button>
          <div style={{ height: 8 }} />
          <button type="button" className="ks-btn secondary" onClick={() => setConfirmDel(false)}>Не удалять</button>
        </>
      ) : (
        <button type="button" className="ks-btn secondary" onClick={() => setConfirmDel(true)}>Удалить заказ</button>
      )}
    </main>
  );
}
