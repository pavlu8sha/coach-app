import { useEffect, useState } from 'react';
import { coachError } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { EmptyState, Pill, Segmented, SwitchRow } from '../ui/components';
import { useConfirm } from '../ui/ConfirmSheet';
import { Loading } from './Message';

interface Template { id: string; club_id?: string; isodow: number; start_time: string; end_time?: string | null; goalkeepers: boolean; active: boolean }
interface Club { id: string }
interface FormState { isodow: string; start: string; end: string; gk: boolean; active: boolean }
const DAYS = ['', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
const EMPTY: FormState = { isodow: '6', start: '19:00', end: '', gk: false, active: true };
const time5 = (v: string) => v.slice(0, 5);
const slotTitle = (t: Template) => `${DAYS[t.isodow]} ${time5(t.start_time)}${t.end_time ? `–${time5(t.end_time)}` : ''} · ${t.goalkeepers ? 'Вратари' : 'Индивидуальные'}`;

function errText(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('row-level security') || m.includes('permission denied')) return 'Недостаточно прав: изменять шаблоны может только администратор.';
  if (m.includes('duplicate key') || m.includes('individual_templates_club_id_isodow_start_time_goalkeepers_key')) return 'Шаблон с таким днём, временем и типом уже есть. Если он отключён, включите его в списке.';
  if (m.includes('individual_templates_end_after_start') || (m.includes('end_time') && m.includes('check'))) return 'Окончание должно быть позже начала.';
  if (m.includes('individual_templates_isodow_check') || (m.includes('isodow') && m.includes('check'))) return 'День недели должен быть с понедельника по воскресенье.';
  if (m.includes('start_time') && (m.includes('null') || m.includes('not-null'))) return 'Укажите время начала.';
  if (m.includes('individual_templates') && (m.includes('does not exist') || m.includes('schema cache') || m.includes('could not find'))) return 'Расписание ещё не установлено в базе (миграция 0090).';
  return coachError(message);
}

