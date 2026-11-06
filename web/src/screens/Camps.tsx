import { useEffect, useState } from 'react';
import { useDirtyGuard, useDirtySignature } from '../nav';
import { coachError, fmtDate, groupByGroupName, today } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { EmptyState, ListRow, Pill, SearchInput, Segmented, SwitchRow } from '../ui/components';
import { useConfirm } from '../ui/ConfirmSheet';
import { BackNav } from '../ui/nav';
import { useNav, useNavState } from '../nav';
import { Failure, Loading } from './Message';

interface Camp { id: string; name: string; location: string | null; starts_on: string; ends_on: string; booking_fee: number; booking_deadline: string | null; full_payment_deadline: string | null; active: boolean }
interface Tariff { id: string; name: string; price: number; active: boolean }
interface Pay { id: string; amount: number; paid_on: string; kind: 'booking' | 'payment' | 'refund'; method: string | null; comment: string | null; legacy_ref?: string | null }
interface Part {
  id: string; player_id: string | null; guest_name: string | null; guest_contact: string | null; tariff_id: string | null; amount: number; tshirt_size: string | null; comment: string | null; status: 'registered' | 'declined';
  players: { full_name: string; groups: { name: string } | null } | null; camp_tariffs: { name: string } | null; camp_payments: Pay[];
}

