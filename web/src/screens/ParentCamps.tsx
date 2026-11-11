import { useCallback, useEffect, useRef, useState } from 'react';
import { fmtDate } from '../lib/coach';
import { campDocLink } from '../lib/campDocs';
import { supabase } from '../lib/supabase';
import { useNav, useSubEntry } from '../nav';
import { EmptyState, ListRow, Pill } from '../ui/components';
import { useConfirm } from '../ui/ConfirmSheet';
import { campErr } from './CampSelfSignup';
import { Failure, Loading } from './Message';

// Сборы родителя (Issue #470, docs/CAMP_SELF_SIGNUP_ACCEPTANCE.md, условия 49-56).
// Экран только вызывает функции базы и показывает их ответ: права, сроки, места и суммы решает база.

interface Kid { id: string; name: string; club: string | null; active: boolean }
interface Camp { id: string; club_id: string; name: string; location: string | null; starts_on: string; ends_on: string; booking_fee: number | null; booking_deadline: string | null; full_payment_deadline: string | null; active: boolean }
interface Pay { id: string; amount: number; paid_on: string | null; kind: string | null }
interface Part { id: string; camp_id: string; player_id: string | null; guest_name: string | null; owner_user_id: string | null; tariff_id: string | null; amount: number; comment: string | null; status: 'registered' | 'cancelled' | 'declined'; camp_tariffs: { name: string } | null; camp_payments: Pay[] | null }
interface Tariff { id: string; name: string; price: number; active: boolean }
interface Period { from: string | null; to: string | null; text: string }
interface Doc { id: string; title: string; version: number }

const CAMP_COLS = 'id, club_id, name, location, starts_on, ends_on, booking_fee, booking_deadline, full_payment_deadline, active';
const PART_COLS = 'id, camp_id, player_id, guest_name, owner_user_id, tariff_id, amount, comment, status, camp_tariffs(name), camp_payments(id, amount, paid_on, kind)';
const STATUS: Record<Part['status'] | 'none', { label: string; tone: 'success' | 'neutral' | 'danger' }> = {
  registered: { label: 'Записан', tone: 'success' },
  cancelled: { label: 'Отменён', tone: 'neutral' },
  declined: { label: 'Отказ', tone: 'danger' },
  none: { label: 'Не записан', tone: 'neutral' },
};
const money = (n: number) => `${Math.round(n * 100) / 100} ₾`;
const paidOf = (p: Part) => (p.camp_payments ?? []).reduce((s, x) => s + Number(x.amount), 0);
const tbilisiToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tbilisi' });
const periodText = (p: Period) => {
  const range = p.from && p.to ? `с ${fmtDate(p.from)} по ${fmtDate(p.to)}` : p.from ? `с ${fmtDate(p.from)}` : p.to ? `по ${fmtDate(p.to)}` : 'всегда';
  return `${range}: ${p.text}`;
};

