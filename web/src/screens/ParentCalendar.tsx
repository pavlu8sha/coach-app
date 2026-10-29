import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { EmptyState } from '../ui/components';
import { Failure, Loading } from './Message';

interface Child {
  id: string;
  name: string;
}
interface GuardianRow {
  player_id: string;
  players: { id: string; full_name: string | null; groups: { name: string } | null } | null;
}
interface CalendarEvent {
  event_id: string;
  event_date: string;
  event_time: string | null;
  event_type: 'match' | 'training';
  title: string;
  location: string | null;
  event_status: 'past' | 'completed' | 'upcoming';
  attendance_status: 'present' | 'absent' | 'excused' | 'played' | 'not_played' | null;
}

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const pad = (n: number) => String(n).padStart(2, '0');
const keyOf = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const dateFromKey = (key: string) => {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
};
const formatDate = (key: string) => dateFromKey(key).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const formatMonth = (date: Date) => date.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
const formatTime = (time: string | null) => time ? time.slice(0, 5) : null;

function statusLabel(event: CalendarEvent) {
  if (event.event_type === 'match' && event.event_status === 'completed') return 'Завершён';
  if (event.event_status === 'past') {
    if (event.attendance_status === 'present') return 'Был';
    if (event.attendance_status === 'absent') return 'Не был';
    if (event.attendance_status === 'excused') return 'Пропуск';
    return 'Прошло';
  }
  if (event.event_type === 'match') return 'Матч';
  return event.title.includes('расписанию') ? 'По расписанию' : 'Предстоит';
}

