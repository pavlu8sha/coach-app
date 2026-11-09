import { useEffect, useMemo, useRef, useState } from 'react';
import { ExpandableTextarea } from '../ui/ExpandableTextarea';
import { coachError, compareGroups, fmtDate, groupByGroupName, today } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { EmptyState, ListRow, Pill, SearchInput, Segmented, SwitchRow } from '../ui/components';
import { BackNav } from '../ui/nav';
import { useDirtyGuard, useNav, useNavState } from '../nav';
import { Failure, Loading } from './Message';
import { useConfirm } from '../ui/ConfirmSheet';
import { settingNumberError, useClubSettings } from '../lib/clubSettings';
import { bundleDiscount, priorAmount } from '../lib/equipmentDiscount';
import { allKitsIssued, EQUIPMENT_REQUIRED_KEY, EQUIPMENT_REQUIRED_TEXT, issueStateLabel, lastStatusDate, nextStatus, orderStatusLabel, prevStatus, type StatusEvent } from '../lib/equipment';

interface Line { id?: string; kit: string; size: string | null; quantity: number; unit_price?: number | string | null }
interface Order {
  id: string; player_id: string | null; ordered_on: string | null; total: number; paid: number; installment: boolean; number: string | null; inscription: string | null; location: string | null;
  status: string; equipment_order_status_history: StatusEvent[];
  players: { full_name: string; groups?: { name: string } | null } | null; equipment_order_lines: Line[]; equipment_issues: { kit: string; issued_on: string; issued_by: string | null }[];
}
const ORDER_COLS = 'id, player_id, ordered_on, total, paid, installment, number, inscription, location, status, equipment_order_status_history(status, changed_at, changed_by_name), equipment_order_lines(id, kit, size, quantity, unit_price), equipment_issues(kit, issued_on, issued_by)';
interface Kit { kit: string; price: number }

