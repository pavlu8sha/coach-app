import { useEffect, useMemo, useState } from 'react';
import { fmtDate, today } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { EmptyState, ListRow, Pill, SearchInput, SwitchRow, type Tone } from '../ui/components';
import { Failure, Splash } from './Message';
import { tariffFor } from './MonthPayments';
import PlayerCard, { type CardPlayer } from './PlayerCard';
import PlayerEdit, { type PlayerForm } from './PlayerEdit';

interface Row { id: string; full_name: string; group_id: string | null; birth_date: string | null; status: 'active' | 'inactive'; external_id: string | null }
interface GroupRow { id: string; name: string; club_id: string }
interface Price { group_id: string | null; amount: number; valid_from: string; valid_to: string | null }
interface Sub { player_id: string; discount: boolean; written_off: boolean }
type StatusFilter = 'active' | 'inactive' | 'all';

const LIMIT = 80; // сколько строк показываем: список длинный, дальше — уточнить поиск
const monthStart = () => today().slice(0, 7) + '-01';
const nextMonthStart = () => {
  const [y, m] = monthStart().split('-').map(Number);
  return new Date(y, m, 1).toLocaleDateString('en-CA');
};
const monthLabel = () => {
  const s = new Date(monthStart() + 'T12:00:00').toLocaleDateString('ru', { month: 'numeric', year: '2-digit' });
  return s;
};

/** Статус оплаты абонемента за месяц: как в «Оплатах за месяц» (списано и скидка считаются оплаченным). */
function payState(got: number, tariff: number | null, sub?: Sub): { tone: Tone; label: string } {
  if (sub?.written_off) return { tone: 'neutral', label: 'Списано' };
  if (sub?.discount && got > 0) return { tone: 'success', label: 'Скидка' };
  if (tariff !== null && got >= tariff) return { tone: 'success', label: 'Оплачено' };
  if (got > 0) return { tone: 'warning', label: 'Частично' };
  return { tone: 'danger', label: 'Не платил' };
}

