import type { CoachGroup } from '../lib/coach';

/** Выбор группы, если у тренера их больше одной. */
export function GroupPicker({ groups, value, onChange }: { groups: CoachGroup[]; value: string; onChange: (id: string) => void }) {
  if (groups.length < 2) return null;
  return (
    <select className="ks-select" aria-label="Группа" value={value} onChange={e => onChange(e.target.value)}>
      {groups.map(g => (
        <option key={g.id} value={g.id}>
          {g.name}
        </option>
      ))}
    </select>
  );
}

/** Счётчик целого числа 0…max. */
export function Stepper({ value, onChange, max = 99, label, disabled }: { value: number; onChange: (n: number) => void; max?: number; label: string; disabled?: boolean }) {
  return (
    <span className="ks-stepper" role="group" aria-label={label}>
      <button type="button" aria-label="Меньше" disabled={disabled || value <= 0} onClick={() => onChange(value - 1)}>−</button>
      <b>{value}</b>
      <button type="button" aria-label="Больше" disabled={disabled || value >= max} onClick={() => onChange(value + 1)}>+</button>
    </span>
  );
}
