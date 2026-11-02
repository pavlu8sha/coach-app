import { useState } from 'react';
import { closeApp, telegramName } from '../lib/telegram';
import { supabase } from '../lib/supabase';
import { getThemePref, saveThemePref, type ThemePref } from '../lib/theme';
import { applyTelegramTheme } from '../ui/telegram-theme';
import { Avatar, ListRow, Segmented } from '../ui/components';
import HomeScreenPrompt from '../ui/HomeScreenPrompt';
import NotifyToggle from '../ui/NotifyToggle';
import MyData from './MyData';
import MyKids from './MyKids';
import { useConfirm } from '../ui/ConfirmSheet';

// Профиль родителя. Имя берётся из Telegram и видно только владельцу. Уведомления в Telegram — миграция 0026, docs/NOTIFICATIONS.md.
export default function Profile() {
  const { ask, dialog: confirmDialog } = useConfirm();
  const [view, setView] = useState<'main' | 'kids' | 'data'>('main');
  const [pref, setPref] = useState<ThemePref>(getThemePref());
  const [busy, setBusy] = useState(false);
  const name = telegramName();
  if (view === 'kids') return <MyKids onBack={() => setView('main')} />;
  if (view === 'data') return <MyData onBack={() => setView('main')} />;

  const choose = (p: ThemePref) => {
    saveThemePref(p);
    setPref(p);
    applyTelegramTheme('hybrid');
  };
  const askLogout = async () => {
    if (!(await ask({ title: 'Выйти из аккаунта?', note: 'Приложение закроется. При следующем открытии из Telegram вход произойдёт снова.', confirmLabel: 'Выйти', danger: true }))) return;
    await logout();
  };
  const logout = async () => {
    setBusy(true);
    await supabase.auth.signOut();
    closeApp();
  };

  return (
    <main className="page">
      <h1>Профиль</h1>
      <div className="ks-card" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 14 }}>
        <Avatar name={name ?? 'Родитель'} large />
        <div style={{ minWidth: 0 }}>
          <b style={{ overflowWrap: 'anywhere' }}>{name ?? 'Родитель'}</b>
          {name && <div className="ks-muted">Родитель</div>}
        </div>
      </div>

      <ListRow title="Мои дети" onClick={() => setView('kids')} />
      <ListRow title="Мои данные" sub={['Скачать, удалить']} onClick={() => setView('data')} />

      <p className="ks-label">Тема</p>
      <Segmented
        label="Тема оформления"
        value={pref}
        onChange={choose}
        items={[
          { value: 'auto', label: 'Авто' },
          { value: 'light', label: 'Светлая' },
          { value: 'dark', label: 'Тёмная' },
        ]}
      />

      <HomeScreenPrompt />
      <NotifyToggle hint="Бот пришлёт сообщение, когда администратор ответит на запрос о ребёнке, при оплате и при баллах от тренера. Чтобы сообщения приходили, один раз нажмите «Старт» в чате с ботом клуба." />

      <button type="button" className="ks-btn secondary" onClick={() => void askLogout()}>
        Выйти
      </button>
      {confirmDialog}
    </main>
  );
}