// «Игроки» для администратора: поиск, фильтры, статус оплаты за текущий месяц. Права проверяет база (администратор читает всё).
export default function Players() {
  const [players, setPlayers] = useState<Row[] | null>(null);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [paid, setPaid] = useState<Map<string, number>>(new Map());
  const [subs, setSubs] = useState<Map<string, Sub>>(new Map());
  const [prices, setPrices] = useState<Price[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<PlayerForm | null>(null);
  const [card, setCard] = useState<CardPlayer | null>(null);
  const [reload, setReload] = useState(0);
  const [q, setQ] = useState('');
  const [gid, setGid] = useState('');
  const [status, setStatus] = useState<StatusFilter>('active');
  const [onlyUnpaid, setOnlyUnpaid] = useState(false);
  const [years, setYears] = useState<string[]>([]);

  useEffect(() => {
    void (async () => {
      const month = monthStart();
      const g = await supabase.from('groups').select('id, name, club_id').order('name');
      const p = await supabase.from('players').select('id, full_name, group_id, birth_date, status, external_id').order('full_name').limit(1000);
      const pr = await supabase.from('prices').select('group_id, amount, valid_from, valid_to').eq('kind', 'subscription');
      const pay = await supabase.from('payments').select('player_id, amount').eq('pay_month', month).limit(1000);
      const sb = await supabase.from('subscriptions').select('player_id, discount, written_off').eq('month', month).limit(1000);
      const bad = g.error ?? p.error ?? pr.error ?? pay.error ?? sb.error;
      if (bad) return setError(bad.message);
      const m = new Map<string, number>();
      ((pay.data ?? []) as { player_id: string; amount: number }[]).forEach(x => m.set(x.player_id, (m.get(x.player_id) ?? 0) + Number(x.amount)));
      setGroups((g.data ?? []) as GroupRow[]);
      setPlayers((p.data ?? []) as Row[]);
      setPrices(((pr.data ?? []) as Price[]).map(x => ({ ...x, amount: Number(x.amount) })));
      setPaid(m);
      setSubs(new Map(((sb.data ?? []) as Sub[]).map(x => [x.player_id, x])));
    })();
  }, [reload]);

  const groupName = useMemo(() => new Map(groups.map(g => [g.id, g.name])), [groups]);
  const allYears = useMemo(() => [...new Set((players ?? []).map(p => p.birth_date?.slice(0, 4)).filter((y): y is string => Boolean(y)))].sort().reverse(), [players]);
  const hasNoDate = (players ?? []).some(p => !p.birth_date);

  // игроки индивидуальных и вратарских платят за занятия, абонемента у них нет
  const noSub = (p: Row) => (groupName.get(p.group_id ?? '') ?? '').trim().toLowerCase() === 'индивидуальные / вратарские';
  const state = (p: Row) => noSub(p) ? { tone: 'neutral' as Tone, label: 'Без абонемента' } : payState(paid.get(p.id) ?? 0, p.group_id ? tariffFor(prices, p.group_id, monthStart()) : null, subs.get(p.id));
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (players ?? []).filter(p => {
      if (status !== 'all' && p.status !== status) return false;
      if (gid && p.group_id !== gid) return false;
      if (years.length && !years.includes(p.birth_date?.slice(0, 4) ?? 'none')) return false;
      if (needle && !`${p.full_name} ${p.external_id ?? ''} ${groupName.get(p.group_id ?? '') ?? ''}`.toLowerCase().includes(needle)) return false;
      if (onlyUnpaid && p.status === 'active' && state(p).tone !== 'danger' && state(p).tone !== 'warning') return false;
      if (onlyUnpaid && p.status !== 'active') return false;
      return true;
    });
  }, [players, q, gid, status, years, onlyUnpaid, paid, subs, prices, groupName]);

  if (error) return <Failure title="Не удалось загрузить игроков" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} />;
  if (!players) return <Splash />;
  const done = () => {
    setEdit(null);
    setCard(null);
    setReload(n => n + 1);
  };
  if (edit) return <main className="page"><PlayerEdit initial={edit} groups={groups} clubId={groups[0]?.club_id ?? null} onDone={done} onCancel={() => setEdit(null)} /></main>;
  if (card) return <PlayerCard player={card} onBack={() => setCard(null)} onEdit={() => setEdit({ id: card.id, full_name: card.full_name, birth_date: card.birth_date, group_id: card.group_id, status: card.status })} />;
  const toggleYear = (y: string) => setYears(cur => (cur.includes(y) ? cur.filter(x => x !== y) : [...cur, y]));

  return (
    <main className="page">
      <h1>Игроки</h1>
      <SearchInput value={q} onChange={setQ} placeholder="Поиск: ФИ, ID, группа" label="Поиск игроков" />
      <div className="two" style={{ marginTop: 8 }}>
        <select className="ks-select" style={{ marginBottom: 0 }} aria-label="Группа" value={gid} onChange={e => setGid(e.target.value)}>
          <option value="">Все группы</option>
          {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <select className="ks-select" style={{ marginBottom: 0 }} aria-label="Статус" value={status} onChange={e => setStatus(e.target.value as StatusFilter)}>
          <option value="active">Активные</option>
          <option value="inactive">Не занимаются</option>
          <option value="all">Все</option>
        </select>
      </div>
      <div className="two" style={{ marginTop: 8, alignItems: 'stretch' }}>
        <SwitchRow id="unpaid" label="Только не оплатившие" checked={onlyUnpaid} onChange={setOnlyUnpaid} />
        <button type="button" className="ks-btn" onClick={() => setEdit({ full_name: '', birth_date: null, group_id: null, status: 'active' })}>+ Добавить</button>
      </div>
      {(allYears.length > 0 || hasNoDate) && (
        <>
          <p className="ks-label">Год рождения (можно несколько)</p>
          <div className="ks-chips">
            {[...allYears, ...(hasNoDate ? ['none'] : [])].map(y => (
              <button key={y} type="button" className="ks-chip" aria-pressed={years.includes(y)} onClick={() => toggleYear(y)}>{y === 'none' ? 'без даты' : y}</button>
            ))}
          </div>
        </>
      )}
      <h3 className="ks-list-head"><span>Игроки</span><span>{list.length}</span></h3>
      {list.length > LIMIT && <p className="muted" style={{ marginBottom: 8 }}>Статус оплаты за {monthLabel()} · показаны первые {LIMIT}, уточните поиск</p>}
      {list.length === 0 ? (
        <EmptyState icon="users" title="Никого не нашли" text="Измените поиск или фильтры." />
      ) : (
        list.slice(0, LIMIT).map(p => {
          const s = state(p);
          return (
            <ListRow
              key={p.id}
              avatar={p.full_name}
              title={p.full_name}
              sub={[groupName.get(p.group_id ?? '') ?? 'без группы', [p.external_id, p.birth_date ? `р. ${fmtDate(p.birth_date)}` : null].filter(Boolean).join(' · ')].filter(Boolean)}
              end={p.status === 'inactive' ? <Pill>Не занимается</Pill> : <Pill tone={s.tone} dot>{s.label}</Pill>}
              onClick={() => setCard({ id: p.id, full_name: p.full_name, birth_date: p.birth_date, group_id: p.group_id, status: p.status, external_id: p.external_id, group_name: groupName.get(p.group_id ?? '') ?? null })}
            />
          );
        })
      )}
    </main>
  );
}
