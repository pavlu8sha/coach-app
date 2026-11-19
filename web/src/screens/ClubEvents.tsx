import { useEffect, useRef, useState } from 'react';
import { ExpandableTextarea } from '../ui/ExpandableTextarea';
import { useDirtySignature, useNav, useNavState } from '../nav';
import { fmtDate } from '../lib/coach';
import { tbilisiToday } from '../lib/campAttention';
import { RECORD_LABEL, RECORD_TONE, STATUS_LABEL, STATUS_TONE, clubEventErr, deadlineText, gel, moneyOk, num, parseMoney, seatsText, whenText, type ClubEvent, type EventStatus, type Participant } from '../lib/clubEvents';
import { supabase } from '../lib/supabase';
import { EmptyState, ListRow, Pill, Segmented } from '../ui/components';
import { useConfirm } from '../ui/ConfirmSheet';
import { BackNav } from '../ui/nav';
import { Failure, Loading } from './Message';

const METHODS = ['Наличные', 'Перевод'];
const newKey = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
type Group = { id: string; name: string };

// «Мероприятия» (Issue #677, этап 4): платные мероприятия клуба. Отдельный раздел, с разделом «События» (матчи, взносы) ничего общего нет.
// Деньги, статусы и ограничения считает и проверяет база; экран показывает ответ и не доверяет собственным расчётам при записи платежа.
export default function ClubEvents() {
  const nav = useNav();
  const [ver, setVer] = useState(0);
  const bump = () => setVer(v => v + 1);
  if (nav.top.screen === 'ce.form') return <EventForm id={nav.top.params.id ?? null} onBack={() => nav.back()} onDone={() => { nav.back(); bump(); }} />;
  const index = nav.entries.findIndex(e => e.screen === 'ce.event');
  if (index >= 0) return <EventView key={nav.entries[index].params.id} id={nav.entries[index].params.id} index={index} ver={ver} onBack={() => { nav.back(); bump(); }} />;
  return <EventList ver={ver} />;
}

function EventList({ ver }: { ver: number }) {
  const nav = useNav();
  const [rows, setRows] = useState<ClubEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    void supabase.rpc('club_event_list').then((r: { data: unknown; error: { message: string } | null }) => {
      if (r.error) return setError(clubEventErr(r.error.message));
      setRows((r.data ?? []) as ClubEvent[]);
    });
  }, [ver, reload]);
  if (error) return <Failure title="Не удалось загрузить мероприятия" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} />;
  return (
    <main className="page">
      <h1>Мероприятия</h1>
      <button type="button" className="ks-btn" onClick={() => nav.push('ce.form')}>Новое мероприятие</button>
      {!rows ? <Loading /> : rows.length === 0 ? <EmptyState icon="trophy" title="Мероприятий пока нет" text="Создайте мероприятие кнопкой выше." /> : rows.map(e => (
        <ListRow
          key={e.id}
          avatar="М"
          title={e.name}
          sub={[
            [whenText(e.starts_on, e.starts_time), e.place].filter(Boolean).join(' · '),
            `Участников: ${e.active_count ?? 0} · ${seatsText(e)}`,
            ...(e.over_limit ? [<Pill key="o" tone="warning">Превышение лимита</Pill>] : []),
          ]}
          end={<Pill tone={STATUS_TONE[e.status]}>{STATUS_LABEL[e.status]}</Pill>}
          onClick={() => nav.push('ce.event', { id: e.id })}
        />
      ))}
    </main>
  );
}

interface FormState { name: string; description: string; date: string; time: string; place: string; price: string; deadline: string; capacity: string; groups: string[]; status: 'draft' | 'active'; reason: string }

function EventForm({ id, onBack, onDone }: { id: string | null; onBack: () => void; onDone: () => void }) {
  const [ev, setEv] = useState<ClubEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    void supabase.rpc('club_event_get', { p_id: id }).then((r: { data: unknown; error: { message: string } | null }) => {
      if (r.error) return setError(clubEventErr(r.error.message));
      setEv(r.data as ClubEvent);
    });
  }, [id]);
  if (error) return <Failure title="Не удалось открыть мероприятие" text={error} onRetry={onBack} />;
  if (id && !ev) return <Loading />;
  return <EventFormBody ev={ev} onBack={onBack} onDone={onDone} />;
}

