import { useEffect, useState } from 'react';
import { coachError } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { EmptyState, Pill, Segmented } from '../ui/components';
import { Failure, Loading } from './Message';

type Status = 'new' | 'contacted' | 'trial' | 'joined' | 'declined';
interface Lead { id: string; full_name: string; phone: string | null; parent_name: string | null; username: string | null; birth_year: number | null; status: Status; note: string | null; created_at: string; source: string | null }

const LABEL: Record<Status, string> = { new: 'Новая', contacted: 'Связались', trial: 'Пробное', joined: 'В клубе', declined: 'Отказ' };
const NEXT: Status[] = ['contacted', 'trial', 'joined', 'declined'];
const fmt = (iso: string) => new Date(iso).toLocaleDateString('ru', { day: '2-digit', month: '2-digit' });

// Заявки новых родителей из бота «Хочу в KickStart» (миграция 0039). Видит только администратор.
export default function Leads() {
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [rows, setRows] = useState<Lead[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    void supabase.from('trials').select('id, full_name, phone, parent_name, username, birth_year, status, note, created_at, source').order('created_at', { ascending: false }).limit(300).then(r => {
      if (r.error) return setError(r.error.message.includes('birth_year') ? 'Заявки ещё не установлены в базе (миграция 0039).' : coachError(r.error.message));
      setRows((r.data ?? []) as Lead[]);
    });
  }, [reload]);

  const setStatus = async (l: Lead, st: Status) => {
    setBusy(l.id);
    setMsg(null);
    const r = await supabase.rpc('lead_set_status', { i: l.id, st, nt: notes[l.id] ?? l.note ?? '' });
    setBusy(null);
    if (r.error) return setMsg(coachError(r.error.message));
    setRows(null);
    setReload(n => n + 1);
  };

  if (error) return <Failure title="Не удалось загрузить заявки" text={error} onRetry={() => { setError(null); setReload(n => n + 1); }} />;
  const shown = (rows ?? []).filter(l => filter === 'all' || l.status === 'new' || l.status === 'contacted' || l.status === 'trial');
  return (
    <main className="page">
      <h1>Заявки</h1>
      <Segmented label="Фильтр" value={filter} onChange={setFilter} items={[{ value: 'open', label: 'В работе' }, { value: 'all', label: 'Все' }]} />
      {msg && <p className="error">{msg}</p>}
      {!rows ? <Loading /> : shown.length === 0 ? (
        <EmptyState icon="users" title="Заявок нет" text="Здесь появятся родители, которые нажали «Хочу в KickStart» в боте." />
      ) : shown.map(l => (
        <div className="ks-card" key={l.id}>
          <div className="ks-line">
            <b style={{ overflowWrap: 'anywhere' }}>{l.full_name}{l.birth_year ? `, ${l.birth_year} г.р.` : ''}</b>
            <Pill tone={l.status === 'new' ? 'danger' : l.status === 'joined' ? 'success' : 'neutral'} dot>{LABEL[l.status] ?? l.status}</Pill>
          </div>
          <div className="ks-muted" style={{ fontSize: 13, overflowWrap: 'anywhere' }}>
            {fmt(l.created_at)} · {l.parent_name ?? 'родитель'}
            {l.username ? <> · <a href={`https://t.me/${encodeURIComponent(l.username)}`} target="_blank" rel="noreferrer">@{l.username}</a></> : null}
            {l.phone ? <> · <a href={`tel:${l.phone.replace(/[^+\d]/g, '')}`}>{l.phone}</a></> : null}
          </div>
          <input className="ks-input" aria-label="Заметка" placeholder="Заметка" maxLength={300} style={{ marginTop: 8 }} value={notes[l.id] ?? l.note ?? ''} onChange={e => setNotes({ ...notes, [l.id]: e.target.value })} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            {NEXT.filter(s => s !== l.status).map(s => (
              <button key={s} type="button" className="ks-btn secondary" style={{ width: 'auto' }} disabled={busy === l.id} onClick={() => void setStatus(l, s)}>{LABEL[s]}</button>
            ))}
            {(notes[l.id] ?? l.note ?? '') !== (l.note ?? '') && (
              <button type="button" className="ks-btn secondary" style={{ width: 'auto' }} disabled={busy === l.id} onClick={() => void setStatus(l, l.status)}>Сохранить заметку</button>
            )}
          </div>
        </div>
      ))}
    </main>
  );
}
