import { useCallback, useEffect, useState } from 'react';
import { hasSession, signInWithTelegram } from './lib/auth';
import { configured } from './lib/supabase';
import { initData, prepareTelegram } from './lib/telegram';
import Home from './screens/Home';
import Message from './screens/Message';

type State = { kind: 'loading' } | { kind: 'ready' } | { kind: 'outside' } | { kind: 'config' } | { kind: 'error'; text: string };

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
      return <Home />;
  }
}
