import { useState } from 'react';
import { supabase } from '../lib/supabase';

export interface PlayerForm { id?: string; full_name: string; birth_date: string | null; group_id: string | null; status: 'active' | 'inactive' }
interface GroupRow { id: string; name: string }

// Форма ребёнка для администратора: правка и добавление. Права проверяет база (политика players_admin_write).
export default function PlayerEdit({ initial, groups, clubId, onDone, onCancel }: { initial: PlayerForm; groups: GroupRow[]; clubId: string | null; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dup, setDup] = useState<string | null>(null); // найден игрок с таким же именем: нужно подтверждение
  const isNew = !initial.id;

  const save = async () => {
    const name = f.full_name.trim();
    if (name.length < 3) return setError('Введите фамилию и имя.');
    if (isNew && !clubId) return setError('Не удалось определить клуб.');
    setBusy(true);
    setError(null);
    if (isNew && !dup) {
      const norm = name.replace(/[%_\\]/g, m => '\\' + m).replace(/ё/gi, '_');
      const same = await supabase.from('players').select('full_name, status, groups(name)').ilike('full_name', norm).limit(3);
      if (!same.error && (same.data ?? []).length > 0) {
        const p = (same.data as unknown as { full_name: string; status: string; groups: { name: string } | null }[])[0];
        setBusy(false);
        setDup(`${p.full_name} (${p.groups?.name ?? 'без группы'}, ${p.status === 'active' ? 'занимается' : 'не занимается'})`);
        return;
      }
    }
    const row = { full_name: name, birth_date: f.birth_date || null, group_id: f.group_id || null, status: f.status };
    const r = isNew ? await supabase.from('players').insert({ ...row, club_id: clubId }) : await supabase.from('players').update(row).eq('id', initial.id!);
    setBusy(false);
    if (r.error) return setError(r.error.message);
    onDone();
  };

  return (
    <section className="ks-card">
      <h2>{isNew ? 'Новый ребёнок' : 'Данные ребёнка'}</h2>
      <label className="field">
        Фамилия Имя
        <input value={f.full_name} onChange={e => { setDup(null); setF({ ...f, full_name: e.target.value }); }} autoComplete="off" />
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
    </section>
  );
}
