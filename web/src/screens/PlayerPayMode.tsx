import { useEffect, useState } from 'react';
import { coachError, fmtDate, today } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { loadPayMode, type PayMode } from '../lib/payMode';

// Тип оплаты игрока в карточке (миграция 0200): «Абонемент» или «Платит за визит» (20 ₾ за каждое посещение, без долга по абонементу).
// Меняет администратор (player_set_pay_mode). Старые оплаты в абонемент остаются как есть. Итог за месяц: только факт, без сравнения «выгоды».
// С 0206 в число визитов входят доп. посещения чужих групп (guest_visits, условия: docs/PAY_PER_VISIT_VISITS_ACCEPTANCE.md); без миграции поля нет и строка прежняя.
// С 0229 возврат на абонемент принимает дату (pay_mode_until): месяцы до неё остаются «за визит», месяц возврата уже абонементный.
type Mode = PayMode;
/** Первое число следующего месяца (дата возврата по умолчанию). */
const nextMonthFirst = () => { const [y, m] = today().split('-').map(Number); return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10); };
interface Month { visits: number; guest_visits?: number; accrued: number; paid: number; subscription_price: number | null }
const gel = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2)} ₾`;
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

export default function PlayerPayMode({ playerId }: { playerId: string }) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [month, setMonth] = useState<Month | null>(null);
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(today());
  const [returnDate, setReturnDate] = useState(nextMonthFirst());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const m1 = today().slice(0, 8) + '01';

  useEffect(() => {
    void (async () => {
      // без миграции 0200 колонок нет: панель просто не показывается
      const md = await loadPayMode(playerId);
      if (!md) return setMode(null);
      setMode(md);
      if (md.pay_mode === 'per_visit' || (md.pay_mode_until && md.pay_mode_until > today())) {
        const s = await supabase.rpc('player_visit_month', { p: playerId, m: m1 });
        if (!s.error && s.data) setMonth(s.data as Month);
      } else setMonth(null);
    })();
  }, [playerId, reload, m1]);

  const save = async (next: 'subscription' | 'per_visit') => {
    setBusy(true);
    setError(null);
    const r = await supabase.rpc('player_set_pay_mode', { p: playerId, mode: next, from_d: next === 'per_visit' ? date : returnDate });
    setBusy(false);
    if (r.error) return setError(r.error.message.includes('date in the future') ? 'Дата не может быть в будущем.' : coachError(r.error.message));
    setEditing(false);
    setReload(n => n + 1);
  };

  if (!mode) return null;
  const per = mode.pay_mode === 'per_visit';
  const until = mode.pay_mode_until ?? null;
  const scheduled = !per && !!until && until > today(); // возврат назначен на будущую дату: пока ещё «за визит»
  const perNow = per || scheduled;
  const mi = Number(today().slice(5, 7)) - 1;
  return (
    <section aria-label="Тип оплаты" style={{ margin: '8px 0 12px' }}>
      <p style={{ margin: '0 0 8px' }}>
        <b>{perNow ? 'Платит за визит' : 'Абонемент'}</b>
        {per && mode.pay_mode_from && <span className="muted"> · с {fmtDate(mode.pay_mode_from)}</span>}
        {scheduled && until && <span className="muted"> · абонемент с {fmtDate(until)}</span>}
        {!perNow && until && mode.pay_mode_from && <span className="muted"> · с {fmtDate(until)} (до этого за визит с {fmtDate(mode.pay_mode_from)})</span>}
      </p>
      {perNow && month && (
        <p className="muted" style={{ margin: '0 0 8px' }}>
          {MONTHS[mi]}: визитов {month.visits}{Number(month.guest_visits) > 0 ? ` (из них доп. посещений ${month.guest_visits})` : ''}, начислено {gel(Number(month.accrued))}, оплачено {gel(Number(month.paid))}.
          {month.subscription_price != null && ` Абонемент в этом месяце: ${gel(Number(month.subscription_price))}.`}
        </p>
      )}
      {!editing && (
        <button type="button" className="ks-btn secondary" onClick={() => { setEditing(true); setDate(mode.pay_mode_from ?? today()); setReturnDate(nextMonthFirst()); setError(null); }}>
          {perNow ? 'Изменить тип оплаты' : 'Сменить на «Платит за визит»'}
        </button>
      )}
      {editing && (
        <div className="ks-card" aria-label="Смена типа оплаты">
          <p className="muted">Старые оплаты в абонемент остаются как есть. Игрок «за визит» не попадает в «Должники»: каждый визит с отметкой «Был» копится как долг до оплаты.</p>
          <label className="ks-label" htmlFor="pm-date">Платит за визит с</label>
          <input id="pm-date" className="ks-input" type="date" value={date} max={today()} onChange={e => setDate(e.target.value)} />
          {perNow && (
            <>
              <label className="ks-label" htmlFor="pm-return">Вернуть абонемент с</label>
              <input id="pm-return" className="ks-input" type="date" value={returnDate} onChange={e => setReturnDate(e.target.value)} />
              <p className="muted">Месяц этой даты целиком абонементный, месяцы до него остаются «за визит». Неоплаченные визиты остаются долгом.</p>
            </>
          )}
          <div className="two" style={{ alignItems: 'stretch', marginTop: 8 }}>
            <button type="button" className="ks-btn" disabled={busy || !date} onClick={() => void save('per_visit')}>Платит за визит</button>
            {perNow && <button type="button" className="ks-btn secondary" disabled={busy || !returnDate} onClick={() => void save('subscription')}>Вернуть абонемент</button>}
            <button type="button" className="ks-btn secondary" disabled={busy} onClick={() => setEditing(false)}>Отмена</button>
          </div>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
