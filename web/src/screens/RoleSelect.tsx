import { useState, type ReactElement } from 'react';
import { supabase } from '../lib/supabase';

export type Role = 'parent' | 'coach' | 'child' | 'guest';

const ROLES: { value: Role; title: string; text: string; icon: ReactElement }[] = [
  {
    value: 'parent',
    title: 'Родитель',
    text: 'Баллы, расписание, матчи и оплата ребёнка',
    icon: (
      <>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5" />
      </>
    ),
  },
  {
    value: 'coach',
    title: 'Тренер',
    text: 'Отметки, матчи и баллы своей группы. Группы назначает администратор',
    icon: (
      <>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2.5 20a6.5 6.5 0 0 1 13 0M15.5 12.5l2 2 4-4" />
      </>
    ),
  },
  {
    value: 'child',
    title: 'Ребёнок',
    text: 'Свои баллы и матчи по коду от родителя, расписание клуба',
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M8.5 14a4 4 0 0 0 7 0M9 9.5h.01M15 9.5h.01" />
      </>
    ),
  },
  {
    value: 'guest',
    title: 'Гость',
    text: 'О клубе, расписание и результаты матчей, без личных данных',
    icon: (
      <>
        <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
  },
];

// Первый вход: выбор роли. Роль — подсказка для интерфейса, права она не даёт (их выдаёт администратор).
export default function RoleSelect({ onDone, onCancel }: { onDone: (r: Role) => void; onCancel?: () => void }) {
  const [busy, setBusy] = useState<Role | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = async (r: Role) => {
    setBusy(r);
    setError(null);
    const res = await supabase.rpc('set_my_role', { r });
    setBusy(null);
    if (res.error) return setError(res.error.message);
    onDone(r);
  };

  return (
    <main className="page">
      <h1>Добро пожаловать в FC KickStart</h1>
      <p className="muted" style={{ marginBottom: 16 }}>Выберите свою роль. Её можно сменить позже.</p>
      {ROLES.map(r => (
        <button key={r.value} type="button" className="ks-row role" disabled={busy !== null} onClick={() => void pick(r.value)}>
          <span className="role-icon">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {r.icon}
            </svg>
          </span>
          <span className="ks-row-main">
            <span className="ks-row-title">{r.title}</span>
            <span className="ks-row-sub">{r.text}</span>
          </span>
        </button>
      ))}
      {error && <p className="error">{error}</p>}
      {onCancel && (
        <button type="button" className="ks-btn secondary" onClick={onCancel}>
          Назад
        </button>
      )}
    </main>
  );
}
