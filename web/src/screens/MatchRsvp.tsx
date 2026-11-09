import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { fmtWhen, linkLabel, responseText, rsvpError, splitLinks, type MyRsvp, type RsvpResponse } from '../lib/matchRsvp';
import { Pill } from '../ui/components';

/** Текст с кликабельными ссылками (откроются в браузере телефона) */
function LinkText({ text }: { text: string }) {
  return (
    <>
      {splitLinks(text).map((p, i) => (p.href
        ? <a key={i} href={p.href} target="_blank" rel="noreferrer noopener" style={{ fontWeight: 600 }}>{linkLabel(p.href)}</a>
        : <span key={i}>{p.text}</span>))}
    </>
  );
}
const LABEL = { fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase' as const, margin: '10px 0 2px' };

const KIND: Record<string, string> = { game: 'Матч чемпионата', friendly: 'Товарищеский матч' };
/** Сколько после начала матч считаем «идущим», если счёта ещё нет (допущение: матч длится не дольше 1,5 часа) */
const LIVE_WINDOW_MS = 1.5 * 3600_000;

/**
 * Подтверждение участия для родителя: матчи, на которые приглашены его дети. Только свои дети; других игроков, ответов
 * других семей и статистики здесь нет (база их не отдаёт). Ответ один на ребёнка и общий для обоих родителей.
 * «Предстоящие» — опубликованные и ещё не начавшиеся, «Прошедшие» — начавшиеся и отменённые.
 */
export default function RsvpSection({ rows, part, onChanged, withResult = new Set() }: { rows: MyRsvp[]; part: 'upcoming' | 'past'; onChanged: () => void; withResult?: Set<string> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = Date.now();
  /** Статус прошедшего матча: со счётом — «Прошёл»; без счёта и начался недавно — «Идёт»; иначе — «не внесён» */
  const pastStatus = (m: MyRsvp) => {
    if (withResult.has(m.match_id)) return 'Прошёл';
    return now - new Date(m.starts_at).getTime() < LIVE_WINDOW_MS ? 'Идёт' : 'Прошёл, результат не внесён';
  };
  const upcoming = (r: MyRsvp) => r.lifecycle_status === 'published' && new Date(r.starts_at).getTime() > now;
  const mine = rows.filter(r => (part === 'upcoming' ? upcoming(r) : !upcoming(r)));
  const matches = [...new Set(mine.map(r => r.match_id))];
  if (!matches.length) return null;

  const answer = async (r: MyRsvp, v: RsvpResponse) => {
    setBusy(`${r.match_id}|${r.player_id}`);
    setError(null);
    const res = await supabase.rpc('match_rsvp_answer', { m: r.match_id, p_player: r.player_id, p_response: v });
    setBusy(null);
    if (res.error) setError(rsvpError(res.error.message));
    onChanged();
  };

  const dir = part === 'upcoming' ? 1 : -1; // ближайшие сверху, прошедшие — свежие сверху
  const sorted = matches.map(id => mine.filter(r => r.match_id === id)).sort((a, b) => dir * (a[0].starts_at < b[0].starts_at ? -1 : a[0].starts_at > b[0].starts_at ? 1 : 0));
  return (
    <section aria-label={part === 'upcoming' ? 'Подтверждение участия' : 'Прошедшие матчи с подтверждением'}>
      <h2 className="ks-sub">{part === 'upcoming' ? 'Подтвердите участие' : 'Отменённые и начавшиеся'}</h2>
      {error && <p role="alert" className="muted" style={{ color: 'var(--ks-danger-strong)' }}>{error}</p>}
      {sorted.map(kids => {
        const m = kids[0];
        const cancelled = m.lifecycle_status === 'cancelled';
        return (
          <div className="ks-card" key={m.match_id} aria-label={`Матч ${m.opponent ?? ''}`.trim()}>
            <div className="ks-line">
              <b>{m.opponent ?? 'Соперник уточняется'}</b>
              {cancelled ? <Pill tone="danger">Отменён</Pill> : m.rescheduled ? <Pill tone="warning">Перенесён</Pill> : <Pill tone="primary">{part === 'upcoming' ? 'Предстоит' : pastStatus(m)}</Pill>}
            </div>
            <p style={{ margin: '6px 0 0', fontSize: '1.05rem', fontWeight: 700 }}>{fmtWhen(m.starts_at)}</p>
            <p className="muted" style={{ margin: '2px 0 0' }}>{m.team}{m.kind ? ` · ${KIND[m.kind] ?? ''}` : ''}</p>
            {(m.venue || m.address) && (
              <>
                <p className="muted" style={LABEL}>Где играем</p>
                <p style={{ margin: 0 }}>{m.venue && <b>{m.venue}</b>}{m.venue && m.address ? ' · ' : ''}{m.address && <LinkText text={m.address} />}</p>
              </>
            )}
            {m.notes && (
              <>
                <p className="muted" style={LABEL}>От тренера</p>
                <p style={{ margin: 0 }}><LinkText text={m.notes} /></p>
              </>
            )}
            {kids.map(r => {
              const key = `${r.match_id}|${r.player_id}`;
              return (
                <div key={key} role="group" aria-label={r.player_name} style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--ks-border)' }}>
                  <div className="ks-line"><b>{r.player_name}</b><span className="muted">{cancelled ? 'Матч отменён' : responseText(r.response)}</span></div>
                  {r.responded_by_name && r.response && <p className="muted" style={{ margin: '2px 0' }}>Ответил(а): {r.responded_by_name}</p>}
                  {!cancelled && r.can_answer && (
                    <div className="ks-btns">
                      {(['yes', 'no'] as const).map(v => (
                        <button key={v} type="button" className={`ks-btn sm${r.response === v ? '' : ' secondary'}`} aria-pressed={r.response === v} disabled={busy === key}
                          aria-label={`${r.player_name}: ${v === 'yes' ? 'Будет' : 'Не будет'}`} onClick={() => void answer(r, v)}>
                          {v === 'yes' ? 'Будет' : 'Не будет'}
                        </button>
                      ))}
                    </div>
                  )}
                  {!cancelled && !r.can_answer && <p className="muted" style={{ margin: '2px 0' }}>Приём ответов закрыт</p>}
                </div>
              );
            })}
          </div>
        );
      })}
    </section>
  );
}
