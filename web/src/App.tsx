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
import Message, { Splash } from './screens/Message';
import BrowserLogin, { browserLoginEnabled } from './screens/BrowserLogin';
import About from './screens/About';
import Welcome from './screens/Welcome';
import ParentSchedule from './screens/ParentSchedule';
import RoleSelect, { type Role } from './screens/RoleSelect';
import More from './screens/More';
import CoachMatches from './screens/CoachMatches';
import Group from './screens/Group';
import Sessions from './screens/Sessions';
import ChildHome, { ChildCode, type ChildPlayer } from './screens/ChildHome';
import ChildMatches from './screens/ChildMatches';
import type { CoachGroup } from './lib/coach';
import { BottomNav } from './ui/components';

type State = { kind: 'loading' } | { kind: 'ready' } | { kind: 'outside' } | { kind: 'config' } | { kind: 'error'; text: string };

type Tab = 'about' | 'home' | 'schedule' | 'matches' | 'payments' | 'profile' | 'admin' | 'players' | 'more' | 'sessions' | 'cmatches' | 'group';

const PREVIEW_LABEL: Record<Role, string> = { parent: 'Родитель', child: 'Ребёнок', guest: 'Гость', coach: 'Тренер без групп' };

// Администратор может посмотреть экраны гостя, родителя и ребёнка: это только предпросмотр, права остаются администраторскими (проверяет база).
export function Shell() {
  const [preview, setPreview] = useState<Role | null>(null);
  return (
    <>
      {preview && (
        <div role="status" style={{ position: 'sticky', top: 0, zIndex: 20, display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', background: 'var(--ks-primary, #14213d)', color: '#fff', fontSize: 14 }}>
          <span>Режим просмотра: {PREVIEW_LABEL[preview]}</span>
          <button type="button" className="ks-btn sm" style={{ width: 'auto' }} onClick={() => setPreview(null)}>Выйти</button>
        </div>
      )}
      <ShellInner preview={preview} setPreview={setPreview} />
    </>
  );
}

function ShellInner({ preview, setPreview }: { preview: Role | null; setPreview: (r: Role | null) => void }) {
  const [adminReal, setAdmin] = useState(false);
  const [coachGroups, setCoachGroups] = useState<CoachGroup[]>([]);
  const [allGroups, setAllGroups] = useState<CoachGroup[]>([]); // все группы: администратору и тренеру (тренеры ведут все группы, миграция 0042)
  const [moreKey, setMoreKey] = useState(0);
  const [hasKidsReal, setHasKids] = useState(true); // пока не знаем — не прячем вкладку
  const [loaded, setLoaded] = useState(false);
  const [roleReal, setRole] = useState<Role | null>(null);
  const [changingRole, setChangingRole] = useState(false);
  const [childPlayer, setChildPlayer] = useState<ChildPlayer | null>(null); // игрок, к которому привязан аккаунт ребёнка
  const [childLoaded, setChildLoaded] = useState(false);
  const [childKey, setChildKey] = useState(0);
  const [tab, setTab] = useState<Tab>('home');
  // в предпросмотре администратор «становится» выбранной ролью без детей и без групп
  const admin = adminReal && !preview;
  const hasKids = hasKidsReal && !preview;
  const role = preview ?? roleReal;
  const startPreview = (r: Role) => {
    setPreview(r);
    setChangingRole(false);
    setTab(r === 'parent' || r === 'child' ? 'home' : 'about');
  };
  // Родитель без ребёнка может стать гостем: роль только подсказка интерфейса, права она не меняет
  const becomeGuest = async () => {
    const res = await supabase.rpc('set_my_role', { r: 'guest' });
    if (res.error) return;
    setRole('guest');
    setTab('about');
  };
  const exitPreview = () => {
    setPreview(null);
    setTab('more');
  };
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
      if (isAdm || mineGroups.length) {
        // тренеры видят и ведут все группы (миграция 0042): свои идут первыми
        const ag = await supabase.from('groups').select('id, name').order('name');
        const all = ((ag.data ?? []) as CoachGroup[]).sort((x, y) => x.name.localeCompare(y.name));
        const mineIds = new Set(mineGroups.map(g => g.id));
        setAllGroups(isAdm ? all : [...all.filter(g => mineIds.has(g.id)), ...all.filter(g => !mineIds.has(g.id))]);
      }
      setAdmin(isAdm);
      if (isAdm) setTab('admin'); // администратор открывает приложение сразу на запросах
      else if (mineGroups.length) setTab('sessions'); // тренер — сразу на занятиях
      else if ((mine.count ?? 0) === 0 && r.data?.chosen_role === 'child') setTab('home');
      else if ((mine.count ?? 0) === 0 && r.data?.chosen_role && r.data.chosen_role !== 'parent') setTab('about');
      setLoaded(true);
    })();
  }, []);
  useEffect(() => {
    if (role !== 'child') return;
    void (async () => {
      const me = (await supabase.auth.getUser()).data.user?.id;
      const l = me ? await supabase.from('child_links').select('players(id, full_name, groups(name))').eq('user_id', me).maybeSingle() : null;
      const pl = (l?.data as { players: { id: string; full_name: string | null; groups: { name: string } | null } | null } | null)?.players;
      setChildPlayer(pl ? { id: pl.id, name: pl.full_name ?? '', group: pl.groups?.name ?? null } : null);
      setChildLoaded(true);
    })();
  }, [role, childKey]);
  const coach = !admin && !preview && coachGroups.length > 0;
  if (!loaded) return <Splash />;
  // Роль спрашиваем при первом входе. Администратора, тренера с группами и тех, у кого уже есть дети, не трогаем.
  if (!admin && !coach && !hasKids && (role === null || changingRole)) {
    return (
      <RoleSelect
        onDone={r => {
          setRole(r);
          setChangingRole(false);
          setTab(r === 'parent' || r === 'child' ? 'home' : 'about');
        }}
        onCancel={role ? () => setChangingRole(false) : undefined}
      />
    );
  }
  // Ребёнок: свои баллы и матчи после ввода кода от родителя, плюс расписание клуба
  if (!admin && !coach && !hasKids && role === 'child') {
    if (!childLoaded) return <Splash />;
    const ct: 'home' | 'matches' | 'schedule' | 'about' = tab === 'matches' || tab === 'schedule' || tab === 'about' ? tab : 'home';
    const linked = childPlayer !== null;
    const cur = !linked && ct === 'matches' ? 'home' : ct;
    return (
      <>
        {cur === 'home' ? (
          childPlayer ? <ChildHome player={childPlayer} /> : <ChildCode onLinked={() => setChildKey(k => k + 1)} />
        ) : cur === 'matches' && childPlayer ? (
          <ChildMatches player={childPlayer} />
        ) : cur === 'schedule' ? (
          <Schedule all editable={false} />
        ) : (
          <About role={role} onChangeRole={() => (preview ? exitPreview() : setChangingRole(true))} />
        )}
        <BottomNav
          label="Разделы"
          value={cur}
          onChange={setTab}
          items={[
            { value: 'home', label: 'Мои баллы', icon: 'child' },
            ...(linked ? [{ value: 'matches' as const, label: 'Матчи', icon: 'trophy' as const }] : []),
            { value: 'schedule', label: 'Расписание', icon: 'calendar' },
            { value: 'about', label: 'О клубе', icon: 'user' },
          ]}
        />
      </>
    );
  }
  // Выбравшие не «Родитель» (и без детей) видят только открытую информацию
  if (!admin && !coach && !hasKids && role !== 'parent') {
    return (
      <>
        {tab === 'schedule' ? <Schedule all editable={false} /> : <About role={role} onChangeRole={() => (preview ? exitPreview() : setChangingRole(true))} />}
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
    : admin && tab === 'more' ? <More key={moreKey} groups={allGroups} onPreview={startPreview} />
    : (admin || coach) && tab === 'sessions' ? <Sessions groups={allGroups.length ? allGroups : coachGroups} />
    : (admin || coach) && tab === 'cmatches' ? <CoachMatches groups={allGroups.length ? allGroups : coachGroups} admin={admin} allTeams={!admin} />
    : coach && tab === 'group' ? <Group groups={coachGroups} notify withStats />
    : tab === 'schedule' ? (admin || coach || !hasKids ? <Schedule all={admin} /> : <ParentSchedule />)
    : !admin && !coach && tab === 'matches' ? <Matches />
    : !admin && !coach && tab === 'profile' ? <Profile />
    : !admin && !coach && tab === 'payments' ? <Payments />
    : <Home isAdmin={admin} onGuest={admin || coach || preview ? undefined : becomeGuest} />;
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
                { value: 'players', label: 'Игроки', icon: 'users' },
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

// Без входа: приветственная страница; вход через виджет Telegram Login включается отдельно (имя бота и домен в BotFather)
function OutsideGate({ onUser }: { onUser: (u: Record<string, unknown>) => void }) {
  const [login, setLogin] = useState(false);
  if (login) {
    return (
      <>
        <BrowserLogin onUser={onUser} />
        <main className="page center">
          <button type="button" className="ks-btn secondary" onClick={() => setLogin(false)}>
            Назад
          </button>
        </main>
      </>
    );
  }
  return <Welcome onLogin={browserLoginEnabled ? () => setLogin(true) : undefined} />;
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
      return <Splash />;
    case 'config':
      return <Message title="Приложение не настроено" text="Не заданы VITE_SUPABASE_URL и VITE_SUPABASE_PUBLISHABLE_KEY." />;
    case 'outside':
      return (
        <OutsideGate
          onUser={u => {
            setState({ kind: 'loading' });
            signInWithWidget(u).then(
              () => setState({ kind: 'ready' }),
              e => setState({ kind: 'error', text: e instanceof Error ? e.message : 'Неизвестная ошибка' }),
            );
          }}
        />
      );
    case 'error':
      return <Message title="Не получилось войти" text={state.text} action={{ label: 'Повторить', run: () => void start() }} />;
    case 'ready':
      return <Shell />;
  }
}