function EventFormBody({ ev, onBack, onDone }: { ev: ClubEvent | null; onBack: () => void; onDone: () => void }) {
  const [f, setF] = useState<FormState>({
    name: ev?.name ?? '', description: ev?.description ?? '', date: ev?.starts_on ?? '', time: ev?.starts_time?.slice(0, 5) ?? '', place: ev?.place ?? '',
    price: ev ? String(num(ev.base_price)) : '0', deadline: ev?.signup_deadline?.slice(0, 16) ?? '', capacity: ev?.capacity != null ? String(ev.capacity) : '',
    groups: ev?.group_ids ?? [], status: 'draft', reason: '',
  });
  const [groups, setGroups] = useState<Group[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { ask, dialog } = useConfirm();
  useDirtySignature(JSON.stringify(f));
  useEffect(() => {
    void supabase.from('groups').select('id, name').order('name').then((r: { data: Group[] | null }) => setGroups(r.data ?? []));
  }, []);

  const price = parseMoney(f.price);
  const cap = f.capacity.trim() === '' ? null : Number(f.capacity);
  const priceChanged = Boolean(ev) && moneyOk(price) && price !== num(ev?.base_price);
  const valid = f.name.trim().length > 0 && Boolean(f.date) && moneyOk(price) && f.price.trim() !== '' && (cap === null || (Number.isInteger(cap) && cap >= 1))
    && (!priceChanged || f.reason.trim().length >= 3);

  const save = async () => {
    setBusy(true);
    setErr(null);
    const common = { name: f.name, description: f.description.trim() || null, place: f.place.trim() || null, base_price: price, signup_deadline: f.deadline || null, capacity: cap, group_ids: f.groups, starts_time: f.time || null };
    if (!ev) {
      const r = await supabase.rpc('club_event_create', { p_name: common.name, p_description: common.description, p_date: f.date, p_time: common.starts_time, p_place: common.place, p_price: price, p_deadline: common.signup_deadline, p_capacity: cap, p_group_ids: f.groups, p_status: f.status });
      setBusy(false);
      if (r.error) return setErr(clubEventErr(r.error.message));
      return onDone();
    }
    const patch = { ...common, starts_on: f.date };
    const call = (confirm: boolean) => supabase.rpc('club_event_update', { p_id: ev.id, p_patch: patch, p_reason: priceChanged ? f.reason.trim() : null, p_confirm: confirm });
    let r = await call(false);
    if (!r.error && r.data && r.data.applied === false) {
      const w = (r.data.warnings ?? []) as { code: string; affected?: number; active?: number; capacity?: number }[];
      const notes = w.map(x => x.code === 'date_change' ? `Дата или время изменятся у активных записей: ${x.affected}. Записи не отменяются.` : `Лимит ${x.capacity} меньше числа активных записей (${x.active}). Записи не отменяются.`);
      setBusy(false);
      if (!(await ask({ title: 'Подтвердить изменения?', lines: [['Мероприятие', ev.name]], note: notes.join(' '), confirmLabel: 'Подтвердить' }))) return;
      setBusy(true);
      r = await call(true);
    }
    setBusy(false);
    if (r.error) return setErr(clubEventErr(r.error.message));
    onDone();
  };

  const toggle = (gid: string) => setF(s => ({ ...s, groups: s.groups.includes(gid) ? s.groups.filter(x => x !== gid) : [...s.groups, gid] }));
  return (
    <main className="page">
      <BackNav onBack={onBack} managed />
      <h1>{ev ? 'Правка мероприятия' : 'Новое мероприятие'}</h1>
      <label className="field">Название<input value={f.name} maxLength={200} onChange={e => setF({ ...f, name: e.target.value })} /></label>
      <ExpandableTextarea label="Описание" value={f.description} maxLength={2000} rows={3} onChange={v => setF({ ...f, description: v })} />
      <div className="two">
        <label className="field">Дата<input type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></label>
        <label className="field">Время<input type="time" value={f.time} onChange={e => setF({ ...f, time: e.target.value })} /></label>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>Время можно не указывать.</p>
      <label className="field">Место<input value={f.place} maxLength={200} onChange={e => setF({ ...f, place: e.target.value })} /></label>
      <div className="two">
        <label className="field">Цена, ₾<input inputMode="decimal" value={f.price} onChange={e => setF({ ...f, price: e.target.value })} /></label>
        <label className="field">Лимит мест<input inputMode="numeric" value={f.capacity} placeholder="без лимита" onChange={e => setF({ ...f, capacity: e.target.value })} /></label>
      </div>
      {priceChanged && <label className="field">Причина изменения цены (обязательно)<input value={f.reason} maxLength={200} onChange={e => setF({ ...f, reason: e.target.value })} /></label>}
      <label className="field">Запись до<input type="datetime-local" value={f.deadline} onChange={e => setF({ ...f, deadline: e.target.value })} /></label>
      <fieldset style={{ border: 0, padding: 0, margin: '12px 0 0' }}>
        <legend className="muted" style={{ fontSize: 13 }}>Для групп (пусто — весь клуб)</legend>
        {groups.map(g => (
          <label key={g.id} style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}>
            <input type="checkbox" checked={f.groups.includes(g.id)} onChange={() => toggle(g.id)} /> {g.name}
          </label>
        ))}
      </fieldset>
      {!ev && <Segmented label="Статус при создании" value={f.status} onChange={v => setF({ ...f, status: v })} items={[{ value: 'draft', label: 'Черновик' }, { value: 'active', label: 'Активное' }]} />}
      {dialog}
      {err && <p className="error">{err}</p>}
      <button type="button" className="ks-btn" disabled={busy || !valid} onClick={() => void save()}>{ev ? 'Сохранить' : 'Создать'}</button>
    </main>
  );
}

