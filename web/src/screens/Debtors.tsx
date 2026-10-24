import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { EmptyState, ListRow, Pill } from '../ui/components';
import { Failure, Loading } from './Message';

interface Row { group_name: string; player_id: string; full_name: string; tariff: number; paid: number; debt: number }
interface Disc { id: string; player_id: string; players: { full_name: string } | null }

const gel = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2)} ₾`;
const SEASON_START = '2026-09-01'; // как debt_start() в базе
const monthIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
const monthName = (iso: string) => {
  const [y, m] = iso.split('-').map(Number);
  const s = new Date(y, m - 1, 1).toLocaleDateString('ru', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const monthsList = () => {
  const out: string[] = [];
  const now = new Date();
  for (let d = new Date(now.getFullYear(), now.getMonth(), 1); monthIso(d) >= SEASON_START; d.setMonth(d.getMonth() - 1)) out.push(monthIso(d));
  return out;
};

// Для администратора: должники по абонементу за месяц, скидки и включение показа долга родителям (docs/DEBT_RULES.md).
export default function Debtors() {
  const months = useMemo(monthsList, []);
  const [month, setMonth] = useState(months[0] ?? SEASON_START);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [discs, setDiscs] = useState<Disc[]>([]);
  const [offs, setOffs] = useState<Disc[]>([]);
  const [clubId, setClubId] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const d = await supabase.rpc('debtors', { m: month });
      if (d.error) return setError(d.error.message.includes('Could not find the function') ? 'Функция расчёта долга ещё не установлена в базе (миграция 0023).' : d.error.message);
      const s = await supabase.from('subscriptions').select('id, player_id, players(full_name)').eq('month', month).eq('discount', true);
      if (s.error) return setError(s.error.message);
      const c = await supabase.from('clubs').select('id').limit(1);
      if (c.error) return setError(c.error.message);
      const cid = ((c.data ?? []) as { id: string }[])[0]?.id ?? null;
      if (cid) {
        const st = await supabase.from('club_settings').select('value').eq('club_id', cid).eq('key', 'parent_debt_enabled').maybeSingle();
        if (st.error) return setError(st.error.message);
        setEnabled((st.data as { value: string } | null)?.value === 'true');
      }
      const w = await supabase.from('subscriptions').select('id, player_id, players(full_name)').eq('month', month).eq('written_off', true);
      if (w.error) return setError(w.error.message.includes('written_off') ? 'Списание долга ещё не установлено в базе (миграция 0032).' : w.error.message);
      setOffs((w.data ?? []) as unknown as Disc[]);
      setClubId(cid);
      setRows(((d.data ?? []) as Row[]).map(r => ({ ...r, tariff: Number(r.tariff), paid: Number(r.paid), debt: Number(r.debt) })));
      setDiscs((s.data ?? []) as unknown as Disc[]);
    })();
  }, [month, reload]);

  const setFlag = async (playerId: string, field: 'discount' | 'written_off', on: boolean) => {
    setBusy(playerId);
    setMsg(null);
    const r = await supabase.from('subscriptions').upsert({ player_id: playerId, month, [field]: on }, { onConflict: 'player_id,month' });
    setBusy(null);
    if (r.error) return setMsg(r.error.message);
    setReload(n => n + 1);
  };
  const setDiscount = (playerId: string, on: boolean) => setFlag(playerId, 'discount', on);
  const createMonth = async () => {
    if (!window.confirm(`Создать абонементы на ${monthName(month).toLowerCase()} для всех активных игроков?`)) return;
    setBusy('month');
    setMsg(null);
    const r = await supabase.rpc('create_subscription_month', { m: month });
    setBusy(null);
    if (r.error) return setMsg(r.error.message.includes('Could not find the function') ? 'Функция ещё не установлена в базе (миграция 0032).' : r.error.message.includes('out of range') ? 'Для этого месяца абонементы создать нельзя.' : r.error.message);
    setMsg(`Создано абонементов: ${r.data ?? 0}. Уже существующие не менялись.`);
    setReload(n => n + 1);
  };
  const toggleEnabled = async () => {
    if (!clubId) return;
    setBusy('flag');
    setMsg(null);
    const r = await supabase.from('club_settings').upsert({ club_id: clubId, key: 'parent_debt_enabled', value: enabled ? 'false' : 'true' }, { onConflict: 'club_id,key' });
    setBusy(null);
    if (r.error) return setMsg(r.error.message);
    setEnabled(!enabled);
  };

  if (error) return <Failure title="Не удалось загрузить должников" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} />;
  if (!rows) return <Loading />;

  const groups = [...new Set(rows.map(r => r.group_name))];
  const total = rows.reduce((s, r) => s + r.debt, 0);
  return (
    <main className="page">
      <h1>Должники</h1>
      <select className="ks-select" aria-label="Месяц" value={month} onChange={e => { setRows(null); setMonth(e.target.value); }}>
        {months.map(m => (
          <option key={m} value={m}>{monthName(m)}</option>
        ))}
      </select>
      <div className="ks-card">
        <b>Показ долга родителям: {enabled ? 'включён' : 'выключен'}</b>
        <p className="ks-muted" style={{ margin: '6px 0 10px' }}>
          Включайте, когда внесены скидки: у детей со скидкой иначе покажется неверный долг. Сначала сверьте этот список со старым приложением.
        </p>
        <button type="button" className="ks-btn secondary" disabled={busy === 'flag' || enabled === null} onClick={() => void toggleEnabled()}>
          {enabled ? 'Выключить показ родителям' : 'Включить показ родителям'}
        </button>
      </div>
      <div className="ks-card">
        <b>Абонементы на {monthName(month).toLowerCase()}</b>
        <p className="ks-muted" style={{ margin: '6px 0 10px' }}>Создаёт строки абонементов для всех активных игроков с группой (кроме индивидуальных). Только после этого прошлый месяц считается в долге у неплательщиков.</p>
        <button type="button" className="ks-btn secondary" disabled={busy === 'month'} onClick={() => void createMonth()}>Создать абонементы на месяц</button>
      </div>
      {msg && <p className={msg.startsWith('Создано') ? 'muted' : 'error'}>{msg}</p>}
      <p className="muted" style={{ margin: '4px 0 10px' }}>{rows.length > 0 ? `Должны: ${rows.length}, всего ${gel(total)}` : ''}</p>
      {rows.length === 0 ? (
        <EmptyState icon="users" title="Должников нет" text="За этот месяц у активных игроков нет неоплаченных абонементов." />
      ) : (
        groups.map(g => (
          <section key={g}>
            <h3>{g}</h3>
            {rows.filter(r => r.group_name === g).map(r => (
              <div className="ks-card" key={r.player_id}>
                <div className="ks-line">
                  <b style={{ overflowWrap: 'anywhere' }}>{r.full_name}</b>
                  <Pill tone="danger" dot>{gel(r.debt)}</Pill>
                </div>
                <div className="ks-muted" style={{ fontSize: 13 }}>Внесено {gel(r.paid)} из {gel(r.tariff)}</div>
                <button type="button" className="ks-btn secondary" style={{ marginTop: 8 }} disabled={busy === r.player_id} onClick={() => void setDiscount(r.player_id, true)}>
                  Отметить «Скидка»
                </button>
                <button type="button" className="ks-btn secondary" style={{ marginTop: 8 }} disabled={busy === r.player_id} onClick={() => void setFlag(r.player_id, 'written_off', true)}>
                  Списать долг
                </button>
              </div>
            ))}
          </section>
        ))
      )}
      {discs.length > 0 && (
        <>
          <h3>Со скидкой за месяц</h3>
          {discs.map(d => (
            <ListRow key={d.id} avatar={d.players?.full_name ?? '—'} title={d.players?.full_name ?? 'Игрок'} sub={['Если за месяц что-то внесено, долга нет']} end={<button type="button" className="ks-btn secondary" style={{ width: 'auto', minHeight: 40 }} disabled={busy === d.player_id} onClick={() => void setDiscount(d.player_id, false)}>Снять</button>} />
          ))}
        </>
      )}
      {offs.length > 0 && (
        <>
          <h3>Долг списан</h3>
          {offs.map(d => (
            <ListRow key={d.id} avatar={d.players?.full_name ?? '—'} title={d.players?.full_name ?? 'Игрок'} sub={['Не показывается ни в списке, ни родителю']} end={<button type="button" className="ks-btn secondary" style={{ width: 'auto', minHeight: 40 }} disabled={busy === d.player_id} onClick={() => void setFlag(d.player_id, 'written_off', false)}>Вернуть</button>} />
          ))}
        </>
      )}
    </main>
  );
}
