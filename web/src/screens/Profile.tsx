import { useState } from 'react';
import { closeApp, telegramName } from '../lib/telegram';
import { supabase } from '../lib/supabase';
import { getThemePref, saveThemePref, type ThemePref } from '../lib/theme';
import { applyTelegramTheme } from '../ui/telegram-theme';
import { Avatar, ListRow, Segmented } from '../ui/components';
import MyData from './MyData';
import MyKids from './MyKids';

// Профиль родителя: только то, что уже есть в приложении. Имя берётся из Telegram и видно только владельцу.
// Уведомлений в системе нет, поэтому переключателя уведомлений здесь нет.
export default function Profile() {
  const [view, setView] = useState<'main' | 'kids' | 'data'>('main');
  const [pref, setPref] = useState<ThemePref>(getThemePref());
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const name = telegramName();

  if (view === 'kids') return <MyKids onBack={() => setView('main')} />;
  if (view === 'data') return <MyData onBack={() => setView('main')} />;

  const choose = (p: ThemePref) => {
    saveThemePref(p);
    setPref(p);
    applyTelegramTheme('hybrid');
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

      {confirm ? (
        <div className="ks-card">
          <p style={{ marginBottom: 10 }}>Выйти из аккаунта? Приложение закроется. При следующем открытии из Telegram вход произойдёт снова.</p>
          <button type="button" className="ks-btn" disabled={busy} onClick={() => void logout()}>
            Выйти
          </button>
          <div style={{ height: 8 }} />
          <button type="button" className="ks-btn secondary" disabled={busy} onClick={() => setConfirm(false)}>
            Отмена
          </button>
        </div>
      ) : (
        <button type="button" className="ks-btn secondary" onClick={() => setConfirm(true)}>
          Выйти
        </button>
      )}
    </main>
  );
}