const gel = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2)} ₾`;
const num = (s: string) => Number(s.replace(',', '.'));
const errText = (m: string) =>
  m.includes('paid above total') ? 'Оплата больше суммы заказа.' : m.includes('paid below zero') ? 'Оплачено не может быть меньше нуля.' : m.includes('total below paid') ? 'Сумма заказа меньше уже оплаченного.' :
  m.includes('order has payments') ? 'У заказа есть оплата: сначала верните её записью с минусом.' : m.includes('order has issues') ? 'У заказа есть выданные вещи: сначала снимите выдачу.' : m.includes('item issued') ? 'Вещь уже выдана: сначала снимите выдачу (размер менять можно).' : m.includes('last line') ? 'Это последняя вещь в заказе: удалите весь заказ.' : m.includes('bad quantity') ? 'Количество от 1 до 10.' : m.includes('bad date') ? 'Дата не может быть в будущем.' : m.includes('kit not in catalog') ? 'Позиции нет в каталоге.' : m.includes('no items') ? 'Выберите хотя бы одну вещь.' : m.includes('bad amount') ? 'Сумма указана неверно.' :
  m.includes('bad transition') ? 'Статус можно менять только на один шаг вперёд (назад — администратору).' : m.includes('bad status') ? 'Такого статуса нет.' : m.includes('not all issued') ? 'Статус «Выдан» можно поставить, только когда выданы все вещи заказа.' :
  m.includes('Could not find the function') || m.includes('equipment_issues') ? 'Модуль ещё не установлен в базе (миграция 0036).' : coachError(m);
const issueState = (o: Order) => issueStateLabel(o.equipment_order_lines, o.equipment_issues);

// Чего не хватает в заказе: позиции, размера, номера (для гетр и носков номер не нужен).
const missingOf = (o: Pick<Order, 'number' | 'equipment_order_lines'>): string[] => {
  const lines = o.equipment_order_lines, m: string[] = [];
  if (lines.length === 0) m.push('позиции');
  if (lines.some(l => !(l.size ?? '').trim())) m.push('размер');
  if (lines.length > 0 && !(o.number ?? '').trim() && lines.some(l => !/гетр|носк/i.test(l.kit))) m.push('номер');
  return m;
};

// Номер игрока: берём из его самого свежего заказа, где номер указан.
// Номер уже у другого игрока той же возрастной группы («U10-A» и «U10-B» считаются одной группой U10)? Только подсказка: заказ это не блокирует (#339).
const family = (n: string | null | undefined) => (n ?? '').toLowerCase().replace(/-.*$/, '');
const normNumber = (n: string | null | undefined) => (n ?? '').replace(/\//g, ',').replace(/\s+/g, '');
function useNumberNote(playerId: string | undefined, number: string): string | null {
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    const t = number.trim();
    if (!playerId || !t) return setNote(null);
    let alive = true;
    const timer = setTimeout(() => {
      void (async () => {
        const g = await supabase.from('players').select('groups(name)').eq('id', playerId).maybeSingle();
        const mine = family((g.data as unknown as { groups?: { name: string } | null } | null)?.groups?.name);
        const groupName = (g.data as unknown as { groups?: { name: string } | null } | null)?.groups?.name ?? '';
        if (mine === '') return alive && setNote(null);
        const o = await supabase.from('equipment_orders').select('player_id, number, players(full_name, groups(name))').ilike('number', `%${t}%`).neq('player_id', playerId).limit(200);
        type Who = { players: { full_name: string; groups: { name: string } | null } | null; number: string | null };
        const who = [...new Set(((o.data ?? []) as unknown as Who[])
          .filter(x => x.players && normNumber(x.number) === normNumber(t) && family(x.players.groups?.name) === mine)
          .map(x => `${x.players!.full_name} (${x.players!.groups?.name})`))].slice(0, 3);
        if (alive) setNote(who.length ? `Номер ${t} уже есть в группе ${groupName}: ${who.join(', ')}.` : null);
      })();
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [playerId, number]);
  return note;
}

const knownNumbers = (orders: Pick<Order, 'player_id' | 'number' | 'ordered_on'>[]) => {
  const m = new Map<string, string>();
  [...orders].sort((a, b) => (b.ordered_on ?? '').localeCompare(a.ordered_on ?? '')).forEach(o => {
    const n = (o.number ?? '').trim();
    if (o.player_id && n && !m.has(o.player_id)) m.set(o.player_id, n);
  });
  return m;
};

type Tab = 'all' | 'unpaid' | 'noissue' | 'incomplete' | 'catalog' | 'text';

// Экипировка для администратора (миграция 0036): заказы, оплата, выдача, каталог.
export default function Equipment() {
  // Каталог, требование к форме, новый заказ и заказ — записи стека; фильтры списка живут в записи списка (entry: 0)
  const nav = useNav();
  const [tab, setTab] = useNavState<Tab>('eq.tab', 'all', { entry: 0, persist: { kind: 'enum', values: ['all', 'unpaid', 'noissue', 'incomplete'] } });
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [q, setQ] = useNavState('eq.q', '', { entry: 0 }); // поиск на диск не пишем: в нём имена детей
  const [fGroup, setFGroup] = useNavState('eq.group', '', { entry: 0 });
  const [fKit, setFKit] = useNavState('eq.kit', '', { entry: 0 });
  const [fLoc, setFLoc] = useNavState('eq.loc', '', { entry: 0 });
  const [fIssue, setFIssue] = useNavState<'' | 'yes' | 'no'>('eq.issue', '', { entry: 0, persist: { kind: 'enum', values: ['', 'yes', 'no'] } });
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    void (async () => {
      const r = await supabase
        .from('equipment_orders')
        .select(`${ORDER_COLS}, players(full_name, groups(name))`)
        .order('ordered_on', { ascending: false, nullsFirst: false })
        .limit(500);
      if (r.error) return setError(errText(r.error.message));
      setOrders(((r.data ?? []) as unknown as Order[]).map(o => ({ ...o, total: Number(o.total), paid: Number(o.paid) })));
    })();
  }, [reload]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (orders ?? []).filter(o => (!t || (o.players?.full_name ?? '').toLowerCase().includes(t))
      && (tab === 'unpaid' ? o.paid < o.total : tab === 'noissue' ? issueState(o) !== 'Да' : tab === 'incomplete' ? missingOf(o).length > 0 : true)
      && (!fGroup || o.players?.groups?.name === fGroup)
      && (!fKit || o.equipment_order_lines.some(l => l.kit === fKit))
      && (!fLoc || (o.location ?? '') === fLoc)
      && (!fIssue || (fIssue === 'yes' ? issueState(o) === 'Да' : issueState(o) !== 'Да')));
  }, [orders, q, tab, fGroup, fKit, fLoc, fIssue]);
  const options = useMemo(() => {
    const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, 'ru'));
    return {
      groups: uniq((orders ?? []).map(o => o.players?.groups?.name)).sort(compareGroups),
      kits: uniq((orders ?? []).flatMap(o => o.equipment_order_lines.map(l => l.kit))),
      locs: uniq((orders ?? []).map(o => o.location)),
    };
  }, [orders]);
  const numbers = useMemo(() => knownNumbers(orders ?? []), [orders]);
  const sums = useMemo(() => {
    const total = shown.reduce((s, o) => s + o.total, 0), paid = shown.reduce((s, o) => s + Math.min(o.paid, o.total), 0);
    return { players: new Set(shown.map(o => o.players?.full_name ?? o.id)).size, total, paid, debt: total - paid };
  }, [shown]);

  const done = () => { nav.backToRoot(); setOrders(null); setReload(n => n + 1); };
  if (error) return <Failure title="Не удалось загрузить заказы" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} />;
  const screen = nav.top.screen;
  if (screen === 'new') return <NewOrder onBack={() => nav.back()} onDone={done} />;
  if (screen === 'catalog') return <Catalog onBack={() => nav.back()} />;
  if (screen === 'text') return <RequirementEditor onBack={() => nav.back()} />;
  const open = screen === 'order' ? orders?.find(o => o.id === nav.top.params.id) : undefined;
  if (open) return <OrderView order={open} knownNumber={open.player_id ? numbers.get(open.player_id) : undefined} onBack={done} onChanged={d => setOrders(prev => prev && prev.map(x => x.id === d.id ? { ...x, ...d, players: { ...(x.players ?? {}), ...(d.players ?? {}) } as Order['players'] } : x))} />;

  return (
    <main className="page">
      <h1>Экипировка</h1>
      <Segmented label="Раздел" value={tab} onChange={v => (v === 'catalog' || v === 'text' ? nav.push(v) : setTab(v))} items={[{ value: 'all', label: 'Все' }, { value: 'unpaid', label: 'Не оплачены' }, { value: 'noissue', label: 'Не выданы' }, { value: 'incomplete', label: 'Неполные' }, { value: 'catalog', label: 'Каталог' }, { value: 'text', label: 'Текст' }]} />
      <div style={{ height: 10 }} />
      <button type="button" className="ks-btn" onClick={() => nav.push('new')}>Новый заказ</button>
      <div style={{ height: 10 }} />
      <SearchInput label="Найти игрока" placeholder="Фамилия или имя" value={q} onChange={setQ} suggestions={q.trim().length >= 2 ? shown.slice(0, 8).map(o => o.players?.full_name ?? "") .filter(Boolean) : []} />
      <div className="ks-pair">
        <select className="ks-select" aria-label="Группа" value={fGroup} onChange={e => setFGroup(e.target.value)}><option value="">Все группы</option>{options.groups.map(g => <option key={g}>{g}</option>)}</select>
        <select className="ks-select" aria-label="Товар" value={fKit} onChange={e => setFKit(e.target.value)}><option value="">Все товары</option>{options.kits.map(k => <option key={k}>{k}</option>)}</select>
      </div>
      <div className="ks-pair">
        <select className="ks-select" aria-label="Локация" value={fLoc} onChange={e => setFLoc(e.target.value)}><option value="">Все локации</option>{options.locs.map(l => <option key={l}>{l}</option>)}</select>
        <select className="ks-select" aria-label="Выдача" value={fIssue} onChange={e => setFIssue(e.target.value as '' | 'yes' | 'no')}><option value="">Выдача: любая</option><option value="yes">Выдано</option><option value="no">Не выдано</option></select>
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
        groupByGroupName(shown, o => o.players?.groups?.name ?? 'Без группы').map(([group, items]) => (
          <details className="ks-group" key={group} open={!!fGroup || !!q.trim()}>
            <summary><div className="ks-line"><b>{group}</b><span className="muted">{items.length} заказ.</span></div></summary>
            {items.map(o => (
              <ListRow
                key={o.id}
                avatar={o.players?.full_name ?? '—'}
                title={o.players?.full_name ?? 'Игрок'}
                sub={[[...new Set(o.equipment_order_lines.map(l => l.kit))].join(' + ') || 'без позиций', `${o.ordered_on ? fmtDate(o.ordered_on) : 'без даты'} · ${orderStatusLabel(o.status)} · выдано: ${issueState(o)}${missingOf(o).length ? ` · не заполнено: ${missingOf(o).join(', ')}${missingOf(o).includes('номер') && o.player_id && numbers.has(o.player_id) ? ` (номер ${numbers.get(o.player_id)} есть в другом заказе)` : ''}` : ''}`]}
                end={<Pill tone={o.paid >= o.total ? 'success' : 'danger'} dot>{o.paid >= o.total ? 'Оплачен' : `${o.paid} из ${gel(o.total)}`}</Pill>}
                onClick={() => nav.push('order', { id: o.id })}
              />
            ))}
          </details>
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

function Catalog({ onBack }: { onBack: () => void }) {
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
      <BackNav onBack={onBack} managed />
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

// Требование к тренировочной форме (#240): текст в club_settings, его видит родитель; правит администратор.
function RequirementEditor({ onBack }: { onBack: () => void }) {
  const [clubId, setClubId] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    void (async () => {
      const c = await supabase.from('clubs').select('id').limit(1);
      if (c.error) return setError(c.error.message);
      const cid = ((c.data ?? []) as { id: string }[])[0]?.id ?? null;
      if (!cid) return setError('Клуб не найден');
      setClubId(cid);
      const r = await supabase.from('club_settings').select('value').eq('club_id', cid).eq('key', EQUIPMENT_REQUIRED_KEY).eq('scope', '').maybeSingle();
      if (r.error) return setError(r.error.message);
      setText(((r.data as { value: string } | null)?.value ?? '').trim() || EQUIPMENT_REQUIRED_TEXT);
    })();
  }, []);
  const save = async () => {
    if (!clubId || text === null) return;
    setBusy(true);
    setMsg(null);
    const r = await supabase.from('club_settings').upsert({ club_id: clubId, key: EQUIPMENT_REQUIRED_KEY, scope: '', value: text.trim(), updated_at: today() }, { onConflict: 'club_id,key,scope' });
    setBusy(false);
    setMsg(r.error ? { ok: false, text: 'Не удалось сохранить текст.' } : { ok: true, text: 'Текст сохранён. Родители увидят его сразу.' });
  };
  if (error) return <Failure title="Не удалось загрузить текст" text={error} onRetry={() => { setError(null); onBack(); }} />;
  return (
    <main className="page">
      <BackNav onBack={onBack} managed />
      <h1>Требование к форме</h1>
      <p className="muted">Этот текст видят родители в экипировке. Пишите только утверждённые условия: сроки, состав и цены без согласования не добавляйте.</p>
      {text === null ? <Loading /> : (
        <>
          <ExpandableTextarea label="Требование к форме" rows={6} maxLength={1000} value={text} onChange={setText} />
          {msg && <p className={msg.ok ? 'muted' : 'error'}>{msg.text}</p>}
          <button type="button" className="ks-btn" disabled={busy || !text.trim()} onClick={() => void save()}>Сохранить</button>
          <div style={{ height: 8 }} />
          <button type="button" className="ks-btn secondary" disabled={busy || text === EQUIPMENT_REQUIRED_TEXT} onClick={() => setText(EQUIPMENT_REQUIRED_TEXT)}>Вернуть утверждённый текст</button>
        </>
      )}
    </main>
  );
}

function NewOrder({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const { kits } = useCatalog();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<{ id: string; full_name: string; groups?: { location: string | null; name?: string | null } | null }[]>([]);
  const [player, setPlayer] = useState<{ id: string; full_name: string; groups?: { name?: string | null } | null } | null>(null);
  const [pick, setPick] = useState<Record<string, { size: string; quantity: number }>>({});
  const [insc, setInsc] = useState('');
  const [number, setNumber] = useState('');
  const [inst, setInst] = useState(false);
  const [loc, setLoc] = useState('');
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const settings = useClubSettings();
  useDirtyGuard(player !== null || Object.keys(pick).length > 0 || insc.trim() !== '' || number.trim() !== '' || custom.trim() !== '');
  const numberNote = useNumberNote(player?.id, number);
  const [past, setPast] = useState<{ total: number; lines: { kit: string; quantity: number; unit_price: number | null }[] }[]>([]);

  // Что игрок заказывал раньше и на какую сумму: нужно, чтобы посчитать скидку на весь набор.
  useEffect(() => {
    if (!player) return setPast([]);
    let alive = true;
    void supabase.from('equipment_orders').select('total, equipment_order_lines(kit, quantity, unit_price)').eq('player_id', player.id).then(r => {
      if (!alive || r.error) return;
      setPast(((r.data ?? []) as unknown as { total: number | string | null; equipment_order_lines: { kit: string; quantity: number; unit_price: number | null }[] | null }[]).map(o => ({ total: Number(o.total ?? 0), lines: o.equipment_order_lines ?? [] })));
    });
    return () => { alive = false; };
  }, [player]);

  useEffect(() => {
    if (q.trim().length < 2) return setFound([]);
    const t = setTimeout(() => {
      void supabase.from('players').select('id, full_name, groups(location, name)').ilike('full_name', `%${q.trim()}%`).order('full_name').limit(8).then(r => {
        if (!r.error) setFound((r.data ?? []) as unknown as { id: string; full_name: string; groups?: { location: string | null } | null }[]);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  // Номер из прежних заказов игрока подставляем сами, его можно поправить.
  const prefillNumber = async (id: string) => {
    const r = await supabase.from('equipment_orders').select('number, ordered_on').eq('player_id', id);
    if (r.error) return;
    const n = knownNumbers(((r.data ?? []) as { number: string | null; ordered_on: string | null }[]).map(x => ({ ...x, player_id: id }))).get(id);
    if (n) setNumber(cur => (cur.trim() ? cur : n));
  };
  const total = (kits ?? []).reduce((s, k) => s + (pick[k.kit] ? k.price * pick[k.kit].quantity : 0), 0);
  const pastAmount = priorAmount(past, settings.values);
  const disc = bundleDiscount({
    lines: (kits ?? []).filter(k => pick[k.kit]).map(k => ({ kit: k.kit, amount: k.price * pick[k.kit].quantity })),
    pastKits: past.flatMap(o => o.lines.map(l => l.kit)), pastAmount, installment: inst, settings: settings.values,
  });
  const discError = settingNumberError(settings.values, 'equip.discPct') ?? settingNumberError(settings.values, 'equip.discRound');
  const save = async () => {
    if (!player) return;
    setBusy(true);
    setErr(null);
    const lines = Object.entries(pick).map(([kit, v]) => ({ kit, size: v.size, quantity: v.quantity }));
    const r = await supabase.rpc('eq_create_order', { p: player.id, lines, insc, num: number, inst, loc, custom_total: custom.trim() !== '' ? num(custom) : disc.applies ? disc.total : null });
    setBusy(false);
    if (r.error) return setErr(errText(r.error.message));
    onDone();
  };
  return (
    <main className="page">
      <BackNav onBack={onBack} managed />
      <h1>Новый заказ</h1>
      {player ? (
        <ListRow avatar={player.full_name} title={player.full_name} end={<button type="button" className="ks-btn secondary" style={{ width: 'auto', minHeight: 40 }} onClick={() => setPlayer(null)}>Сменить</button>} />
      ) : (
        <>
          <SearchInput label="Найти игрока" placeholder="Фамилия или имя (от 2 букв)" value={q} onChange={setQ} suggestions={found.map(f => f.full_name)} />
          {found.map(p => <ListRow key={p.id} avatar={p.full_name} title={p.full_name} onClick={() => { setPlayer(p); if (!loc.trim() && p.groups?.location) setLoc(p.groups.location); void prefillNumber(p.id); }} />)}
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
      {numberNote && <p className="ks-callout" role="status">{numberNote}</p>}
      <label className="field">Локация<input value={loc} maxLength={40} onChange={e => setLoc(e.target.value)} /></label>
      <div style={{ marginTop: 12 }}><SwitchRow id="inst" label="Рассрочка" checked={inst} onChange={setInst} /></div>
      <label className="field">Своя сумма, ₾ (если со скидкой; иначе пусто)<input inputMode="decimal" value={custom} onChange={e => setCustom(e.target.value)} /></label>
      {discError && <p className="error">Скидка не рассчитана: исправьте настройку в «Настройках клуба». {discError}</p>}
      {disc.applies && custom.trim() === '' ? (
        <div className="ks-callout">
          <div>По каталогу: {gel(disc.base)}</div>
          <div>Скидка на комплект {disc.pct}%: −{gel(disc.discount)}</div>
          <div><b>К оплате: {gel(disc.total)}</b></div>
          {disc.pastAmount > 0 && <div className="muted">Считается от всего набора: {gel(disc.allBase)} с прошлыми заказами, со скидкой {gel(disc.allTotal)}, минус прошлые {gel(disc.pastAmount)}. Другую сумму можно вписать выше.</div>}
        </div>
      ) : <p className="muted">По каталогу: {gel(total)}</p>}
      {err && <p className="error" style={{ marginBottom: 12 }}>{err}</p>}
      <button type="button" className="ks-btn" style={{ marginTop: 16 }} disabled={busy || !player || Object.keys(pick).length === 0 || (custom.trim() !== '' && Number.isNaN(num(custom)))} onClick={() => void save()}>Создать заказ</button>
    </main>
  );
}

// Строка заказа: размер и количество правятся отдельно по каждой вещи (0125).
function LineEditor({ line, locked, last, busy, onSave, onRemove }: { line: Line; locked: boolean; last: boolean; busy: boolean; onSave: (size: string, qty: number) => void; onRemove: () => void }) {
  const [size, setSize] = useState(line.size ?? '');
  const [qty, setQty] = useState(line.quantity);
  const dirty = size.trim() !== (line.size ?? '') || qty !== line.quantity;
  return (
    <div>
      <label className="field">Размер<input aria-label={`Размер: ${line.kit}`} placeholder="Например, 140" value={size} maxLength={40} onChange={e => setSize(e.target.value)} /></label>
      <label className="field">Количество<input aria-label={`Количество: ${line.kit}`} type="number" inputMode="numeric" min={1} max={10} value={qty} disabled={locked} onChange={e => setQty(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} /></label>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button type="button" className="ks-btn" style={{ flex: 1 }} disabled={busy || !dirty} onClick={() => onSave(size, qty)}>Сохранить</button>
        {!locked && !last && <button type="button" className="ks-btn secondary" style={{ flex: 1 }} disabled={busy} onClick={onRemove}>Убрать</button>}
      </div>
    </div>
  );
}

function OrderView({ order, knownNumber, onBack, onChanged }: { order: Order; knownNumber?: string; onBack: () => void; onChanged: (o: Order) => void }) {
  const [o, setO] = useState(order);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('');
  const [insc, setInsc] = useState(order.inscription ?? '');
  const [number, setNumber] = useState(order.number ?? '');
  const numberNote = useNumberNote(order.player_id ?? undefined, number);
  const [loc, setLoc] = useState(order.location ?? '');
  const [inst, setInst] = useState(order.installment);
  const [total, setTotal] = useState(String(order.total));
  const [who, setWho] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const { ask, dialog: confirmDialog } = useConfirm();
  const msgRef = useRef<HTMLParagraphElement>(null);
  const lastFresh = useRef<Order | null>(null);
  const [gone, setGone] = useState(false);
  const { kits: catalog } = useCatalog();
  const [addKit, setAddKit] = useState('');
  const [addSize, setAddSize] = useState('');
  const [orderedOn, setOrderedOn] = useState(order.ordered_on ?? '');
  // Кнопки внизу экрана, сообщение вверху: показываем его, чтобы ошибка сохранения не оставалась за кадром.
  useEffect(() => { msg && msgRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }); }, [msg]);
  useEffect(() => { if (gone) onBack(); }, [gone]); // eslint-disable-line react-hooks/exhaustive-deps

  const settings = useClubSettings();
  const refresh = async (): Promise<Order | null> => {
    const r = await supabase.from('equipment_orders').select(`${ORDER_COLS}, players(full_name)`).eq('id', order.id).maybeSingle();
    if (!r.error && r.data) {
      const d = r.data as unknown as Order;
      const fresh = { ...d, total: Number(d.total), paid: Number(d.paid) };
      setO(fresh);
      onChanged(fresh); // «Назад» через стек навигации список не перезагружает: без этого заказ открывается по старой копии
      return fresh;
    }
    return null;
  };
  // После добавления вещи сумма сдвигается на цену по каталогу без скидки. Если теперь набор полный, предлагаем пересчитать
  // сумму по скидке на комплект (как в «Новом заказе»). Не меняем молча: сумма могла быть вписана вручную.
  const offerBundle = async (fresh: Order, manual = false) => {
    const skip = (text: string) => { if (manual) setMsg({ ok: true, text }); };
    if (fresh.installment) return skip('Заказ в рассрочку: скидки на комплект нет.');
    if (!fresh.player_id) return skip('Скидку посчитать нельзя: у заказа нет игрока.');
    const r = await supabase.from('equipment_orders').select('id, total, equipment_order_lines(kit, quantity, unit_price)').eq('player_id', fresh.player_id);
    if (r.error) return skip('Не удалось загрузить заказы игрока.');
    const past = ((r.data ?? []) as unknown as { id: string; total: number | string | null; equipment_order_lines: { kit: string }[] | null }[])
      .filter(x => x.id !== fresh.id).map(x => ({ total: Number(x.total ?? 0), lines: x.equipment_order_lines ?? [] }));
    const disc = bundleDiscount({
      lines: fresh.equipment_order_lines.map(l => ({ kit: l.kit, amount: (Number(l.unit_price) || (catalog ?? []).find(k => k.kit === l.kit)?.price || 0) * l.quantity })), // нет цены строки: берём цену каталога
      pastKits: past.flatMap(x => x.lines.map(l => l.kit)), pastAmount: priorAmount(past, settings.values), installment: false, settings: settings.values,
    });
    if (!disc.applies) return skip('Скидка на комплект к этому заказу не применяется (нужен полный набор).');
    if (Math.abs(disc.total - fresh.total) < 0.005) return skip(`Сумма уже верная: ${gel(fresh.total)}.`);
    if (disc.total < fresh.paid) return skip(`По скидке вышло бы ${gel(disc.total)}, это меньше уже оплаченного.`);
    const yes = await ask({ title: 'Пересчитать сумму по скидке на комплект?', lines: [['Игрок', fresh.players?.full_name ?? 'Игрок'], ['Сейчас', gel(fresh.total)], ['Со скидкой', gel(disc.total)]], note: `Скидка ${disc.pct}% на набор. Сумма заказа изменится.`, confirmLabel: 'Применить' });
    if (!yes) return;
    if (await run('edit', () => supabase.rpc('eq_edit_order', { o: fresh.id, insc: fresh.inscription ?? '', num: fresh.number ?? '', inst: fresh.installment, loc: fresh.location ?? '', new_total: disc.total }), 'Сумма пересчитана.')) setTotal(String(disc.total));
  };
  const run = async (key: string, f: () => PromiseLike<{ error: { message: string } | null }>, ok?: string) => {
    setBusy(key);
    setMsg(null);
    const r = await f();
    setBusy(null);
    if (r.error) { setMsg({ ok: false, text: errText(r.error.message) }); return false; }
    if (ok) setMsg({ ok: true, text: ok });
    lastFresh.current = await refresh();
    return true;
  };
  if (gone) return null;
  const hist = o.equipment_order_status_history ?? [];
  const issued = new Map(o.equipment_issues.map(i => [i.kit, i]));
  const kitsInOrder = [...new Set(o.equipment_order_lines.map(l => l.kit))];

  // Шаг назад только для администратора (проверяет база). Спрашиваем подтверждение: запись попадёт в историю.
  const stepBack = async () => {
    const prev = prevStatus(o.status);
    if (!prev) return;
    if (!(await ask({ title: 'Вернуть статус?', lines: [['Игрок', o.players?.full_name ?? 'Игрок'], ['Сейчас', orderStatusLabel(o.status)], ['Будет', orderStatusLabel(prev)]], note: 'Возврат попадёт в историю статусов.', confirmLabel: 'Вернуть' }))) return;
    await run('status', () => supabase.rpc('eq_set_order_status', { o: o.id, st: prev }), 'Статус возвращён.');
  };
  const removeLine = async (l: Line) => {
    if (!l.id) return;
    if (!(await ask({ title: 'Убрать вещь из заказа?', lines: [['Игрок', o.players?.full_name ?? 'Игрок'], ['Вещь', `${l.kit}${l.size ? ` (${l.size})` : ''} × ${l.quantity}`]], note: 'Сумма заказа уменьшится на стоимость вещи.', confirmLabel: 'Убрать', danger: true }))) return;
    await run(`rm-${l.id}`, () => supabase.rpc('eq_delete_line', { l: l.id }), 'Вещь убрана.');
  };
  const deleteOrder = async () => {
    if (!(await ask({ title: 'Удалить заказ?', lines: [['Игрок', o.players?.full_name ?? 'Игрок'], ['Сумма', gel(o.total)]], note: 'Заказ будет удалён. Отменить нельзя.', confirmLabel: 'Удалить', danger: true }))) return;
    if (await run('del', () => supabase.rpc('eq_delete_order', { o: o.id }))) setGone(true);
  };
  return (
    <main className="page">
      <BackNav onBack={onBack} managed />
      <h1 style={{ overflowWrap: 'anywhere' }}>{o.players?.full_name ?? 'Заказ'}</h1>
      <p className="muted">{o.ordered_on ? fmtDate(o.ordered_on) : 'Дата не указана'} · оплачено {gel(o.paid)} из {gel(o.total)}{o.installment ? ' · рассрочка' : ''}</p>
      {msg && <p ref={msgRef} role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'muted' : 'error'}>{msg.text}</p>}

      <h3>Статус заказа</h3>
      <div className="ks-card">
        <div className="ks-line"><b>{orderStatusLabel(o.status)}</b>{lastStatusDate(hist) && <span className="muted">с {fmtDate(lastStatusDate(hist) as string)}</span>}</div>
        {nextStatus(o.status) === 'issued' && !allKitsIssued(o.equipment_order_lines, o.equipment_issues) && (
          <p className="muted" style={{ marginTop: 8 }}>Статус «Выдан» станет доступен, когда будут выданы все вещи заказа.</p>
        )}
        {nextStatus(o.status) && (
          <button type="button" className="ks-btn" style={{ marginTop: 8 }} disabled={busy === 'status' || (nextStatus(o.status) === 'issued' && !allKitsIssued(o.equipment_order_lines, o.equipment_issues))} onClick={() => void run('status', () => supabase.rpc('eq_set_order_status', { o: o.id, st: nextStatus(o.status) }), 'Статус обновлён.')}>
            Перевести: {orderStatusLabel(nextStatus(o.status))}
          </button>
        )}
        {prevStatus(o.status) && (
          <button type="button" className="ks-btn secondary" style={{ marginTop: 8 }} disabled={busy === 'status'} onClick={() => void stepBack()}>
            Вернуть: {orderStatusLabel(prevStatus(o.status))}
          </button>
        )}
        {hist.length > 0 && (
          <div className="ks-muted" style={{ fontSize: 13, marginTop: 8 }}>
            {[...hist].sort((a, b) => b.changed_at.localeCompare(a.changed_at)).map((h, i) => (
              <div key={i}>{fmtDate(h.changed_at.slice(0, 10))} · {orderStatusLabel(h.status)}{h.changed_by_name ? ` · ${h.changed_by_name}` : ''}</div>
            ))}
          </div>
        )}
      </div>

      <h3>Вещи и выдача</h3>
      <label className="field">Кто выдаёт (для отметок)<input value={who} maxLength={40} onChange={e => setWho(e.target.value)} /></label>
      {kitsInOrder.map(k => {
        const lines = o.equipment_order_lines.filter(l => l.kit === k);
        const i = issued.get(k);
        return (
          <div className="ks-card" key={k}>
            <div className="ks-line"><b>{k}</b><Pill tone={i ? 'success' : 'neutral'} dot>{i ? `Выдано ${fmtDate(i.issued_on)}` : 'Не выдано'}</Pill></div>
            {i?.issued_by && <div className="ks-muted" style={{ fontSize: 13 }}>выдал: {i.issued_by}</div>}
            {lines.map((l, n) => l.id
              ? <LineEditor key={`${l.id}-${l.size}-${l.quantity}`} line={l} locked={!!i} last={o.equipment_order_lines.length <= 1} busy={busy === `ln-${l.id}` || busy === `rm-${l.id}`}
                  onSave={(size, qty) => void run(`ln-${l.id}`, () => supabase.rpc('eq_edit_line', { l: l.id, sz: size, qty }), 'Сохранено.')} onRemove={() => void removeLine(l)} />
              : <div key={n} className="ks-muted" style={{ fontSize: 13 }}>{l.size ?? 'размер не указан'} × {l.quantity}</div>)}
            <button type="button" className="ks-btn secondary" style={{ marginTop: 8 }} disabled={busy === k} onClick={() => void run(k, () => supabase.rpc('eq_set_issued', { o: o.id, k, on_: !i, who }))}>{i ? 'Снять выдачу' : 'Отметить выдачу'}</button>
          </div>
        );
      })}

      <h3>Добавить вещь</h3>
      <div className="ks-card">
        <label className="field">Вещь<select value={addKit} onChange={e => setAddKit(e.target.value)}><option value="">Выберите вещь</option>{(catalog ?? []).filter(k => !issued.has(k.kit)).map(k => <option key={k.kit} value={k.kit}>{k.kit} — {gel(k.price)}</option>)}</select></label>
        <label className="field">Размер новой вещи<input value={addSize} maxLength={40} onChange={e => setAddSize(e.target.value)} /></label>
        <button type="button" className="ks-btn secondary" disabled={busy === 'add' || !addKit} onClick={() => void run('add', () => supabase.rpc('eq_add_line', { o: o.id, k: addKit, sz: addSize, qty: 1 }), 'Вещь добавлена.').then(ok => { if (ok) { setAddKit(''); setAddSize(''); if (lastFresh.current) void offerBundle(lastFresh.current); } })}>Добавить в заказ</button>
      </div>

      <h3>Оплата</h3>
      <label className="field">Способ оплаты<select value={method} onChange={e => setMethod(e.target.value)}><option value="">Выберите способ</option><option>Наличные</option><option>Перевод</option></select></label>
      <label className="field">Сумма, ₾ (минус — исправление)<input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></label>
      <button type="button" className="ks-btn" disabled={busy === 'pay' || !method || amount.trim() === '' || Number.isNaN(num(amount)) || num(amount) === 0} onClick={() => void run('pay', () => supabase.rpc('eq_add_payment', { o: o.id, amt: num(amount), mth: method }), 'Платёж записан.').then(ok => { if (ok) setAmount(''); })}>Записать платёж</button>

      <h3>Данные заказа</h3>
      <label className="field">Надпись<input value={insc} maxLength={40} onChange={e => setInsc(e.target.value)} /></label>
      <label className="field">Номер<input value={number} maxLength={10} onChange={e => setNumber(e.target.value)} /></label>
      {numberNote && <p className="ks-callout" role="status">{numberNote}</p>}
      {!number.trim() && knownNumber && <button type="button" className="ks-btn secondary" style={{ marginTop: 8 }} onClick={() => setNumber(knownNumber)}>Подставить номер {knownNumber} из другого заказа игрока</button>}
      <label className="field">Дата заказа<input type="date" max={today()} value={orderedOn} onChange={e => setOrderedOn(e.target.value)} /></label>
      <button type="button" className="ks-btn secondary" style={{ marginTop: 8 }} disabled={busy === 'date' || !orderedOn || orderedOn === (o.ordered_on ?? '')} onClick={() => void run('date', () => supabase.rpc('eq_set_order_date', { o: o.id, d: orderedOn }), 'Дата сохранена.')}>Сохранить дату</button>
      <label className="field">Локация<input value={loc} maxLength={40} onChange={e => setLoc(e.target.value)} /></label>
      <button type="button" className="ks-btn secondary" style={{ marginTop: 8 }} disabled={busy === 'edit'} onClick={() => void offerBundle(o, true)}>Пересчитать по скидке на комплект</button>
      <label className="field">Сумма заказа, ₾<input inputMode="decimal" value={total} onChange={e => setTotal(e.target.value)} /></label>
      <div style={{ marginTop: 12 }}><SwitchRow id="inst" label="Рассрочка" checked={inst} onChange={setInst} /></div>
      <button type="button" className="ks-btn" style={{ marginTop: 16 }} disabled={busy === 'edit' || Number.isNaN(num(total))} onClick={() => void run('edit', () => supabase.rpc('eq_edit_order', { o: o.id, insc, num: number, inst, loc, new_total: num(total) }), 'Сохранено.')}>Сохранить</button>
      <div style={{ height: 8 }} />
      <button type="button" className="ks-btn secondary" disabled={busy === 'del'} onClick={() => void deleteOrder()}>Удалить заказ</button>
      {confirmDialog}
    </main>
  );
}
