import { useCallback, useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import { hasSession, signInWithTelegram } from './lib/auth';
import { configured } from './lib/supabase';
import { initData, prepareTelegram } from './lib/telegram';
import Admin from './screens/Admin';
import Home from './screens/Home';
import Message from './screens/Message';

type State = { kind: 'loading' } | { kind: 'ready' } | { kind: 'outside' } | { kind: 'config' } | { kind: 'error'; text: string };

function Shell() {
  const [admin, setAdmin] = useState(false);
  const [tab, setTab] = useState<'home' | 'admin'>('home');
  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return;
      // RLS: пользователь читает только свою строку; флаг — только подсказка для меню, права проверяет база
      const r = await supabase.from('users').select('is_admin').eq('id', data.user.id).maybeSingle();
      setAdmin(Boolean(r.data?.is_admin));
    })();
  }, []);
  return (
    <>
      {admin && (
        <nav className="tabs">
          <button className={tab === 'home' ? 'on' : ''} onClick={() => setTab('home')}>Ребёнок</button>
          <button className={tab === 'admin' ? 'on' : ''} onClick={() => setTab('admin')}>Запросы</button>
        </nav>
      )}
      {tab === 'admin' && admin ? <Admin /> : <Home />}
    </>
  );
}

export default function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  const start = useCallback(async () => {
    setState({ kind: 'loading' });
    prepareTelegram();
    if (!configured) return setState({ kind: 'config' });
    try {
      if (await hasSession()) return setState({ kind: 'ready' });
      const data = initData();
      if (!data) return setState({ kind: 'outside' });
      await signInWithTelegram(data);
      setState({ kind: 'ready' });
    } catch (e) {
      setState({ kind: 'error', text: e instanceof Error ? e.message : 'Неизвестная ошибка' });
    }
  }, []);

  useEffect(() => {
    void start();
  }, [start]);

  switch (state.kind) {
    case 'loading':
      return <Message title="Загрузка…" />;
    case 'config':
      return <Message title="Приложение не настроено" text="Не заданы VITE_SUPABASE_URL и VITE_SUPABASE_PUBLISHABLE_KEY." />;
    case 'outside':
      return (
        <Message
          title="Откройте через Telegram"
          text="Вход пока работает только из Telegram: откройте приложение кнопкой в чате с ботом клуба."
        />
      );
    case 'error':
      return <Message title="Не получилось войти" text={state.text} action={{ label: 'Повторить', run: () => void start() }} />;
    case 'ready':
      return <Shell />;
  }
}
