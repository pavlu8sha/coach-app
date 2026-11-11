import { useEffect, useState } from 'react';
import { coachError } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { useConfirm } from '../ui/ConfirmSheet';
import { SearchInput } from '../ui/components';

// Разовые посещения (миграция 0177): игрок другой группы пришёл на эту тренировку. Не отметка группы и не абонемент:
// баллы начисляются автоматически, оплата идёт отдельной строкой кассы и в долг по абонементу не входит.
interface Guest { player_id: string; amount: number; paid: boolean; paid_amount: number | null; method: string | null; players: { full_name: string; groups: { name: string } | null } | null }
interface Found { id: string; full_name: string; groups: { name: string } | null }

const METHODS = ['Наличные', 'Перевод'];
const gel = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2)} ₾`;
const errText = (m: string) =>
  m.includes('same group') ? 'Игрок из этой же группы: его отмечают в списке группы.' :
  m.includes('player not active') ? 'Игрок сейчас не занимается.' :
  m.includes('visit paid') ? 'Сначала снимите оплату.' :
  m.includes('invalid setting visit.fee') ? 'В настройках неверная сумма разового посещения (visit.fee).' :
  m.includes('bad method') ? 'Выберите способ оплаты: наличные или перевод.' :
  m.includes('forbidden') ? 'Нет прав на это действие. Оплату снимает администратор.' :
  coachError(m);

export default function GuestVisits({ gid, date, admin = false }: { gid: string; date: string; admin?: boolean }) {
  const [guests, setGuests] = useState<Guest[] | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Found[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const { ask, dialog } = useConfirm();

  useEffect(() => {
    void (async () => {
      const s = await supabase.from('sessions').select('id').eq('group_id', gid).eq('source_key', 'ATT|' + date).maybeSingle();
      if (s.error) return setError(s.error.message);
      const id = (s.data as { id: string } | null)?.id ?? null;
      setSessionId(id);
      if (!id) return setGuests([]);
      const g = await supabase.from('session_guests')
        .select('player_id, amount, paid, paid_amount, method, players(full_name, groups(name))')
        .eq('session_id', id);
      if (g.error) return setError(g.error.message);
      setGuests(((g.data ?? []) as unknown as Guest[]).sort((a, b) => (a.players?.full_name ?? '').localeCompare(b.players?.full_name ?? '', 'ru')));
    })();
  }, [gid, date, reload]);

  // Поиск игрока другой группы (тренер видит всех игроков клуба)
  useEffect(() => {
    const needle = q.trim();
    if (needle.length < 2) return setFound([]);
    let live = true;
    void (async () => {
      const r = await supabase.from('players').select('id, full_name, groups(name)').eq('status', 'active').neq('group_id', gid).ilike('full_name', `%${needle}%`).order('full_name').limit(8);
      if (live && !r.error) setFound((r.data ?? []) as unknown as Found[]);
    })();
    return () => { live = false; };
  }, [q, gid]);

  const run = async (key: string, call: () => PromiseLike<{ error: { message: string } | null }>, ok?: string) => {
    setBusy(key);
    setMsg(null);
    const r = await call();
    setBusy(null);
    if (r.error) { setMsg({ ok: false, text: errText(r.error.message) }); return false; }
    if (ok) setMsg({ ok: true, text: ok });
    setReload(n => n + 1);
    return true;
  };

  const add = async (p: Found) => {
    setBusy('add-' + p.id);
    setMsg(null);
    // занятие группы за день открывается так же, как при сохранении отметок
    let sid = sessionId;
    if (!sid) {
      const o = await supabase.rpc('open_session', { g: gid, d: date });
      if (o.error) { setBusy(null); return setMsg({ ok: false, text: coachError(o.error.message) }); }
      sid = o.data as string;
      setSessionId(sid);
    }
    setBusy(null);
    if (await run('add-' + p.id, () => supabase.rpc('session_guest_add', { s: sid, p: p.id }), `${p.full_name} добавлен как гость. Баллы начислены автоматически.`)) { setQ(''); setFound([]); }
  };
  const pay = async (g: Guest, mth: string) => {
    const name = g.players?.full_name ?? 'Игрок';
    if (!(await ask({ title: 'Принять оплату?', lines: [['Игрок', name], ['Сумма', gel(Number(g.amount))], ['Способ', mth]], confirmLabel: 'Принять оплату' }))) return;
    await run(g.player_id + mth, () => supabase.rpc('session_guest_set_paid', { s: sessionId, p: g.player_id, is_paid: true, mth }));
  };
  const unpay = async (g: Guest) => {
    if (!(await ask({ title: 'Отменить оплату?', lines: [['Игрок', g.players?.full_name ?? 'Игрок'], ['Сумма', gel(Number(g.paid_amount ?? g.amount))]], note: 'Посещение снова станет неоплаченным, в кассе появится строка с минусом.', confirmLabel: 'Отменить оплату', danger: true }))) return;
    await run(g.player_id + 'unpay', () => supabase.rpc('session_guest_set_paid', { s: sessionId, p: g.player_id, is_paid: false }));
  };
  const remove = async (g: Guest) => {
    if (!(await ask({ title: 'Убрать гостя?', lines: [['Игрок', g.players?.full_name ?? 'Игрок']], note: 'Начисленные за это посещение баллы будут сняты.', confirmLabel: 'Убрать', danger: true }))) return;
    await run(g.player_id + 'rm', () => supabase.rpc('session_guest_remove', { s: sessionId, p: g.player_id }));
  };

  if (error) return <p className="error">Не удалось загрузить разовые посещения: {error}</p>;
  const have = new Set((guests ?? []).map(g => g.player_id));
  return (
    <section aria-label="Разовые посещения" style={{ marginTop: 20 }}>
      <h2>Разовые посещения</h2>
      <p className="muted">Игрок из другой группы пришёл на эту тренировку. Баллы начисляются как за обычную тренировку, оплата записывается отдельно и в долг по абонементу не входит.</p>
      {guests === null ? <p className="muted">Загрузка…</p> : guests.map(g => (
        <div className="ks-mark" key={g.player_id} role="group" aria-label={`Гость: ${g.players?.full_name ?? ''}`} style={{ flexWrap: 'wrap' }}>
          <b>{g.players?.full_name ?? 'Игрок'}</b>
          <span className="muted">{g.players?.groups?.name ?? 'без группы'} · {gel(Number(g.amount))}</span>
          {g.paid ? <span className="ks-ok">Оплачено{g.method ? ` (${g.method})` : ''}</span> : <span className="error">Не оплачено</span>}
          <span className="ks-actions">
            {!g.paid && METHODS.map(m => (
              <button key={m} type="button" className="ks-btn secondary sm" disabled={busy !== null} onClick={() => void pay(g, m)}>{m}</button>
            ))}
            {!g.paid && <button type="button" className="ks-btn secondary sm" disabled={busy !== null} onClick={() => void remove(g)}>Убрать</button>}
            {g.paid && admin && <button type="button" className="ks-btn secondary sm" disabled={busy !== null} onClick={() => void unpay(g)}>Отменить оплату</button>}
          </span>
        </div>
      ))}
      <SearchInput label="Добавить гостя" placeholder="Добавить гостя: имя игрока другой группы" value={q} onChange={setQ} />
      {found.filter(p => !have.has(p.id)).map(p => (
        <div className="ks-mark" key={p.id}>
          <b>{p.full_name}</b>
          <span className="muted">{p.groups?.name ?? 'без группы'}</span>
          <button type="button" className="ks-btn secondary sm" disabled={busy !== null} onClick={() => void add(p)}>Добавить</button>
        </div>
      ))}
      {msg && <p className={msg.ok ? 'ks-ok' : 'error'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}
      {dialog}
    </section>
  );
}
