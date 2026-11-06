import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { SwitchRow } from './components';

const DIRECTIONS: { id: string; label: string }[] = [
  { id: 'ind_sat', label: 'Индивидуальные тренировки: суббота' },
  { id: 'ind_sun', label: 'Индивидуальные тренировки: воскресенье' },
  { id: 'goalkeeper', label: 'Вратарские тренировки' },
  { id: 'extra', label: 'Дополнительные тренировки' },
];

// Переключатель сообщений от бота. Не показывается, пока не известно значение (функция не установлена).
// directions: у родителя ниже общего выключателя четыре независимые настройки по направлениям тренировок.
export default function NotifyToggle({ hint, directions = false }: { hint: string; directions?: boolean }) {
  const [notify, setNotify] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Record<string, boolean> | null>(null);

  useEffect(() => {
    if (!directions) return;
    void (async () => {
      const r = await supabase.rpc('notify_prefs_get');
      if (r.error || !Array.isArray(r.data)) return;
      const m: Record<string, boolean> = {};
      for (const row of r.data as { direction: string; enabled: boolean }[]) m[row.direction] = Boolean(row.enabled);
      setPrefs(m);
    })();
  }, [directions]);

  const setPref = async (id: string, on: boolean) => {
    setErr(null);
    setPrefs(p => ({ ...(p ?? {}), [id]: on }));
    const r = await supabase.rpc('notify_pref_set', { d: id, on_: on });
    if (r.error) {
      setPrefs(p => ({ ...(p ?? {}), [id]: !on }));
      setErr('Не удалось сохранить настройку.');
    }
  };

  useEffect(() => {
    void (async () => {
      const me = (await supabase.auth.getUser()).data.user?.id;
      if (!me) return;
      const r = await supabase.from('users').select('notifications_enabled').eq('id', me).maybeSingle();
      if (!r.error && r.data) setNotify(Boolean((r.data as { notifications_enabled: boolean }).notifications_enabled));
    })();
  }, []);

  const toggle = async (on: boolean) => {
    setErr(null);
    setNotify(on);
    const r = await supabase.rpc('set_notifications', { on_: on });
    if (r.error) {
      setNotify(!on);
      setErr('Не удалось сохранить настройку.');
    }
  };

  if (notify === null) return null;
  return (
    <>
      <p className="ks-label">Уведомления</p>
      <SwitchRow id="notify" label="Сообщения от бота в Telegram" checked={notify} onChange={v => void toggle(v)} />
      <p className="ks-muted" style={{ fontSize: 13, margin: '6px 0 12px' }}>{hint}</p>
      {directions && prefs && notify && (
        <>
          <p className="ks-label">О каких тренировках сообщать</p>
          {DIRECTIONS.map(d => <SwitchRow key={d.id} id={'notify-' + d.id} label={d.label} checked={Boolean(prefs[d.id])} onChange={v => void setPref(d.id, v)} />)}
          <p className="ks-muted" style={{ fontSize: 13, margin: '6px 0 12px' }}>Настройки действуют, пока включены сообщения от бота.</p>
        </>
      )}
      {err && <p className="error">{err}</p>}
    </>
  );
}
