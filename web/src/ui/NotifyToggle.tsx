import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { SwitchRow } from './components';

// Переключатель сообщений от бота. Не показывается, пока не известно значение (функция не установлена).
export default function NotifyToggle({ hint }: { hint: string }) {
  const [notify, setNotify] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);

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
      {err && <p className="error">{err}</p>}
    </>
  );
}
