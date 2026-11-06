import { useCallback, useEffect, useState } from 'react';
import { coachError } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { ListRow, SearchInput, SwitchRow } from '../ui/components';
import { useConfirm } from '../ui/ConfirmSheet';

export interface Grp { id: string; name: string }
export interface Pl { id: string; full_name: string }

export function useGroups() {
  const [groups, setGroups] = useState<Grp[] | null>(null);
  useEffect(() => {
    void supabase.from('groups').select('id, name').order('name').then(r => setGroups(r.error ? [] : ((r.data ?? []) as Grp[])));
  }, []);
  return groups;
}

function usePlayerSearch(q: string) {
  const [found, setFound] = useState<Pl[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) { setFound([]); return; }
    const t = setTimeout(() => {
      void supabase.from('players').select('id, full_name').eq('status', 'active').ilike('full_name', `%${q.trim()}%`).order('full_name').limit(8).then(r => {
        if (!r.error) setFound((r.data ?? []) as Pl[]);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return found;
}

// Выбор целей при создании: группы и приглашённые игроки (хотя бы одна цель обязательна)
export function TargetPicker(props: { groups: Grp[] | null; selected: string[]; onToggle: (id: string) => void; invited: Pl[]; onInvite: (p: Pl) => void; onUninvite: (id: string) => void }) {
  const [q, setQ] = useState('');
  const found = usePlayerSearch(q).filter(f => !props.invited.some(i => i.id === f.id));
  return (
    <>
      <h3>Для кого</h3>
      <p className="ks-muted" style={{ fontSize: 13 }}>Родители детей выбранных групп и приглашённых игроков смогут записаться. Общей рассылки всем нет.</p>
      {(props.groups ?? []).map(g => <SwitchRow key={g.id} id={'tg-' + g.id} label={g.name} checked={props.selected.includes(g.id)} onChange={() => props.onToggle(g.id)} />)}
      {props.invited.map(p => <ListRow key={p.id} avatar={p.full_name} title={p.full_name} sub={['Приглашён лично']} end={<button type="button" className="ks-btn secondary" style={{ width: 'auto', minHeight: 40 }} onClick={() => props.onUninvite(p.id)}>Убрать</button>} />)}
      <SearchInput label="Пригласить игрока" placeholder="Фамилия или имя (от 2 букв)" value={q} onChange={setQ} suggestions={found.map(f => f.full_name)} />
      {found.map(p => <ListRow key={p.id} avatar={p.full_name} title={p.full_name} end={<button type="button" className="ks-btn secondary" style={{ width: 'auto', minHeight: 40 }} onClick={() => { props.onInvite(p); setQ(''); }}>Пригласить</button>} />)}
    </>
  );
}

const errText = (m: string) => m.includes('session cancelled') ? 'Тренировка отменена.' : m.includes('group not found') ? 'Группа не найдена.' : m.includes('player not in club') ? 'Игрок не из этого клуба.' : coachError(m);

// Цели существующей тренировки: группы и приглашённые; после публикации можно добавлять и убирать, записи не удаляются
export default function ExtraTargets({ sessionId, disabled, onIneligible }: { sessionId: string; disabled?: boolean; onIneligible?: (ids: string[]) => void }) {
  const groups = useGroups();
  const [selected, setSelected] = useState<string[] | null>(null);
  const [invited, setInvited] = useState<Pl[]>([]);
  const [q, setQ] = useState('');
  const found = usePlayerSearch(q).filter(f => !invited.some(i => i.id === f.id));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const { ask, dialog } = useConfirm();

  const load = useCallback(async () => {
    const g = await supabase.from('extra_session_groups').select('group_id').eq('session_id', sessionId);
    const p = await supabase.from('extra_session_players').select('player_id, players(full_name)').eq('session_id', sessionId);
    setSelected(g.error ? [] : ((g.data ?? []) as { group_id: string }[]).map(x => x.group_id));
    setInvited(p.error ? [] : ((p.data ?? []) as unknown as { player_id: string; players: { full_name: string } | null }[]).map(x => ({ id: x.player_id, full_name: x.players?.full_name ?? 'Игрок' })));
    if (onIneligible) {
      const r = await supabase.rpc('extra_ineligible', { s: sessionId });
      onIneligible(r.error ? [] : ((r.data ?? []) as { player_id: string }[]).map(x => x.player_id));
    }
  }, [sessionId, onIneligible]);
  useEffect(() => { void load(); }, [load]);

  const done = async (r: { data?: unknown; error: { message: string } | null }, ok: string) => {
    if (r.error) return setMsg({ ok: false, text: errText(r.error.message) });
    const n = Number(r.data ?? 0);
    setMsg({ ok: n === 0, text: n > 0 ? `${ok} Записанных без допуска: ${n}. Их записи сохранены, решите, что с ними делать.` : ok });
    await load();
  };

  const toggleGroup = async (g: Grp) => {
    const on = !(selected ?? []).includes(g.id);
    if (!on && !(await ask({ title: 'Убрать группу?', lines: [['Группа', g.name]], note: 'Уже записанные дети сохранят запись, но новые записи этой группы станут недоступны.', confirmLabel: 'Убрать', danger: true }))) return;
    setBusy(true);
    setMsg(null);
    const r = await supabase.rpc('extra_target_group', { s: sessionId, g: g.id, on_: on });
    setBusy(false);
    await done(r, on ? 'Группа добавлена.' : 'Группа убрана.');
  };
  const setPlayer = async (p: Pl, on: boolean) => {
    if (!on && !(await ask({ title: 'Убрать приглашение?', lines: [['Игрок', p.full_name]], note: 'Если игрок уже записан, запись сохранится.', confirmLabel: 'Убрать', danger: true }))) return;
    setBusy(true);
    setMsg(null);
    const r = await supabase.rpc('extra_target_player', { s: sessionId, p: p.id, on_: on });
    setBusy(false);
    if (on) setQ('');
    await done(r, on ? 'Игрок приглашён.' : 'Приглашение убрано.');
  };

  if (selected === null) return null;
  return (
    <>
      <h3>Для кого</h3>
      {selected.length === 0 && invited.length === 0 && <p className="ks-muted" style={{ fontSize: 13 }}>Цели не заданы: тренировка открыта для всех (создана до появления целевых групп). Добавьте группу или игрока, чтобы ограничить запись.</p>}
      {msg && <p className={msg.ok ? 'muted' : 'error'}>{msg.text}</p>}
      {(groups ?? []).map(g => <SwitchRow key={g.id} id={'tg-' + g.id} label={g.name} checked={selected.includes(g.id)} onChange={() => { if (!busy && !disabled) void toggleGroup(g); }} />)}
      {invited.map(p => <ListRow key={p.id} avatar={p.full_name} title={p.full_name} sub={['Приглашён лично']} end={<button type="button" className="ks-btn secondary" style={{ width: 'auto', minHeight: 40 }} disabled={busy || disabled} onClick={() => void setPlayer(p, false)}>Убрать</button>} />)}
      {!disabled && <SearchInput label="Пригласить игрока" placeholder="Фамилия или имя (от 2 букв)" value={q} onChange={setQ} suggestions={found.map(f => f.full_name)} />}
      {!disabled && found.map(p => <ListRow key={p.id} avatar={p.full_name} title={p.full_name} end={<button type="button" className="ks-btn secondary" style={{ width: 'auto', minHeight: 40 }} disabled={busy} onClick={() => void setPlayer(p, true)}>Пригласить</button>} />)}
      {dialog}
    </>
  );
}