export default function IndTemplates() {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [clubId, setClubId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [reload, setReload] = useState(0);
  const { ask, dialog } = useConfirm();

  useEffect(() => {
    void (async () => {
      const [t, c] = await Promise.all([
        supabase.from('individual_templates').select('id, club_id, isodow, start_time, end_time, goalkeepers, active').order('isodow').order('start_time'),
        supabase.from('clubs').select('id').order('id').limit(1),
      ]);
      if (t.error) return setError(errText(t.error.message));
      setTemplates((t.data ?? []) as Template[]);
      if (!c.error) setClubId(((c.data ?? []) as Club[])[0]?.id ?? '');
    })();
  }, [reload]);

  const startNew = () => {
    setEditing(null);
    setForm(EMPTY);
    setOpen(true);
    setNotice(null);
  };

  const startEdit = (t: Template) => {
    setEditing(t);
    setForm({ isodow: String(t.isodow), start: time5(t.start_time), end: t.end_time ? time5(t.end_time) : '', gk: t.goalkeepers, active: t.active });
    setOpen(true);
    setNotice(null);
  };

  const cancel = () => {
    setOpen(false);
    setEditing(null);
    setForm(EMPTY);
  };

  const save = async () => {
    const isodow = Number(form.isodow);
    if (!Number.isInteger(isodow) || isodow < 1 || isodow > 7) return setNotice({ ok: false, text: 'Выберите день недели.' });
    if (!/^\d{2}:\d{2}$/.test(form.start)) return setNotice({ ok: false, text: 'Укажите время начала.' });
    if (form.end && !/^\d{2}:\d{2}$/.test(form.end)) return setNotice({ ok: false, text: 'Укажите корректное время окончания.' });
    if (form.end && form.end <= form.start) return setNotice({ ok: false, text: 'Окончание должно быть позже начала.' });
    if (!editing && !clubId) return setNotice({ ok: false, text: 'Не найден клуб. Обновите экран и попробуйте снова.' });
    const payload = { isodow, start_time: form.start, end_time: form.end || null, goalkeepers: form.gk, active: form.active };
    setBusy('save');
    setNotice(null);
    const r = editing
      ? await supabase.from('individual_templates').update(payload).eq('id', editing.id)
      : await supabase.from('individual_templates').insert({ ...payload, club_id: clubId });
    setBusy(null);
    if (r.error) return setNotice({ ok: false, text: errText(r.error.message) });
    if (editing) setTemplates(cur => (cur ?? []).map(x => (x.id === editing.id ? { ...x, ...payload } : x)));
    else setReload(n => n + 1);
    setOpen(false);
    setEditing(null);
    setForm(EMPTY);
    setNotice({ ok: true, text: editing ? 'Шаблон сохранён.' : 'Шаблон создан.' });
  };

  const toggle = async (t: Template) => {
    if (t.active && !(await ask({ title: 'Отключить шаблон?', lines: [['Шаблон', slotTitle(t)]], note: 'Новые занятия по нему создаваться не будут. Прошедшие занятия, записи и постоянные игроки сохранятся.', confirmLabel: 'Отключить', danger: true }))) return;
    setBusy('t' + t.id);
    setNotice(null);
    const r = await supabase.from('individual_templates').update({ active: !t.active }).eq('id', t.id);
    setBusy(null);
    if (r.error) return setNotice({ ok: false, text: errText(r.error.message) });
    setTemplates(cur => (cur ?? []).map(x => (x.id === t.id ? { ...x, active: !t.active } : x)));
    setNotice({ ok: true, text: t.active ? 'Шаблон отключён. История и постоянные сохранены.' : 'Шаблон включён.' });
  };

  if (error) return <><p className="error" role="alert">{error}</p><button type="button" className="ks-btn secondary" onClick={() => { setError(null); setReload(n => n + 1); }}>Повторить</button></>;
  if (!templates) return <Loading />;
  const list = [...templates].sort((a, b) => a.isodow - b.isodow || a.start_time.localeCompare(b.start_time) || Number(a.goalkeepers) - Number(b.goalkeepers));

  return (
    <>
      <p className="muted">Шаблоны задают дни, время и тип индивидуальных тренировок. Отключённый шаблон не создаёт новые занятия; история и постоянные игроки сохраняются.</p>
      <button type="button" className="ks-btn" onClick={startNew}>Новый шаблон</button>
      {notice && <p className={notice.ok ? 'muted' : 'error'} role={notice.ok ? 'status' : 'alert'}>{notice.text}</p>}
      {open && (
        <form className="ks-card" onSubmit={e => { e.preventDefault(); void save(); }}>
          <h3>{editing ? 'Изменить шаблон' : 'Новый шаблон'}</h3>
          <label className="field">День недели<select value={form.isodow} onChange={e => setForm(f => ({ ...f, isodow: e.target.value }))}>{DAYS.slice(1).map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</select></label>
          <div className="two">
            <label className="field">Начало<input type="time" value={form.start} onChange={e => setForm(f => ({ ...f, start: e.target.value }))} /></label>
            <label className="field">Окончание (необязательно)<input type="time" value={form.end} onChange={e => setForm(f => ({ ...f, end: e.target.value }))} /></label>
          </div>
          <Segmented label="Тип тренировки" value={form.gk ? 'gk' : 'ind'} onChange={v => setForm(f => ({ ...f, gk: v === 'gk' }))} items={[{ value: 'ind', label: 'Индивидуальные' }, { value: 'gk', label: 'Вратари' }]} />
          <SwitchRow id="tpl-active" label="Шаблон активен" checked={form.active} onChange={v => setForm(f => ({ ...f, active: v }))} />
          <div className="ks-actions">
            <button type="submit" className="ks-btn" disabled={busy === 'save'}>{editing ? 'Сохранить' : 'Создать'}</button>
            <button type="button" className="ks-btn secondary" onClick={cancel}>Отмена</button>
          </div>
        </form>
      )}
      <h3>Все шаблоны</h3>
      {list.length === 0 ? (
        <EmptyState icon="calendar" title="Шаблонов нет" text="Создайте первый шаблон кнопкой выше." />
      ) : list.map(t => (
        <section className="ks-card" key={t.id || `${t.isodow}-${t.start_time}-${t.goalkeepers}`}>
          <div className="ks-line">
            <b style={{ overflowWrap: 'anywhere' }}>{slotTitle(t)}</b>
            <Pill tone={t.active ? 'success' : 'neutral'} dot>{t.active ? 'Активен' : 'Отключён'}</Pill>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <button type="button" className="ks-btn secondary" style={{ width: 'auto' }} onClick={() => startEdit(t)}>Изменить</button>
            <button type="button" className="ks-btn secondary" style={{ width: 'auto' }} disabled={busy === 't' + t.id} onClick={() => void toggle(t)}>{t.active ? 'Отключить' : 'Включить'}</button>
          </div>
        </section>
      ))}
      {dialog}
    </>
  );
}