type Tab = 'people' | 'finance';

function EventView({ id, index, ver, onBack }: { id: string; index: number; ver: number; onBack: () => void }) {
  const nav = useNav();
  const [tab, setTab] = useNavState<Tab>('ce.tab', 'people', { entry: index, persist: { kind: 'enum', values: ['people', 'finance'] } });
  const [rec, setRec] = useState<'active' | 'cancelled'>('active');
  const [ev, setEv] = useState<ClubEvent | null>(null);
  const [parts, setParts] = useState<Participant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actErr, setActErr] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const { ask, dialog } = useConfirm();

  useEffect(() => {
    void Promise.all([supabase.rpc('club_event_get', { p_id: id }), supabase.rpc('club_event_participants_list', { p_event: id })]).then(([e, p]: { data: unknown; error: { message: string } | null }[]) => {
      if (e.error || p.error) return setError(clubEventErr((e.error ?? p.error)!.message));
      setEv(e.data as ClubEvent);
      setParts((p.data ?? []) as Participant[]);
    });
  }, [id, ver, reload]);
  const refresh = () => setReload(n => n + 1);

  if (error) return <Failure title="Не удалось загрузить мероприятие" text={error} onRetry={() => { setError(null); refresh(); }} back={<BackNav onBack={onBack} managed />} />;
  if (!ev || !parts) return <main className="page"><BackNav onBack={onBack} managed /><Loading /></main>;

  if (nav.top.screen === 'ce.person') {
    const p = parts.find(x => x.id === nav.top.params.id);
    if (p) return <PersonCard ev={ev} p={p} onBack={() => nav.back()} onChanged={refresh} />;
  }
  if (nav.top.screen === 'ce.add') return <AddPeople ev={ev} parts={parts} mode={nav.top.params.mode === 'group' ? 'group' : 'player'} onBack={() => nav.back()} onDone={() => { nav.back(); refresh(); }} />;

  const setStatus = async (to: EventStatus) => {
    const copy: Partial<Record<EventStatus, { title: string; note: string; label: string; danger?: boolean }>> = {
      cancelled: { title: 'Отменить мероприятие?', note: 'Записи и платежи сохранятся. Возвраты в приложении недоступны.', label: 'Отменить мероприятие', danger: true },
      finished: { title: 'Завершить мероприятие?', note: 'Записи и платежи сохранятся. Оплаты по-прежнему принимаются.', label: 'Завершить' },
    };
    const c = copy[to];
    if (c && !(await ask({ title: c.title, lines: [['Мероприятие', ev.name]], note: c.note, confirmLabel: c.label, danger: c.danger }))) return;
    setActErr(null);
    const r = await supabase.rpc('club_event_set_status', { p_id: ev.id, p_to: to });
    if (r.error) return setActErr(clubEventErr(r.error.message));
    refresh();
  };

  const shown = parts.filter(p => p.status === rec);
  const debtors = parts.filter(p => num(p.debt) > 0);
  const fin = ev.finance;
  return (
    <main className="page">
      <BackNav onBack={onBack} managed />
      <h1>{ev.name}</h1>
      <p><Pill tone={STATUS_TONE[ev.status]}>{STATUS_LABEL[ev.status]}</Pill></p>
      <p>{[whenText(ev.starts_on, ev.starts_time), ev.place].filter(Boolean).join(' · ')}</p>
      <p className="muted">Цена: {gel(ev.base_price)}{ev.signup_deadline ? ` · запись до ${deadlineText(ev.signup_deadline)}` : ''}</p>
      <p className="muted">{ev.club_wide ? 'Весь клуб' : (ev.group_names ?? []).join(', ')} · {seatsText(ev)}{ev.over_limit ? ' · превышение лимита' : ''}</p>
      {ev.description && <p>{ev.description}</p>}
      <div className="ks-btns">
        {ev.status === 'draft' && <button type="button" className="ks-btn" onClick={() => void setStatus('active')}>Сделать активным</button>}
        {ev.status === 'active' && <button type="button" className="ks-btn" onClick={() => void setStatus('finished')}>Завершить</button>}
        {ev.status === 'active' && <button type="button" className="ks-btn secondary" onClick={() => void setStatus('cancelled')}>Отменить</button>}
        {ev.status === 'cancelled' && <button type="button" className="ks-btn" onClick={() => void setStatus('active')}>Активировать снова</button>}
        <button type="button" className="ks-btn secondary" onClick={() => nav.push('ce.form', { id: ev.id })}>Редактировать</button>
      </div>
      {actErr && <p className="error">{actErr}</p>}
      {dialog}
      <Segmented label="Раздел" value={tab} onChange={setTab} items={[{ value: 'people', label: 'Участники' }, { value: 'finance', label: 'Финансы' }]} />
      {tab === 'people' && (
        <>
          <div className="ks-btns">
            <button type="button" className="ks-btn" disabled={ev.status !== 'active'} onClick={() => nav.push('ce.add', { mode: 'player' })}>Добавить игрока</button>
            <button type="button" className="ks-btn secondary" disabled={ev.status !== 'active'} onClick={() => nav.push('ce.add', { mode: 'group' })}>Добавить группу</button>
          </div>
          {ev.status !== 'active' && <p className="muted" style={{ fontSize: 13 }}>Записывать игроков можно только в активное мероприятие.</p>}
          <Segmented label="Записи" value={rec} onChange={setRec} items={[{ value: 'active', label: 'Активные' }, { value: 'cancelled', label: 'Отменённые' }]} />
          {shown.length === 0 ? <EmptyState icon="users" title={rec === 'active' ? 'Участников пока нет' : 'Отменённых записей нет'} /> : shown.map(p => (
            <ListRow
              key={p.id}
              avatar={p.full_name}
              title={p.full_name}
              sub={[
                `${p.group_name ?? 'Без группы'} · ${gel(p.price)}`,
                num(p.debt) > 0 ? `Долг ${gel(p.debt)}` : num(p.overpay) > 0 ? `Переплата ${gel(p.overpay)}` : 'Оплачено',
                ...(p.not_in_group ? [<Pill key="g" tone="warning">Не из группы мероприятия</Pill>] : []),
              ]}
              end={<Pill tone={RECORD_TONE[p.status]}>{RECORD_LABEL[p.status]}</Pill>}
              onClick={() => nav.push('ce.person', { id: p.id })}
            />
          ))}
        </>
      )}
      {tab === 'finance' && fin && (
        <section className="ks-card">
          <p><b>Принято: {gel(fin.counted)}</b></p>
          <p>Долг: {gel(fin.debt)}</p>
          <p>Переплата: {gel(fin.overpay)}</p>
          <p className="muted" style={{ fontSize: 13 }}>Переплата не вычитается из долга других игроков.</p>
          {debtors.length > 0 && <h2>Долги по игрокам</h2>}
          {debtors.map(p => <ListRow key={p.id} title={p.full_name} sub={[`Долг ${gel(p.debt)}`]} end={p.status === 'cancelled' ? <Pill tone="danger">Отменена</Pill> : undefined} onClick={() => nav.push('ce.person', { id: p.id })} />)}
        </section>
      )}
    </main>
  );
}

