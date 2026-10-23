import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import Message from './Message';

interface Slot { weekday: number; starts_at: string; ends_at: string | null; location: string | null; kind: string; coaches: string | null }
interface Match { id: string; played_on: string; opponent: string | null; goals_for: number | null; goals_against: number | null }
interface GroupView { id: string; name: string; kids: string[]; slots: Slot[]; upcoming: Match[]; results: Match[] }

const DAYS = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const hm = (t: string | null) => (t ? t.slice(0, 5) : '');
const fmtDate = (iso: string) => iso.split('-').reverse().slice(0, 2).join('.');
const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD по местному времени телефона

// Расписание и матчи групп, в которых играют дети текущего пользователя.
export default function Schedule() {
  const [groups, setGroups] = useState<GroupView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const me = (await supabase.auth.getUser()).data.user?.id;
      if (!me) return setError('Нет сессии');
      const links = await supabase
        .from('player_guardians')
        .select('players(full_name, group_id, groups(name))')
        .eq('user_id', me)
        .is('consent_revoked_at', null);
      if (links.error) return setError(links.error.message);

      const byGroup = new Map<string, GroupView>();
      for (const l of (links.data ?? []) as any[]) {
        const p = l.players;
        if (!p?.group_id) continue;
        const g: GroupView = byGroup.get(p.group_id) ?? { id: p.group_id, name: p.groups?.name ?? '', kids: [], slots: [], upcoming: [], results: [] };
        g.kids.push(p.full_name);
        byGroup.set(p.group_id, g);
      }
      const list = [...byGroup.values()];
      for (const g of list) {
        const sl = await supabase.from('weekly_schedule').select('weekday, starts_at, ends_at, location, kind, coaches').eq('group_id', g.id).order('weekday').order('starts_at');
        if (sl.error) return setError(sl.error.message);
        g.slots = (sl.data ?? []) as Slot[];
        if (g.name) {
          const m = await supabase.from('matches').select('id, played_on, opponent, goals_for, goals_against').eq('team', g.name).order('played_on', { ascending: false }).limit(40);
          if (m.error) return setError(m.error.message);
          const rows = (m.data ?? []) as Match[];
          const t = today();
          g.upcoming = rows.filter(r => r.played_on >= t && r.goals_for === null).reverse().slice(0, 5);
          g.results = rows.filter(r => r.goals_for !== null && r.goals_against !== null).slice(0, 3);
        }
      }
      setGroups(list);
    })();
  }, []);

  if (error) return <Message title="Не удалось загрузить расписание" text={error} />;
  if (!groups) return <Message title="Загрузка…" />;
  if (!groups.length) return <Message title="Расписание" text="Расписание появится, когда администратор подтвердит связь с ребёнком." />;

  return (
    <main className="page">
      <h1>Расписание</h1>
      {groups.map(g => (
        <section className="card" key={g.id}>
          <h2>{g.name}</h2>
          <p className="muted">{g.kids.join(', ')}</p>

          <h3>Тренировки</h3>
          {g.slots.length === 0 && <p className="muted">Расписание пока не заполнено.</p>}
          <ul className="events">
            {g.slots.map((s, i) => (
              <li key={i}>
                <span>
                  <strong>{DAYS[s.weekday]}</strong> {hm(s.starts_at)}
                  {s.ends_at ? `–${hm(s.ends_at)}` : ''}
                  {s.kind !== 'Групповая' && <span className="muted"> · {s.kind}</span>}
                </span>
                <span className="muted">{s.location ?? ''}</span>
              </li>
            ))}
          </ul>

          {g.upcoming.length > 0 && (
            <>
              <h3>Ближайшие матчи</h3>
              <ul className="events">
                {g.upcoming.map(m => (
                  <li key={m.id}>
                    <span>{m.opponent ?? 'Соперник уточняется'}</span>
                    <span className="muted">{fmtDate(m.played_on)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {g.results.length > 0 && (
            <>
              <h3>Последние результаты</h3>
              <ul className="events">
                {g.results.map(m => (
                  <li key={m.id}>
                    <span>{m.opponent ?? 'Матч'}</span>
                    <span className="muted">
                      {m.goals_for}:{m.goals_against} · {fmtDate(m.played_on)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      ))}
    </main>
  );
}
