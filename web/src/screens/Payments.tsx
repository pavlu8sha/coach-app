import { useEffect, useState } from 'react';
import { loadMyChildren } from '../lib/myChildren';
import { loadPayMode, type PayMode } from '../lib/payMode';
import { supabase } from '../lib/supabase';
import { EmptyState, Pill, SkeletonRows } from '../ui/components';
import PaymentInfo from './PaymentInfo';
import { errMsg } from '../lib/coach';

interface Kid { id: string; name: string; months: { month: string; sum: number }[]; pay?: PayMode | null }
interface Debt { player_id: string; month: string; tariff: number; paid: number; debt: number }
interface Due { player_id: string; kind: 'eq' | 'ind' | 'extra' | 'visit' | 'own_visit' | 'camp'; title: string; on_date: string | null; due: number; paid: number; debt: number }
const KIND_NAME: Record<Due['kind'], string> = { eq: 'Экипировка', ind: 'Индивидуальные и вратарские', extra: 'Дополнительные тренировки', visit: 'Доп. посещения', own_visit: 'Оплата за визит', camp: 'Сборы' };
const fmt = (iso: string | null) => (iso ? iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4) : '');

/** 1 визит, 2–4 визита, 5+ визитов. */
const visitsWord = (n: number) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'визит' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'визита' : 'визитов'}`;
/** Статус типа оплаты ребёнка (0200, 0229); для ребёнка на абонементе без периода строки нет. */
function payModeLine(pm: PayMode | null | undefined, today: string): string | null {
  if (!pm?.pay_mode_from) return null;
  const from = fmt(pm.pay_mode_from);
  const until = pm.pay_mode_until ?? null;
  if (pm.pay_mode === 'per_visit' && !until) return `Платит за визит с ${from}`;
  if (until && until > today) return `Платит за визит до ${fmt(until)}, дальше абонемент`;
  if (until) return `Платил за визит с ${from} до ${fmt(until)}, дальше абонемент`;
  return null;
}
const gel = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2)} ₾`;
const monthName = (iso: string) => {
  const [y, m] = iso.split('-').map(Number);
  const s = new Date(y, m - 1, 1).toLocaleDateString('ru', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

// Оплаты ребёнка по месяцам (внесённые суммы) и долг по абонементу (docs/DEBT_RULES.md), если администратор включил его показ.
export default function Payments() {
  const [kids, setKids] = useState<Kid[] | null>(null);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [dues, setDues] = useState<Due[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [debtError, setDebtError] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    setDebtError(false);
    setDebts([]);
    setDues([]);
    void (async () => {
      const me = (await supabase.auth.getUser()).data.user?.id;
      if (!me) return setError('Нет сессии');
      const links = await loadMyChildren();
      if (links.error) return setError(errMsg(links.error));
      const list: Kid[] = (links.kids ?? []).map(k => ({ id: k.player_id, name: k.full_name, months: [] }));
      if (list.length) {
        const pay = await supabase.from('payments').select('player_id, amount, paid_on, pay_month').in('player_id', list.map(k => k.id)).order('paid_on', { ascending: false }).limit(1000);
        if (pay.error) return setError(errMsg(pay.error));
        for (const k of list) {
          const byMonth = new Map<string, number>();
          for (const p of (pay.data ?? []) as { player_id: string; amount: number | string; paid_on: string; pay_month?: string | null }[]) {
            if (p.player_id !== k.id) continue;
            const month = p.pay_month ?? p.paid_on.slice(0, 7) + '-01';
            byMonth.set(month, (byMonth.get(month) ?? 0) + Number(p.amount));
          }
          k.months = [...byMonth.entries()].map(([month, sum]) => ({ month, sum })).sort((a, b) => (a.month < b.month ? 1 : -1));
        }
      }
      // Тип оплаты ребёнка: сбой чтения не должен выглядеть как «оплаты за визит нет»
      let payFailed = false;
      for (const k of list) {
        try { k.pay = await loadPayMode(k.id); } catch { payFailed = true; }
      }
      setKids(list);
      // Долги загружаются отдельно от истории платежей. Ошибка не должна выглядеть как отсутствие задолженности.
      const d = await supabase.rpc('parent_debts');
      const o = await supabase.rpc('parent_dues');
      if (!o.error) setDues(((o.data ?? []) as Due[]).map(x => ({ ...x, due: Number(x.due), paid: Number(x.paid), debt: Number(x.debt) })));
      if (!d.error) setDebts(((d.data ?? []) as Debt[]).map(r => ({ ...r, tariff: Number(r.tariff), paid: Number(r.paid), debt: Number(r.debt) })).filter(r => r.debt > 0));
      if (d.error || o.error || payFailed) setDebtError(true);
    })();
  }, [reload]);

  return (
    <main className="page">
      <h1>Оплата</h1>
      <PaymentInfo />
      {error ? (
        <EmptyState icon="alert" title="Не удалось загрузить оплаты" text={error} action={{ label: 'Повторить', run: () => { setError(null); setReload(n => n + 1); } }} />
      ) : !kids ? (
        <div role="status" aria-label="Загрузка"><SkeletonRows count={2} card /></div>
      ) : !kids.length ? (
        <p className="muted">Оплаты появятся, когда администратор подтвердит связь с ребёнком.</p>
      ) : (
        <>
      {debtError && (
        <section className="ks-card" role="alert" aria-live="polite">
          <h2>Не удалось загрузить задолженность</h2>
          <p className="muted">История внесённых платежей показана ниже, но сведения о долгах могут быть неполными. Проверьте соединение и повторите загрузку.</p>
          <button type="button" onClick={() => { setError(null); setReload(n => n + 1); }}>Повторить загрузку</button>
        </section>
      )}
      {kids.map(k => {
        const modeLine = payModeLine(k.pay, new Date().toLocaleDateString('en-CA'));
        // визиты за плату по месяцам занятия: число, начислено, внесено (parent_dues вида own_visit)
        const byMonth = new Map<string, { n: number; due: number; paid: number }>();
        for (const d of dues) {
          if (d.player_id !== k.id || d.kind !== 'own_visit' || !d.on_date) continue;
          const m = d.on_date.slice(0, 7) + '-01';
          const cur = byMonth.get(m) ?? { n: 0, due: 0, paid: 0 };
          byMonth.set(m, { n: cur.n + 1, due: cur.due + d.due, paid: cur.paid + d.paid });
        }
        const visitMonths = [...byMonth.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
        return (
        <section className="ks-card" key={k.id}>
          <h2>{k.name}</h2>
          {modeLine && <p className="muted">{modeLine}</p>}
          {(debts.some(d => d.player_id === k.id) || dues.some(d => d.player_id === k.id && d.debt > 0)) && (
            <div className="debt">
              <p>
                <strong>К оплате: {gel(debts.filter(d => d.player_id === k.id).reduce((s, d) => s + d.debt, 0) + dues.filter(d => d.player_id === k.id).reduce((s, d) => s + d.debt, 0))}</strong>
              </p>
              {debts.filter(d => d.player_id === k.id).map(d => (
                <div className="debt-row" key={d.month}>
                  <div className="ks-line">
                    <span>{monthName(d.month)}</span>
                    <b>{gel(d.debt)}</b>
                  </div>
                  <div className="debt-sub">внесено {gel(d.paid)} из {gel(d.tariff)}</div>
                </div>
              ))}
              {dues.filter(d => d.player_id === k.id && d.debt > 0).map((d, i) => (
                <div className="debt-row" key={d.kind + i}>
                  <div className="ks-line">
                    <span>{d.title}{d.on_date ? ` · ${fmt(d.on_date)}` : ''}</span>
                    <b>{gel(d.debt)}</b>
                  </div>
                  <div className="debt-sub">{KIND_NAME[d.kind]} · внесено {gel(d.paid)} из {gel(d.due)}</div>
                </div>
              ))}
            </div>
          )}
          {visitMonths.map(([m, v]) => (
            <div className="ks-slot" key={`v${m}`}>
              <span>Визиты · {monthName(m)}<br /><span className="muted">{visitsWord(v.n)}, начислено {gel(v.due)}</span></span>
              <Pill tone={v.paid >= v.due ? 'success' : 'warning'} dot>{v.paid >= v.due ? gel(v.paid) : `${Number.isInteger(v.paid) ? v.paid : v.paid.toFixed(2)} из ${gel(v.due)}`}</Pill>
            </div>
          ))}
          {dues.some(d => d.player_id === k.id && d.paid > 0 && d.kind !== 'own_visit') && (
            <div>
              <h3>Оплаты по другим видам</h3>
              {dues.filter(d => d.player_id === k.id && d.paid > 0 && d.kind !== 'own_visit').map((d, i) => (
                <div className="ks-slot" key={d.kind + i}>
                  <span>{d.title}{d.on_date ? ` · ${fmt(d.on_date)}` : ''}</span>
                  <Pill tone="success" dot>{gel(d.paid)}</Pill>
                </div>
              ))}
            </div>
          )}
          {k.months.length === 0 ? (
            <p className="muted">Платежей пока нет.</p>
          ) : (
            <div>
              {k.months.map(m => (
                <div className="ks-slot" key={m.month}>
                  <span>Абонемент · {monthName(m.month)}</span>
                  <Pill tone="success" dot>{gel(m.sum)}</Pill>
                </div>
              ))}
            </div>
          )}
        </section>
        );
      })}
        </>
      )}
      <p className="muted note">Показаны внесённые суммы по месяцам. Если что-то не сходится, напишите администратору клуба.</p>
    </main>
  );
}