function AddPeople({ ev, parts, mode, onBack, onDone }: { ev: ClubEvent; parts: Participant[]; mode: 'player' | 'group'; onBack: () => void; onDone: () => void }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<{ id: string; full_name: string; groups?: { name: string } | null }[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [gid, setGid] = useState('');
  const seq = useRef(0);
  const [pre, setPre] = useState<{ group: string; add_count: number; over_limit: boolean; to_add: { player_id: string; full_name: string }[]; skipped: { player_id: string; full_name: string; reason: string }[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { ask, dialog } = useConfirm();

  useEffect(() => {
    if (mode !== 'player' || q.trim().length < 2) return setFound([]);
    void supabase.from('players').select('id, full_name, groups(name)').eq('status', 'active').ilike('full_name', `%${q.trim()}%`).order('full_name').limit(8).then((r: { data: unknown }) => setFound((r.data ?? []) as typeof found));
  }, [q, mode]);
  useEffect(() => {
    if (mode === 'group') void supabase.from('groups').select('id, name').order('name').then((r: { data: Group[] | null }) => setGroups(r.data ?? []));
  }, [mode]);

  const pick = async (p: { id: string; full_name: string }) => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    let r = await supabase.rpc('club_event_participant_add', { p_event: ev.id, p_player: p.id, p_confirm: false });
    if (!r.error && r.data?.applied === false) {
      setBusy(false);
      if (!(await ask({ title: 'Игрок не из групп мероприятия', lines: [['Игрок', p.full_name], ['Мероприятие', ev.name]], note: 'Его можно добавить: в списке останется отметка.', confirmLabel: 'Добавить' }))) return;
      setBusy(true);
      r = await supabase.rpc('club_event_participant_add', { p_event: ev.id, p_player: p.id, p_confirm: true });
    }
    setBusy(false);
    if (r.error) return setErr(clubEventErr(r.error.message));
    onDone();
  };

  const choose = async (v: string) => {
    const mine = ++seq.current; // устаревший ответ предпросмотра другой группы игнорируется
    setGid(v);
    setPre(null);
    setErr(null);
    if (!v) return;
    const r = await supabase.rpc('club_event_group_preview', { p_event: ev.id, p_group: v });
    if (mine !== seq.current) return;
    if (r.error) return setErr(clubEventErr(r.error.message));
    setPre({ ...r.data, group: v });
  };
  const addGroup = async () => {
    if (busy || !pre || pre.group !== gid) return;
    setBusy(true);
    const r = await supabase.rpc('club_event_group_add', { p_event: ev.id, p_group: gid });
    setBusy(false);
    if (r.error) return setErr(clubEventErr(r.error.message));
    onDone();
  };

  const have = new Set(parts.map(p => p.player_id));
  return (
    <main className="page">
      <BackNav onBack={onBack} managed />
      <h1>{mode === 'group' ? 'Добавить группу' : 'Добавить игрока'}</h1>
      <p className="muted">{ev.name}</p>
      {dialog}
      {mode === 'player' && (
        <>
          <label className="field">Поиск игрока<input value={q} placeholder="Фамилия или имя" onChange={e => setQ(e.target.value)} /></label>
          {found.filter(p => !have.has(p.id)).map(p => <ListRow key={p.id} avatar={p.full_name} title={p.full_name} sub={[p.groups?.name ?? 'Без группы']} onClick={() => void pick(p)} />)}
        </>
      )}
      {mode === 'group' && (
        <>
          <label className="field">Группа
            <select value={gid} onChange={e => void choose(e.target.value)}>
              <option value="">— выберите —</option>
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
          {pre && pre.group === gid && (
            <section className="ks-card">
              <h2>Будет добавлено: {pre.add_count}</h2>
              {pre.to_add.map(x => <p key={x.player_id}>{x.full_name}</p>)}
              {pre.skipped.length > 0 && <h2>Пропущены</h2>}
              {pre.skipped.map(x => <p key={x.player_id}>{x.full_name} <Pill>{x.reason === 'already' ? 'Уже участвует' : 'Не занимается'}</Pill></p>)}
              {pre.over_limit && <p className="error">Лимит будет превышен: группу целиком добавить нельзя. Ничего не будет добавлено.</p>}
              <button type="button" className="ks-btn" disabled={busy || pre.over_limit || pre.add_count === 0} onClick={() => void addGroup()}>Добавить {pre.add_count}</button>
            </section>
          )}
        </>
      )}
      {err && <p className="error">{err}</p>}
    </main>
  );
}

interface PayRow { id: string; amount: number | string; paid_on: string; method: string | null }
interface Bal { counted: number; debt: number; overpay: number }

function PersonCard({ ev, p, onBack, onChanged }: { ev: ClubEvent; p: Participant; onBack: () => void; onChanged: () => void }) {
  const [pays, setPays] = useState<PayRow[] | null>(null);
  const [paysErr, setPaysErr] = useState<string | null>(null);
  const [payVer, setPayVer] = useState(0);
  const [last, setLast] = useState<Bal | null>(null);
  const [priceOpen, setPriceOpen] = useState(false);
  const [np, setNp] = useState(p.individual_price != null ? String(num(p.individual_price)) : '');
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('');
  const [date, setDate] = useState(tbilisiToday());
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const req = useRef<{ sig: string; key: string } | null>(null);
  const { ask, dialog } = useConfirm();
  useDirtySignature(JSON.stringify([np, reason, amount, method, date]));

  useEffect(() => {
    void supabase.from('service_payments').select('id, amount, paid_on, method, op').eq('kind', 'event').eq('ref_id', ev.id).eq('player_id', p.player_id).eq('op', 'payment').order('paid_on', { ascending: true })
      .then((r: { data: PayRow[] | null; error: { message: string } | null }) => {
        if (r.error) return setPaysErr(clubEventErr(r.error.message));
        setPaysErr(null);
        setPays(r.data ?? []);
      });
  }, [ev.id, p.player_id, payVer]);

  const bal: Bal = last ?? { counted: num(p.counted), debt: num(p.debt), overpay: num(p.overpay) };
  const cancelled = p.status === 'cancelled';
  const payable = !cancelled && (ev.status === 'active' || ev.status === 'finished');

  // Цена
  const priceTxt = np.trim();
  const newEff = priceTxt === '' ? num(p.base_price) : parseMoney(priceTxt);
  const priceOk = (priceTxt === '' || moneyOk(newEff)) && reason.trim().length >= 3 && newEff !== num(p.price) && !(cancelled && newEff < bal.counted);
  const savePrice = async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setErr(null); setMsg(null);
    const r = await supabase.rpc('club_event_participant_set_price', { p_participant: p.id, p_price: priceTxt === '' ? null : newEff, p_reason: reason.trim() });
    busyRef.current = false; setBusy(false);
    if (r.error) return setErr(clubEventErr(r.error.message));
    setLast(null); setPriceOpen(false); setReason(''); setMsg('Цена сохранена.');
    onChanged();
  };

  // Запись
  const cancelRec = async () => {
    if (!(await ask({ title: 'Отменить запись?', lines: [['Игрок', p.full_name], ['Мероприятие', ev.name]], note: 'Платежи сохранятся. Возвраты в приложении недоступны.', confirmLabel: 'Отменить запись', danger: true }))) return;
    setErr(null);
    const r = await supabase.rpc('club_event_participant_cancel', { p_participant: p.id });
    if (r.error) return setErr(clubEventErr(r.error.message));
    onChanged();
  };
  const restoreRec = async () => {
    setErr(null);
    const r = await supabase.rpc('club_event_participant_restore', { p_participant: p.id });
    if (r.error) return setErr(clubEventErr(r.error.message));
    onChanged();
  };

  // Оплата в два шага: форма, затем окно подтверждения. Один request_id на одно действие: повтор после сбоя с теми же данными его не меняет.
  const amt = parseMoney(amount);
  const payOk = payable && amount.trim() !== '' && Number.isFinite(amt) && amt > 0 && moneyOk(amt) && METHODS.includes(method) && Boolean(date) && date <= tbilisiToday();
  const pay = async () => {
    if (busyRef.current || !payOk) return;
    const ok = await ask({
      title: 'Записать платёж?',
      lines: [['Игрок', p.full_name], ['Мероприятие', ev.name], ['Сумма', gel(amt)], ['Способ', method], ['Дата платежа', fmtDate(date)]],
      note: 'Запись нельзя изменить или удалить.',
      confirmLabel: 'Записать',
    });
    if (!ok || busyRef.current) return;
    const sig = `${amt}|${method}|${date}`;
    if (!req.current || req.current.sig !== sig) req.current = { sig, key: newKey() };
    busyRef.current = true; setBusy(true); setErr(null); setMsg(null);
    const r = await supabase.rpc('club_event_pay', { p_event: ev.id, p_player: p.player_id, p_amount: amt, p_method: method, p_paid_on: date, p_request: req.current.key });
    busyRef.current = false; setBusy(false);
    if (r.error) return setErr(clubEventErr(r.error.message));
    req.current = null;
    const d = r.data as { counted: number; debt: number; overpay: number };
    setLast({ counted: num(d.counted), debt: num(d.debt), overpay: num(d.overpay) });
    setAmount(''); setMethod(''); setMsg('Платёж записан.');
    setPayVer(n => n + 1);
    onChanged();
  };

  return (
    <main className="page">
      <BackNav onBack={onBack} managed />
      <h1>{p.full_name}</h1>
      <p><Pill tone={RECORD_TONE[p.status]}>{RECORD_LABEL[p.status]}</Pill> {p.not_in_group && <Pill tone="warning">Не из группы мероприятия</Pill>}</p>
      <p className="muted">{ev.name} · {p.group_name ?? 'Без группы'}</p>
      <section className="ks-card">
        <p>Цена: <b>{gel(p.price)}</b>{p.individual_price != null ? ' (индивидуальная)' : ''}</p>
        <p>Засчитано: {gel(bal.counted)}</p>
        <p>{bal.debt > 0 ? `Долг ${gel(bal.debt)}` : bal.overpay > 0 ? `Переплата ${gel(bal.overpay)}` : 'Оплачено'}</p>
      </section>
      {msg && <p>{msg}</p>}
      {err && <p className="error">{err}</p>}
      {dialog}
      <div className="ks-btns">
        {cancelled ? <button type="button" className="ks-btn secondary" onClick={() => void restoreRec()}>Восстановить запись</button> : <button type="button" className="ks-btn secondary" onClick={() => void cancelRec()}>Отменить запись</button>}
        <button type="button" className="ks-btn secondary" onClick={() => setPriceOpen(o => !o)}>Изменить цену</button>
      </div>
      {priceOpen && (
        <section className="ks-card">
          <label className="field">Новая цена, ₾<input inputMode="decimal" value={np} placeholder={`пусто — цена мероприятия, ${gel(p.base_price)}`} onChange={e => setNp(e.target.value)} /></label>
          {cancelled && <p className="muted">Не ниже засчитанного: {gel(bal.counted)}</p>}
          {!cancelled && priceTxt !== '' && moneyOk(newEff) && newEff < bal.counted && <p className="muted">Возникнет переплата {gel(bal.counted - newEff)}</p>}
          <label className="field">Причина (обязательно)<input value={reason} maxLength={200} onChange={e => setReason(e.target.value)} /></label>
          <button type="button" className="ks-btn" disabled={busy || !priceOk} onClick={() => void savePrice()}>Сохранить цену</button>
        </section>
      )}
      <h2>Принять оплату</h2>
      <section className="ks-card">
        <label className="field">Сумма, ₾<input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></label>
        <label className="field">Способ
          <select value={method} onChange={e => setMethod(e.target.value)}>
            <option value="">— выберите —</option>
            {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="field">Дата платежа<input type="date" value={date} max={tbilisiToday()} onChange={e => setDate(e.target.value)} /></label>
        {!payable && <p className="muted">{cancelled ? 'У отменённой записи оплата не принимается.' : 'Оплаты принимаются в активном и завершённом мероприятии.'}</p>}
        <button type="button" className="ks-btn" disabled={busy || !payOk} onClick={() => void pay()}>Проверить и записать</button>
      </section>
      <h2>Платежи</h2>
      {paysErr ? <><p className="error">Не удалось загрузить платежи: {paysErr}</p><button type="button" className="ks-btn secondary" onClick={() => { setPaysErr(null); setPayVer(n => n + 1); }}>Повторить</button></> : !pays ? <Loading rows={1} /> : pays.length === 0 ? <p className="muted">Платежей пока нет.</p> : pays.map(x => <p key={x.id}>{`${fmtDate(x.paid_on)} · ${x.method ?? 'не указан'} · ${gel(x.amount)}`}</p>)}
    </main>
  );
}
