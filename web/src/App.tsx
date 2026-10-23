import { useCallback, useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import { hasSession, signInWithTelegram } from './lib/auth';
import { configured } from './lib/supabase';
import { initData, prepareTelegram } from './lib/telegram';
import Admin from './screens/Admin';
import Home from './screens/Home';
import Players from './screens/Players';
import Schedule from './screens/Schedule';
import Message from './screens/Message';

type State = { kind: 'loading' } | { kind: 'ready' } | { kind: 'outside' } | { kind: 'config' } | { kind: 'error'; text: string };

function Shell() {
  const [admin, setAdmin] = useState(false);
  const [hasKids, setHasKids] = useState(true); // пока не знаем — не прячем вкладку
  const [tab, setTab] = useState<'home' | 'schedule' | 'admin' | 'players'>('home');
  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return;
      // RLS: пользователь читает только свою строку; флаг — только подсказка для меню, права проверяет база
      const r = await supabase.from('users').select('is_admin').eq('id', data.user.id).maybeSingle();
      const isAdm = Boolean(r.data?.is_admin);
      // у администратора вкладка «Ребёнок» нужна, только если он сам родитель
      const mine = await supabase.from('player_guardians').select('player_id', { count: 'exact', head: true }).eq('user_id', data.user.id).is('consent_revoked_at', null);
      setHasKids((mine.count ?? 0) > 0);
      setAdmin(isAdm);
      if (isAdm) setTab('admin'); // администратор открывает приложение сразу на запросах
    })();
  }, []);
  return (
    <>
      <nav className="tabs">
        {admin ? (
          <>
            <button className={tab === 'admin' ? 'on' : ''} onClick={() => setTab('admin')}>Запросы</button>
            <button className={tab === 'players' ? 'on' : ''} onClick={() => setTab('players')}>Дети</button>
            <button className={tab === 'schedule' ? 'on' : ''} onClick={() => setTab('schedule')}>Расписание</button>
            {hasKids && <button className={tab === 'home' ? 'on' : ''} onClick={() => setTab('home')}>Ребёнок</button>}
          </>
        ) : (
          <>
            <button className={tab === 'home' ? 'on' : ''} onClick={() => setTab('home')}>Ребёнок</button>
            <button className={tab === 'schedule' ? 'on' : ''} onClick={() => setTab('schedule')}>Расписание</button>
          </>
        )}
      </nav>
      {admin && tab === 'admin' ? <Admin /> : admin && tab === 'players' ? <Players /> : tab === 'schedule' ? <Schedule all={admin} /> : <Home isAdmin={admin} />}
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
