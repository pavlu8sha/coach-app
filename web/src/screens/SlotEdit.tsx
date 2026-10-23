import { useState } from 'react';
import { supabase } from '../lib/supabase';

export interface SlotForm { id?: string; weekday: number; starts_at: string; ends_at: string | null; location: string | null; kind: string; coaches: string | null }

const DAYS = ['', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
const hm = (t: string | null) => (t ? t.slice(0, 5) : '');

// Форма тренировки в расписании группы (для администратора). Права проверяет база (политика weekly_schedule_admin).
export default function SlotEdit({ groupId, initial, onDone, onCancel }: { groupId: string; initial: SlotForm; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState<SlotForm>({ ...initial, starts_at: hm(initial.starts_at), ends_at: hm(initial.ends_at) || null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (q: PromiseLike<{ error: { message: string } | null }>) => {
    setBusy(true);
    setError(null);
    const r = await q;
    setBusy(false);
    if (r.error) return setError(r.error.message);
    onDone();
  };

  const save = () => {
    if (!f.starts_at) return setError('Укажите время начала.');
    if (f.ends_at && f.ends_at <= f.starts_at) return setError('Окончание должно быть позже начала.');
    const row = { weekday: f.weekday, starts_at: f.starts_at, ends_at: f.ends_at || null, location: f.location?.trim() || null, kind: f.kind.trim() || 'Групповая', coaches: f.coaches?.trim() || null };
    void run(initial.id ? supabase.from('weekly_schedule').update(row).eq('id', initial.id) : supabase.from('weekly_schedule').insert({ ...row, group_id: groupId }));
  };

  const remove = () => {
    if (initial.id && window.confirm('Удалить эту тренировку из расписания?')) void run(supabase.from('weekly_schedule').delete().eq('id', initial.id));
  };

  return (
    <div className="card inner">
      <label className="field">
        День недели
        <select value={f.weekday} onChange={e => setF({ ...f, weekday: Number(e.target.value) })}>
          {DAYS.slice(1).map((d, i) => (
            <option key={d} value={i + 1}>
              {d}
            </option>
          ))}
        </select>
      </label>
      <div className="two">
        <label className="field">
          Начало
          <input type="time" value={f.starts_at} onChange={e => setF({ ...f, starts_at: e.target.value })} />
        </label>
        <label className="field">
          Конец
          <input type="time" value={f.ends_at ?? ''} onChange={e => setF({ ...f, ends_at: e.target.value || null })} />
        </label>
      </div>
      <label className="field">
        Место
        <input value={f.location ?? ''} onChange={e => setF({ ...f, location: e.target.value })} />
      </label>
      <label className="field">
        Тип
        <input value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })} placeholder="Групповая" />
      </label>
      <label className="field">
        Тренеры
        <input value={f.coaches ?? ''} onChange={e => setF({ ...f, coaches: e.target.value })} />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button className="btn small" disabled={busy} onClick={save}>
          Сохранить
        </button>
        <button className="btn small ghost" disabled={busy} onClick={onCancel}>
          Отмена
        </button>
        {initial.id && (
          <button className="btn small ghost" disabled={busy} onClick={remove}>
            Удалить
          </button>
        )}
      </div>
    </div>
  );
}
