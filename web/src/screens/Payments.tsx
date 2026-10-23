import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import Message from './Message';

interface Kid { id: string; name: string; months: { month: string; sum: number }[] }

const gel = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2)} ₾`;
const monthName = (iso: string) => {
  const [y, m] = iso.split('-').map(Number);
  const s = new Date(y, m - 1, 1).toLocaleDateString('ru', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

// Оплаты ребёнка по месяцам (внесённые суммы). Долг не считаем: в данных нет сумм «к оплате».
export default function Payments() {
  const [kids, setKids] = useState<Kid[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const me = (await supabase.auth.getUser()).data.user?.id;
      if (!me) return setError('Нет сессии');
      const links = await supabase.from('player_guardians').select('players(id, full_name)').eq('user_id', me).is('consent_revoked_at', null);
      if (links.error) return setError(links.error.message);
      const list: Kid[] = ((links.data ?? []) as any[]).filter(l => l.players).map(l => ({ id: l.players.id as string, name: l.players.full_name as string, months: [] }));
      if (list.length) {
        const pay = await supabase.from('payments').select('player_id, amount, paid_on').in('player_id', list.map(k => k.id)).order('paid_on', { ascending: false }).limit(1000);
        if (pay.error) return setError(pay.error.message);
        for (const k of list) {
          const byMonth = new Map<string, number>();
          for (const p of (pay.data ?? []) as { player_id: string; amount: number | string; paid_on: string }[]) {
            if (p.player_id !== k.id) continue;
            const month = p.paid_on.slice(0, 7) + '-01';
            byMonth.set(month, (byMonth.get(month) ?? 0) + Number(p.amount));
          }
          k.months = [...byMonth.entries()].map(([month, sum]) => ({ month, sum })).sort((a, b) => (a.month < b.month ? 1 : -1));
        }
      }
      setKids(list);
    })();
  }, []);

  if (error) return <Message title="Не удалось загрузить оплаты" text={error} />;
  if (!kids) return <Message title="Загрузка…" />;
  if (!kids.length) return <Message title="Оплата" text="Оплаты появятся, когда администратор подтвердит связь с ребёнком." />;

  return (
    <main className="page">
      <h1>Оплата</h1>
      {kids.map(k => (
        <section className="card" key={k.id}>
          <h2>{k.name}</h2>
          {k.months.length === 0 ? (
            <p className="muted">Платежей пока нет.</p>
          ) : (
            <ul className="events">
              {k.months.map(m => (
                <li key={m.month}>
                  <span>{monthName(m.month)}</span>
                  <span>{gel(m.sum)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
      <p className="muted note">Показаны внесённые суммы по месяцам. Вопросы по оплате — администратору клуба.</p>
    </main>
  );
}
