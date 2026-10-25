import { ADMIN_CHAT, BRANCHES, CAMP, CHAMPIONSHIPS, CLUB_CHANNEL, EQUIPMENT, GOALKEEPERS, INDIVIDUAL, INSTALLMENT_CHAT } from '../lib/clubInfo';
import type { Role } from './RoleSelect';
import TrialForm from './TrialForm';

export { CLUB_CHANNEL };

const linkBtn = { display: 'inline-block', textDecoration: 'none', marginTop: 8 } as const;
const Sign = ({ text = 'Записаться' }: { text?: string }) => (
  <a className="ks-btn" style={linkBtn} href={ADMIN_CHAT} target="_blank" rel="noreferrer">{text}</a>
);
const List = ({ items }: { items: string[] }) => (
  <ul style={{ margin: '8px 0', paddingLeft: 20 }}>{items.map(x => <li key={x}>{x}</li>)}</ul>
);

// «О клубе» для гостя, ребёнка и тренера без назначенных групп: только открытая информация, без данных детей и результатов игроков.
export default function About({ role, onChangeRole }: { role: Role | null; onChangeRole: () => void }) {
  return (
    <main className="page">
      <h1>FC KickStart Tbilisi</h1>
      {role === 'coach' && (
        <section className="ks-card">
          <h2>Вы вошли как тренер</h2>
          <p className="muted">Администратор клуба назначит вам группы, после этого здесь появятся отметки, матчи и баллы. Пока доступна открытая информация о клубе.</p>
        </section>
      )}
      <TrialForm />
      <section className="ks-card">
        <h2>Филиалы</h2>
        <p className="muted">У клуба три филиала. Время тренировок смотрите во вкладке «Расписание».</p>
        <List items={BRANCHES} />
      </section>
      <section className="ks-card">
        <h2>Чемпионаты сезона 2026/27</h2>
        {CHAMPIONSHIPS.map(c => (
          <p key={c.name}><b>{c.name}</b><br /><span className="muted">{c.teams}</span></p>
        ))}
      </section>
      <section className="ks-card">
        <h2>Индивидуальные тренировки</h2>
        <p className="muted">{INDIVIDUAL.lead}</p>
        <p>Ближайшие три месяца разбираем четыре блока:</p>
        <List items={INDIVIDUAL.blocks} />
        <List items={[...INDIVIDUAL.schedule, INDIVIDUAL.note]} />
        <Sign />
      </section>
      <section className="ks-card">
        <h2>Вратарские тренировки</h2>
        <p className="muted">{GOALKEEPERS.lead}</p>
        <List items={GOALKEEPERS.skills} />
        <Sign />
      </section>
      <section className="ks-card">
        <h2>Экипировка 2026/27</h2>
        {EQUIPMENT.items.map(i => (
          <p key={i.name}><b>{i.name} — {i.price} GEL</b><br /><span className="muted">{i.note}</span></p>
        ))}
        <p>{EQUIPMENT.bundle}</p>
        <p className="muted">{EQUIPMENT.installment} {EQUIPMENT.fitting}</p>
        <Sign text="Заказать" />
        <a className="ks-btn secondary" style={linkBtn} href={INSTALLMENT_CHAT} target="_blank" rel="noreferrer">Вопросы по рассрочке</a>
      </section>
      <section className="ks-card">
        <h2>{CAMP.title}</h2>
        <p><b>{CAMP.when}</b><br /><span className="muted">Группы: {CAMP.groups}</span></p>
        <List items={CAMP.facts} />
        {CAMP.prices.map(p => (
          <p key={p.name}><b>{p.name} — {p.price}</b><br /><span className="muted">{p.note}</span></p>
        ))}
        <List items={CAMP.terms} />
        <Sign text="Забронировать место" />
      </section>
      <section className="ks-card">
        <h2>Наш канал</h2>
        <p className="muted">Новости клуба, результаты, фото и объявления.</p>
        <a className="ks-btn secondary" style={linkBtn} href={CLUB_CHANNEL} target="_blank" rel="noreferrer">Открыть канал</a>
      </section>
      <button type="button" className="ks-btn secondary" onClick={onChangeRole}>
        Сменить роль
      </button>
    </main>
  );
}
