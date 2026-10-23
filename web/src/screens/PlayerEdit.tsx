import { useState } from 'react';
import { supabase } from '../lib/supabase';

export interface PlayerForm { id?: string; full_name: string; birth_date: string | null; group_id: string | null; status: 'active' | 'inactive' }
interface GroupRow { id: string; name: string }

// Форма ребёнка для администратора: правка и добавление. Права проверяет база (политика players_admin_write).
export default function PlayerEdit({ initial, groups, clubId, onDone, onCancel }: { initial: PlayerForm; groups: GroupRow[]; clubId: string | null; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isNew = !initial.id;

  const save = async () => {
    const name = f.full_name.trim();
    if (name.length < 3) return setError('Введите фамилию и имя.');
    if (isNew && !clubId) return setError('Не удалось определить клуб.');
    setBusy(true);
    setError(null);
    const row = { full_name: name, birth_date: f.birth_date || null, group_id: f.group_id || null, status: f.status };
    const r = isNew ? await supabase.from('players').insert({ ...row, club_id: clubId }) : await supabase.from('players').update(row).eq('id', initial.id!);
    setBusy(false);
    if (r.error) return setError(r.error.message);
    onDone();
  };

  return (
    <section className="card">
      <h2>{isNew ? 'Новый ребёнок' : 'Данные ребёнка'}</h2>
      <label className="field">
        Фамилия Имя
        <input value={f.full_name} onChange={e => setF({ ...f, full_name: e.target.value })} autoComplete="off" />
      </label>
      <label className="field">
        Дата рождения
        <input type="date" value={f.birth_date ?? ''} onChange={e => setF({ ...f, birth_date: e.target.value || null })} />
      </label>
      <label className="field">
        Группа
        <select value={f.group_id ?? ''} onChange={e => setF({ ...f, group_id: e.target.value || null })}>
          <option value="">Без группы</option>
          {groups.map(g => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Статус
        <select value={f.status} onChange={e => setF({ ...f, status: e.target.value as PlayerForm['status'] })}>
          <option value="active">Занимается</option>
          <option value="inactive">Не занимается</option>
        </select>
      </label>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button className="btn" disabled={busy} onClick={() => void save()}>
          Сохранить
        </button>
        <button className="btn ghost" disabled={busy} onClick={onCancel}>
          Отмена
        </button>
      </div>
    </section>
  );
}
