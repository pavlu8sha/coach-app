import { useCallback, useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import { hasSession, signInWithTelegram, signInWithWidget } from './lib/auth';
import { configured } from './lib/supabase';
import { initData, prepareTelegram } from './lib/telegram';
import Admin from './screens/Admin';
import Home from './screens/Home';
import Payments from './screens/Payments';
import Players from './screens/Players';
import Schedule from './screens/Schedule';
import Matches from './screens/Matches';
import Profile from './screens/Profile';
import Message from './screens/Message';
import BrowserLogin, { browserLoginEnabled } from './screens/BrowserLogin';
import About from './screens/About';
import RoleSelect, { type Role } from './screens/RoleSelect';
import More from './screens/More';
import CoachMatches from './screens/CoachMatches';
import Group from './screens/Group';
import Sessions from './screens/Sessions';
import type { CoachGroup } from './lib/coach';
import { BottomNav } from './ui/components';

type State = { kind: 'loading' } | { kind: 'ready' } | { kind: 'outside' } | { kind: 'config' } | { kind: 'error'; text: string };

type Tab = 'about' | 'home' | 'schedule' | 'matches' | 'payments' | 'profile' | 'admin' | 'players' | 'more' | 'sessions' | 'cmatches' | 'group';

function Shell() {
  const [admin, setAdmin] = useState(false);
  const [coachGroups, setCoachGroups] = useState<CoachGroup[]>([]);
  const [allGroups, setAllGroups] = useState<CoachGroup[]>([]); // для администратора: все группы
  const [moreKey, setMoreKey] = useState(0);
  const [hasKids, setHasKids] = useState(true); // пока не знаем — не прячем вкладку
  const [loaded, setLoaded] = useState(false);
  const [role, setRole] = useState<Role | null>(null);
  const [changingRole, setChangingRole] = useState(false);
  const [tab, setTab] = useState<Tab>('home');
  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return setLoaded(true);
      // RLS: пользователь читает только свою строку; флаг и роль — только подсказка для меню, права проверяет база
      const r = await supabase.from('users').select('is_admin, chosen_role').eq('id', data.user.id).maybeSingle();
      setRole((r.data?.chosen_role as Role | null) ?? null);
      const isAdm = Boolean(r.data?.is_admin);
      // у администратора вкладка «Ребёнок» нужна, только если он сам родитель
      const mine = await supabase.from('player_guardians').select('player_id', { count: 'exact', head: true }).eq('user_id', data.user.id).is('consent_revoked_at', null);
      setHasKids((mine.count ?? 0) > 0);
      // тренер — тот, кому администратор назначил группы (coach_groups); каждый видит только свои строки
      const cg = await supabase.from('coach_groups').select('groups(id, name)').eq('user_id', data.user.id);
      const mineGroups = ((cg.data ?? []) as unknown as { groups: CoachGroup | null }[]).map(x => x.groups).filter((g): g is CoachGroup => Boolean(g)).sort((x, y) => x.name.localeCompare(y.name));
      setCoachGroups(mineGroups);
      if (isAdm) {
        const ag = await supabase.from('groups').select('id, name').order('name');
        setAllGroups(((ag.data ?? []) as CoachGroup[]).sort((x, y) => x.name.localeCompare(y.name)));
      }
      setAdmin(isAdm);
      if (isAdm) setTab('admin'); // администратор открывает приложение сразу на запросах
      else if (mineGroups.length) setTab('sessions'); // тренер — сразу на занятиях
      else if ((mine.count ?? 0) === 0 && r.data?.chosen_role && r.data.chosen_role !== 'parent') setTab('about');
      setLoaded(true);
    })();
  }, []);
  const coach = !admin && coachGroups.length > 0;
  if (!loaded) return <Message title="Загрузка…" />;
  // Роль спрашиваем при первом входе. Администратора, тренера с группами и тех, у кого уже есть дети, не трогаем.
  if (!admin && !coach && !hasKids && (role === null || changingRole)) {
    return (
      <RoleSelect
        onDone={r => {
          setRole(r);
          setChangingRole(false);
          setTab(r === 'parent' ? 'home' : 'about');
        }}
        onCancel={role ? () => setChangingRole(false) : undefined}
      />
    );
  }
  // Выбравшие не «Родитель» (и без детей) видят только открытую информацию
  if (!admin && !coach && !hasKids && role !== 'parent') {
    return (
      <>
        {tab === 'schedule' ? <Schedule all editable={false} /> : <About role={role} onChangeRole={() => setChangingRole(true)} />}
        <BottomNav
          label="Разделы"
          value={tab === 'schedule' ? 'schedule' : 'about'}
          onChange={setTab}
          items={[
            { value: 'about', label: 'О клубе', icon: 'user' },
            { value: 'schedule', label: 'Расписание', icon: 'calendar' },
          ]}
        />
      </>
    );
  }
  const screen =
    admin && tab === 'admin' ? <Admin />
    : admin && tab === 'players' ? <Players />
    : admin && tab === 'more' ? <More key={moreKey} groups={allGroups} />
    : (admin || coach) && tab === 'sessions' ? <Sessions groups={admin ? allGroups : coachGroups} />
    : (admin || coach) && tab === 'cmatches' ? <CoachMatches groups={admin ? allGroups : coachGroups} admin={admin} />
    : coach && tab === 'group' ? <Group groups={coachGroups} />
    : tab === 'schedule' ? <Schedule all={admin} />
    : !admin && !coach && tab === 'matches' ? <Matches />
    : !admin && !coach && tab === 'profile' ? <Profile />
    : !admin && !coach && tab === 'payments' ? <Payments />
    : <Home isAdmin={admin} />;
  const kidsTab = hasKids ? [{ value: 'home' as const, label: 'Ребёнок', icon: 'child' as const }] : [];
  return (
    <>
      {screen}
      <BottomNav
        label="Разделы"
        value={tab}
        onChange={v => {
          if (v === 'more' && tab === 'more') setMoreKey(k => k + 1); // повторное нажатие «Ещё» — назад к списку
          setTab(v);
        }}
        items={
          admin
            ? [
                { value: 'admin', label: 'Запросы', icon: 'inbox' },
                { value: 'players', label: 'Дети', icon: 'users' },
                { value: 'sessions', label: 'Занятия', icon: 'calendar' },
                { value: 'cmatches', label: 'Матчи', icon: 'trophy' },
                { value: 'more', label: 'Ещё', icon: 'more' },
              ]
            : coach
              ? [
                  { value: 'sessions', label: 'Занятия', icon: 'calendar' },
                  { value: 'cmatches', label: 'Матчи', icon: 'trophy' },
                  { value: 'group', label: 'Группа', icon: 'users' },
                  ...kidsTab,
                ]
              : [
                  { value: 'home', label: 'Ребёнок', icon: 'child' },
                  { value: 'schedule', label: 'Расписание', icon: 'calendar' },
                  { value: 'matches', label: 'Матчи', icon: 'trophy' },
                  { value: 'payments', label: 'Оплата', icon: 'wallet' },
                  { value: 'profile', label: 'Профиль', icon: 'user' },
                ]
        }
      />
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
      if (browserLoginEnabled) {
        // вход из обычного браузера: виджет Telegram Login → tg-login
        return (
          <BrowserLogin
            onUser={u => {
              setState({ kind: 'loading' });
              signInWithWidget(u).then(
                () => setState({ kind: 'ready' }),
                e => setState({ kind: 'error', text: e instanceof Error ? e.message : 'Неизвестная ошибка' }),
              );
            }}
          />
        );
      }
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