// Свои дети (связь с действующим согласием) и свои записи. Администратору база отдаёт больше, поэтому фильтруем по себе.
async function loadMine(campId?: string): Promise<{ me: string; kids: Kid[]; parts: Part[] } | { error: string }> {
  const me = (await supabase.auth.getUser()).data.user?.id as string | undefined;
  if (!me) return { error: 'Нет сессии' };
  const g = await supabase.from('player_guardians').select('player_id, players(id, full_name, club_id, status)').eq('user_id', me).is('consent_revoked_at', null);
  if (g.error) return { error: g.error.message };
  const kids: Kid[] = (g.data ?? []).filter((l: any) => l.players?.id).map((l: any) => ({ id: l.players.id, name: l.players.full_name ?? '', club: l.players.club_id ?? null, active: l.players.status === 'active' }));
  const ids = kids.map(k => k.id);
  const byKid = ids.length ? supabase.from('camp_participants').select(PART_COLS).in('player_id', ids) : null;
  const byOwner = supabase.from('camp_participants').select(PART_COLS).eq('owner_user_id', me);
  const [a, b] = await Promise.all([campId && byKid ? byKid.eq('camp_id', campId) : byKid ?? Promise.resolve({ data: [], error: null }), campId ? byOwner.eq('camp_id', campId) : byOwner]);
  if (a.error) return { error: a.error.message };
  if (b.error) return { error: b.error.message };
  const seen = new Set<string>();
  const parts = ([...(a.data ?? []), ...(b.data ?? [])] as unknown as Part[]).filter(p => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  return { me, kids, parts };
}

export default function ParentCamps({ onBack }: { onBack?: () => void } = {}) {
  const nav = useNav();
  const open = useSubEntry('pc.camp');
  const [data, setData] = useState<{ camps: Camp[]; kids: Kid[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    void (async () => {
      const mine = await loadMine();
      if (!live) return;
      if ('error' in mine) return setError(mine.error);
      const c = await supabase.from('camps').select(CAMP_COLS).order('starts_on', { ascending: false }).limit(100);
      if (!live) return;
      if (c.error) return setError(c.error.message);
      const clubs = new Set(mine.kids.filter(k => k.active && k.club).map(k => k.club as string));
      const withMine = new Set(mine.parts.map(p => p.camp_id));
      const camps = ((c.data ?? []) as Camp[]).filter(x => (x.active && clubs.has(x.club_id)) || withMine.has(x.id));
      setData({ camps, kids: mine.kids });
    })();
    return () => { live = false; };
  }, [reload]);

  if (error) return <Failure title="Не удалось загрузить сборы" text={error} onRetry={() => { setError(null); setData(null); setReload(n => n + 1); }} />;
  if (!data) return <Loading title="Сборы" />;
  const camp = open ? data.camps.find(c => c.id === open.params.id) : undefined;
  if (camp) return <CampCard camp={camp} onBack={() => nav.back()} />;
  return (
    <main className="page">
      {onBack && <button type="button" className="ks-btn secondary sm" style={{ width: 'auto', marginBottom: 12 }} onClick={onBack}>← Назад</button>}
      <h1>Сборы</h1>
      {data.camps.length === 0 ? (
        <EmptyState icon="calendar" title="Сборов пока нет" text="Когда клуб объявит сбор, он появится здесь." />
      ) : (
        data.camps.map(c => (
          <ListRow key={c.id} avatar="С" title={c.name} sub={[`${fmtDate(c.starts_on)} — ${fmtDate(c.ends_on)}`, c.location ?? 'место не указано']} end={c.active ? undefined : <Pill>Прошёл</Pill>} onClick={() => nav.push('pc.camp', { id: c.id })} />
        ))
      )}
    </main>
  );
}

function CampCard({ camp, onBack }: { camp: Camp; onBack: () => void }) {
  const [mine, setMine] = useState<{ kids: Kid[]; parts: Part[] } | null>(null);
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [seats, setSeats] = useState<number | null>(null);
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload(n => n + 1), []);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [m, t, k, s] = await Promise.all([
        loadMine(camp.id),
        supabase.from('camp_tariffs').select('id, name, price, active').eq('camp_id', camp.id).order('price'),
        supabase.from('camp_cancel_terms').select('version, periods').eq('camp_id', camp.id).order('version', { ascending: false }).limit(1),
        supabase.rpc('camp_seats', { cid: camp.id }),
      ]);
      if (!live) return;
      if ('error' in m) return setError(m.error);
      if (t.error) return setError(t.error.message);
      setTariffs((t.data ?? []) as Tariff[]);
      setPeriods(k.error ? [] : (((k.data ?? [])[0]?.periods ?? []) as Period[]));
      // места: при отказе базы строку просто не показываем
      setSeats(s.error || typeof s.data !== 'number' ? null : s.data);
      setMine({ kids: m.kids, parts: m.parts });
      // документы видят только записанные участники: без записи список не запрашиваем
      if (m.parts.some(p => p.status === 'registered')) {
        const d = await supabase.rpc('camp_documents_list', { cid: camp.id });
        if (live) setDocs(d.error ? [] : ((d.data ?? []) as Doc[]));
      } else setDocs(null);
    })();
    return () => { live = false; };
  }, [camp.id, reload]);

  if (error) return <Failure title="Не удалось загрузить сбор" text={error} onRetry={() => { setError(null); refresh(); }} back={<button type="button" className="ks-btn secondary" onClick={onBack}>Назад</button>} />;
  if (!mine) return <Loading title={camp.name} />;
  const open = camp.active && camp.ends_on >= tbilisiToday();
  const activeTariffs = tariffs.filter(t => t.active);
  // Строки: свои дети этого клуба (и те, кто уже был записан), затем свои гостевые записи
  const kidRows = mine.kids
    .filter(k => (k.active && k.club === camp.club_id) || mine.parts.some(p => p.player_id === k.id))
    .map(k => ({ key: k.id, name: k.name, kid: k, part: mine.parts.find(p => p.player_id === k.id) ?? null }));
  const guestRows = mine.parts.filter(p => !p.player_id).map(p => ({ key: p.id, name: p.guest_name ?? 'Гость', kid: null, part: p }));

  return (
    <main className="page">
      <button type="button" className="ks-btn secondary sm" style={{ width: 'auto', marginBottom: 12 }} onClick={onBack}>← Сборы</button>
      <h1>{camp.name}</h1>
      <p className="muted">{fmtDate(camp.starts_on)} — {fmtDate(camp.ends_on)}{camp.location ? ` · ${camp.location}` : ''}</p>
      {seats !== null && <p>Свободно мест: {seats}</p>}
      {camp.booking_deadline && <p className="muted">Бронь{camp.booking_fee ? ` ${money(Number(camp.booking_fee))}` : ''} до {fmtDate(camp.booking_deadline)}</p>}
      {camp.full_payment_deadline && <p className="muted">Полная оплата до {fmtDate(camp.full_payment_deadline)}</p>}
      {activeTariffs.length > 0 && (
        <section className="ks-card" aria-label="Тарифы">
          <h2>Тарифы</h2>
          <ul>{activeTariffs.map(t => <li key={t.id}>{t.name}: {money(Number(t.price))}</li>)}</ul>
        </section>
      )}
      {periods.length > 0 && (
        <section className="ks-card" aria-label="Условия отмены">
          <h2>Условия отмены</h2>
          <ul>{periods.map((p, i) => <li key={i}>{periodText(p)}</li>)}</ul>
        </section>
      )}
      {[...kidRows, ...guestRows].map(r => (
        <PartRow key={r.key} name={r.name} kid={r.kid} part={r.part} camp={camp} open={open} tariffs={tariffs} periods={periods} onChanged={refresh} />
      ))}
      {docs && docs.length > 0 && <Docs docs={docs} />}
    </main>
  );
}

