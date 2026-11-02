import { useCallback, useEffect, useState } from 'react';
import { coachError, fmtDate, today } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { EmptyState, ListRow, Pill, SearchInput } from '../ui/components';
import { useConfirm } from '../ui/ConfirmSheet';
import { BackNav } from '../ui/nav';
import { Failure, Loading } from './Message';
import { gel, monthIso, monthName, nextMonth, SEASON_START, tariffFor } from './MonthPayments';

interface Pl { id: string; full_name: string; group_id: string | null; groups: { name: string } | null; external_id?: string | null; birth_date?: string | null; status?: string }
interface Due { key: string; kind: 'sub' | 'eq' | 'ind' | 'extra' | 'camp'; section: string; title: string; sub?: string; due: number; paid: number; month?: string; advance?: boolean; pay: (amount: number, method: string, date: string) => PromiseLike<{ error: { message: string } | null }>; discount?: () => PromiseLike<{ error: { message: string } | null }> }

const METHODS = ['Наличные', 'Перевод'];
const PAY_METHODS = ['Наличные', 'Перевод'];
const JUMPS = [
  { label: 'Абонемент', section: 'Абонемент' }, { label: 'Экипировка', section: 'Экипировка' },
  { label: 'Индивидуальные', section: 'Индивидуальные и вратари' }, { label: 'Дополнительные', section: 'Дополнительные тренировки' },
];
const r2 = (n: number) => Math.round(n * 100) / 100;
const SECTIONS = ['Абонемент', 'Экипировка', 'Индивидуальные и вратари', 'Дополнительные тренировки', 'Сборы'];
const errText = (m: string) => (m.includes('paid above total') ? 'Оплата больше суммы заказа.' : m.includes('bad amount') ? 'Сумма указана неверно.' : coachError(m));

