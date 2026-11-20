import { useEffect, useState } from 'react';
import { useDirtyGuard } from '../nav';
import { fmtDate, playerTeam, today } from '../lib/coach';
import { seasonStart } from '../lib/seasonStats';
import { supabase } from '../lib/supabase';
import type { PlayerStatus } from '../lib/playerStatus';

export interface PlayerForm {
  id?: string;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  primary_position: string | null;
  jersey_number: number | null;
  jersey_team: string | null;
  jersey_season_start: string | null;
  birth_date: string | null;
  group_id: string | null;
  status: PlayerStatus;
}
interface GroupRow { id: string; name: string }
interface ProfileChange { field: 'first_name' | 'last_name' | 'primary_position'; old_value: string | null; new_value: string | null; changed_at: string }
interface JerseyChange { number: number; team: string; season_start: string; valid_from: string; valid_to: string | null }

const FIELD_LABEL: Record<ProfileChange['field'], string> = { first_name: 'Имя', last_name: 'Фамилия', primary_position: 'Позиция' };
const dash = (v: string | null) => (v && v.trim() ? v : '—');

// Форма ребёнка для администратора: правка и добавление. Права проверяет база (политика players_admin_write).
export default function PlayerEdit({ initial, groups, clubId, onDone, onCancel }: { initial: PlayerForm; groups: GroupRow[]; clubId: string | null; onDone: () => void; onCancel: () => void }) {
  const currentSeason = seasonStart(today());
  const groupName = (id: string | null) => groups.find(g => g.id === id)?.name ?? null;
  const initialTeam = playerTeam(groupName(initial.group_id));
  const initialJersey = initial.jersey_number !== null && initial.jersey_team === initialTeam && initial.jersey_season_start === currentSeason ? initial.jersey_number : null;
  const initialJerseyText = initialJersey === null ? '' : String(initialJersey);
  const [f, setF] = useState<PlayerForm>({ ...initial, jersey_number: initialJersey, jersey_team: initialTeam, jersey_season_start: currentSeason });
  const [jersey, setJersey] = useState(initialJerseyText);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dup, setDup] = useState<string | null>(null); // найден игрок с таким же именем: нужно подтверждение
  const [history, setHistory] = useState<{ fields: ProfileChange[]; jerseys: JerseyChange[] } | null>(null);
  const playerId = initial.id ?? null;
  const isNew = !playerId;
  const team = playerTeam(groupName(f.group_id));
  useDirtyGuard(JSON.stringify(f) !== JSON.stringify({ ...initial, jersey_number: initialJersey, jersey_team: initialTeam, jersey_season_start: currentSeason }) || jersey !== initialJerseyText);

  useEffect(() => {
    if (!initial.id) return;
    let live = true;
    void (async () => {
      const [ph, jh] = await Promise.all([
        supabase.from('player_profile_history').select('field, old_value, new_value, changed_at').eq('player_id', initial.id).order('changed_at', { ascending: false }).limit(20),
        supabase.from('player_jersey_history').select('number, team, season_start, valid_from, valid_to').eq('player_id', initial.id).order('valid_from', { ascending: false }).limit(20),
      ]);
      if (!live) return;
      if (ph.error || jh.error) return setHistory({ fields: [], jerseys: [] });
      setHistory({ fields: (ph.data ?? []) as ProfileChange[], jerseys: (jh.data ?? []) as JerseyChange[] });
    })();
    return () => {
      live = false;
    };
  }, [initial.id]);

  const setGroup = (id: string) => {
    const oldTeam = playerTeam(groupName(f.group_id));
    const newTeam = playerTeam(groupName(id || null));
    setF({ ...f, group_id: id || null, ...(newTeam !== oldTeam ? { jersey_number: null, jersey_team: null, jersey_season_start: null } : {}) });
    if (newTeam !== oldTeam) setJersey('');
  };

  const save = async () => {
    const first = (f.first_name ?? '').trim();
    const last = (f.last_name ?? '').trim();
    const position = (f.primary_position ?? '').trim();
    if (position.length > 40) return setError('Позиция — не больше 40 символов.');
    let full: string;
    if (first && last) full = `${last} ${first}`;
    else if (!first && !last) {
      full = f.full_name.trim();
      if (isNew || full.length < 3) return setError('Введите фамилию и имя.');
    } else {
      return setError('Заполните и фамилию, и имя, либо оставьте оба поля пустыми.');
    }
    let number: number | null = null;
    const jerseyText = jersey.trim();
    if (jerseyText) {
      if (!/^[0-9]{1,2}$/.test(jerseyText) || Number(jerseyText) < 1 || Number(jerseyText) > 99) return setError('Номер — целое число от 1 до 99.');
      if (!team) return setError('Номер можно указать только для командной группы.');
      number = Number(jerseyText);
    }
    if (isNew && !clubId) return setError('Не удалось определить клуб.');
    setBusy(true);
    setError(null);
    if (isNew && !dup) {
      const norm = full.replace(/[%_\\]/g, m => '\\' + m).replace(/ё/gi, '_');
      const same = await supabase.from('players').select('full_name, status, groups(name)').ilike('full_name', norm).limit(3);
      if (!same.error && (same.data ?? []).length > 0) {
        const p = (same.data as unknown as { full_name: string; status: string; groups: { name: string } | null }[])[0];
        setBusy(false);
        setDup(`${p.full_name} (${p.groups?.name ?? 'без группы'}, ${p.status === 'active' ? 'занимается' : 'не занимается'})`);
        return;
      }
    }
    if (number !== null && team) {
      let taken = supabase.from('player_jersey_history').select('player_id').eq('team', team).eq('season_start', currentSeason).eq('number', number).is('valid_to', null);
      if (playerId) taken = taken.neq('player_id', playerId);
      const busyNumber = await taken.limit(1);
      if (!busyNumber.error && (busyNumber.data ?? []).length > 0) {
        setBusy(false);
        return setError('Этот номер уже занят в команде в этом сезоне.');
      }
    }
    // Одна серверная транзакция (0209, И2.4а): игрок, профиль и абонемент текущего месяца при смене группы.
    // Любая ошибка откатывает всё; занятость номера окончательно решает уникальный индекс, проверка выше только подсказка.
    const r = await supabase.rpc('player_save', {
      p_id: playerId,
      p_club: playerId ? null : clubId,
      p_row: { full_name: full, birth_date: f.birth_date || null, group_id: f.group_id || null, status: f.status },
      p_profile: { first_name: first || null, last_name: last || null, primary_position: position || null, jersey_number: number },
    });
    if (r.error) {
      setBusy(false);
      const busyNumber = /duplicate key|unique|player_jersey_history_open/.test(r.error.message);
      return setError(busyNumber ? 'Этот номер уже занят в команде в этом сезоне.' : r.error.message);
    }
    setBusy(false);
    onDone();
  };

  const historyLines = history
    ? [
        ...history.fields.map(h => ({ key: `f|${h.changed_at}|${h.field}`, at: h.changed_at, text: `${FIELD_LABEL[h.field]}: ${dash(h.old_value)} → ${dash(h.new_value)}` })),
        ...history.jerseys.map(h => ({ key: `j|${h.valid_from}|${h.number}`, at: h.valid_from, text: `Номер ${h.number}: ${h.team}, сезон с ${fmtDate(h.season_start)}${h.valid_to ? `, снят ${fmtDate(h.valid_to.slice(0, 10))}` : ' — действует'}` })),
      ].sort((a, b) => b.at.localeCompare(a.at))
    : [];

  return (
    <section className="ks-card">
      <h1>{isNew ? 'Новый ребёнок' : 'Данные ребёнка'}</h1>
      <label className="field">
        Фамилия
        <input value={f.last_name ?? ''} onChange={e => { setDup(null); setF({ ...f, last_name: e.target.value || null }); }} autoComplete="off" />
      </label>
      <label className="field">
        Имя
        <input value={f.first_name ?? ''} onChange={e => { setDup(null); setF({ ...f, first_name: e.target.value || null }); }} autoComplete="off" />
      </label>
      {!isNew && !f.first_name && !f.last_name && (
        <label className="field">
          Сохранённое полное имя
          <input value={f.full_name} onChange={e => { setDup(null); setF({ ...f, full_name: e.target.value }); }} autoComplete="off" />
        </label>
      )}
      <label className="field">
        Основная позиция
        <input value={f.primary_position ?? ''} onChange={e => setF({ ...f, primary_position: e.target.value || null })} placeholder="например, вратарь" autoComplete="off" />
      </label>
      <label className="field">
        Дата рождения
        <input type="date" value={f.birth_date ?? ''} onChange={e => setF({ ...f, birth_date: e.target.value || null })} />
      </label>
      <label className="field">
        Группа
        <select value={f.group_id ?? ''} onChange={e => setGroup(e.target.value)}>
          <option value="">Без группы</option>
          {groups.map(g => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Игровой номер
        <input type="number" min={1} max={99} inputMode="numeric" aria-label="Игровой номер" value={jersey} disabled={!team} onChange={e => setJersey(e.target.value)} />
        <span className="muted" style={{ fontSize: 13 }}>
          {team ? `Команда: ${team} · сезон с ${fmtDate(currentSeason)}` : 'Номер доступен только для командной группы.'}
        </span>
      </label>
      <label className="field">
        Статус
        <select value={f.status} onChange={e => setF({ ...f, status: e.target.value as PlayerForm['status'] })}>
          <option value="active">Занимается</option>
          {f.status === 'paused' && <option value="paused">Пауза</option>}
          <option value="inactive">Ушёл</option>
        </select>
        {!isNew && <span className="muted" style={{ fontSize: 13 }}>Паузу и уход с датами ставьте в карточке игрока: там сохраняется история.</span>}
      </label>
      {dup && <p className="error">Игрок с таким именем уже есть: {dup}. Если это другой ребёнок, нажмите «Всё равно добавить».</p>}
      {error && <p className="error">{error}</p>}
      <div className="ks-btns">
        <button className="ks-btn" disabled={busy} onClick={() => void save()}>
          {dup ? 'Всё равно добавить' : 'Сохранить'}
        </button>
        <button className="ks-btn secondary" disabled={busy} onClick={onCancel}>
          Отмена
        </button>
      </div>
      {historyLines.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary>История изменений</summary>
          <ul className="ks-list" style={{ listStyle: 'none', padding: 0, margin: '8px 0 0' }}>
            {historyLines.map(h => (
              <li key={h.key} className="ks-slot">
                <span className="ks-slot-main">{h.text}</span>
                <span className="muted">{fmtDate(h.at.slice(0, 10))}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
