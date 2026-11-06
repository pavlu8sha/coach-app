import { useEffect, useState } from 'react';
import { coachError, hm } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { EmptyState, ListRow, SearchInput } from '../ui/components';
import { Loading } from './Message';
import { useNavState } from '../nav';

interface Template { id: string; isodow: number; start_time: string; end_time?: string | null; goalkeepers: boolean; active: boolean }
interface Overflow { template_id: string; regulars: number; cap: number }
interface Member { template_id: string; player_id: string; players: { full_name: string } | null }

const DAYS = ['', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
const slotTitle = (t: Template) => `${DAYS[t.isodow]} ${hm(t.start_time.slice(0, 5))}${t.end_time ? `–${hm(t.end_time.slice(0, 5))}` : ''} · ${t.goalkeepers ? 'Вратари' : 'Индивидуальные'}`;
const thisMonth = () => new Date().toISOString().slice(0, 7);

// Постоянные игроки по месяцам (миграция 0090): на какие слоты расписания игрок записывается в выбранном месяце.
// Занятия на выходные создаются автоматически по вторникам и сразу записывают постоянных этого месяца.
export default function IndRegulars() {
  const [month, setMonth] = useNavState('ir.month', thisMonth());
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [overflow, setOverflow] = useState<Overflow[]>([]);
  const [tplId, setTplId] = useNavState('ir.tpl', '');
  const [q, setQ] = useState('');
  const [found, setFound] = useState<{ id: string; full_name: string }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [reload, setReload] = useState(0);
  const [ends, setEnds] = useState<Record<string, string>>({});

  useEffect(() => {
    void supabase.from('individual_templates').select('id, isodow, start_time, end_time, goalkeepers, active').eq('active', true).order('isodow').order('start_time').then(r => {
      if (r.error) return setMsg({ ok: false, text: r.error.message.includes('individual_templates') ? 'Расписание ещё не установлено в базе (миграция 0090).' : coachError(r.error.message) });
      const rows = (r.data ?? []) as Template[];
      setTemplates(rows);
      setEnds(Object.fromEntries(rows.map(t => [t.id, t.end_time ? t.end_time.slice(0, 5) : ''])));
      setTplId(cur => cur || rows[0]?.id || '');
    });
  }, []);

  useEffect(() => {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    void supabase.from('individual_slot_members').select('template_id, player_id, players(full_name)').eq('month', `${month}-01`).then(r => {
      if (!r.error) setMembers((r.data ?? []) as unknown as Member[]);
    });
  }, [month, reload]);

  // Предупреждение: постоянных на слот больше мест (ничего не блокирует; функция из миграции 0141, без неё предупреждений нет)
  useEffect(() => {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    void supabase.rpc('ind_regulars_overflow', { mth: `${month}-01` }).then(r => setOverflow(r.error ? [] : ((r.data ?? []) as Overflow[])));
  }, [month, reload]);

  useEffect(() => {
    if (q.trim().length < 2) return setFound([]);
    const t = setTimeout(() => {
      void supabase.from('players').select('id, full_name').eq('status', 'active').ilike('full_name', `%${q.trim()}%`).order('full_name').limit(8).then(r => {
        if (!r.error) setFound((r.data ?? []) as { id: string; full_name: string }[]);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const run = async (key: string, f: () => PromiseLike<{ error: { message: string } | null; data?: unknown }>, ok: (data: unknown) => string) => {
    setBusy(key);
    setMsg(null);
    const r = await f();
    setBusy(null);
    if (r.error) {
      const m = r.error.message;
      setMsg({ ok: false, text: m.includes('player not in club') ? 'Игрок из другого клуба.' : m.includes('player not active') ? 'Постоянным можно назначить только игрока в статусе «Занимается».' : coachError(m) });
      return false;
    }
    setMsg({ ok: true, text: ok(r.data) });
    setReload(n => n + 1);
    return true;
  };
  const setMember = (tpl: string, p: string, on: boolean) => run((on ? 'a' : 'd') + tpl + p, () => supabase.rpc('ind_slot_member_set', { tpl, p, mth: `${month}-01`, on_: on }), () => (on ? 'Игрок добавлен в постоянные месяца.' : 'Убран из постоянных. Оплаченные записи остались.'));

  // Окончание шаблона (миграция 0150): попадает на занятия, которые создаются автоматически дальше; уже созданные правятся в карточке занятия
  const saveEnd = async (t: Template) => {
    const v = ends[t.id] ?? '';
    if (v && v <= t.start_time.slice(0, 5)) return setMsg({ ok: false, text: 'Окончание должно быть позже начала.' });
    setBusy('e' + t.id);
    setMsg(null);
    const r = await supabase.from('individual_templates').update({ end_time: v || null }).eq('id', t.id);
    setBusy(null);
    if (r.error) return setMsg({ ok: false, text: coachError(r.error.message) });
    setTemplates(cur => (cur ?? []).map(x => (x.id === t.id ? { ...x, end_time: v ? `${v}:00` : null } : x)));
    setMsg({ ok: true, text: 'Окончание слота сохранено: оно будет у новых занятий.' });
  };

  if (!templates) return msg ? <p className="error">{msg.text}</p> : <Loading />;
  if (templates.length === 0) return <EmptyState icon="users" title="Расписание не задано" text="Шаблоны занятий появятся после установки миграции 0090." />;

  return (
    <>
      <p className="muted">Занятия на ближайшие выходные создаются автоматически по вторникам. Постоянные игроки выбранного месяца записываются на свои слоты сразу.</p>
      <button type="button" className="ks-btn secondary" disabled={busy === 'now'} onClick={() => void run('now', () => supabase.rpc('ind_autocreate_now'), d => (Number(d) > 0 ? `Создано занятий: ${Number(d)}.` : 'Все занятия на ближайшие выходные уже созданы.'))}>Создать занятия на выходные сейчас</button>
      <label className="field">Месяц<input type="month" value={month} onChange={e => setMonth(e.target.value)} /></label>
      {msg && <p className={msg.ok ? 'muted' : 'error'} role="status">{msg.text}</p>}

      {templates.map(t => {
        const list = members.filter(m => m.template_id === t.id).sort((a, b) => (a.players?.full_name ?? '').localeCompare(b.players?.full_name ?? '', 'ru'));
        return (
          <section key={t.id}>
            <h3>{slotTitle(t)}</h3>
            <div className="ks-line" style={{ gap: 8, alignItems: 'end' }}>
              <label className="field" style={{ flex: 1 }}>Окончание слота<input type="time" value={ends[t.id] ?? ''} onChange={e => setEnds(cur => ({ ...cur, [t.id]: e.target.value }))} /></label>
              <button type="button" className="ks-btn secondary" style={{ width: 'auto', minHeight: 44 }} aria-label={`Сохранить окончание: ${slotTitle(t)}`} disabled={busy === 'e' + t.id} onClick={() => void saveEnd(t)}>Сохранить</button>
            </div>
            {overflow.filter(o => o.template_id === t.id).map(o => (
              <p key={o.template_id} className="error" role="alert">Постоянных ({o.regulars}) больше мест ({o.cap}): часть не попадёт на занятие.</p>
            ))}
            {list.length === 0 ? <p className="muted">Постоянных на этот месяц нет.</p> : list.map(m => (
              <ListRow key={m.player_id} avatar={m.players?.full_name ?? ''} title={m.players?.full_name ?? 'Игрок'}
                end={<button type="button" className="ks-btn secondary" style={{ width: 'auto', minHeight: 40 }} aria-label={`Убрать: ${m.players?.full_name ?? ''}, ${slotTitle(t)}`} disabled={busy === 'd' + t.id + m.player_id} onClick={() => void setMember(t.id, m.player_id, false)}>Убрать</button>} />
            ))}
          </section>
        );
      })}

      <h3>Добавить постоянного</h3>
      <label className="field" style={{ marginBottom: 10 }}>Слот<select value={tplId} onChange={e => setTplId(e.target.value)}>{templates.map(t => <option key={t.id} value={t.id}>{slotTitle(t)}</option>)}</select></label>
      <SearchInput label="Найти игрока" placeholder="Фамилия или имя (от 2 букв)" value={q} onChange={setQ} suggestions={found.map(f => f.full_name)} />
      {found.map(p => (
        <ListRow key={p.id} avatar={p.full_name} title={p.full_name}
          end={<button type="button" className="ks-btn secondary" style={{ width: 'auto', minHeight: 40 }} disabled={busy === 'a' + tplId + p.id || !tplId} onClick={() => void setMember(tplId, p.id, true).then(ok => { if (ok) setQ(''); })}>Добавить</button>} />
      ))}
    </>
  );
}