/** Всё, что игрок должен: абонемент по месяцам, заказы экипировки, занятия и сборы. Платёж по строке идёт в нужный раздел. */
async function loadDues(p: Pl): Promise<Due[]> {
  const out: Due[] = [];
  const noSub = (p.groups?.name ?? '').trim().toLowerCase() === 'индивидуальные / вратарские';
  const [prices, pays, subs, orders, ind, extra, camps] = await Promise.all([
    supabase.from('prices').select('group_id, amount, valid_from, valid_to').eq('kind', 'subscription'),
    supabase.from('payments').select('amount, paid_on, pay_month').eq('player_id', p.id).limit(1000),
    supabase.from('subscriptions').select('month, group_id, discount, written_off').eq('player_id', p.id),
    supabase.from('equipment_orders').select('id, ordered_on, total, paid, equipment_order_lines(kit)').eq('player_id', p.id),
    supabase.from('individual_bookings').select('session_id, amount, paid, individual_sessions(starts_at, goalkeepers)').eq('player_id', p.id).eq('paid', false),
    supabase.from('extra_bookings').select('session_id, paid, extra_sessions(starts_on, amount)').eq('player_id', p.id).eq('paid', false),
    supabase.from('camp_participants').select('id, amount, status, camps(name), camp_payments(amount)').eq('player_id', p.id).eq('status', 'registered'),
  ]);
  const bad = [prices, pays, subs, orders, ind, extra, camps].find(r => r.error);
  if (bad?.error) throw new Error(bad.error.message);

  if (!noSub) {
    const pr = ((prices.data ?? []) as { group_id: string | null; amount: number; valid_from: string; valid_to: string | null }[]).map(x => ({ ...x, amount: Number(x.amount) }));
    const paidBy = new Map<string, number>();
    ((pays.data ?? []) as { amount: number; paid_on: string; pay_month?: string | null }[]).forEach(x => { const m = x.pay_month ?? monthIso(new Date(x.paid_on + 'T12:00:00')); paidBy.set(m, (paidBy.get(m) ?? 0) + Number(x.amount)); });
    const sb = new Map(((subs.data ?? []) as { month: string; group_id: string | null; discount: boolean; written_off: boolean }[]).map(s => [s.month, s]));
    const cur = monthIso(new Date());
    for (let m = SEASON_START; m <= nextMonth(cur); m = nextMonth(m)) {
      const s = sb.get(m);
      // ушедшему игроку текущий и будущий месяцы долгом не считаются, пока нет строки абонемента или платежа
      if ((m < cur || (p.status ?? 'active') !== 'active') && !s && (paidBy.get(m) ?? 0) <= 0) continue; // прошлый месяц без строки абонемента и без внесённых денег (платёж и его отмена дают 0) долгом не считается
      const gid = s?.group_id ?? p.group_id;
      const tariff = gid ? tariffFor(pr, gid, m) : null;
      if (tariff === null || s?.written_off) continue;
      const got = paidBy.get(m) ?? 0;
      if (s?.discount) continue; // скидка закрывает месяц и без платежа (0093)
      if (got >= tariff) continue;
      out.push({
        key: 'sub' + m, kind: 'sub', section: SECTIONS[0], title: m > cur ? `${monthName(m)} (вперёд)` : monthName(m), sub: s?.discount ? 'скидка по договорённости: оплатите любую сумму' : m > cur ? 'оплата вперёд: дата — день, когда внесли деньги' : undefined, due: tariff, paid: got, month: m, advance: m > cur,
        pay: (amount, method, date) => supabase.from('payments').insert({ player_id: p.id, amount: r2(amount), paid_on: date, for_month: m, method }),
        discount: () => supabase.from('subscriptions').upsert({ player_id: p.id, month: m, discount: true, closed_kind: 'discount', closed_reason: 'скидка при приёме оплаты в кассе' }, { onConflict: 'player_id,month' }),
      });
    }
  }
  ((orders.data ?? []) as unknown as { id: string; ordered_on: string | null; total: number; paid: number; equipment_order_lines: { kit: string }[] }[]).forEach(o => {
    if (Number(o.paid) >= Number(o.total)) return;
    out.push({ key: 'eq' + o.id, kind: 'eq', section: SECTIONS[1], title: [...new Set(o.equipment_order_lines.map(l => l.kit))].join(' + ') || 'Заказ', sub: o.ordered_on ? fmtDate(o.ordered_on) : undefined, due: Number(o.total), paid: Number(o.paid), pay: (amount, method, date) => supabase.rpc('eq_add_payment', { o: o.id, amt: r2(amount), d: date, mth: method }) });
  });
  const nowLocal = `${today()}T${new Date().toTimeString().slice(0, 5)}`;
  ((ind.data ?? []) as unknown as { session_id: string; amount: number; individual_sessions: { starts_at: string; goalkeepers: boolean } | null }[]).forEach(b => {
    if (!b.individual_sessions || b.individual_sessions.starts_at > nowLocal) return;
    out.push({ key: 'ind' + b.session_id, kind: 'ind', section: SECTIONS[2], title: `${b.individual_sessions.goalkeepers ? 'Вратари' : 'Индивидуальное'} ${fmtDate(b.individual_sessions.starts_at.slice(0, 10))}`, due: Number(b.amount), paid: 0, pay: (_amount, method, date) => supabase.rpc('ind_set_paid', { s: b.session_id, p: p.id, is_paid: true, mth: method, d: date }) });
  });
  ((extra.data ?? []) as unknown as { session_id: string; extra_sessions: { starts_on: string; amount: number } | null }[]).forEach(b => {
    if (!b.extra_sessions || b.extra_sessions.starts_on > today() || Number(b.extra_sessions.amount) <= 0) return;
    out.push({ key: 'ex' + b.session_id, kind: 'extra', section: SECTIONS[3], title: `Доп. тренировка ${fmtDate(b.extra_sessions.starts_on)}`, due: Number(b.extra_sessions.amount), paid: 0, pay: (amount, method, date) => supabase.rpc('extra_set_paid', { s: b.session_id, p: p.id, is_paid: true, mth: method, amt: r2(amount), d: date }) });
  });
  ((camps.data ?? []) as unknown as { id: string; amount: number; camps: { name: string } | null; camp_payments: { amount: number }[] }[]).forEach(c => {
    const got = c.camp_payments.reduce((s, x) => s + Number(x.amount), 0);
    if (got >= Number(c.amount)) return;
    out.push({ key: 'camp' + c.id, kind: 'camp', section: SECTIONS[4], title: c.camps?.name ?? 'Сбор', due: Number(c.amount), paid: got, pay: (amount, method, date) => supabase.rpc('camp_pay', { pid: c.id, amt: r2(amount), k: 'payment', d: date, mth: method, cmt: null }) });
  });
  return out;
}