function PartRow(props: { name: string; kid: Kid | null; part: Part | null; camp: Camp; open: boolean; tariffs: Tariff[]; periods: Period[]; onChanged: () => void }) {
  const { name, kid, part, camp, open, tariffs, periods, onChanged } = props;
  const { ask, dialog } = useConfirm();
  const [mode, setMode] = useState<'none' | 'register' | 'edit'>('none');
  const active = tariffs.filter(t => t.active);
  const current = part?.tariff_id ? tariffs.find(t => t.id === part.tariff_id) : undefined;
  const choices = current && !current.active ? [...active, current] : active;
  const [tid, setTid] = useState('');
  const [cmt, setCmt] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const status = part?.status ?? 'none';
  const paid = part ? paidOf(part) : 0;
  const canRegister = open && kid !== null && kid.active && kid.club === camp.club_id && (status === 'none' || status === 'cancelled') && active.length > 0;
  const canChange = open && status === 'registered';

  const run = async (fn: () => Promise<{ ok: boolean; text: string } | null>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const r = await fn();
      if (r) {
        setMsg(r);
        if (r.ok) {
          setMode('none');
          onChanged();
        }
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const startRegister = () => { setMsg(null); setTid(active[0]?.id ?? ''); setCmt(''); setMode('register'); };
  const startEdit = () => { setMsg(null); setTid(part?.tariff_id ?? ''); setCmt(part?.comment ?? ''); setMode('edit'); };

  const register = () => run(async () => {
    const t = tariffs.find(x => x.id === tid);
    if (!t || !kid) return { ok: false, text: 'Выберите тариф.' };
    const ok = await ask({ title: 'Записать на сбор?', lines: [['Ребёнок', name], ['Сбор', camp.name], ['Тариф', t.name], ['Сумма', money(Number(t.price))]], note: 'Сумма берётся из тарифа.', confirmLabel: 'Записать' });
    if (!ok) return null;
    const r = await supabase.rpc('camp_parent_register', { cid: camp.id, p: kid.id, tid: t.id, cmt: cmt.trim() || null });
    return r.error ? { ok: false, text: campErr(r.error.message) } : { ok: true, text: 'Ребёнок записан на сбор.' };
  });

  const save = () => run(async () => {
    if (!part) return null;
    const r = await supabase.rpc('camp_parent_update', { pid: part.id, tid: tid || null, cmt: cmt.trim() || null });
    return r.error ? { ok: false, text: campErr(r.error.message) } : { ok: true, text: 'Запись изменена.' };
  });

  const cancel = () => run(async () => {
    if (!part) return null;
    const ok = await ask({
      title: 'Отменить запись?',
      lines: [['Ребёнок', name], ['Сбор', camp.name], ['Внесено', money(paid)]],
      note: periods.length ? `Условия отмены: ${periods.map(periodText).join('; ')}. Сумму возврата определяет администратор.` : 'Сумму возврата определяет администратор.',
      confirmLabel: 'Отменить запись',
      danger: true,
    });
    if (!ok) return null;
    const r = await supabase.rpc('camp_parent_cancel', { pid: part.id });
    if (r.error) return { ok: false, text: campErr(r.error.message) };
    const terms = (r.data as { terms?: { text?: string } | null } | null)?.terms?.text;
    return { ok: true, text: `Запись отменена.${terms ? ` Условия на сегодня: ${terms}.` : ''} Сумму возврата определяет администратор.` };
  });

  const form = (submitLabel: string, onSubmit: () => void) => (
    <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
      {mode === 'edit' && camp.full_payment_deadline && <p className="muted">Сменить тариф можно до {fmtDate(camp.full_payment_deadline)}.</p>}
      <label>
        Тариф
        <select className="ks-input" value={tid} onChange={e => setTid(e.target.value)}>
          {choices.map(t => <option key={t.id} value={t.id}>{t.name} — {money(Number(t.price))}</option>)}
        </select>
      </label>
      <label>
        Комментарий
        <textarea className="ks-input" maxLength={500} value={cmt} onChange={e => setCmt(e.target.value)} />
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="ks-btn" disabled={busy} onClick={onSubmit}>{submitLabel}</button>
        <button type="button" className="ks-btn secondary" disabled={busy} onClick={() => setMode('none')}>Закрыть</button>
      </div>
    </div>
  );

  return (
    <section className="ks-card" aria-label={name}>
      <h2 style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{name} <Pill tone={STATUS[status].tone}>{STATUS[status].label}</Pill></h2>
      {part && (
        <>
          <p className="muted">Тариф: {part.camp_tariffs?.name ?? '—'}{part.comment ? ` · ${part.comment}` : ''}</p>
          <p>Сумма: {money(Number(part.amount))} · внесено: {money(paid)} · остаток: {money(Math.max(Number(part.amount) - paid, 0))}</p>
          {(part.camp_payments ?? []).length > 0 && (
            <ul aria-label="Платежи">
              {[...(part.camp_payments ?? [])].sort((a, b) => String(a.paid_on).localeCompare(String(b.paid_on))).map(x => (
                <li key={x.id}>{x.paid_on ? fmtDate(x.paid_on) : '—'}: {Number(x.amount) < 0 || x.kind === 'refund' ? `возврат ${money(Math.abs(Number(x.amount)))}` : money(Number(x.amount))}</li>
              ))}
            </ul>
          )}
        </>
      )}
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? undefined : 'error'}>{msg.text}</p>}
      {mode === 'register' && form('Записать на сбор', () => void register())}
      {mode === 'edit' && form('Сохранить', () => void save())}
      {mode === 'none' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          {canRegister && <button type="button" className="ks-btn" onClick={startRegister}>Записать</button>}
          {canChange && <button type="button" className="ks-btn secondary" onClick={startEdit}>Изменить запись</button>}
          {canChange && <button type="button" className="ks-btn secondary" disabled={busy} onClick={() => void cancel()}>Отменить запись</button>}
        </div>
      )}
      {dialog}
    </section>
  );
}

function Docs({ docs }: { docs: Doc[] }) {
  const [msg, setMsg] = useState<string | null>(null);
  const openDoc = async (d: Doc) => {
    setMsg(null);
    const r = await campDocLink(d.id);
    if (!r.ok) return setMsg(campErr(r.error));
    window.open(r.data.url, '_blank', 'noopener');
  };
  return (
    <section className="ks-card" aria-label="Документы">
      <h2>Документы</h2>
      <ul>
        {docs.map(d => (
          <li key={d.id} style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
            <span>{d.title} · версия {d.version}</span>
            <button type="button" className="ks-btn secondary sm" style={{ width: 'auto' }} onClick={() => void openDoc(d)}>Открыть</button>
          </li>
        ))}
      </ul>
      {msg && <p role="alert" className="error">{msg}</p>}
    </section>
  );
}
