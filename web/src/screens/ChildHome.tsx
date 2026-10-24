import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { EmptyState } from '../ui/components';
import { Failure, Loading } from './Message';

export interface ChildPlayer { id: string; name: string; group: string | null }

interface Totals { points: number; recent: { points: number; explanation: string; occurred_on: string }[]; played: number; goals: number }

const fmtDate = (iso: string) => iso.split('-').reverse().join('.');
const plural = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'балл' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'балла' : 'баллов');

// Ввод кода от родителя: связывает аккаунт ребёнка с игроком.
export function ChildCode({ onLinked }: { onLinked: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const r = await supabase.rpc('redeem_child_code', { c: code });
    setBusy(false);
    if (r.error) return setError(r.error.message.includes('too many attempts') ? 'Слишком много попыток. Подождите 10 минут и попробуйте снова.' : r.error.message.includes('invalid code') ? 'Код не подошёл или устарел. Попросите родителя создать новый.' : r.error.message.includes('already linked') ? 'К этому игроку уже привязан другой аккаунт.' : r.error.message);
    if (!r.data) return setError('Код не подошёл или устарел. Попросите родителя создать новый.');
    onLinked();
  };

  return (
    <main className="page">
      <h1>Мои баллы</h1>
      <section className="card">
        <h2>Введите код</h2>
        <p className="muted">Код создаёт родитель в приложении: «Профиль», «Мои дети», «Код для ребёнка». Он действует 3 дня.</p>
        <form
          className="search"
          onSubmit={e => {
            e.preventDefault();
            void submit();
          }}
        >
          <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="КОД" maxLength={8} autoComplete="off" autoCapitalize="characters" aria-label="Код от родителя" />
          <button className="btn" disabled={busy || code.trim().length < 8}>
            Привязать
          </button>
        </form>
        {error && <p className="error">{error}</p>}
      </section>
    </main>
  );
}

// «Мои баллы» ребёнка: баллы, последние события и сыгранные матчи.
export default function ChildHome({ player }: { player: ChildPlayer }) {
  const [t, setT] = useState<Totals | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    void (async () => {
      const ev = await supabase.from('point_events').select('points, explanation, occurred_on').eq('player_id', player.id).order('occurred_on', { ascending: false }).limit(1000);
      if (ev.error) return setError(ev.error.message);
      const mp = await supabase.from('match_players').select('played, goals').eq('player_id', player.id);
      if (mp.error) return setError(mp.error.message);
      const rows = (ev.data ?? []) as Totals['recent'];
      const parts = (mp.data ?? []) as { played: boolean; goals: number }[];
      setT({ points: rows.reduce((s, r) => s + r.points, 0), recent: rows.slice(0, 10), played: parts.filter(p => p.played).length, goals: parts.reduce((s, p) => s + (p.goals ?? 0), 0) });
    })();
  }, [player.id, reload]);

  if (error) return <Failure title="Не удалось загрузить баллы" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} />;
  if (!t) return <Loading />;
  return (
    <main className="page">
      <h1>Мои баллы</h1>
      <section className="card">
        <div className="row">
          <div>
            <h2>{player.name}</h2>
            {player.group && <p className="muted">{player.group}</p>}
          </div>
          <div className="score">
            <strong>{t.points}</strong>
            <span className="muted"> {plural(t.points)}</span>
          </div>
        </div>
        <p className="muted">Матчей сыграно: {t.played} · голов: {t.goals}</p>
        {t.recent.length > 0 ? (
          <ul className="events">
            {t.recent.map((e, i) => (
              <li key={i}>
                <span>{e.explanation}</span>
                <span className="muted">
                  {fmtDate(e.occurred_on)} · {e.points > 0 ? '+' : ''}{e.points}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon="trophy" title="Пока нет баллов" text="Баллы появятся после тренировок и матчей." />
        )}
      </section>
    </main>
  );
}
