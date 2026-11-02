import { useEffect, useState } from 'react';
import { coachError, fmtDate, today } from '../lib/coach';
import { isGuest, statusLabel, statusTone, type PlayerStatus } from '../lib/playerStatus';
import { supabase } from '../lib/supabase';
import { Pill } from '../ui/components';

interface LogRow { status: PlayerStatus; on_date: string; until_on: string | null; comment: string | null }
type Mode = PlayerStatus | null;

const HINT: Record<PlayerStatus, string> = {
  paused: 'Плату за паузу не берём. Игрок не попадает в отметки и новые матчи, в списке должников не показывается. История и баллы сохраняются.',
  inactive: 'Игрок не попадает в отметки и новые матчи, в списке должников не показывается. История матчей, баллы и платежи сохраняются.',
  active: 'Игрок возвращается в отметки и списки группы.',
};
const TITLE: Record<PlayerStatus, string> = { paused: 'Поставить на паузу', inactive: 'Игрок ушёл', active: 'Вернуть в группу' };

// Статус игрока в карточке: текущий статус с датами, смена (пауза, уход, возвращение) и история. Меняет администратор (player_set_status, миграция 0104).
export default function PlayerStatusPanel({ playerId, status, externalId, onChanged }: { playerId: string; status: PlayerStatus; externalId: string | null; onChanged: (s: PlayerStatus) => void }) {
  const [log, setLog] = useState<LogRow[]>([]);
  const [mode, setMode] = useState<Mode>(null);
  const [date, setDate] = useState(today());
  const [until, setUntil] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    void supabase.from('player_status_log').select('status, on_date, until_on, comment').eq('player_id', playerId).order('on_date', { ascending: false }).order('created_at', { ascending: false }).limit(30).then(r => {
      // без миграции 0104 таблицы нет: история просто не показывается
      if (!r.error) setLog((r.data ?? []) as LogRow[]);
    });
  }, [playerId, reload]);

  const open = (m: PlayerStatus) => { setMode(m); setDate(today()); setUntil(''); setNote(''); setError(null); };
  const save = async () => {
    if (!mode) return;
    if (mode === 'paused' && until && until < date) return setError('Дата возвращения раньше даты начала паузы.');
    setBusy(true);
    setError(null);
    const r = await supabase.rpc('player_set_status', { p: playerId, s: mode, d: date, until: mode === 'paused' && until ? until : null, note: note.trim() || null });
    setBusy(false);
    if (r.error) return setError(coachError(r.error.message));
    onChanged(mode);
    setMode(null);
    setReload(n => n + 1);
  };

  const last = log[0];
  const detail = last && last.status === status ? `с ${fmtDate(last.on_date)}${status === 'paused' && last.until_on ? `, вернётся ${fmtDate(last.until_on)}` : ''}` : '';
  const guest = status === 'inactive' && isGuest(externalId);

  return (
    <section aria-label="Статус игрока" style={{ margin: '8px 0 12px' }}>
      <p style={{ margin: '0 0 8px' }}>
        <Pill tone={statusTone(status)} dot>{statusLabel(status, externalId)}</Pill>
        {detail && <span className="muted" style={{ marginLeft: 8 }}>{detail}</span>}
      </p>
      {!mode && !guest && (
        <div className="two" style={{ alignItems: 'stretch' }}>
          {status === 'active' && <button type="button" className="ks-btn secondary" onClick={() => open('paused')}>{TITLE.paused}</button>}
          {status !== 'inactive' && <button type="button" className="ks-btn secondary" onClick={() => open('inactive')}>{TITLE.inactive}</button>}
          {status !== 'active' && <button type="button" className="ks-btn secondary" onClick={() => open('active')}>{TITLE.active}</button>}
        </div>
      )}
      {mode && (
        <div className="ks-card" aria-label={TITLE[mode]}>
          <p className="ks-label">{TITLE[mode]}</p>
          <label className="ks-label" htmlFor="ps-date">{mode === 'paused' ? 'Пауза с' : mode === 'inactive' ? 'Дата ухода' : 'Дата возвращения'}</label>
          <input id="ps-date" className="ks-input" type="date" value={date} onChange={e => setDate(e.target.value)} />
          {mode === 'paused' && (
            <>
              <label className="ks-label" htmlFor="ps-until">Вернётся (необязательно)</label>
              <input id="ps-until" className="ks-input" type="date" value={until} onChange={e => setUntil(e.target.value)} />
            </>
          )}
          <label className="ks-label" htmlFor="ps-note">Комментарий (необязательно)</label>
          <input id="ps-note" className="ks-input" value={note} onChange={e => setNote(e.target.value)} maxLength={200} />
          <p className="muted" style={{ fontSize: 13, margin: '8px 0' }}>{HINT[mode]}</p>
          {error && <p className="error">{error}</p>}
          <button type="button" className="ks-btn" disabled={busy || !date} onClick={() => void save()}>Сохранить</button>
          <div style={{ height: 8 }} />
          <button type="button" className="ks-btn secondary" disabled={busy} onClick={() => setMode(null)}>Отмена</button>
        </div>
      )}
      {log.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary className="muted">История статуса ({log.length})</summary>
          {log.map((l, i) => (
            <p key={i} className="muted" style={{ fontSize: 13, margin: '4px 0' }}>
              {fmtDate(l.on_date)} · {statusLabel(l.status)}{l.until_on ? `, вернётся ${fmtDate(l.until_on)}` : ''}{l.comment ? ` · ${l.comment}` : ''}
            </p>
          ))}
        </details>
      )}
    </section>
  );
}
