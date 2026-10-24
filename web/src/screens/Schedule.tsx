import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { EmptyState } from '../ui/components';
import { Failure, Loading } from './Message';
import SlotEdit, { type SlotForm } from './SlotEdit';

interface Slot { id: string; weekday: number; starts_at: string; ends_at: string | null; location: string | null; kind: string; coaches: string | null }
interface Match { id: string; played_on: string; opponent: string | null; goals_for: number | null; goals_against: number | null }
interface GroupView { id: string; name: string; kids: string[]; slots: Slot[]; upcoming: Match[]; results: Match[] }

const DAYS = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const hm = (t: string | null) => (t ? t.slice(0, 5) : '');
const fmtDate = (iso: string) => iso.split('-').reverse().slice(0, 2).join('.');
const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD по местному времени телефона

// Расписание и матчи групп, в которых играют дети текущего пользователя.
export default function Schedule({ all = false, editable = all }: { all?: boolean; editable?: boolean }) {
  const [groups, setGroups] = useState<GroupView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<{ group: string; slot: SlotForm; key: string } | null>(null);

  useEffect(() => {
    void (async () => {
      const byGroup = new Map<string, GroupView>();
      if (all) {
        // администратор: расписание всех групп
        const gr = await supabase.from('groups').select('id, name').order('name');
        if (gr.error) return setError(gr.error.message);
        for (const x of (gr.data ?? []) as { id: string; name: string }[]) byGroup.set(x.id, { id: x.id, name: x.name, kids: [], slots: [], upcoming: [], results: [] });
      } else {
        const me = (await supabase.auth.getUser()).data.user?.id;
        if (!me) return setError('Нет сессии');
        const links = await supabase
          .from('player_guardians')
          .select('players(full_name, group_id, groups(name))')
          .eq('user_id', me)
          .is('consent_revoked_at', null);
        if (links.error) return setError(links.error.message);
        for (const l of (links.data ?? []) as any[]) {
          const p = l.players;
          if (!p?.group_id) continue;
          const g: GroupView = byGroup.get(p.group_id) ?? { id: p.group_id, name: p.groups?.name ?? '', kids: [], slots: [], upcoming: [], results: [] };
          g.kids.push(p.full_name);
          byGroup.set(p.group_id, g);
        }
      }
      const list = [...byGroup.values()];
      for (const g of list) {
        const sl = await supabase.from('weekly_schedule').select('id, weekday, starts_at, ends_at, location, kind, coaches').eq('group_id', g.id).order('weekday').order('starts_at');
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
      // у администратора не показываем группы, о которых ничего нет (архивные, пустые)
      setGroups(all ? list.filter(g => g.slots.length || g.upcoming.length || g.results.length || editable) : list);
    })();
  }, [all, reload]);

  if (error) return <Failure title="Не удалось загрузить расписание" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} />;
  if (!groups) return <Loading />;
  if (!groups.length) return <main className="page"><h1>Расписание</h1><EmptyState icon="box" title="Пока пусто" text="Расписание появится, когда администратор подтвердит связь с ребёнком." /></main>;

  const done = () => {
    setEditing(null);
    setReload(n => n + 1);
  };
  return (
    <main className="page">
      <h1>Расписание</h1>
      {groups.map(g => (
        <section className="ks-card" key={g.id}>
          <h2>{g.name}</h2>
          {g.kids.length > 0 && <p className="muted">{g.kids.join(', ')}</p>}

          <h3>Тренировки</h3>
          {g.slots.length === 0 && <p className="muted">Расписание пока не заполнено.</p>}
          <div>
            {g.slots.map(s => (
              <div className="ks-slot" key={s.id} style={editable && editing?.key === s.id ? { display: 'block' } : undefined}>
                {editable && editing?.key === s.id ? (
                  <SlotEdit groupId={g.id} initial={editing.slot} onDone={done} onCancel={() => setEditing(null)} />
                ) : (
                  <>
                    <span className="ks-slot-main">
                      <strong>{DAYS[s.weekday]}</strong> {hm(s.starts_at)}
                      {s.ends_at ? `–${hm(s.ends_at)}` : ''}
                      {(s.kind !== 'Групповая' || s.location) && (
                        <span className="ks-muted">
                          {[s.kind !== 'Групповая' ? s.kind : null, s.location].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </span>
                    {editable && (
                      <button className="ks-btn secondary sm" onClick={() => setEditing({ group: g.id, key: s.id, slot: s })}>
                        Изменить
                      </button>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
          {editable && (editing?.key === `new-${g.id}` ? (
            <SlotEdit groupId={g.id} initial={editing.slot} onDone={done} onCancel={() => setEditing(null)} />
          ) : (
            <button className="ks-btn secondary" style={{ marginTop: 10 }} onClick={() => setEditing({ group: g.id, key: `new-${g.id}`, slot: { weekday: 1, starts_at: '', ends_at: null, location: null, kind: 'Групповая', coaches: null } })}>
              Добавить тренировку
            </button>
          ))}

          {g.upcoming.length > 0 && (
            <>
              <h3>Ближайшие матчи</h3>
              <div>
                {g.upcoming.map(m => (
                  <div className="ks-slot" key={m.id}>
                    <span className="ks-slot-main">{m.opponent ?? 'Соперник уточняется'}</span>
                    <span className="ks-slot-end">{fmtDate(m.played_on)}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {g.results.length > 0 && (
            <>
              <h3>Последние результаты</h3>
              <div>
                {g.results.map(m => (
                  <div className="ks-slot" key={m.id}>
                    <span className="ks-slot-main">{m.opponent ?? 'Матч'}</span>
                    <span className="ks-slot-end">
                      {m.goals_for}:{m.goals_against} · {fmtDate(m.played_on)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      ))}
    </main>
  );
}
