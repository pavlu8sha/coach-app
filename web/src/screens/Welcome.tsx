import type { ReactNode } from 'react';
import { ADMIN_CHAT } from '../lib/clubInfo';
import { Avatar, Pill } from '../ui/components';

const BOT = (import.meta.env.VITE_TG_BOT_USERNAME as string | undefined)?.replace(/^@/, '');
// Подключение происходит в боте клуба; без имени бота ведём в чат администратора
export const CONNECT_URL = BOT ? `https://t.me/${BOT}` : ADMIN_CHAT;

const Icon = ({ children }: { children: ReactNode }) => (
  <span className="ks-ico" aria-hidden="true">
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  </span>
);

const BENEFITS = [
  { title: 'Расписание', text: 'Тренировки и важные события клуба.', icon: (<><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>) },
  { title: 'Прогресс ребёнка', text: 'Баллы за занятия и достижения.', icon: (<><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></>) },
  { title: 'Всё для семьи', text: 'Оплата и сообщения клуба в одном месте.', icon: (<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>) },
];

// Вымышленный пример: статичный, не связан с базой и не похож на реального воспитанника.
const DEMO = { name: 'Пример Игрок', group: 'U10', points: 12, events: [['Тренировка', '+1'], ['Победа команды', '+2'], ['Тренировка', '+1']] };

// Страница для тех, кто открыл приложение без входа. Данных из базы здесь нет.
export default function Welcome({ onLogin }: { onLogin?: () => void }) {
  return (
    <main className="page">
      <section className="ks-hero">
        <img src="/icon-192.png" alt="" width="72" height="72" />
        <h1>KicksApp</h1>
        <p>Футбольная жизнь вашего ребёнка в одном месте</p>
        <a className="ks-btn" href={CONNECT_URL} target="_blank" rel="noreferrer">
          Подключиться к школе
        </a>
        {onLogin && (
          <p className="ks-login">
            Уже есть аккаунт?{' '}
            <button type="button" className="link-btn" onClick={onLogin}>
              Войти
            </button>
          </p>
        )}
      </section>
      <section className="ks-card" aria-label="Что внутри">
        {BENEFITS.map(b => (
          <div className="ks-benefit" key={b.title}>
            <Icon>{b.icon}</Icon>
            <div>
              <b>{b.title}</b>
              <span className="t">{b.text}</span>
            </div>
          </div>
        ))}
      </section>
      <section className="ks-card ks-demo" aria-label="Пример профиля">
        <Pill tone="neutral">Пример · вымышленные данные</Pill>
        <div className="ks-demo-head">
          <Avatar name={DEMO.name} />
          <span className="name">
            {DEMO.name}
            <small>{DEMO.group}</small>
          </span>
          <span className="ks-demo-pts">
            {DEMO.points}
            <small>баллов</small>
          </span>
        </div>
        {DEMO.events.map(([t, p], i) => (
          <div className="ks-demo-ev" key={i}>
            <span>{t}</span>
            <b>{p}</b>
          </div>
        ))}
      </section>
    </main>
  );
}