const gel = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2)} ₾`;
const num = (s: string) => Number(s.replace(',', '.'));
const METHODS = ['Наличные', 'Перевод'];
const KIND: Record<Pay['kind'], string> = { booking: 'Бронь', payment: 'Оплата', refund: 'Возврат' };
const errText = (m: string) =>
  m.includes('already registered') ? 'Уже записан на этот сбор.' : m.includes('not a guest') ? 'Имя и контакт правятся только у гостя.' : m.includes('already cancelled') ? 'Этот платёж уже отменён.' : m.includes('not cancellable') ? 'Этот платёж отменить нельзя.' : m.includes('paid below zero') ? 'Отмена увела бы оплату ниже нуля.' :
  m.includes('bad dates') ? 'Дата конца раньше даты начала.' : m.includes('bad amount') ? 'Сумма указана неверно.' : m.includes('amount below paid') ? 'Сумма участника не может быть меньше уже оплаченного.' : m.includes('name required') ? 'Введите название.' : m.includes('tariff not found') ? 'Выберите действующий тариф.' :
  m.includes('Could not find the function') || m.includes('camp_') ? 'Модуль ещё не установлен в базе (миграция 0037).' : coachError(m);
const nameOf = (p: Pick<Part, 'players' | 'guest_name'>) => p.players?.full_name ?? p.guest_name ?? 'Участник';
const groupOf = (p: Pick<Part, 'players' | 'player_id'>) => (p.player_id ? p.players?.groups?.name ?? 'Без группы' : 'Гости');
const paidOf = (p: Part) => p.camp_payments.reduce((s, x) => s + Number(x.amount), 0);

// Сборы для администратора (миграция 0037): сборы, тарифы, участники, платежи, список для отправки.
export default function Camps() {
  const [camps, setCamps] = useState<Camp[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  // Сбор, форма сбора, запись участника и участник — записи стека раздела; список остаётся под ними
  const nav = useNav();

  useEffect(() => {
    void supabase.from('camps').select('id, name, location, starts_on, ends_on, booking_fee, booking_deadline, full_payment_deadline, active').order('starts_on', { ascending: false }).limit(60).then(r => {
      if (r.error) return setError(errText(r.error.message));
      setCamps(((r.data ?? []) as Camp[]).map(c => ({ ...c, booking_fee: Number(c.booking_fee) })));
    });
  }, [reload]);

  const done = () => { setCamps(null); setReload(n => n + 1); };
  if (error) return <Failure title="Не удалось загрузить сборы" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} />;
  if (nav.top.screen === 'camp.form') {
    const editing = camps?.find(c => c.id === nav.top.params.id);
    if (!nav.top.params.id || editing) return <CampForm camp={editing ?? null} onBack={() => nav.back()} onDone={() => { nav.back(); done(); }} />;
  }
  const campIndex = nav.entries.findIndex(e => e.screen === 'camp');
  const open = campIndex >= 0 ? camps?.find(c => c.id === nav.entries[campIndex].params.id) : undefined;
  if (open) return <CampView camp={open} campIndex={campIndex} onBack={() => { nav.back(); done(); }} onEdit={() => nav.push('camp.form', { id: open.id })} />;
  return (
    <main className="page">
      <h1>Сборы</h1>
      <button type="button" className="ks-btn" onClick={() => nav.push('camp.form')}>Новый сбор</button>
      {!camps ? <Loading /> : camps.length === 0 ? <EmptyState icon="users" title="Сборов нет" text="Создайте сбор кнопкой выше." /> : camps.map(c => (
        <ListRow key={c.id} avatar="С" title={c.name} sub={[`${fmtDate(c.starts_on)} — ${fmtDate(c.ends_on)}`, c.location ?? 'место не указано']} end={c.active ? undefined : <Pill>Архив</Pill>} onClick={() => nav.push('camp', { id: c.id })} />
      ))}
    </main>
  );
}

function CampForm({ camp, onBack, onDone }: { camp: Camp | null; onBack: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: camp?.name ?? '', loc: camp?.location ?? '', d1: camp?.starts_on ?? today(), d2: camp?.ends_on ?? today(), fee: String(camp?.booking_fee ?? 0), feeBy: camp?.booking_deadline ?? '', payBy: camp?.full_payment_deadline ?? '', act: camp?.active ?? true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useDirtySignature(JSON.stringify(f)); // правки считаются от открытого значения
  const save = async () => {
    setBusy(true);
    setErr(null);
    const r = await supabase.rpc('camp_save', { cid: camp?.id ?? null, nm: f.name, loc: f.loc, d1: f.d1, d2: f.d2, fee: num(f.fee), fee_by: f.feeBy || null, pay_by: f.payBy || null, act: f.act });
    setBusy(false);
    if (r.error) return setErr(errText(r.error.message));
    onDone();
  };
  return (
    <main className="page">
      <BackNav onBack={onBack} managed />
      <h1>{camp ? 'Данные сбора' : 'Новый сбор'}</h1>
      <label className="field">Название<input value={f.name} maxLength={80} onChange={e => setF({ ...f, name: e.target.value })} /></label>
      <label className="field">Место<input value={f.loc} maxLength={80} onChange={e => setF({ ...f, loc: e.target.value })} /></label>
      <div className="two">
        <label className="field">С<input type="date" value={f.d1} onChange={e => setF({ ...f, d1: e.target.value })} /></label>
        <label className="field">По<input type="date" value={f.d2} min={f.d1} onChange={e => setF({ ...f, d2: e.target.value })} /></label>
      </div>
      <label className="field">Бронь, ₾<input inputMode="decimal" value={f.fee} onChange={e => setF({ ...f, fee: e.target.value })} /></label>
      <div className="two">
        <label className="field">Бронь до<input type="date" value={f.feeBy} onChange={e => setF({ ...f, feeBy: e.target.value })} /></label>
        <label className="field">Оплата до<input type="date" value={f.payBy} onChange={e => setF({ ...f, payBy: e.target.value })} /></label>
      </div>
      <div style={{ marginTop: 12 }}><SwitchRow id="act" label="Сбор активен" checked={f.act} onChange={v => setF({ ...f, act: v })} /></div>
      {err && <p className="error">{err}</p>}
      <button type="button" className="ks-btn" disabled={busy || !f.name.trim() || Number.isNaN(num(f.fee))} onClick={() => void save()}>Сохранить</button>
    </main>
  );
}

type Tab = 'people' | 'tariffs' | 'list';

function CampView({ camp, campIndex, onBack, onEdit }: { camp: Camp; campIndex: number; onBack: () => void; onEdit: () => void }) {
  const nav = useNav();
  const [tab, setTab] = useNavState<Tab>('camp.tab', 'people', { entry: campIndex, persist: { kind: 'enum', values: ['people', 'tariffs', 'list'] } });
  const [parts, setParts] = useState<Part[] | null>(null);
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    void (async () => {
      const t = await supabase.from('camp_tariffs').select('id, name, price, active').eq('camp_id', camp.id).order('name');
      if (t.error) return setError(errText(t.error.message));
      setTariffs(((t.data ?? []) as Tariff[]).map(x => ({ ...x, price: Number(x.price) })));
      const r = await supabase.from('camp_participants').select('id, player_id, guest_name, guest_contact, tariff_id, amount, tshirt_size, comment, status, players(full_name, groups(name)), camp_tariffs(name), camp_payments(id, amount, paid_on, kind, method, comment, legacy_ref)').eq('camp_id', camp.id).limit(500);
      if (r.error) return setError(errText(r.error.message));
      setParts(((r.data ?? []) as unknown as Part[]).map(p => ({ ...p, amount: Number(p.amount) })).sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'ru')));
    })();
  }, [camp.id, reload]);

  const refresh = () => { setParts(null); setReload(n => n + 1); };
  if (error) return <Failure title="Не удалось загрузить сбор" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} />;
  if (nav.top.screen === 'camp.add') return <AddPart camp={camp} tariffs={tariffs.filter(t => t.active)} taken={new Set((parts ?? []).filter(p => p.status === 'registered' && p.player_id).map(p => p.player_id as string))} onBack={() => nav.back()} onDone={() => { nav.back(); refresh(); }} />;
  const open = nav.top.screen === 'camp.part' ? parts?.find(p => p.id === nav.top.params.id) : undefined;
  if (open) return <PartView part={open} camp={camp} tariffs={tariffs} onBack={() => { nav.back(); refresh(); }} />;

  const reg = (parts ?? []).filter(p => p.status === 'registered');
  const owed = reg.reduce((s, p) => s + p.amount, 0);
  const paid = reg.reduce((s, p) => s + paidOf(p), 0);
  return (
    <main className="page">
      <BackNav onBack={onBack} managed />
      <h1>{camp.name}</h1>
      <p className="muted">{fmtDate(camp.starts_on)} — {fmtDate(camp.ends_on)}{camp.location ? ` · ${camp.location}` : ''}{camp.booking_fee ? ` · бронь ${gel(camp.booking_fee)}` : ''}</p>
      <button type="button" className="ks-btn secondary" onClick={onEdit}>Данные сбора</button>
      <div style={{ height: 10 }} />
      <Segmented label="Раздел" value={tab} onChange={setTab} items={[{ value: 'people', label: 'Участники' }, { value: 'tariffs', label: 'Тарифы' }, { value: 'list', label: 'Список' }]} />
      {tab === 'tariffs' ? <Tariffs camp={camp} tariffs={tariffs} onChanged={refresh} /> : !parts ? <Loading /> : tab === 'list' ? <ListText parts={reg} /> : (
        <>
          <p className="muted" style={{ margin: '10px 0' }}>Записано: {reg.length} · оплачено {gel(paid)} из {gel(owed)}</p>
          <button type="button" className="ks-btn" onClick={() => nav.push('camp.add')} disabled={tariffs.filter(t => t.active).length === 0}>{tariffs.some(t => t.active) ? 'Записать игрока' : 'Сначала добавьте тариф'}</button>
          {parts.length === 0 ? <EmptyState icon="users" title="Пока никого" /> : groupByGroupName(parts, groupOf).map(([group, items]) => (
            <details className="ks-group" key={group}>
              <summary><div className="ks-line"><b>{group}</b><span className="muted">{items.length} уч.</span></div></summary>
              {items.map(p => (
                <ListRow key={p.id} avatar={nameOf(p)} title={nameOf(p)} sub={[p.camp_tariffs?.name ?? 'без тарифа', p.status === 'declined' ? 'отказ' : p.player_id ? p.players?.groups?.name ?? 'без группы' : 'гость']}
                  end={p.status === 'declined' ? <Pill>Отказ</Pill> : <Pill tone={paidOf(p) >= p.amount ? 'success' : 'danger'} dot>{paidOf(p) >= p.amount ? 'Оплачен' : `${gel(paidOf(p))} из ${gel(p.amount)}`}</Pill>} onClick={() => nav.push('camp.part', { id: p.id })} />
              ))}
            </details>
          ))}
        </>
      )}
    </main>
  );
}

function Tariffs({ camp, tariffs, onChanged }: { camp: Camp; tariffs: Tariff[]; onChanged: () => void }) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const save = async (nm: string, pr: number, act: boolean) => {
    setMsg(null);
    const r = await supabase.rpc('camp_tariff_save', { cid: camp.id, nm, pr, act });
    if (r.error) return setMsg(errText(r.error.message));
    setName('');
    setPrice('');
    onChanged();
  };
  return (
    <>
      <p className="muted" style={{ margin: '10px 0' }}>Тариф не удаляется: его можно снять с «активен».</p>
      {tariffs.map(t => (
        <ListRow key={t.id} title={t.name} sub={[t.active ? 'активен' : 'не активен']} end={<span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><b>{gel(t.price)}</b><button type="button" className="ks-btn secondary" style={{ width: 'auto', minHeight: 40 }} onClick={() => void save(t.name, t.price, !t.active)}>{t.active ? 'Снять' : 'Вернуть'}</button></span>} onClick={() => { setName(t.name); setPrice(String(t.price)); }} />
      ))}
      <h3>Тариф и цена</h3>
      <label className="field">Название<input value={name} maxLength={60} onChange={e => setName(e.target.value)} /></label>
      <label className="field">Цена, ₾<input inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} /></label>
      {msg && <p className="error">{msg}</p>}
      <button type="button" className="ks-btn" disabled={!name.trim() || price.trim() === '' || Number.isNaN(num(price))} onClick={() => void save(name, num(price), true)}>Сохранить тариф</button>
    </>
  );
}

function ListText({ parts }: { parts: Part[] }) {
  const [copied, setCopied] = useState(false);
  const key = (g: string | undefined) => (g ?? 'Без группы').replace(/-[A-Za-zА-Яа-я]$/, '');
  const gk = (p: Part) => (p.player_id ? key(p.players?.groups?.name) : 'Гости');
  const groups = new Map<string, string[]>();
  parts.forEach(p => groups.set(gk(p), [...(groups.get(gk(p)) ?? []), nameOf(p)]));
  const text = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ru')).map(([g, names]) => `${g}\n${names.sort((a, b) => a.localeCompare(b, 'ru')).map((n, i) => `${i + 1} — ${n}`).join('\n')}`).join('\n\n');
  return (
    <>
      <p className="muted" style={{ margin: '10px 0' }}>Записавшиеся по группам (U7-A и U7-B объединены). Скопируйте и отправьте.</p>
      <textarea className="ks-input" readOnly rows={Math.min(20, text.split('\n').length + 1)} value={text || 'Пока никого'} style={{ marginBottom: 10 }} aria-label="Список" />
      <button type="button" className="ks-btn" onClick={() => void navigator.clipboard?.writeText(text).then(() => setCopied(true))}>{copied ? 'Скопировано' : 'Скопировать'}</button>
    </>
  );
}

function AddPart({ camp, tariffs, taken, onBack, onDone }: { camp: Camp; tariffs: Tariff[]; taken: Set<string>; onBack: () => void; onDone: () => void }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<{ id: string; full_name: string }[]>([]);
  const [player, setPlayer] = useState<{ id: string; full_name: string } | null>(null);
  const [who, setWho] = useState<'player' | 'guest'>('player');
  const [guestName, setGuestName] = useState('');
  const [guestContact, setGuestContact] = useState('');
  const [tid, setTid] = useState(tariffs[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [size, setSize] = useState('');
  const [cmt, setCmt] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useDirtyGuard(player !== null || guestName.trim() !== '' || guestContact.trim() !== '' || amount.trim() !== '' || size.trim() !== '' || cmt.trim() !== '');
  useEffect(() => {
    if (q.trim().length < 2) return setFound([]);
    const t = setTimeout(() => {
      void supabase.from('players').select('id, full_name').ilike('full_name', `%${q.trim()}%`).order('full_name').limit(8).then(r => {
        if (!r.error) setFound(((r.data ?? []) as { id: string; full_name: string }[]).filter(p => !taken.has(p.id)));
      });
    }, 250);
    return () => clearTimeout(t);
  }, [q, taken]);
  const save = async () => {
    if (who === 'player' && !player) return;
    setBusy(true);
    setErr(null);
    const amt = amount.trim() === '' ? null : num(amount);
    const r = who === 'guest'
      ? await supabase.rpc('camp_register_guest', { cid: camp.id, nm: guestName, contact: guestContact, tid, amt, tshirt: size, cmt })
      : await supabase.rpc('camp_register', { cid: camp.id, p: (player as { id: string }).id, tid, amt, tshirt: size, cmt });
    setBusy(false);
    if (r.error) return setErr(errText(r.error.message));
    onDone();
  };
  return (
    <main className="page">
      <BackNav onBack={onBack} managed />
      <h1>Записать на сбор</h1>
      <Segmented label="Кого записать" value={who} onChange={setWho} items={[{ value: 'player', label: 'Игрок клуба' }, { value: 'guest', label: 'Гость' }]} />
      {who === 'guest' ? (
        <>
          <p className="muted" style={{ margin: '10px 0' }}>Гость не заводится как игрок клуба: достаточно имени и контакта.</p>
          <label className="field">Имя гостя<input value={guestName} maxLength={80} onChange={e => setGuestName(e.target.value)} /></label>
          <label className="field">Контакт (телефон или Telegram)<input value={guestContact} maxLength={80} onChange={e => setGuestContact(e.target.value)} /></label>
        </>
      ) : player ? <ListRow avatar={player.full_name} title={player.full_name} end={<button type="button" className="ks-btn secondary" style={{ width: 'auto', minHeight: 40 }} onClick={() => setPlayer(null)}>Сменить</button>} /> : (
        <>
          <SearchInput label="Найти игрока" placeholder="Фамилия или имя (от 2 букв)" value={q} onChange={setQ} suggestions={found.map(f => f.full_name)} />
          {found.map(p => <ListRow key={p.id} avatar={p.full_name} title={p.full_name} onClick={() => setPlayer(p)} />)}
        </>
      )}
      <label className="field">Тариф<select value={tid} onChange={e => setTid(e.target.value)}>{tariffs.map(t => <option key={t.id} value={t.id}>{t.name} — {gel(t.price)}</option>)}</select></label>
      <label className="field">Сумма, ₾ (если не по тарифу; иначе пусто)<input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></label>
      <label className="field">Размер футболки<input value={size} maxLength={20} onChange={e => setSize(e.target.value)} /></label>
      <label className="field">Комментарий<input value={cmt} maxLength={120} onChange={e => setCmt(e.target.value)} /></label>
      {err && <p className="error">{err}</p>}
      <button type="button" className="ks-btn" disabled={busy || (who === 'player' ? !player : !guestName.trim()) || !tid || (amount.trim() !== '' && Number.isNaN(num(amount)))} onClick={() => void save()}>Записать</button>
    </main>
  );
}

function PartView({ part, camp, tariffs, onBack }: { part: Part; camp: Camp; tariffs: Tariff[]; onBack: () => void }) {
  const [p, setP] = useState(part);
  const [tid, setTid] = useState(part.tariff_id ?? '');
  const [amount, setAmount] = useState(String(part.amount));
  const [size, setSize] = useState(part.tshirt_size ?? '');
  const [cmt, setCmt] = useState(part.comment ?? '');
  const [gName, setGName] = useState(part.guest_name ?? '');
  const [gContact, setGContact] = useState(part.guest_contact ?? '');
  const [payAmount, setPayAmount] = useState('');
  const [kind, setKind] = useState<'booking' | 'payment'>(camp.booking_fee > 0 && part.camp_payments.length === 0 ? 'booking' : 'payment');
  const [date, setDate] = useState(today());
  const [method, setMethod] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const { ask, dialog } = useConfirm();

  const recordPay = async () => {
    const ok = await ask({
      title: 'Записать платёж?',
      lines: [[p.player_id ? 'Игрок' : 'Гость', nameOf(p)], ['Кемп', camp.name], ['Сумма', gel(num(payAmount))], ['Вид', KIND[kind]], ['Способ', method], ['Дата', fmtDate(date)]],
      note: 'Запись нельзя изменить или удалить, ошибку исправляют записью с минусом.',
      confirmLabel: 'Записать',
    });
    if (!ok) return;
    const saved = await run('pay', () => supabase.rpc('camp_pay', { pid: p.id, amt: num(payAmount), k: kind, d: date, mth: method, cmt: null }), 'Платёж записан.');
    if (saved) setPayAmount('');
  };

  const cancelPay = async (x: Pay) => {
    const ok = await ask({
      title: 'Отменить платёж?',
      lines: [[p.player_id ? 'Игрок' : 'Гость', nameOf(p)], ['Сумма', gel(Number(x.amount))], ['Вид', KIND[x.kind]], ['Дата', fmtDate(x.paid_on)]],
      note: 'Будет записана запись с минусом на ту же сумму. Сам платёж удалить нельзя.',
      confirmLabel: 'Отменить платёж',
      danger: true,
    });
    if (ok) await run(x.id, () => supabase.rpc('camp_cancel_payment', { payid: x.id }), 'Платёж отменён записью с минусом.');
  };

  const refresh = async () => {
    const r = await supabase.from('camp_participants').select('id, player_id, guest_name, guest_contact, tariff_id, amount, tshirt_size, comment, status, players(full_name, groups(name)), camp_tariffs(name), camp_payments(id, amount, paid_on, kind, method, comment, legacy_ref)').eq('id', part.id).maybeSingle();
    if (!r.error && r.data) setP({ ...(r.data as unknown as Part), amount: Number((r.data as { amount: number }).amount) });
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
  const pays = [...p.camp_payments].sort((a, b) => b.paid_on.localeCompare(a.paid_on));
  const cancelled = new Set(p.camp_payments.map(x => x.legacy_ref).filter((r): r is string => !!r && r.startsWith('cancel:')).map(r => r.slice(7)));
  return (
    <main className="page">
      <BackNav onBack={onBack} managed />
      <h1 style={{ overflowWrap: 'anywhere' }}>{nameOf(p)}</h1>
      <p className="muted">{camp.name}{p.player_id ? '' : ' · гость'}{p.guest_contact ? ` · ${p.guest_contact}` : ''} · оплачено {gel(paidOf(p))} из {gel(p.amount)}{p.status === 'declined' ? ' · отказ' : ''}</p>
      {msg && <p className={msg.ok ? 'muted' : 'error'}>{msg.text}</p>}

      {dialog}
      <h3>Платежи</h3>
      {pays.length === 0 ? <p className="muted">Платежей нет.</p> : pays.map(x => (
        <div className="ks-card" key={x.id}>
          <div className="ks-line"><span>{KIND[x.kind]} · {fmtDate(x.paid_on)}{x.method ? ` · ${x.method}` : ''}</span><b>{gel(Number(x.amount))}</b></div>
          {cancelled.has(x.id) && <div className="ks-muted" style={{ fontSize: 13 }}>Отменён</div>}
          {x.kind !== 'refund' && Number(x.amount) > 0 && !cancelled.has(x.id) && (
            <button type="button" className="ks-btn secondary" style={{ marginTop: 8 }} disabled={busy === x.id} onClick={() => void cancelPay(x)}>Отменить платёж</button>
          )}
        </div>
      ))}
      <h3>Внести платёж</h3>
      <Segmented label="Вид" value={kind} onChange={setKind} items={[{ value: 'booking', label: 'Бронь' }, { value: 'payment', label: 'Оплата' }]} />
      <label className="field">Сумма, ₾<input inputMode="decimal" value={payAmount} onChange={e => setPayAmount(e.target.value)} /></label>
      <div className="two">
        <label className="field">Дата<input type="date" value={date} max={today()} onChange={e => setDate(e.target.value)} /></label>
        <label className="field">Способ<select value={method} onChange={e => setMethod(e.target.value)}><option value="">Выберите способ</option>{METHODS.map(m => <option key={m}>{m}</option>)}</select></label>
      </div>
      <button type="button" className="ks-btn" disabled={busy === 'pay' || !method || payAmount.trim() === '' || Number.isNaN(num(payAmount)) || num(payAmount) <= 0} onClick={() => void recordPay()}>Записать платёж</button>

      {!p.player_id && (
        <>
          <h3>Гость</h3>
          <label className="field">Имя гостя<input value={gName} maxLength={80} onChange={e => setGName(e.target.value)} /></label>
          <label className="field">Контакт (телефон или Telegram)<input value={gContact} maxLength={80} onChange={e => setGContact(e.target.value)} /></label>
          <button type="button" className="ks-btn" disabled={busy === 'guest' || !gName.trim()} onClick={() => void run('guest', () => supabase.rpc('camp_update_guest', { pid: p.id, nm: gName, contact: gContact }), 'Данные гостя сохранены.')}>Сохранить имя и контакт</button>
        </>
      )}
      <h3>Данные участника</h3>
      <label className="field">Тариф<select value={tid} onChange={e => setTid(e.target.value)}>{tariffs.map(t => <option key={t.id} value={t.id}>{t.name} — {gel(t.price)}{t.active ? '' : ' (не активен)'}</option>)}</select></label>
      <label className="field">Сумма, ₾<input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></label>
      <label className="field">Размер футболки<input value={size} maxLength={20} onChange={e => setSize(e.target.value)} /></label>
      <label className="field">Комментарий<input value={cmt} maxLength={120} onChange={e => setCmt(e.target.value)} /></label>
      <button type="button" className="ks-btn" disabled={busy === 'save' || Number.isNaN(num(amount))} onClick={() => void run('save', () => supabase.rpc('camp_update_participant', { pid: p.id, tid: tid || null, amt: num(amount), tshirt: size, cmt, st: p.status }), 'Сохранено.')}>Сохранить</button>
      <div style={{ height: 8 }} />
      <button type="button" className="ks-btn secondary" disabled={busy === 'st'} onClick={() => void run('st', () => supabase.rpc('camp_update_participant', { pid: p.id, tid: tid || null, amt: num(amount), tshirt: size, cmt, st: p.status === 'declined' ? 'registered' : 'declined' }), p.status === 'declined' ? 'Снова записан.' : 'Отказ отмечен.')}>{p.status === 'declined' ? 'Вернуть в список' : 'Отметить отказ'}</button>
    </main>
  );
}
