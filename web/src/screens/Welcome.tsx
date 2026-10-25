import { ADMIN_CHAT } from '../lib/clubInfo';
import { Pill } from '../ui/components';

const BOT = (import.meta.env.VITE_TG_BOT_USERNAME as string | undefined)?.replace(/^@/, '');
// Подключение происходит в боте клуба; без имени бота ведём в чат администратора
export const CONNECT_URL = BOT ? `https://t.me/${BOT}` : ADMIN_CHAT;

const BENEFITS = [
  { title: 'Расписание', text: 'Тренировки и важные события клуба.' },
  { title: 'Прогресс ребёнка', text: 'Баллы за занятия и достижения.' },
  { title: 'Всё для семьи', text: 'Оплата и сообщения клуба в одном месте.' },
];

// Вымышленный пример: статичный, не связан с базой и не похож на реального воспитанника.
const DEMO = { name: 'Пример Игрок', group: 'U10', points: 12, events: [['Тренировка', '+1'], ['Победа команды', '+2'], ['Тренировка', '+1']] };

// Страница для тех, кто открыл приложение без входа. Данных из базы здесь нет.
export default function Welcome({ onLogin }: { onLogin?: () => void }) {
  return (
    <main className="page">
      <img src="/icon-192.png" alt="" width="64" height="64" style={{ borderRadius: 16 }} />
      <h1>KicksApp</h1>
      <p className="muted" style={{ marginBottom: 14 }}>Футбольная жизнь вашего ребёнка в одном месте.</p>
      <a className="ks-btn" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }} href={CONNECT_URL} target="_blank" rel="noreferrer">
        Подключиться к школе
      </a>
      {onLogin && (
        <p className="muted note" style={{ textAlign: 'center', marginTop: 10 }}>
          Уже есть аккаунт?{' '}
          <button type="button" className="link-btn" onClick={onLogin}>
            Войти
          </button>
        </p>
      )}
      <section className="ks-card" style={{ marginTop: 14 }} aria-label="Что внутри">
        {BENEFITS.map(b => (
          <p key={b.title} style={{ margin: '0 0 10px' }}>
            <b>{b.title}</b>
            <br />
            <span className="muted">{b.text}</span>
          </p>
        ))}
      </section>
      <section className="ks-card" aria-label="Пример профиля">
        <p>
          <Pill tone="neutral">Пример</Pill> <span className="muted note">Вымышленные данные</span>
        </p>
        <h2>{DEMO.name}</h2>
        <p className="muted">{DEMO.group} · баллов: {DEMO.points}</p>
        {DEMO.events.map(([t, p], i) => (
          <p key={i} className="note">
            {t} <b>{p}</b>
          </p>
        ))}
      </section>
    </main>
  );
}
