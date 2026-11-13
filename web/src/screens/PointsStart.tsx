import { useEffect, useState } from 'react';
import { today } from '../lib/coach';
import { supabase } from '../lib/supabase';
import { useConfirm } from '../ui/ConfirmSheet';

const fmt = (iso: string) => iso.split('-').reverse().join('.');

// Для администратора: с какой даты считаются баллы (миграция 0040). Баллы раньше этой даты никому не показываются.
export default function PointsStart() {
  const { ask, dialog: confirmDialog } = useConfirm();
  const [current, setCurrent] = useState<string | null | undefined>(undefined); // undefined — ещё не знаем
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => {
    const r = await supabase.rpc('points_start');
    if (r.error) return setMsg({ ok: false, text: r.error.message.includes('Could not find the function') ? 'Функция ещё не установлена в базе (миграция 0040).' : r.error.message });
    setCurrent((r.data as string | null) ?? null);
  };
  useEffect(() => { void load(); }, []);

  const save = async (d: string | null) => {
    setBusy(true);
    setMsg(null);
    const r = await supabase.rpc('set_points_start', { d });
    setBusy(false);
   
    if (r.error) return setMsg({ ok: false, text: r.error.message.includes('forbidden') ? 'Нет прав: дату задаёт только администратор.' : r.error.message });
    setMsg({ ok: true, text: d ? `Баллы считаются с ${fmt(d)}.` : 'Ограничение снято: видна вся история баллов.' });
    await load();
  };

  const askSave = async () => {
    if (!(await ask({ title: 'Задать дату старта?', lines: [['Дата', fmt(date)]], note: 'Журнал баллов пересчитается: начисления раньше этой даты закроются, серии начнутся заново, ручные баллы до даты закроются и при снятии даты не вернутся. Записи не удаляются.', confirmLabel: 'Задать дату', danger: true }))) return;
    await save(date);
  };

  return (
    <main className="page">
      <h1>Старт подсчёта баллов</h1>
      <p className="muted" style={{ marginBottom: 12 }}>
        Баллы раньше выбранной даты никто не увидит в приложении: ни родители и дети, ни тренеры, ни вы. Задайте день запуска для родителей, и все начнут с нуля: начисления до этой даты закрываются, серии и рекорды серий начинаются заново, ручные баллы тренеров до даты тоже закрываются. Записи не удаляются. Если снять ограничение, начисления за тренировки, матчи и серии вернутся, а закрытые ручные баллы нет. Пока дата в будущем, тренеры не могут начислять ручные баллы: задавайте её в день запуска.
      </p>
      <div className="ks-card">
        <b>Сейчас: {current === undefined ? 'загрузка…' : current ? `с ${fmt(current)}` : 'ограничения нет, видна вся история'}</b>
      </div>
      {msg && <p className={msg.ok ? 'ks-ok' : 'error'}>{msg.text}</p>}
      <label className="field">Дата старта<input type="date" value={date} onChange={e => { setDate(e.target.value); }} /></label>
      <button type="button" className="ks-btn" disabled={!date} onClick={() => void askSave()}>Задать дату старта</button>
      {current && (
        <>
          <div style={{ height: 8 }} />
          <button type="button" className="ks-btn secondary" disabled={busy} onClick={() => void save(null)}>Снять ограничение</button>
        </>
      )}
      {confirmDialog}
    </main>
  );
}