export default function ParentCalendar() {
  const [children, setChildren] = useState<Child[]>([]);
  const [playerId, setPlayerId] = useState('');
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState(() => keyOf(new Date()));
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [childrenLoading, setChildrenLoading] = useState(true);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [childrenError, setChildrenError] = useState(false);
  const [eventsError, setEventsError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setChildrenLoading(true);
      setChildrenError(false);
      const me = (await supabase.auth.getUser()).data.user?.id;
      if (!me) {
        if (!cancelled) { setChildrenError(true); setChildrenLoading(false); }
        return;
      }
      const { data, error } = await supabase
        .from('player_guardians')
        .select('player_id, players(id, full_name, groups(name))')
        .eq('user_id', me)
        .is('consent_revoked_at', null)
        .order('player_id');
      if (cancelled) return;
      if (error) {
        setChildrenError(true);
      } else {
        const next = ((data ?? []) as unknown as GuardianRow[])
          .map(row => row.players ? { id: row.players.id, name: row.players.full_name ?? 'Ребёнок' } : null)
          .filter((child): child is Child => child !== null);
        setChildren(next);
        setPlayerId(current => next.some(child => child.id === current) ? current : next[0]?.id ?? '');
      }
      setChildrenLoading(false);
    })();
    return () => { cancelled = true; };
  }, [retry]);

  useEffect(() => {
    if (!playerId) { setEvents([]); return; }
    let cancelled = false;
    void (async () => {
      setEventsLoading(true);
      setEventsError(false);
      const from = keyOf(new Date(month.getFullYear(), month.getMonth(), 1));
      const to = keyOf(new Date(month.getFullYear(), month.getMonth() + 1, 0));
      const { data, error } = await supabase.rpc('parent_calendar', {
        p_player: playerId,
        p_from: from,
        p_to: to,
      });
      if (cancelled) return;
      if (error) {
        setEventsError(true);
        setEvents([]);
      } else {
        setEvents((data ?? []) as CalendarEvent[]);
      }
      setEventsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [playerId, month, retry]);

  const eventDays = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events) map.set(event.event_date, [...(map.get(event.event_date) ?? []), event]);
    return map;
  }, [events]);

  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const offset = (first.getDay() + 6) % 7;
    return [...Array(offset).fill(null), ...Array.from({ length: count }, (_, i) => keyOf(new Date(month.getFullYear(), month.getMonth(), i + 1)))];
  }, [month]);

  const selectedEvents = eventDays.get(selectedDate) ?? [];
  const shiftMonth = (delta: number) => {
    const next = new Date(month.getFullYear(), month.getMonth() + delta, 1);
    setMonth(next);
    setSelectedDate(keyOf(next));
  };
  const goToday = () => {
    const today = new Date();
    setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDate(keyOf(today));
  };

  if (childrenLoading) return <Loading />;
  if (childrenError) return <Failure title="Не удалось загрузить календарь" text="Не получилось проверить связь с ребёнком. Повтори попытку." onRetry={() => setRetry(n => n + 1)} />;
  if (!children.length) {
    return <main className="page"><EmptyState icon="calendar" title="Нет привязанных детей" text="Календарь появится после подтверждения связи с ребёнком." /></main>;
  }

  return (
    <main className="page">
      <h1>Календарь ребёнка</h1>
      <label htmlFor="parent-calendar-child" style={{ display: 'block', marginBottom: 6, fontSize: 14, fontWeight: 600 }}>Ребёнок</label>
      <select
        id="parent-calendar-child"
        aria-label="Ребёнок"
        className="ks-input"
        value={playerId}
        onChange={event => setPlayerId(event.target.value)}
        style={{ width: '100%', maxWidth: 420, marginBottom: 16 }}
      >
        {children.map(child => <option key={child.id} value={child.id}>{child.name}</option>)}
      </select>

      <section aria-label="Календарь событий" style={{ maxWidth: 560, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
          <button type="button" className="ks-btn sm" aria-label="Предыдущий месяц" onClick={() => shiftMonth(-1)}>‹</button>
          <h2 style={{ margin: 0, textTransform: 'capitalize', fontSize: 18 }}>{formatMonth(month)}</h2>
          <button type="button" className="ks-btn sm" aria-label="Следующий месяц" onClick={() => shiftMonth(1)}>›</button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button type="button" className="ks-btn sm" onClick={goToday}>Сегодня</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4 }} role="grid" aria-label={formatMonth(month)}>
          {WEEKDAYS.map(day => <div key={day} role="columnheader" style={{ textAlign: 'center', fontSize: 12, color: 'var(--ks-text-muted, #5a6584)', padding: '6px 0' }}>{day}</div>)}
          {cells.map((date, index) => date ? (
            <button
              key={date}
              type="button"
              role="gridcell"
              aria-label={`${formatDate(date)}${eventDays.has(date) ? `, событий: ${eventDays.get(date)?.length}` : ''}`}
              aria-pressed={date === selectedDate}
              onClick={() => setSelectedDate(date)}
              style={{
                minWidth: 0, minHeight: 48, padding: '5px 2px', borderRadius: 10,
                border: date === selectedDate ? '2px solid var(--ks-primary, #25335a)' : '1px solid var(--ks-border, #dadfec)',
                background: date === selectedDate ? 'var(--ks-primary-subtle, #dde4f6)' : 'var(--ks-surface, #fff)',
                color: 'var(--ks-text, #141c33)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
                fontWeight: date === keyOf(new Date()) ? 700 : 500,
              }}
            >
              <span>{dateFromKey(date).getDate()}</span>
              <span aria-hidden="true" style={{ display: 'flex', gap: 3, height: 5 }}>
                {(eventDays.get(date) ?? []).slice(0, 3).map(event => <i key={event.event_id} style={{ display: 'block', width: 5, height: 5, borderRadius: '50%', background: event.event_type === 'match' ? '#2d6cdf' : '#23845a' }} />)}
              </span>
            </button>
          ) : <span key={`empty-${index}`} aria-hidden="true" />)}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 12, color: 'var(--ks-text-muted, #5a6584)', margin: '10px 0 20px' }}>
          <span>🔵 Матчи</span><span>🟢 Тренировки</span>
        </div>
      </section>

      <section aria-live="polite" style={{ maxWidth: 560, margin: '0 auto' }}>
        <h2 style={{ fontSize: 18, marginBottom: 12, textTransform: 'capitalize' }}>{formatDate(selectedDate)}</h2>
        {eventsLoading ? <Loading /> : eventsError ? (
          <EmptyState icon="alert" title="События не загрузились" text="Данные не удалось получить. Повтори попытку." action={{ label: 'Повторить', run: () => setRetry(n => n + 1) }} />
        ) : selectedEvents.length ? (
          <div style={{ display: 'grid', gap: 8 }}>
            {selectedEvents.map(event => (
              <article key={event.event_id} style={{ border: '1px solid var(--ks-border, #dadfec)', borderRadius: 12, background: 'var(--ks-surface, #fff)', padding: 12 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 650 }}>{event.title}</div>
                    <div style={{ color: 'var(--ks-text-muted, #5a6584)', fontSize: 13, marginTop: 4 }}>
                      {[formatTime(event.event_time), event.location].filter(Boolean).join(' · ') || (event.event_type === 'match' ? 'Футбольный матч' : 'Тренировка')}
                    </div>
                  </div>
                  <span style={{ flexShrink: 0, fontSize: 12, borderRadius: 999, padding: '4px 8px', background: 'var(--ks-primary-subtle, #dde4f6)', color: 'var(--ks-primary, #25335a)' }}>{statusLabel(event)}</span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState icon="calendar" title="На этот день событий нет" text="Выбери другую дату или перейди к следующему месяцу." />
        )}
      </section>
    </main>
  );
}