// время записи платежа по Тбилиси, ЧЧ:ММ
const timeOf = (iso: string) => new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tbilisi' }).format(new Date(iso));
const dayOf = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tbilisi' }).format(new Date(iso)); // YYYY-MM-DD по Тбилиси
// время записи: если внесено в тот же день, что и оплата, только время; иначе «внесено 02.11 08:41», чтобы вчерашняя оплата не выглядела сегодняшней
const whenOf = (iso: string, payDay: string) => dayOf(iso) === payDay ? timeOf(iso) : `внесено ${fmtDate(dayOf(iso))} ${timeOf(iso)}`;
type TodayRow = { id: string; amount: number; method: string | null; recorded_at?: string | null; what: string; kind?: string; player_id?: string; pay_month?: string | null; cancels?: string | null; cancelled?: boolean; detail?: string; sub?: string; players: { full_name: string } | null };
const monthShort = (iso: string) => `${iso.slice(5, 7)}.${iso.slice(2, 4)}`; // 2026-10-01 → 10.26
const CAMP_KIND: Record<string, string> = { booking: 'Бронь', payment: 'Оплата', refund: 'Возврат' };
// «Абонемент 10.26, U7-A, Оплата, Перевод» · «Экипировка: Форма + Куртка, Наличные» · «Индивидуальное, U9-A, Оплата, Перевод»
function payLine(x: TodayRow, group: string | undefined, detail: string | undefined): string {
  const neg = Number(x.amount) < 0;
  const kind = neg ? 'Исправление' : x.what === 'Сбор' ? CAMP_KIND[x.kind ?? ''] ?? 'Оплата' : 'Оплата';
  const method = x.method && x.method !== 'Исправление' ? x.method : null;
  if (x.what === 'Экипировка') return [detail ? `Экипировка: ${detail}` : 'Экипировка', neg ? kind : null, method].filter(Boolean).join(', ');
  const head = x.what === 'Абонемент' ? (detail ? `Абонемент ${detail}` : 'Абонемент') : x.what === 'Сбор' && detail ? `Сбор: ${detail}` : x.what;
  return [head, group, kind, method].filter(Boolean).join(', ');
}

