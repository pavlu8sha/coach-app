import { useCallback, useEffect, useState } from 'react';
import { useNavState } from '../nav';
import { supabase } from '../lib/supabase';
import { EmptyState, Segmented } from '../ui/components';
import { useConfirm } from '../ui/ConfirmSheet';
import { Failure, Splash } from './Message';
import ParentsRoster from './ParentsRoster';

interface Pending {
  id: string;
  created_at: string;
  player_id: string;
  user_id: string;
  users: { display_name: string | null; telegram_id: number } | null;
  players: { full_name: string; groups: { name: string } | null } | null;
}

// Подсказка админу: кто уже привязан к этому ребёнку и сколько детей уже у этого родителя.
interface Hint { guardians: string[]; childCount: number }
interface GuardianRow { player_id: string; user_id: string; users: { display_name: string | null } | null; players: { full_name: string } | null }

interface Del { id: string; created_at: string; users: { display_name: string | null; telegram_id: number } | null }

// Подтверждение связей «родитель — ребёнок». Видно только администратору (проверяет и база).
export default function Admin() {
  const [rows, setRows] = useState<Pending[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dels, setDels] = useState<Del[]>([]);
  const [hints, setHints] = useState<Record<string, Hint>>({});
  const [tab, setTab] = useNavState<'requests' | 'parents'>('ad.tab', 'requests', { persist: { kind: 'enum', values: ['requests', 'parents'] } });

  const load = useCallback(async () => {
    const r = await supabase
      .from('link_requests')
      .select('id, created_at, player_id, user_id, users!link_requests_user_id_fkey(display_name, telegram_id), players(full_name, groups(name))')
      .eq('status', 'pending')
      .order('created_at');
    if (r.error) return setError(r.error.message);
    const list = (r.data ?? []) as unknown as Pending[];
    setRows(list);
    // подсказки не критичны: при ошибке просто не показываем
    const pids = [...new Set(list.map(x => x.player_id))];
    const uids = [...new Set(list.map(x => x.user_id))];
    if (list.length) {
      const sel = 'player_id, user_id, users(display_name), players(full_name)';
      const [byPlayer, byUser] = await Promise.all([
        supabase.from('player_guardians').select(sel).in('player_id', pids).is('consent_revoked_at', null),
        supabase.from('player_guardians').select(sel).in('user_id', uids).is('consent_revoked_at', null),
      ]);
      const pg = (byPlayer.data ?? []) as unknown as GuardianRow[];
      const ug = (byUser.data ?? []) as unknown as GuardianRow[];
      const h: Record<string, Hint> = {};
      for (const x of list) {
        h[x.id] = {
          guardians: pg.filter(g => g.player_id === x.player_id && g.user_id !== x.user_id).map(g => g.users?.display_name ?? 'без имени'),
          childCount: new Set(ug.filter(g => g.user_id === x.user_id).map(g => g.player_id)).size,
        };
      }
      setHints(byPlayer.error || byUser.error ? {} : h);
    }
    // запросы на удаление данных (миграция 0025); если таблицы ещё нет, блок просто пуст
    const d = await supabase.from('data_requests').select('id, created_at, users!data_requests_user_id_fkey(display_name, telegram_id)').eq('status', 'open').order('created_at');
    setDels(d.error ? [] : ((d.data ?? []) as unknown as Del[]));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const { ask, dialog } = useConfirm();

  const decide = async (row: Pending, approve: boolean) => {
    const ok = await ask({
      title: approve ? 'Подтвердить связь?' : 'Отклонить связь?',
      lines: [['Ребёнок', row.players?.full_name], ['Группа', row.players?.groups?.name], ['Родитель', row.users?.display_name ?? 'без имени']],
      note: approve ? 'Родитель получит доступ к карточке этого ребёнка.' : 'Родитель не получит доступ к карточке ребёнка.',
      confirmLabel: approve ? 'Подтвердить' : 'Отклонить',
      danger: !approve,
    });
    if (!ok) return;
    const id = row.id;
    setBusy(id);
    const r = await supabase.rpc('decide_link', { r: id, approve });
    setBusy(null);
    if (r.error) return setError(r.error.message);
    await load();
  };

  const erase = async (d: Del) => {
    if (!(await ask({ title: 'Удалить данные родителя?', lines: [['Родитель', d.users?.display_name ?? 'без имени']], note: 'Будут удалены связи с детьми, запросы и отметки о согласии; имя в профиле очистится. Отменить нельзя.', confirmLabel: 'Удалить данные', danger: true }))) return;
    setBusy(d.id);
    const r = await supabase.rpc('erase_parent', { r: d.id });
    setBusy(null);
    if (r.error) return setError(r.error.message.includes('admin or coach') ? 'Нельзя: это администратор или тренер, за ними числятся действия в журналах. Разберите вручную.' : r.error.message);
    await load();
  };
  const rejectDel = async (d: Del) => {
    const why = window.prompt('Причина отказа (её увидит родитель; можно оставить пустой)');
    if (why === null) return;
    setBusy(d.id);
    const r = await supabase.rpc('reject_data_request', { r: d.id, why });
    setBusy(null);
    if (r.error) return setError(r.error.message);
    await load();
  };

  if (error) return <Failure title="Не удалось загрузить запросы" text={error} onRetry={() => { setError(null); void load(); }} />;
  if (!rows) return <Splash />;
  return (
    <main className="page">
      <h1>Запросы родителей</h1>
      <Segmented label="Раздел" value={tab} onChange={setTab} items={[{ value: 'requests', label: `Запросы${rows.length ? ` (${rows.length})` : ''}` }, { value: 'parents', label: 'Родители' }]} />
      {tab === 'parents' && <ParentsRoster />}
      {dialog}
      {tab === 'requests' && rows.length === 0 && <EmptyState icon="box" title="Новых запросов нет" text="Когда родитель попросит связать его с ребёнком, запрос появится здесь." />}
      {tab === 'requests' && rows.map(r => (
        <section className="ks-card" key={r.id}>
          <h2>{r.players?.full_name}</h2>
          <p className="muted">{r.players?.groups?.name ?? 'без группы'}</p>
          <p>
            Запрашивает: <strong>{r.users?.display_name ?? 'без имени'}</strong> <span className="muted">(Telegram ID {r.users?.telegram_id})</span>
          </p>
          {hints[r.id] && (
            <p className="muted">
              {hints[r.id].guardians.length ? `У ребёнка уже привязаны: ${hints[r.id].guardians.join(', ')}.` : 'У ребёнка пока нет привязанных родителей.'}{' '}
              {hints[r.id].childCount ? `У этого родителя уже привязано детей: ${hints[r.id].childCount}.` : 'Это первая привязка родителя.'}
            </p>
          )}
          <div className="ks-btns">
            <button className="ks-btn" disabled={busy === r.id} onClick={() => void decide(r, true)}>
              Подтвердить
            </button>
            <button className="ks-btn secondary" disabled={busy === r.id} onClick={() => void decide(r, false)}>
              Отклонить
            </button>
          </div>
        </section>
      ))}
      {tab === 'requests' && dels.length > 0 && (
        <>
          <h1 style={{ marginTop: 28 }}>Запросы на удаление данных</h1>
          <p className="muted" style={{ marginBottom: 10 }}>
            «Удалить» убирает связи родителя с детьми, его запросы, отметки о согласии и имя в профиле. Данные игроков остаются у клуба. Учётную запись Telegram в Supabase (Authentication) при необходимости удалите вручную.
          </p>
          {dels.map(d => (
            <section className="ks-card" key={d.id}>
              <h2>{d.users?.display_name ?? 'без имени'}</h2>
              <p className="muted">Telegram ID {d.users?.telegram_id} · {d.created_at.slice(0, 10).split('-').reverse().join('.')}</p>
              <div className="ks-btns">
                <button className="ks-btn" disabled={busy === d.id} onClick={() => void erase(d)}>Удалить данные</button>
                <button className="ks-btn secondary" disabled={busy === d.id} onClick={() => void rejectDel(d)}>Отклонить</button>
              </div>
            </section>
          ))}
        </>
      )}
    </main>
  );
}
