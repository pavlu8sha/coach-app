import { useEffect, useMemo, useState } from 'react';
import { fmtDate } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { Avatar, Pill, Segmented } from '../ui/components';
import { BackNav } from '../ui/nav';
import { PlayerDues } from './CashDesk';
import { Failure, Loading } from './Message';
import { EquipmentTab, MatchesTab, PointsTab, SessionsTab } from './PlayerCardTabs';
import { monthIso, monthName, nextMonth, Row, SEASON_START, tariffFor, type Sub } from './MonthPayments';
import type { PlayerForm } from './PlayerEdit';

interface Price { group_id: string | null; amount: number; valid_from: string; valid_to: string | null }
interface Pay { amount: number; paid_on: string; pay_month?: string | null }

export interface CardPlayer extends PlayerForm { id: string; external_id: string | null; group_name: string | null }

// Карточка игрока для администратора: данные и абонемент по месяцам сезона с быстрым платежом.
export default function PlayerCard({ player, onBack, onEdit }: { player: CardPlayer; onBack: () => void; onEdit: () => void }) {
  const months = useMemo(() => {
    const out: string[] = [];
    const now = new Date();
    for (let d = new Date(now.getFullYear(), now.getMonth(), 1); monthIso(d) >= SEASON_START; d.setMonth(d.getMonth() - 1)) out.push(monthIso(d));
    return out;
  }, []);
  const [prices, setPrices] = useState<Price[]>([]);
  const [pays, setPays] = useState<Pay[] | null>(null);
  const [subs, setSubs] = useState<Map<string, Sub>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [openMonth, setOpenMonth] = useState<string | null>(null);
  const [tab, setTab] = useState<'sub' | 'dues' | 'sessions' | 'equip' | 'matches' | 'points'>('sub');

  useEffect(() => {
    void (async () => {
      const pr = await supabase.from('prices').select('group_id, amount, valid_from, valid_to').eq('kind', 'subscription');
      const pay = await supabase.from('payments').select('amount, paid_on, pay_month').eq('player_id', player.id).gte('pay_month', SEASON_START).limit(1000);
      const sb = await supabase.from('subscriptions').select('player_id, month, discount, written_off').eq('player_id', player.id);
      const bad = pr.error ?? pay.error ?? sb.error;
      if (bad) return setError(bad.message);
      setPrices(((pr.data ?? []) as Price[]).map(x => ({ ...x, amount: Number(x.amount) })));
      setPays(((pay.data ?? []) as Pay[]).map(x => ({ ...x, amount: Number(x.amount) })));
      setSubs(new Map(((sb.data ?? []) as (Sub & { month: string })[]).map(x => [x.month, x])));
    })();
  }, [player.id, reload]);

  if (error) return <Failure title="Не удалось загрузить игрока" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} back={<BackNav onBack={onBack} />} />;
  const gotIn = (m: string) => (pays ?? []).filter(p => (p.pay_month ?? p.paid_on.slice(0, 7) + '-01') === m).reduce((s, p) => s + p.amount, 0);

  return (
    <main className="page">
      <BackNav onBack={onBack} />
      <div className="ks-line" style={{ margin: "8px 0 4px", justifyContent: "flex-start", flexWrap: "nowrap" }}>
        <Avatar name={player.full_name} large />
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 style={{ margin: 0, overflowWrap: 'anywhere' }}>{player.full_name}</h1>
          <p className="muted">{[player.external_id, player.group_name ?? 'без группы'].filter(Boolean).join(' · ')}</p>
          <p className="muted">{player.birth_date ? `Дата рождения: ${fmtDate(player.birth_date)}` : 'Дата рождения не указана'}</p>
        </div>
      </div>
      <p style={{ margin: '8px 0 12px' }}><Pill tone={player.status === 'active' ? 'success' : 'neutral'} dot>{player.status === 'active' ? 'Занимается' : 'Не занимается'}</Pill></p>
      <button type="button" className="ks-btn secondary" onClick={onEdit}>Изменить данные</button>

      <Segmented label="Раздел карточки" value={tab} onChange={setTab} items={[
        { value: 'sub', label: 'Абонемент' }, { value: 'dues', label: 'К оплате' }, { value: 'sessions', label: 'Занятия' },
        { value: 'equip', label: 'Экипировка' }, { value: 'matches', label: 'Матчи' }, { value: 'points', label: 'Баллы' },
      ]} />
      <div style={{ height: 12 }} />
      {tab === 'dues' && <PlayerDues embedded player={{ id: player.id, full_name: player.full_name, group_id: player.group_id, groups: player.group_name ? { name: player.group_name } : null }} />}
      {tab === 'sessions' && <SessionsTab playerId={player.id} />}
      {tab === 'equip' && <EquipmentTab playerId={player.id} />}
      {tab === 'matches' && <MatchesTab playerId={player.id} />}
      {tab === 'points' && <PointsTab playerId={player.id} />}
      {tab === 'sub' && (pays === null ? <Loading /> : months.map(m => {
        const tariff = player.group_id ? tariffFor(prices, player.group_id, m) : null;
        const got = gotIn(m);
        const sub = subs.get(m);
        const paidUp = !!sub?.written_off || (!!sub?.discount && got > 0) || (tariff !== null && got >= tariff);
        return (
          <Row key={`${m}|${got}`} player={{ id: player.id, full_name: player.full_name }} title={monthName(m)} month={m} tariff={tariff} got={got} sub={sub} paidUp={paidUp} open={openMonth === m} onOpen={() => setOpenMonth(openMonth === m ? null : m)} onSaved={() => { setOpenMonth(null); setReload(n => n + 1); }} />
        );
      }))}
    </main>
  );
}