// «Приём оплат»: найти игрока, увидеть всё, что к оплате, и принять платёж одним шагом (миграции 0023, 0034–0037).
export default function CashDesk() {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Pl[]>([]);
  const [player, setPlayer] = useState<Pl | null>(null);
  const [day, setDay] = useState(today());
  const [payMethod, setPayMethod] = useState('');
  const [todayRows, setTodayRows] = useState<TodayRow[] | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [cancelErr, setCancelErr] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const { ask, dialog } = useConfirm();

  useEffect(() => {
    if (q.trim().length < 2) return setFound([]);
    const t = setTimeout(() => {
      void supabase.from('players').select('id, full_name, group_id, external_id, birth_date, status, groups(name)').ilike('full_name', `%${q.trim()}%`).order('full_name').limit(10).then(r => {
        if (!r.error) setFound((r.data ?? []) as unknown as Pl[]);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  // Платежи за выбранный день: абонемент (payments), сборы (camp_payments) и журнал экипировки и занятий (cash_day_service, 0086).
  // Подпись как в старом приложении: что именно, месяц абонемента, группа, вид оплаты, способ. Только чтение, без миграций.
  useEffect(() => {
    setTodayRows(null);
    void (async () => {
      const a = await supabase.from('payments').select('id, amount, method, player_id, pay_month, cancels, recorded_at, players(full_name)').eq('paid_on', day).limit(500);
      const c = await supabase.from('camp_payments').select('id, amount, method, kind, player_id, recorded_at, players(full_name), camps(name), camp_participants(guest_name)').eq('paid_on', day).limit(500);
      if (a.error) return;
      const rows = ((a.data ?? []) as unknown as { id: string; amount: number; method: string | null; player_id: string; pay_month?: string | null; cancels?: string | null; players: { full_name: string } | null }[]).map(x => ({ ...x, what: 'Абонемент' }));
      // какие платежи уже отменены записью со ссылкой cancels (отмена может быть записана в другой день)
      const cancelledIds = new Set<string>();
      const payIds = rows.filter(x => Number(x.amount) > 0).map(x => x.id);
      if (payIds.length) {
        const cx = await supabase.from('payments').select('cancels').in('cancels', payIds).limit(1000);
        for (const y of ((cx.data ?? []) as unknown as { cancels: string | null }[])) if (y.cancels) cancelledIds.add(y.cancels);
      }
      const camp = c.error ? [] : ((c.data ?? []) as unknown as { id: string; amount: number; method: string | null; kind: string; player_id?: string; players: { full_name: string } | null; camps?: { name: string } | null; camp_participants?: { guest_name: string | null } | null }[]).map(x => ({ ...x, players: x.players ?? (x.camp_participants?.guest_name ? { full_name: `${x.camp_participants.guest_name} (гость)` } : null), what: 'Сбор', detail: x.camps?.name }));
      const svc = await supabase.rpc('cash_day_service', { p_day: day });
      const service = svc.error ? [] : ((svc.data ?? []) as unknown as { id: string; amount: number; method: string | null; what: string; player_id: string; full_name: string; recorded_at?: string | null }[]).map(x => ({ id: x.id, amount: x.amount, method: x.method, what: x.what, recorded_at: x.recorded_at ?? null, player_id: x.player_id, players: { full_name: x.full_name } }));
      // все виды платежей одним списком: новые сверху по времени записи; платежи без времени (импорт) в конце
      const byTime = (x: TodayRow, y: TodayRow) => (y.recorded_at ?? '').localeCompare(x.recorded_at ?? '') || String(x.id ?? '').localeCompare(String(y.id ?? ''));
      const all: TodayRow[] = ([...rows, ...camp, ...service] as TodayRow[]).sort(byTime);
      // группа: по абонементу месяца платежа, иначе текущая группа игрока
      const ids = [...new Set(all.map(x => x.player_id).filter((v): v is string => !!v))];
      const gById = new Map<string, string>();
      const gBySub = new Map<string, string>();
      const kits = new Map<string, string[]>();
      if (ids.length) {
        const pl = await supabase.from('players').select('id, groups(name)').in('id', ids).limit(1000);
        for (const p of ((pl.data ?? []) as unknown as { id: string; groups: { name: string } | null }[])) if (p.groups?.name) gById.set(p.id, p.groups.name);
        const sb = await supabase.from('subscriptions').select('player_id, month, groups(name)').in('player_id', ids).limit(5000);
        for (const x of ((sb.data ?? []) as unknown as { player_id: string; month: string; groups: { name: string } | null }[])) if (x.groups?.name) gBySub.set(`${x.player_id}|${x.month}`, x.groups.name);
        if (all.some(x => x.what === 'Экипировка')) {
          const eq = await supabase.from('equipment_orders').select('player_id, equipment_order_lines(kit)').in('player_id', ids).limit(2000);
          const per = new Map<string, string[][]>();
          for (const o of ((eq.data ?? []) as unknown as { player_id: string; equipment_order_lines: { kit: string }[] | null }[])) per.set(o.player_id, [...(per.get(o.player_id) ?? []), (o.equipment_order_lines ?? []).map(l => l.kit)]);
          // состав показываем только когда заказ у игрока один: иначе не угадать, за какой именно платёж
          for (const [pid, list] of per) if (list.length === 1 && list[0].length) kits.set(pid, list[0]);
        }
      }
      setTodayRows(all.map(x => {
        const pid = x.player_id;
        const group = pid ? (x.what === 'Абонемент' && x.pay_month ? gBySub.get(`${pid}|${x.pay_month}`) : undefined) ?? gById.get(pid) : undefined;
        const detail = x.what === 'Абонемент' ? (x.pay_month ? monthShort(x.pay_month) : undefined) : x.what === 'Экипировка' && pid && kits.has(pid) ? (kits.get(pid) as string[]).join(' + ') : x.detail;
        const line = payLine(x, group, detail);
        return { ...x, cancelled: x.what === 'Абонемент' && cancelledIds.has(x.id), sub: x.recorded_at ? `${whenOf(x.recorded_at, day)} · ${line}` : line };
      }));
    })();
  }, [reload, player, day]);

  // Отмена оплаты абонемента — записью с минусом (журнал платежей только добавляется)
  // запись с минусом берёт способ отменяемого платежа, чтобы итоги «Наличные» и «Перевод» за день сходились
  const cancelPay = async (x: { id: string; amount: number; player_id?: string; pay_month?: string | null; method?: string | null; players?: { full_name: string } | null }) => {
    if (!x.player_id || cancelling) return;
    const ok = await ask({
      title: 'Отменить оплату?',
      lines: [['Игрок', x.players?.full_name], ['Сумма', gel(Number(x.amount))], ['Способ', x.method ?? 'Исправление'], ['Дата', fmtDate(day)]],
      note: 'Будет записана запись с минусом на ту же сумму. Саму оплату удалить нельзя.',
      confirmLabel: 'Отменить оплату',
      danger: true,
    });
    if (!ok) return;
    setCancelling(x.id);
    setCancelErr(null);
    const { error } = await supabase.from('payments').insert({ player_id: x.player_id, amount: -Number(x.amount), paid_on: day, cancels: x.id, ...(x.pay_month ? { for_month: x.pay_month } : {}), method: x.method ?? 'Исправление' });
    setCancelling(null);
    if (error) {
      // запись не сохранилась: не показываем отмену, которой нет в базе. Если платёж уже отменён (повтор или параллельный клик), обновляем список
      const already = (error as { code?: string }).code === '23505' || /cancels/.test(error.message);
      setCancelErr(already ? 'Этот платёж уже отменён.' : `Отмена не записана: ${errText(error.message)}`);
      if (already) setReload(n => n + 1);
      return;
    }
    setReload(n => n + 1);
  };
  const total = (todayRows ?? []).reduce((s, x) => s + Number(x.amount), 0);
  // платёж отменён, если на него есть запись cancels (0097). Старые отмены без ссылки ищем по игроку и сумме за этот день (повторная отмена удвоила бы минус)
  const isCancelled = (x: { id: string; amount: number; player_id?: string; what: string; cancelled?: boolean }) => {
    if (x.cancelled) return true;
    const neg = (todayRows ?? []).filter(y => y.what === x.what && y.player_id === x.player_id && !y.cancels && Number(y.amount) === -Number(x.amount)).length;
    const same = (todayRows ?? []).filter(y => y.what === x.what && y.player_id === x.player_id && !y.cancelled && Number(y.amount) === Number(x.amount)).map(y => y.id);
    return neg > 0 && same.indexOf(x.id) < neg;
  };
  return (
    <main className="page">
      <h1>Приём оплат</h1>
      {cancelErr && <p className="error" role="alert">{cancelErr}</p>}
      {player ? (
        <>
          <div className="ks-card">
            <div className="ks-line">
              <span style={{ minWidth: 0 }}><b style={{ overflowWrap: 'anywhere' }}>{player.full_name}</b><br /><span className="muted">{[player.external_id, player.groups?.name ?? 'без группы', player.birth_date ? `${player.birth_date.slice(0, 4)} г.` : null].filter(Boolean).join(' · ')}</span></span>
              <button type="button" className="ks-btn secondary sm" onClick={() => { setPlayer(null); setReload(n => n + 1); }}>Сменить</button>
            </div>
          </div>
          <p className="ks-label">Способ оплаты</p>
          <div className="two" role="group" aria-label="Способ оплаты">
            {PAY_METHODS.map(m => (
              <button type="button" key={m} className={payMethod === m ? 'ks-btn' : 'ks-btn secondary'} aria-pressed={payMethod === m} onClick={() => setPayMethod(m)}>{m}</button>
            ))}
          </div>
          <p className="ks-label">Перейти к оплате</p>
          <div className="two">
            {JUMPS.map(j => (
              <button type="button" key={j.label} className="ks-btn secondary" onClick={() => document.querySelector(`[data-sec="${j.section}"]`)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })}>{j.label}</button>
            ))}
          </div>
          <PlayerDues embedded player={player} sharedMethod={payMethod} />
        </>
      ) : (
        <>
          <SearchInput label="Игрок (введите ФИ и выберите из списка)" placeholder="Фамилия или имя (от 2 букв)" value={q} onChange={setQ} suggestions={found.map(f => f.full_name)} />
          {q.trim().length >= 2 && found.length === 0 ? (
            <EmptyState icon="search" title="Никого не найдено" text="Проверьте написание." />
          ) : (
            found.map(p => <ListRow key={p.id} avatar={p.full_name} title={p.full_name} sub={[p.groups?.name ?? 'без группы']} onClick={() => setPlayer(p)} />)
          )}
        </>
      )}
      <h2 className="ks-list-head"><span>{day === today() ? 'Внесено сегодня' : `Внесено ${fmtDate(day)}`}</span><span>{todayRows ? gel(total) : ''}</span></h2>
      <label className="field" style={{ marginBottom: 8 }}>Дата<input type="date" aria-label="Дата платежей" value={day} max={today()} onChange={e => e.target.value && setDay(e.target.value)} /></label>
      {todayRows && todayRows.length > 0 && (
        <div className="ks-tiles" style={{ marginBottom: 12, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
          <div className="ks-tile"><b>Наличные</b>{gel(todayRows.filter(x => x.method === 'Наличные').reduce((s, x) => s + Number(x.amount), 0))}</div>
          <div className="ks-tile"><b>Перевод</b>{gel(todayRows.filter(x => x.method === 'Перевод').reduce((s, x) => s + Number(x.amount), 0))}</div>
          <div className="ks-tile"><b>Всего</b>{gel(total)}</div>
        </div>
      )}
      {!todayRows ? <Loading /> : todayRows.length === 0 ? <p className="muted">В этот день платежей нет.</p> : todayRows.map(x => {
        const row = <ListRow title={x.players?.full_name ?? 'Игрок'} sub={[x.sub ?? [x.what, x.method].filter(Boolean).join(' · ')]} end={<Pill tone={Number(x.amount) < 0 ? 'danger' : 'success'}>{gel(Number(x.amount))}</Pill>} />;
        if (!(x.what === 'Абонемент' && Number(x.amount) > 0 && !isCancelled(x))) return <div key={x.what + x.id}>{row}</div>;
        // Отмена относится к этой оплате: это часть той же карточки, под разделителем.
        return (
          <div className="ks-pay-group" key={x.what + x.id}>
            {row}
            <button type="button" className="ks-pay-cancel" aria-label={`Отменить оплату: ${x.players?.full_name ?? 'игрок'}`} disabled={cancelling === x.id} onClick={() => void cancelPay(x)}>Отменить оплату</button>
          </div>
        );
      })}
      {dialog}
      <p className="ks-muted" style={{ fontSize: 13 }}>В списке оплаты за день: абонементы, сборы, экипировка и занятия. Отменить можно оплату абонемента кнопкой у строки; остальные оплаты отменяются в своих разделах.</p>
    </main>
  );
}

export function PlayerDues({ player, onBack, embedded = false, sharedMethod }: { player: Pl; onBack?: () => void; embedded?: boolean; sharedMethod?: string }) {
  const [dues, setDues] = useState<Due[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  // после записи платежа список обновляется на месте: старый список остаётся на экране, чтобы страница не сжималась и не прыгала к началу
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => { void loadDues(player).then(d => { setDues(d); setRefreshing(false); }).catch(e => { setError(e instanceof Error ? e.message : String(e)); setRefreshing(false); }); }, [player]);
  useEffect(() => { load(); }, [load, reload]);

  if (error) return <Failure title="Не удалось загрузить долги игрока" text={coachError(error)} embedded={embedded} onRetry={() => { setError(null); setDues(null); setReload(n => n + 1); }} />;
  const sum = (dues ?? []).filter(d => !d.advance).reduce((s, d) => s + (d.due - d.paid), 0);
  const Wrap = embedded ? 'div' : 'main';
  return (
    <Wrap className={embedded ? undefined : 'page'}>
      {!embedded && onBack && <BackNav onBack={onBack} />}
      {!embedded && <h1 style={{ overflowWrap: 'anywhere' }}>{player.full_name}</h1>}
      <p className="muted">{embedded ? '' : `${player.groups?.name ?? 'без группы'}`}{dues ? `${embedded ? '' : ' · '}к оплате: ${gel(sum)}` : ''}</p>
      {msg && <p className="ks-ok">{msg}</p>}
      {dues && dues.length > 0 && !dues.some(d => !d.advance) && <p className="muted">Долгов нет. Ниже можно принять оплату вперёд.</p>}
      {!dues ? <Loading /> : dues.length === 0 ? (
        <EmptyState icon="users" title="Долгов нет" text="По абонементу, экипировке, занятиям и сборам всё оплачено." />
      ) : (
        SECTIONS.filter(s => dues.some(d => d.section === s)).map(s => (
          <section key={s} data-sec={s}>
            <h2 className="ks-sub">{s}</h2>
            {dues.filter(d => d.section === s).map(d => (
              <DueCard key={d.key} due={d} who={player.full_name} sharedMethod={sharedMethod} open={openKey === d.key} onOpen={() => setOpenKey(openKey === d.key ? null : d.key)} locked={refreshing} onPaid={() => { setOpenKey(null); setMsg('Платёж записан.'); setRefreshing(true); setReload(n => n + 1); }} />
            ))}
          </section>
        ))
      )}
    </Wrap>
  );
}

function DueCard({ due, open, onOpen, onPaid, sharedMethod, who, locked = false }: { due: Due; open: boolean; onOpen: () => void; onPaid: () => void; sharedMethod?: string; who: string; locked?: boolean }) {
  const left = r2(due.due - due.paid);
  const [amount, setAmount] = useState(String(left));
  const [ownMethod, setMethod] = useState('');
  const method = sharedMethod !== undefined ? sharedMethod : ownMethod;
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { ask, dialog } = useConfirm();
  const fixedAmount = due.kind === 'ind'; // индивидуальное занятие отмечается оплаченным целиком
  const num = Number(amount.replace(',', '.'));
  const save = async () => {
    if (!method) return setErr(sharedMethod !== undefined ? 'Выберите способ оплаты вверху экрана: «Наличные» или «Перевод».' : 'Выберите способ оплаты.');
    if (!fixedAmount && (!Number.isFinite(num) || num <= 0 || num > 100000)) return setErr('Введите сумму больше нуля.');
    if (date > today()) return setErr('Дата платежа не может быть в будущем.');
    const sum = fixedAmount ? left : num;
    const ok = await ask({
      title: fixedAmount ? 'Отметить занятие оплаченным?' : 'Записать платёж?',
      lines: [['Игрок', who], ['За что', due.title], ['Сумма', gel(sum)], ['Способ', method], ['Дата', fmtDate(date)]],
      note: 'Запись нельзя изменить или удалить, ошибку исправляют записью с минусом.',
      confirmLabel: 'Записать',
    });
    if (!ok) return;
    setBusy(true);
    setErr(null);
    const r = await due.pay(fixedAmount ? left : num, method, date);
    setBusy(false);
    if (r.error) return setErr(errText(r.error.message));
    onPaid();
  };
  // «Оплатить со скидкой»: то же, что внести меньшую сумму и затем применить скидку месяца, одним действием
  const payWithDiscount = async () => {
    if (!method) return setErr(sharedMethod !== undefined ? 'Выберите способ оплаты вверху экрана: «Наличные» или «Перевод».' : 'Выберите способ оплаты.');
    if (!due.discount || !Number.isFinite(num) || num <= 0 || num >= left) return setErr('Введите сумму больше нуля и меньше остатка.');
    if (date > today()) return setErr('Дата платежа не может быть в будущем.');
    const ok = await ask({
      title: 'Оплатить со скидкой?',
      lines: [['Игрок', who], ['За что', due.title], ['Внесём', gel(num)], ['Скидка', 'месяц закрывается, остаток не считается долгом'], ['Способ', method], ['Дата', fmtDate(date)]],
      note: 'Запись нельзя изменить или удалить, ошибку исправляют записью с минусом.',
      confirmLabel: 'Оплатить',
    });
    if (!ok) return;
    setBusy(true);
    setErr(null);
    const p = await due.pay(num, method, date);
    if (p.error) { setBusy(false); return setErr(errText(p.error.message)); }
    const d = await due.discount!();
    setBusy(false);
    // платёж уже записан: повторно его не отправляем, только сообщаем об ошибке скидки
    if (d.error) return setErr(`Платёж записан, но скидку не применили (${d.error.message}). Примените скидку в «Оплатах за месяц», платёж повторять не нужно.`);
    onPaid();
  };
  return (
    <div className="ks-card ks-due">
      <div className="ks-line"><b style={{ overflowWrap: 'anywhere' }}>{due.title}</b><span role="img" aria-label={`Осталось оплатить ${gel(left)}`}><Pill tone="danger" dot>{gel(left)}</Pill></span></div>
      <div className="ks-muted" style={{ fontSize: 13 }}>{due.paid > 0 ? `Внесено ${gel(due.paid)} из ${gel(due.due)}` : `К оплате ${gel(due.due)}`}{due.sub ? ` · ${due.sub}` : ''}</div>
      <button type="button" className="ks-btn secondary" style={{ marginTop: 8 }} disabled={locked} onClick={onOpen}>{open ? 'Свернуть' : 'Принять оплату'}</button>
      {open && (
        <div style={{ marginTop: 8 }}>
          {!fixedAmount && <label className="field">Сумма, ₾ (меньше остатка — частичный платёж, останется долг)<input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></label>}
          {(() => {
            const dateField = due.kind === 'sub' || due.kind === 'camp' || due.kind === 'ind' || due.kind === 'extra' ? <label className="field">Дата<input type="date" value={date} max={today()} onChange={e => setDate(e.target.value)} /></label> : null;
            const methodField = sharedMethod !== undefined ? null : <label className="field">Способ<select value={method} onChange={e => setMethod(e.target.value)}><option value="">Выберите способ</option>{METHODS.map(m => <option key={m}>{m}</option>)}</select></label>;
            return dateField && methodField ? <div className="two pay-fields">{dateField}{methodField}</div> : dateField ?? methodField;
          })()}
          {err && <p className="error">{err}</p>}
          <button type="button" className="ks-btn" disabled={busy} onClick={() => void save()}>{fixedAmount ? `Отметить оплаченным (${gel(left)})` : 'Записать платёж'}</button>
          {!fixedAmount && due.discount && num > 0 && num < left && <button type="button" className="ks-btn secondary" style={{ marginTop: 8 }} disabled={busy} onClick={() => void payWithDiscount()}>Оплатить со скидкой</button>}
        </div>
      )}
      {dialog}
    </div>
  );
}
