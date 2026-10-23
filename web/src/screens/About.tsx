import type { Role } from './RoleSelect';

export const CLUB_CHANNEL = 'https://t.me/fc_kickstart_tbs';

// «О клубе» для гостя, ребёнка и тренера без назначенных групп: только открытая информация.
export default function About({ role, onChangeRole }: { role: Role | null; onChangeRole: () => void }) {
  return (
    <main className="page">
      <h1>FC KickStart Tbilisi</h1>
      {role === 'coach' && (
        <section className="card">
          <h2>Вы вошли как тренер</h2>
          <p className="muted">Администратор клуба назначит вам группы, после этого здесь появятся отметки, матчи и баллы. Пока доступна открытая информация о клубе.</p>
        </section>
      )}
      <section className="card">
        <h2>О клубе</h2>
        <p className="muted">Футбольный клуб для детей в Тбилиси. Во вкладке «Расписание» вы найдёте тренировки всех групп, ближайшие матчи и результаты.</p>
        <a className="btn ghost" style={{ display: 'inline-block', textDecoration: 'none' }} href={CLUB_CHANNEL} target="_blank" rel="noreferrer">
          Наш канал
        </a>
      </section>
      <button type="button" className="btn ghost" onClick={onChangeRole}>
        Сменить роль
      </button>
    </main>
  );
}
